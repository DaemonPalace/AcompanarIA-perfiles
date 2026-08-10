"""Stdlib-only HTTP server: serves ui/ static files + schema/generate API.

Run: python3 server.py [--port 8765]
"""

import argparse
import datetime
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(REPO_ROOT, "ui")
SCHEMA_PATH = os.path.join(REPO_ROOT, "schema", "graph_model.json")

sys.path.insert(0, REPO_ROOT)
from generator import engine  # noqa: E402
from generator import privacy  # noqa: E402
from generator import stats as stats_mod  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status, body, content_type, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/schema":
            self._handle_get_schema()
            return
        self._serve_static()

    def do_POST(self):
        if self.path == "/api/generate":
            self._handle_generate()
            return
        if self.path == "/api/analyze":
            self._handle_analyze()
            return
        if self.path == "/api/schema":
            self._handle_save_schema()
            return
        self._send_json(404, {"error": "not found"})

    def _handle_get_schema(self):
        if not os.path.isfile(SCHEMA_PATH):
            self._send_json(404, {"error": f"schema not found at {SCHEMA_PATH}"})
            return
        try:
            schema = engine.load_schema(SCHEMA_PATH)
        except Exception as e:
            self._send_json(500, {"error": f"failed to read schema: {e}"})
            return
        self._send_json(200, schema)

    def _handle_generate(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"error": f"invalid request body: {e}"})
            return

        schema = body.get("schema")
        n = body.get("n", 500)
        seed = body.get("seed", None)
        fmt = body.get("format", "csv")

        if not isinstance(schema, dict):
            self._send_json(400, {"error": "'schema' field must be a JSON object"})
            return

        try:
            rows = engine.generate(schema, n=n, seed=seed)
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
            return
        except Exception as e:
            self._send_json(400, {"error": f"generation failed: {e}"})
            return

        node_ids = [node["id"] for node in schema["nodes"]]

        if fmt == "json":
            table_rows = [[row[nid] for nid in node_ids] for row in rows]
            self._send_json(200, {"columns": node_ids, "rows": table_rows})
        else:
            csv_text = engine.to_csv(rows, node_ids)
            self._send_bytes(
                200,
                csv_text.encode("utf-8"),
                "text/csv",
                {"Content-Disposition": 'attachment; filename="synthetic_profiles.csv"'},
            )

    def _handle_analyze(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"error": f"invalid request body: {e}"})
            return

        schema = body.get("schema")
        n = body.get("n", 500)
        seed = body.get("seed", None)

        if not isinstance(schema, dict):
            self._send_json(400, {"error": "'schema' field must be a JSON object"})
            return

        errors = engine.validate_schema(schema)
        if errors:
            self._send_json(400, {"error": "; ".join(errors)})
            return

        try:
            rows = engine.generate(schema, n=n, seed=seed)
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
            return
        except Exception as e:
            self._send_json(400, {"error": f"generation failed: {e}"})
            return

        summary = stats_mod.summarize(schema, rows)
        privacy_result = privacy.privacy_audit(schema, rows)

        self._send_json(200, {
            "n": len(rows),
            "numeric": summary["numeric"],
            "categorical": summary["categorical"],
            "correlations": summary["correlations"],
            "privacy": privacy_result,
        })

    def _handle_save_schema(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            schema = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"error": f"invalid request body: {e}"})
            return

        if not isinstance(schema, dict):
            self._send_json(400, {"error": "request body must be a JSON object (the schema itself)"})
            return

        errors = engine.validate_schema(schema)
        if errors:
            self._send_json(400, {"error": "; ".join(errors)})
            return

        if isinstance(schema.get("metadata"), dict):
            schema["metadata"]["last_modified"] = datetime.date.today().isoformat()

        try:
            schema_dir = os.path.dirname(SCHEMA_PATH)
            os.makedirs(schema_dir, exist_ok=True)
            tmp_path = SCHEMA_PATH + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(json.dumps(schema, indent=2, ensure_ascii=False))
            os.replace(tmp_path, SCHEMA_PATH)
        except Exception as e:
            self._send_json(500, {"error": f"failed to write schema: {e}"})
            return

        self._send_json(200, {
            "ok": True,
            "nodes": len(schema.get("nodes", [])),
            "edges": len(schema.get("edges", [])),
        })

    def _serve_static(self):
        rel_path = self.path.split("?", 1)[0]
        if rel_path == "/":
            rel_path = "/index.html"
        safe_path = os.path.normpath(rel_path).lstrip(os.sep)
        full_path = os.path.join(UI_DIR, safe_path)

        if not os.path.abspath(full_path).startswith(os.path.abspath(UI_DIR)):
            self._send_json(403, {"error": "forbidden"})
            return
        if not os.path.isfile(full_path):
            self._send_json(404, {"error": "not found"})
            return

        content_type, _ = mimetypes.guess_type(full_path)
        with open(full_path, "rb") as f:
            data = f.read()
        self._send_bytes(200, data, content_type or "application/octet-stream")

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"Serving on http://0.0.0.0:{args.port} (ui dir: {UI_DIR})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
