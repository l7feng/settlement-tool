import importlib.util
import os
from pathlib import Path
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler,HTTPServer

repo=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(repo/'src'))
os.environ['SETTLEMENT_DATA_ROOT']=str(Path(__file__).parent.parent/'build/premium-20261022/reuse-test-data')
spec=importlib.util.spec_from_file_location('desktop_app',repo/'src/desktop_app.py')
app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)
class ReuseTests(unittest.TestCase):
    def probe(self,version,root,body=None):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                self.send_response(200)
                if version:self.send_header('X-Settlement-Version',version)
                if root:self.send_header('X-Settlement-Workspace-Root',root)
                self.end_headers();self.wfile.write(body or app.PING_BODY)
        server=HTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:return app._ping(server.server_port)
        finally:server.shutdown();server.server_close()
    def test_windows_exclusive_listener(self):
        import socketserver
        class OldServer(socketserver.TCPServer):allow_reuse_address=True
        old=OldServer(('127.0.0.1',0),BaseHTTPRequestHandler)
        try:
            with self.assertRaises(OSError):app._Server(old.server_address,BaseHTTPRequestHandler)
        finally:old.server_close()
    def test_matching_version_and_root_reused(self):self.assertTrue(self.probe(app.VERSION,app.workspace_root_id()))
    def test_old_version_rejected(self):self.assertFalse(self.probe('2.5.4',app.workspace_root_id()))
    def test_other_data_root_rejected(self):self.assertFalse(self.probe(app.VERSION,'other-root'))
    def test_old_protocol_without_headers_rejected(self):self.assertFalse(self.probe(None,None))
    def test_unrelated_service_rejected(self):self.assertFalse(self.probe(app.VERSION,app.workspace_root_id(),b'other app'))
if __name__=='__main__':unittest.main()

