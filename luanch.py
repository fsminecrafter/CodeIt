"""
CodeIt IDE — launch.py  (HTTPS)

Auto-generates a self-signed cert for localhost on first run,
then serves over https://localhost:8443.

First launch only: Chrome shows a security warning.
  Click "Advanced" → "Proceed to localhost (unsafe)"

Requires:  pip install cryptography
"""

import http.server, socketserver, ssl, webbrowser
import os, json, tempfile, subprocess, shutil, pathlib, datetime, ipaddress

PORT     = 8000
BASE_DIR = pathlib.Path(__file__).parent.resolve()
os.chdir(BASE_DIR)

CERT_FILE = BASE_DIR / "cert.pem"
KEY_FILE  = BASE_DIR / "key.pem"


def make_cert():
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        print("Generating self-signed certificate for localhost …")
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "CodeIt IDE"),
        ])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            ]), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))

        CERT_FILE.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        KEY_FILE.write_bytes(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()))
        print(f"  cert.pem + key.pem written to {BASE_DIR}\n")

    except ImportError:
        print("cryptography not found, trying openssl CLI …")
        try:
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", str(KEY_FILE), "-out", str(CERT_FILE),
                "-days", "3650", "-nodes", "-subj", "/CN=localhost",
                "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
            ], check=True, capture_output=True)
            print("  cert.pem + key.pem written via openssl\n")
        except Exception as e:
            print(f"ERROR: Cannot generate certificate: {e}")
            print("Run:  pip install cryptography")
            raise SystemExit(1)


if not CERT_FILE.exists() or not KEY_FILE.exists():
    make_cert()

MIME = {
    ".js": "application/javascript", ".mjs": "application/javascript",
    ".css": "text/css", ".html": "text/html", ".json": "application/json",
    ".wasm": "application/wasm", ".ico": "image/x-icon",
    ".py": "text/plain", ".txt": "text/plain", ".md": "text/plain",
}


class IDEHandler(http.server.SimpleHTTPRequestHandler):

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return MIME.get(ext, super().guess_type(path))

    def end_headers(self):
        # COOP/COEP required for SharedArrayBuffer (Pyodide threads)
        # Also enables File System Access API from https://localhost
        self.send_header("Cross-Origin-Opener-Policy",   "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Access-Control-Allow-Origin",  "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and len(args) >= 2 and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Invalid JSON"})
            return

        if self.path == "/build":
            lang = data.get("lang", "")
            code = data.get("code", "")
            if lang not in ("C", "C++"):
                self.send_json(400, {"error": f"Unsupported: {lang}"}); return

            ext, cc = ("c", "gcc") if lang == "C" else ("cpp", "g++")
            if not shutil.which(cc):
                self.send_json(200, {"error":
                    f"Compiler '{cc}' not found.\n"
                    "Linux : sudo apt install build-essential\n"
                    "macOS : brew install gcc\n"
                    "Windows: https://winlibs.com"}); return

            tmpdir   = tempfile.mkdtemp(prefix="codeit_")
            src_file = os.path.join(tmpdir, f"main.{ext}")
            exe_file = os.path.join(tmpdir, "main.exe" if os.name == "nt" else "main.out")
            with open(src_file, "w", encoding="utf-8") as f:
                f.write(code)
            r = subprocess.run([cc, src_file, "-o", exe_file, "-Wall"], capture_output=True, text=True)
            if r.returncode != 0:
                shutil.rmtree(tmpdir, ignore_errors=True)
                self.send_json(200, {"error": r.stderr or r.stdout})
            else:
                self.send_json(200, {"executable": exe_file})

        elif self.path == "/run":
            exe = data.get("exe", "")
            if not exe or not os.path.isfile(exe):
                self.send_json(400, {"stdout": "", "stderr": "Executable not found", "exit_code": -1}); return
            if os.name == "posix":
                os.chmod(exe, 0o755)
            try:
                r = subprocess.run([exe], capture_output=True, text=True,
                                   timeout=15, cwd=os.path.dirname(exe))
                self.send_json(200, {"stdout": r.stdout, "stderr": r.stderr, "exit_code": r.returncode})
            except subprocess.TimeoutExpired:
                self.send_json(200, {"stdout": "", "stderr": "Timed out (15s).", "exit_code": -1})
            except Exception as e:
                self.send_json(200, {"stdout": "", "stderr": str(e), "exit_code": -1})
            finally:
                d = os.path.dirname(exe)
                if d.startswith(tempfile.gettempdir()):
                    shutil.rmtree(d, ignore_errors=True)

        else:
            self.send_json(404, {"error": f"Unknown endpoint: {self.path}"})


class ReusingServer(socketserver.TCPServer):
    allow_reuse_address = True


with ReusingServer(("", PORT), IDEHandler) as httpd:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    url = f"https://localhost:{PORT}"
    print("┌────────────────────────────────────────────┐")
    print(f"│  CodeIt IDE  ▶  {url}    │")
    print("└────────────────────────────────────────────┘")
    print("  Python  →  Pyodide (in-browser)")
    print("  C/C++   →  gcc/g++ via this server")
    print()
    print("  ⚠  First launch: Chrome shows a security warning.")
    print('     Click "Advanced" → "Proceed to localhost (unsafe)"')
    print("     This only appears once per browser profile.")
    print()
    print("  Ctrl+C to stop.\n")

    webbrowser.open(url)
    httpd.serve_forever()
