import http.server
import socketserver
import webbrowser
import os

PORT = 8000

os.chdir(os.path.dirname(__file__))

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    url = f"http://localhost:{PORT}"
    print(f"Serving at {url}")
    webbrowser.open(url)
    httpd.serve_forever()
