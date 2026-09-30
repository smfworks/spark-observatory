# Spark Observatory

Live ops wall for one or more NVIDIA DGX Spark (GB10) nodes. Same visual language as the SMF GLM-5.3-Flash visual bench (node cards, KV area, concurrency×TTFT, request river) — **wired to real telemetry**, not simulated physics.

Zero Python dependencies (3.11+). Hermes can stand this up from a clone.

## What is live vs honest-blank

| Panel | Source | Notes |
|---|---|---|
| Node temp / power / util / UMA / clocks | [sparkDash](https://github.com/MiaAI-Lab/sparkDash) `/api/sparks/:id/metrics` | Required |
| Decode / prefill tok/s, KV %, running/waiting, TTFT p95, MTP accept | sparkDash LLM probe (vLLM `/metrics`) | Empty if the serve is down |
| Request river | inflight + waiting **counts** | No per-request IDs — vLLM does not export traces |
| Expert routing heatmap | — | **Not drawn.** vLLM/EXL3 do not export per-expert load. The panel says so. |
| Replay 60s | in-memory history of real samples | Replays recorded live data, not a sim |

## Quick start

```bash
git clone https://github.com/smfworks/spark-observatory.git
cd spark-observatory
python3 scripts/discover.py --sparkdash http://127.0.0.1:5556 --out config.toml
python3 -m observatory --config config.toml
# open http://<this-host>:8790/
```

Or copy `config.example.toml` → `config.toml` and edit node ids to match your sparkDash `config/sparks.json`.

sparkDash itself is a separate service (Vite `:5173` / API `:5555` or `:5556`). This observatory **reads** it; it does not replace it.

## Local mesh

Home or lab layout: [NVIDIA Personal AI Router (PAIR)](https://github.com/NVIDIA/Personal-AI-Router) routes Ollama and LM Studio across LAN nodes, [sparkDash](https://github.com/MiaAI-Lab/sparkDash) collects Spark fleet metrics, and this observatory is the ops wall Hermes can open. Diagram, ports, and ownership are in [docs/local-mesh.md](docs/local-mesh.md).

PAIR is NVIDIA's project. Install and take releases from [NVIDIA/Personal-AI-Router](https://github.com/NVIDIA/Personal-AI-Router). [smfworks/Personal-AI-Router](https://github.com/smfworks/Personal-AI-Router) is an SMF fork of that repo for reference only. SMF did not author PAIR.

## Hermes

Point an agent at this repo. `AGENTS.md` + `skills/spark-observatory/SKILL.md` are the setup procedure. The mesh those agents sit in is [docs/local-mesh.md](docs/local-mesh.md).

## License

MIT. Visual shell derived from SMF Works / Aiona Edge GLM-5.3-Flash visual bench shot 3 (2026-08-29).
