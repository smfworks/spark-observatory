# Hermes setup

This repo is a **live** DGX Spark ops wall (not the simulated visual-bench HTML).

When asked to set this up, follow `skills/spark-observatory/SKILL.md`. Do not invent metrics. Do not fill the expert heatmap with noise.

How this wall sits next to NVIDIA PAIR and sparkDash is [docs/local-mesh.md](docs/local-mesh.md). PAIR installs and releases come from [NVIDIA/Personal-AI-Router](https://github.com/NVIDIA/Personal-AI-Router), not from the SMF fork.

## Honesty

- Node cards, KV, tok/s, queue, TTFT come from sparkDash / vLLM.
- Request river pills are **counts** (running / waiting), not reconstructed prompts.
- Expert routing stays blank unless a real per-expert metric exists.
- If sparkDash or a node is down, show OFFLINE / the error — never last-known-good dressed as live.

## SMF defaults

- sparkDash fleet API: `http://127.0.0.1:5556` (UI `http://<sparkdash-host>:5173/`)
- Observatory: `python3 -m observatory --config config.toml` → `http://<observatory-host>:8790/`
- Nodes: `spark-56bc` (SPARK-A), `spark-d369` (SPARK-B)
