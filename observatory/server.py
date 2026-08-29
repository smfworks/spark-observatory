"""Stdlib HTTP server: static UI + /api/snapshot + /api/history."""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .collect import fetch_cluster
from .config import load_config

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


class Ring:
    def __init__(self, seconds: int, poll_ms: int):
        cap = max(30, int(seconds * 1000 / max(200, poll_ms)))
        self.buf: deque[dict] = deque(maxlen=cap)
        self.lock = threading.Lock()
        self.latest: dict | None = None

    def push(self, snap: dict) -> None:
        with self.lock:
            self.latest = snap
            self.buf.append(snap)

    def snapshot(self) -> dict | None:
        with self.lock:
            return self.latest

    def history(self) -> list[dict]:
        with self.lock:
            return list(self.buf)


def start_poller(cfg: dict, ring: Ring, stop: threading.Event) -> None:
    interval = max(0.2, float(cfg.get("poll_ms", 1000)) / 1000.0)

    def loop():
        while not stop.is_set():
            t0 = time.time()
            try:
                snap = fetch_cluster(cfg)
            except Exception as exc:  # noqa: BLE001 — keep the wall up
                snap = {
                    "t": time.time(),
                    "live": False,
                    "health": "critical",
                    "error": str(exc),
                    "nodes": [],
                    "events": [{"t": time.time(), "sev": "crit", "msg": str(exc)}],
                    "cluster": {},
                    "title": cfg.get("title"),
                    "subtitle": cfg.get("subtitle"),
                    "chips": cfg.get("chips") or [],
                    "expert_routing": None,
                    "expert_note": "backend does not expose MoE expert load",
                }
            ring.push(snap)
            stop.wait(max(0.05, interval - (time.time() - t0)))

    threading.Thread(target=loop, name="obs-poll", daemon=True).start()


def make_handler(cfg: dict, ring: Ring):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(WEB), **kwargs)

        def log_message(self, fmt, *args):
            pass

        def _json(self, obj, code=200):
            body = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                self.path = "/index.html"
                return SimpleHTTPRequestHandler.do_GET(self)
            if path == "/api/health":
                snap = ring.snapshot()
                return self._json(
                    {
                        "ok": True,
                        "live": bool(snap and snap.get("live")),
                        "health": (snap or {}).get("health"),
                    }
                )
            if path == "/api/config":
                public = {
                    "title": cfg.get("title"),
                    "subtitle": cfg.get("subtitle"),
                    "chips": cfg.get("chips"),
                    "nodes": [
                        {"id": n["id"], "label": n["label"]} for n in cfg["nodes"]
                    ],
                    "source": cfg["source"]["kind"],
                    "listen": cfg["listen"],
                }
                return self._json(public)
            if path == "/api/snapshot":
                snap = ring.snapshot()
                if snap is None:
                    return self._json({"live": False, "nodes": [], "error": "warming up"})
                return self._json(snap)
            if path == "/api/history":
                return self._json({"samples": ring.history()})
            return SimpleHTTPRequestHandler.do_GET(self)

    return Handler


def serve(cfg_path: str | Path = "config.toml") -> None:
    cfg = load_config(cfg_path)
    host, _, port_s = cfg["listen"].rpartition(":")
    host = host or "0.0.0.0"
    port = int(port_s)
    ring = Ring(int(cfg.get("history_seconds") or 120), int(cfg.get("poll_ms") or 1000))
    stop = threading.Event()
    start_poller(cfg, ring, stop)
    httpd = ThreadingHTTPServer((host, port), make_handler(cfg, ring))
    httpd.allow_reuse_address = True
    print(f"spark-observatory  http://{host}:{port}/  source={cfg['source']['url']}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        stop.set()
        httpd.server_close()
