---
name: spark-observatory
description: Stand up a live Spark Observatory from sparkDash.
---

# Spark Observatory

Live dual-node (or N-node) DGX Spark ops wall. Reads MiaAI sparkDash; serves a Monitor-surface UI. Python 3.11+, stdlib only.

## When to Use

- User wants the GLM-style Observatory **wired to real Sparks**
- Cloning this repo on a new LAN / new sparkDash instance
- Diagnosing empty panels (almost always sparkDash URL, node id, or LLM port)

Don't use for: replacing sparkDash, inventing MoE expert heatmaps, or publishing the visual-bench simulation as live.

## Prerequisites

- Python 3.11+
- A running sparkDash (`/api/sparks` returns JSON)
- Network path from this host to sparkDash (and from sparkDash to the Sparks)

## Procedure

1. Clone the repo. Completion: `README.md` and `observatory/` exist.
2. Discover nodes:
   `terminal(command="python3 scripts/discover.py --sparkdash http://127.0.0.1:5556 --out config.toml")`
   Completion: `config.toml` lists every sparkDash id.
3. If discover cannot reach sparkDash, copy `config.example.toml` → `config.toml` and set `source.url` plus each `sparkdash_id`.
4. Start:
   `terminal(command="python3 -m observatory --config config.toml")`
   Completion: process prints `spark-observatory  http://0.0.0.0:8790/` and `curl -s http://127.0.0.1:8790/api/health` is `ok`.
5. Verify live data:
   `curl -s http://127.0.0.1:8790/api/snapshot` — each configured node has `online: true` or an explicit error. `expert_routing` is `null`.
6. Optional durability: systemd user unit with `WorkingDirectory` = repo root, `ExecStart=/usr/bin/python3 -m observatory --config config.toml`.

## Pitfalls

- sparkDash Docker on x86_64 against ARM Sparks is the wrong path — run sparkDash natively (see sparkDash README).
- Observatory bind default is `0.0.0.0:8787` (LAN). The API is unauthenticated. Do not expose it past the LAN/tailnet.
- `llm_base_url` in config is documentation / future probe; live tok/s currently come from sparkDash's LLM probe. If tok/s are zero, fix sparkDash LLM ports first.
- Expert heatmap will never populate on stock vLLM/EXL3. That is correct.

## Verification

- `python3 -m unittest tests/test_collect.py -q` passes
- `/api/snapshot` `live: true` with node temps that move across two polls
- Footer says LIVE, not SIMULATION
