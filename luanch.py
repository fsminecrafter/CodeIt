"""
CodeIt IDE — launch.py  (HTTPS + LAN + C/C++ Sandbox)

• Binds to 0.0.0.0 so all LAN devices can connect.
• Auto-generates a self-signed cert covering localhost + all current LAN IPs.
  Cert is regenerated automatically when LAN IPs change.
• C/C++ runs inside a temporary system user (codeit_XXXXXXXX) for sandboxing:
    1. User is created with useradd
    2. Sandbox files are copied into the run directory and chowned to the user
    3. Executable runs as that user via runuser
    4. User and home dir are deleted on completion / server exit
  Falls back to normal execution on Windows or non-root Linux.
• /build endpoint accepts sandbox_files: {filename: content} to pre-populate
  the run directory before execution.

First launch: Chrome shows a security warning once per browser profile.
  Click "Advanced" → "Proceed to … (unsafe)"
  LAN devices need to visit the Network URL shown on startup.

Requires:  pip install cryptography
"""

import http.server, socketserver, ssl, webbrowser
import os, json, tempfile, subprocess, shutil, pathlib
import datetime, ipaddress, socket, threading, uuid, atexit, signal

PORT     = 8443
BASE_DIR = pathlib.Path(__file__).parent.resolve()
os.chdir(BASE_DIR)

CERT_FILE = BASE_DIR / "cert.pem"
KEY_FILE  = BASE_DIR / "key.pem"

IS_LINUX_ROOT = (os.name == "posix" and os.getuid() == 0
                 and shutil.which("useradd") is not None
                 and shutil.which("runuser") is not None)

# ── LAN IP detection ──────────────────────────────────────────────────────────

def get_lan_ips():
    ips = set()
    # Primary interface
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if not ip.startswith("127."):
            ips.add(ip)
    except Exception:
        pass
    # All interfaces via hostname
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


LAN_IPS = get_lan_ips()

# ── Certificate ───────────────────────────────────────────────────────────────

def make_cert():
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        sans = [x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))]
        for ip in LAN_IPS:
            try:
                sans.append(x509.IPAddress(ipaddress.IPv4Address(ip)))
            except Exception:
                pass

        lan_str = ", ".join(LAN_IPS) or "none"
        print(f"  Generating cert for localhost + LAN IPs ({lan_str}) …")

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "CodeIt IDE")])
        now  = datetime.datetime.now(datetime.timezone.utc)

        cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName(sans), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))

        CERT_FILE.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        KEY_FILE.write_bytes(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()))
        print("  cert.pem + key.pem written.\n")

    except ImportError:
        print("  cryptography not found, trying openssl …")
        altnames = "DNS:localhost,IP:127.0.0.1" + "".join(f",IP:{ip}" for ip in LAN_IPS)
        try:
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", str(KEY_FILE), "-out", str(CERT_FILE),
                "-days", "3650", "-nodes", "-subj", "/CN=CodeIt IDE",
                "-addext", f"subjectAltName={altnames}"
            ], check=True, capture_output=True)
            print("  cert.pem + key.pem written.\n")
        except Exception as e:
            print(f"ERROR: Cannot generate certificate: {e}")
            print("Run:  pip install cryptography")
            raise SystemExit(1)


def cert_needs_regen():
    if not CERT_FILE.exists() or not KEY_FILE.exists():
        return True
    if not LAN_IPS:
        return False
    try:
        from cryptography import x509
        cert = x509.load_pem_x509_certificate(CERT_FILE.read_bytes())
        san  = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        existing = {str(v) for v in san.value.get_values_for_type(x509.IPAddress)}
        return any(ip not in existing for ip in LAN_IPS)
    except Exception:
        return True


if cert_needs_regen():
    make_cert()

# ── Sandbox user management ───────────────────────────────────────────────────

_sandbox_lock  = threading.Lock()
_active_users  = set()


def create_sandbox_user():
    if not IS_LINUX_ROOT:
        return None
    username = "codeit_" + uuid.uuid4().hex[:8]
    try:
        subprocess.run(
            ["useradd", "--create-home", "--shell", "/bin/sh",
             "--comment", "CodeIt sandbox (temporary)", username],
            check=True, capture_output=True
        )
        with _sandbox_lock:
            _active_users.add(username)
        return username
    except subprocess.CalledProcessError:
        return None


def delete_sandbox_user(username):
    if not username:
        return
    try:
        subprocess.run(["pkill", "-u", username], capture_output=True)
    except Exception:
        pass
    try:
        subprocess.run(["userdel", "-r", "-f", username], capture_output=True)
    except Exception:
        pass
    with _sandbox_lock:
        _active_users.discard(username)


def cleanup_all():
    with _sandbox_lock:
        users = list(_active_users)
    for u in users:
        delete_sandbox_user(u)


atexit.register(cleanup_all)
for _sig in (signal.SIGTERM, signal.SIGINT):
    try:
        _orig = signal.getsignal(_sig)
        def _h(signum, frame, orig=_orig):
            cleanup_all()
            if callable(orig):
                orig(signum, frame)
            raise SystemExit(0)
        signal.signal(_sig, _h)
    except Exception:
        pass

# ── MIME types ────────────────────────────────────────────────────────────────

MIME = {
    ".js":   "application/javascript",  ".mjs": "application/javascript",
    ".css":  "text/css",                ".html": "text/html",
    ".json": "application/json",        ".wasm": "application/wasm",
    ".ico":  "image/x-icon",            ".py":   "text/plain",
    ".txt":  "text/plain",              ".md":   "text/plain",
}

# ── Request handler ───────────────────────────────────────────────────────────

class IDEHandler(http.server.SimpleHTTPRequestHandler):

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return MIME.get(ext, super().guess_type(path))

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy",   "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Access-Control-Allow-Origin",  "*")
        # Never cache JS files — ensures worker.js and app.js are always fresh
        if self.path and self.path.split("?")[0].endswith(".js"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
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

        # ── /build ── compile + set up sandbox run directory ─────────────────
        if self.path == "/build":
            lang          = data.get("lang", "")
            code          = data.get("code", "")
            # Dict of {filename: file_content_string} to pre-populate in rundir
            sandbox_files = data.get("sandbox_files", {})

            if lang not in ("C", "C++"):
                self.send_json(400, {"error": f"Unsupported language: {lang}"}); return

            ext, cc = ("c", "gcc") if lang == "C" else ("cpp", "g++")
            if not shutil.which(cc):
                self.send_json(200, {"error":
                    f"Compiler '{cc}' not found.\n"
                    "Linux : sudo apt install build-essential\n"
                    "macOS : brew install gcc\n"
                    "Windows: https://winlibs.com"}); return

            # Build in a temp dir
            builddir = tempfile.mkdtemp(prefix="codeit_build_")
            src_file = os.path.join(builddir, f"main.{ext}")
            exe_tmp  = os.path.join(builddir, "main.out")

            try:
                with open(src_file, "w", encoding="utf-8") as f:
                    f.write(code)
                r = subprocess.run(
                    [cc, src_file, "-o", exe_tmp, "-Wall"],
                    capture_output=True, text=True
                )
                if r.returncode != 0:
                    self.send_json(200, {"error": r.stderr or r.stdout})
                    return

                # Separate run directory (sandbox user will own this)
                rundir   = tempfile.mkdtemp(prefix="codeit_run_")
                exe_dest = os.path.join(rundir, "main.out")
                shutil.copy2(exe_tmp, exe_dest)

                # Write sandbox files
                for fname, content in sandbox_files.items():
                    safe = os.path.basename(fname)
                    if not safe:
                        continue
                    dest = os.path.join(rundir, safe)
                    try:
                        with open(dest, "w", encoding="utf-8", errors="replace") as fh:
                            fh.write(content)
                    except Exception:
                        pass

                # Make rundir world-readable/executable so sandbox user can enter
                if os.name == "posix":
                    os.chmod(rundir,   0o755)
                    os.chmod(exe_dest, 0o755)

                self.send_json(200, {
                    "executable":    exe_dest,
                    "rundir":        rundir,
                    "sandbox_files": list(sandbox_files.keys()),
                })
            finally:
                shutil.rmtree(builddir, ignore_errors=True)

        # ── /run ── execute binary (optionally as sandbox user) ───────────────
        elif self.path == "/run":
            exe    = data.get("exe", "")
            rundir = data.get("rundir", "")

            if not exe or not os.path.isfile(exe):
                self.send_json(400, {
                    "stdout": "", "stderr": "Executable not found", "exit_code": -1
                }); return

            if not rundir or not os.path.isdir(rundir):
                rundir = os.path.dirname(exe)

            # ── Snapshot directory state BEFORE execution ─────────────────────
            # Record every file's mtime so we can detect new/changed files after.
            # We exclude the executable itself and any pre-copied sandbox files.
            def snapshot(d):
                s = {}
                try:
                    for entry in os.scandir(d):
                        if entry.is_file(follow_symlinks=False):
                            try:
                                s[entry.name] = entry.stat().st_mtime
                            except OSError:
                                pass
                except OSError:
                    pass
                return s

            pre_snapshot = snapshot(rundir)

            sandbox_user = create_sandbox_user()

            try:
                if sandbox_user:
                    subprocess.run(
                        ["chown", "-R", f"{sandbox_user}:{sandbox_user}", rundir],
                        capture_output=True
                    )
                    cmd = ["runuser", "-u", sandbox_user, "--", exe]
                else:
                    if os.name == "posix":
                        os.chmod(exe, 0o755)
                    cmd = [exe]

                r = subprocess.run(
                    cmd, capture_output=True, text=True,
                    timeout=15, cwd=rundir
                )

                if sandbox_user:
                    sandbox_note = f"sandboxed as {sandbox_user}"
                elif IS_LINUX_ROOT:
                    sandbox_note = "sandbox user creation failed"
                else:
                    sandbox_note = "no sandbox (needs Linux + root)"

                # ── Diff directory AFTER execution ─────────────────────────────
                # Collect files that are new or have a newer mtime.
                # Skip the executable, skip files > 1 MB (binary guard).
                SKIP     = {"main.out", "main.exe", os.path.basename(exe)}
                MAX_SIZE = 1 * 1024 * 1024
                output_files = {}
                post_snapshot = snapshot(rundir)

                for fname, mtime in post_snapshot.items():
                    if fname in SKIP:
                        continue
                    # New file OR file whose mtime changed
                    if fname not in pre_snapshot or mtime != pre_snapshot[fname]:
                        fpath = os.path.join(rundir, fname)
                        try:
                            size = os.path.getsize(fpath)
                            if size > MAX_SIZE:
                                output_files[fname] = f"<binary or large file — {size} bytes>"
                                continue
                            with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                                output_files[fname] = fh.read()
                        except OSError:
                            pass

                self.send_json(200, {
                    "stdout":       r.stdout,
                    "stderr":       r.stderr,
                    "exit_code":    r.returncode,
                    "sandbox":      sandbox_note,
                    "output_files": output_files,   # {} if program wrote nothing
                })

            except subprocess.TimeoutExpired:
                self.send_json(200, {
                    "stdout": "", "stderr": "Timed out (15 s).",
                    "exit_code": -1, "sandbox": "", "output_files": {}
                })
            except Exception as e:
                self.send_json(200, {
                    "stdout": "", "stderr": str(e),
                    "exit_code": -1, "sandbox": "", "output_files": {}
                })
            finally:
                delete_sandbox_user(sandbox_user)
                if rundir.startswith(tempfile.gettempdir()):
                    shutil.rmtree(rundir, ignore_errors=True)

        else:
            self.send_json(404, {"error": f"Unknown endpoint: {self.path}"})


class ReusingServer(socketserver.TCPServer):
    allow_reuse_address = True


# ── Start server ──────────────────────────────────────────────────────────────

with ReusingServer(("0.0.0.0", PORT), IDEHandler) as httpd:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    local_url = f"https://localhost:{PORT}"
    width = 57

    print()
    print("┌" + "─" * width + "┐")
    print("│  CodeIt IDE" + " " * (width - 12) + "│")
    print(f"│  Local   ▶  {local_url:<{width-14}}│")
    for ip in LAN_IPS:
        lan_url = f"https://{ip}:{PORT}"
        print(f"│  Network ▶  {lan_url:<{width-14}}│")
    if not LAN_IPS:
        print(f"│  Network ▶  {'(no LAN interfaces detected)':<{width-14}}│")
    print("└" + "─" * width + "┘")
    print()
    print("  Python →  Pyodide (in-browser, no server needed)")
    sandbox_status = "YES — temporary user per run" if IS_LINUX_ROOT else "NO  — needs Linux + root"
    print(f"  C/C++  →  gcc/g++ sandbox: {sandbox_status}")
    print()
    print("  ⚠  First connection from any device: browser shows security warning.")
    print('     Click "Advanced" → "Proceed to … (unsafe)"')
    print("     LAN devices must use the Network URL above.")
    print()
    print("  Ctrl+C to stop.\n")

    webbrowser.open(local_url)
    httpd.serve_forever()
