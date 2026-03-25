#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys

os.chdir(r'D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future\dist')

PORT = 1002

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        super().end_headers()

handler = MyHTTPRequestHandler
httpd = socketserver.TCPServer(("", PORT), handler)

print(f"Server running at http://localhost:{PORT}")
print(f"Serving files from: {os.getcwd()}")
print("Press Ctrl+C to stop")

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped")
    sys.exit(0)



