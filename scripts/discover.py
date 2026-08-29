#!/usr/bin/env python3
"""Write config.toml from a live sparkDash /api/sparks listing."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--sparkdash", default="http://127.0.0.1:5556")
    p.add_argument("--out", default="config.toml")
    p.add_argument("--listen", default="0.0.0.0:8787")
    args = p.parse_args()
    url = args.sparkdash.rstrip("/") + "/api/sparks"
    with urllib.request.urlopen(url, timeout=5) as resp:
        data = json.loads(resp.read().decode())
    sparks = data.get("sparks") or data
    if not isinstance(sparks, list) or not sparks:
        print("no sparks in", url, file=sys.stderr)
        return 1
    labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    lines = [
        f'listen = "{args.listen}"',
        "poll_ms = 1000",
        "history_seconds = 180",
        'title = "SPARK-PAIR"',
        'subtitle = ""',
        "chips = []",
        "",
        "[source]",
        'kind = "sparkdash"',
        f'url = "{args.sparkdash.rstrip("/")}"',
        "",
    ]
    for i, s in enumerate(sparks):
        sid = s.get("id")
        lab = f"SPARK-{labels[i]}"
        lan = s.get("lanIp")
        ports = s.get("llmPorts") or ([s.get("llmPort")] if s.get("llmPort") else [])
        llm = f"http://{lan}:{ports[0]}" if lan and ports else ""
        lines += [
            "[[nodes]]",
            f'id = "{sid}"',
            f'label = "{lab}"',
            f'sparkdash_id = "{sid}"',
        ]
        if llm:
            lines.append(f'llm_base_url = "{llm}"')
        lines += [
            'roce_ifaces = ["enp1s0f0np0"]',
            'lan_ifaces = ["enP7s7"]',
            "",
        ]
    Path(args.out).write_text("\n".join(lines))
    print(f"wrote {args.out} ({len(sparks)} nodes) from {url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
