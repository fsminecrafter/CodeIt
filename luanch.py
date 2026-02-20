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
os.chdir(os.path.dirname(__file__))

class BackendHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'Invalid JSON')
            return

        if self.path == "/build":
            lang = data.get("lang")
            code = data.get("code")

            if lang not in ["C", "C++"]:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Unsupported language")
                return

            ext = "c" if lang=="C" else "cpp"

            # Use temporary files
            with tempfile.TemporaryDirectory() as tmpdir:
                code_file = os.path.join(tmpdir, f"tmp.{ext}")
                exe_file = os.path.join(tmpdir, "tmp.exe" if os.name=="nt" else "tmp.out")
                
                with open(code_file, "w") as f:
                    f.write(code)
                
                compiler = "gcc" if lang=="C" else "g++"
                cmd = [compiler, code_file, "-o", exe_file]

                try:
                    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                    # On Windows, return path; on Linux, can return tmp dir
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    resp = {"executable": exe_file}
                    self.wfile.write(json.dumps(resp).encode())
                except subprocess.CalledProcessError as e:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    resp = {"error": e.stderr}
                    self.wfile.write(json.dumps(resp).encode())
        
        elif self.path == "/run":
            exe = data.get("exe")
            if not exe or not os.path.exists(exe):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Executable not found")
                return

            # Optional: run in temporary user on Linux (skip for Windows)
            if os.name == "posix":
                tmp_user = "tmpuser_ide"
                try:
                    subprocess.run(["sudo", "useradd", "-m", tmp_user], check=True)
                    shutil.chown(exe, user=tmp_user)
                    result = subprocess.run(["sudo", "-u", tmp_user, exe], capture_output=True, text=True)
                finally:
                    subprocess.run(["sudo", "userdel", "-r", tmp_user])
            else:
                # Windows: just run
                result = subprocess.run([exe], capture_output=True, text=True, shell=True)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            resp = {"output": result.stdout + result.stderr}
            self.wfile.write(json.dumps(resp).encode())

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Unknown endpoint")

with socketserver.TCPServer(("", PORT), BackendHandler) as httpd:
    url = f"http://localhost:{PORT}"
    print(f"Serving at {url}")
    webbrowser.open(url)
    httpd.serve_forever()
