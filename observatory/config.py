"""Load observatory TOML config (stdlib tomllib)."""
from __future__ import annotations

import tomllib
from pathlib import Path


def load_config(path: str | Path) -> dict:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(
            f"config not found: {p}. Copy config.example.toml → config.toml"
        )
    with p.open("rb") as f:
        cfg = tomllib.load(f)
    if not cfg.get("nodes"):
        raise ValueError("config.nodes is empty")
    src = cfg.setdefault("source", {})
    src.setdefault("kind", "sparkdash")
    src.setdefault("url", "http://127.0.0.1:5556")
    cfg.setdefault("listen", "127.0.0.1:8787")
    cfg.setdefault("poll_ms", 1000)
    cfg.setdefault("history_seconds", 120)
    cfg.setdefault("title", "SPARK-PAIR")
    cfg.setdefault("subtitle", "")
    cfg.setdefault("chips", [])
    for n in cfg["nodes"]:
        if "id" not in n:
            raise ValueError("each node needs id")
        n.setdefault("label", n["id"])
        n.setdefault("sparkdash_id", n["id"])
        n.setdefault("roce_ifaces", [])
        n.setdefault("lan_ifaces", [])
        n.setdefault("llm_base_url", None)
    return cfg
