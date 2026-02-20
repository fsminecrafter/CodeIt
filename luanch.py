import http.server
import socketserver
import webbrowser
import os
import json
import tempfile
import subprocess
import shutil
from urllib.parse import urlparse

PORT = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class BackendHandler(http.server.SimpleHTTPRequestHandler):

    def log_message(self, format, *args):
        # Suppress noisy request logs; only print errors
        if args and len(args) >= 2 and str(args[1]).startswith(('4', '5')):
            super().log_message(format, *args)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Invalid JSON"})
            return

        # ── /build ── compile C or C++ and return path to executable
        if self.path == "/build":
            lang = data.get("lang", "")
            code = data.get("code", "")

            if lang not in ("C", "C++"):
                self.send_json(400, {"error": "Unsupported language: " + lang})
                return

            ext      = "c" if lang == "C" else "cpp"
            compiler = "gcc" if lang == "C" else "g++"

            # Check compiler exists
            if not shutil.which(compiler):
                self.send_json(200, {
                    "error": f"Compiler '{compiler}' not found.\n"
                             f"Install it with:  sudo apt install build-essential   (Linux)\n"
                             f"                  brew install gcc                   (macOS)\n"
                             f"                  https://winlibs.com                (Windows)"
                })
                return

            # Write source to a persistent temp dir so /run can find it
            tmpdir   = tempfile.mkdtemp(prefix="codeit_")
            src_file = os.path.join(tmpdir, f"main.{ext}")
            exe_file = os.path.join(tmpdir, "main.exe" if os.name == "nt" else "main.out")

            with open(src_file, "w", encoding="utf-8") as f:
                f.write(code)

            cmd = [compiler, src_file, "-o", exe_file, "-Wall"]
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                shutil.rmtree(tmpdir, ignore_errors=True)
                self.send_json(200, {"error": result.stderr or result.stdout})
            else:
                self.send_json(200, {"executable": exe_file, "tmpdir": tmpdir})

        # ── /run ── execute compiled binary, return stdout + stderr + exit_code
        elif self.path == "/run":
            exe = data.get("exe", "")

            if not exe or not os.path.isfile(exe):
                self.send_json(400, {"error": "Executable not found", "stdout": "", "stderr": "", "exit_code": -1})
                return

            # Make executable on Unix
            if os.name == "posix":
                os.chmod(exe, 0o755)

            try:
                result = subprocess.run(
                    [exe],
                    capture_output=True,
                    text=True,
                    timeout=15,         # 15 second safety limit
                    cwd=os.path.dirname(exe)
                )
                self.send_json(200, {
                    "stdout":    result.stdout,
                    "stderr":    result.stderr,
                    "exit_code": result.returncode
                })
            except subprocess.TimeoutExpired:
                self.send_json(200, {
                    "stdout":    "",
                    "stderr":    "Process timed out after 15 seconds.",
                    "exit_code": -1
                })
            except Exception as e:
                self.send_json(200, {
                    "stdout":    "",
                    "stderr":    str(e),
                    "exit_code": -1
                })
            finally:
                # Clean up temp dir after running
                tmpdir = os.path.dirname(exe)
                if tmpdir.startswith(tempfile.gettempdir()):
                    shutil.rmtree(tmpdir, ignore_errors=True)

        else:
            self.send_json(404, {"error": "Unknown endpoint: " + self.path})


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


with ReusableTCPServer(("", PORT), BackendHandler) as httpd:
    url = f"http://localhost:{PORT}"
    print(f"╔══════════════════════════════════╗")
    print(f"║   CodeIt IDE — {url}  ║")
    print(f"╚══════════════════════════════════╝")
    print(f"  Python : Pyodide (runs in browser)")
    print(f"  C/C++  : gcc/g++ via this server")
    print(f"  Press Ctrl+C to stop\n")
    webbrowser.open(url)
    httpd.serve_forever()
