"""
proxy/ctl.py's replay on the host, against a server on this machine that answers each case as the case says: what the
daemon would get back from a held request sent. argv: the proxy's folder; stdin: one line of JSON cases, each
`{credentials, headers, limit, response: {headers, body (base64)}}`; stdout: the proxy's limit, then each case's replay
and what its server was sent.
"""

import base64
import json
import sys
import threading
import types
from http.server import BaseHTTPRequestHandler, HTTPServer

# the proxy's image has certifi, for a replay over TLS; the host need not
sys.modules["certifi"] = types.SimpleNamespace(where=lambda: "")
sys.path.insert(0, sys.argv[1])

import ctl  # noqa: E402
import policy  # noqa: E402
import state  # noqa: E402

answer = {}
got = {}


class Server(BaseHTTPRequestHandler):
    def do_POST(self):
        got["headers"] = [[key, value] for key, value in self.headers.items()]
        self.rfile.read(int(self.headers.get("content-length", "0")))
        body = base64.b64decode(answer.get("body", ""))
        self.send_response(200)
        for key, value in answer.get("headers", []):
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


server = HTTPServer(("127.0.0.1", 0), Server)
threading.Thread(target=server.serve_forever, daemon=True).start()
# the one address a test may reach: this machine's, which the policy itself would refuse
policy.pin = lambda host, port, resolve, daemon_port=None: ("127.0.0.1", None)

LIMIT = ctl.RESPONSE_LIMIT
out = [LIMIT]
for case in json.loads(sys.stdin.readline()):
    answer.clear()
    answer.update(case["response"])
    got.clear()
    cfg = {"credentials": case.get("credentials", [])}
    state.config = lambda cfg=cfg: cfg
    ctl.RESPONSE_LIMIT = case.get("limit", LIMIT)
    request = {
        "method": "POST",
        "scheme": "http",
        "host": "forge.example",
        "port": server.server_address[1],
        "path": "/v1",
        "headers": case.get("headers", []),
        "body": "",
    }
    try:
        out.append({"replayed": ctl.replay(request, {}), "sent": got.get("headers", [])})
    except ImportError as error:
        # an encoding the proxy's image undoes with a module this machine lacks
        out.append({"missing": error.name})
server.shutdown()
print(json.dumps(out))
