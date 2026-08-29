"""Normalize sparkDash snapshots (+ optional vLLM /metrics) into the UI schema."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any


def _get_json(url: str, timeout: float = 2.5) -> Any | None:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _iface_gbps(interfaces: list[dict], names: list[str]) -> float:
    want = set(names)
    total = 0.0
    for iface in interfaces or []:
        if want and iface.get("name") not in want:
            continue
        if not want:
            continue
        # sparkDash reports bytes/s
        total += float(iface.get("rxSpeed") or 0) + float(iface.get("txSpeed") or 0)
    return total / 1e9


def _uptime_s(raw) -> int:
    try:
        return int(raw or 0)
    except (TypeError, ValueError):
        return 0


def _first_llm(metrics: dict) -> dict:
    llm = metrics.get("llm") or []
    if isinstance(llm, dict):
        return llm
    if isinstance(llm, list) and llm:
        return llm[0] or {}
    return {}


def map_sparkdash_node(cfg_node: dict, snap: dict | None) -> dict:
    """Map one sparkDash /api/sparks/:id/metrics payload to a UI node."""
    out = {
        "id": cfg_node["id"],
        "label": cfg_node["label"],
        "online": False,
        "error": None,
        "hardware": "NVIDIA DGX Spark",
        "uptime_s": 0,
        "temp_c": None,
        "gpu_util": None,
        "power_w": None,
        "power_limit_w": None,
        "sm_clock_mhz": None,
        "throttled": False,
        "throttle_reason": None,
        "mem_used_gib": None,
        "mem_total_gib": None,
        "gpu_used_gib": None,
        "cpu_used_gib": None,
        "oom_risk": None,
        "decode_tps": None,
        "prefill_tps": None,
        "lan_gbs": None,
        "roce_gbs": None,
        "kv_frac": None,
        "running": 0,
        "waiting": 0,
        "ttft_p95_s": None,
        "mtp_accept": None,
        "model_id": None,
        "backend": None,
        "ctx_len": None,
        "llm_available": False,
        "llm_error": None,
    }
    if not snap:
        out["error"] = "no snapshot"
        return out

    m = snap.get("metrics") or {}
    gpu = m.get("gpu") or {}
    um = m.get("unifiedMemory") or {}
    net = m.get("network") or {}
    llm = _first_llm(m)
    hw = snap.get("hardware") or {}
    thr = gpu.get("throttle") or {}
    vram = gpu.get("vram") or {}
    power = gpu.get("power") or {}

    out["online"] = bool(snap.get("online"))
    out["hardware"] = hw.get("device") or out["hardware"]
    out["uptime_s"] = _uptime_s(snap.get("uptime"))
    out["temp_c"] = gpu.get("temperature")
    out["gpu_util"] = gpu.get("usage")
    out["power_w"] = (power or {}).get("draw")
    out["power_limit_w"] = (power or {}).get("limit")
    out["sm_clock_mhz"] = thr.get("smClockMHz")
    out["throttled"] = bool(thr.get("active") or thr.get("thermal"))
    out["throttle_reason"] = thr.get("reason")

    total_mb = um.get("total") or vram.get("total")
    used_mb = um.get("used")
    if total_mb:
        out["mem_total_gib"] = round(float(total_mb) / 1024.0, 2)
    if used_mb is not None:
        out["mem_used_gib"] = round(float(used_mb) / 1024.0, 2)
    if um.get("gpuUsed") is not None:
        out["gpu_used_gib"] = round(float(um["gpuUsed"]) / 1024.0, 2)
    if um.get("cpuUsed") is not None:
        out["cpu_used_gib"] = round(float(um["cpuUsed"]) / 1024.0, 2)
    out["oom_risk"] = um.get("oomRisk")

    ifaces = net.get("interfaces") or []
    out["lan_gbs"] = round(_iface_gbps(ifaces, cfg_node.get("lan_ifaces") or []), 3)
    out["roce_gbs"] = round(_iface_gbps(ifaces, cfg_node.get("roce_ifaces") or []), 3)

    out["decode_tps"] = llm.get("generationTps")
    out["prefill_tps"] = llm.get("prefillTps")
    out["kv_frac"] = llm.get("kvCacheUsage")
    out["running"] = int(llm.get("requestsRunning") or 0)
    out["waiting"] = int(llm.get("requestsWaiting") or 0)
    out["ttft_p95_s"] = llm.get("ttftP95Seconds")
    out["mtp_accept"] = llm.get("mtpAcceptanceRate")
    out["model_id"] = llm.get("modelId")
    out["backend"] = llm.get("backend")
    out["ctx_len"] = llm.get("contextLength")
    out["llm_available"] = bool(llm.get("available"))
    out["llm_error"] = llm.get("error")
    return out


def fetch_cluster(cfg: dict) -> dict:
    src = cfg["source"]
    kind = src.get("kind") or "sparkdash"
    now = time.time()
    nodes = []
    events = []
    if kind != "sparkdash":
        raise ValueError(f"unsupported source.kind: {kind}")

    base = src["url"].rstrip("/")
    for ncfg in cfg["nodes"]:
        sid = ncfg["sparkdash_id"]
        snap = _get_json(f"{base}/api/sparks/{sid}/metrics")
        mapped = map_sparkdash_node(ncfg, snap)
        nodes.append(mapped)
        if mapped["error"]:
            events.append(
                {
                    "t": now,
                    "sev": "warn",
                    "msg": f"{mapped['label']} sparkDash miss — {mapped['error']}",
                }
            )
        elif not mapped["online"]:
            events.append({"t": now, "sev": "crit", "msg": f"{mapped['label']} OFFLINE"})
        elif mapped["llm_error"]:
            events.append(
                {
                    "t": now,
                    "sev": "warn",
                    "msg": f"{mapped['label']} LLM — {mapped['llm_error']}",
                }
            )
        if mapped["throttled"]:
            events.append(
                {
                    "t": now,
                    "sev": "crit",
                    "msg": f"{mapped['label']} THROTTLE {mapped['throttle_reason']}",
                }
            )
        if mapped["oom_risk"] == "high":
            events.append(
                {
                    "t": now,
                    "sev": "warn",
                    "msg": f"{mapped['label']} UMA OOM risk HIGH ({mapped['mem_used_gib']} / {mapped['mem_total_gib']} GiB)",
                }
            )

    live = [n for n in nodes if n["online"]]
    running = sum(n["running"] for n in nodes)
    waiting = sum(n["waiting"] for n in nodes)
    models = [n["model_id"] for n in nodes if n.get("model_id")]
    ctx = next((n["ctx_len"] for n in nodes if n.get("ctx_len")), None)
    mtp = next((n["mtp_accept"] for n in nodes if n.get("mtp_accept") is not None), None)
    kv = next((n["kv_frac"] for n in nodes if n.get("kv_frac") is not None), None)
    ttft = next((n["ttft_p95_s"] for n in nodes if n.get("ttft_p95_s") is not None), None)

    if not live:
        health = "critical"
    elif any(n["throttled"] or n["oom_risk"] == "high" for n in live):
        health = "degraded"
    elif any(not n["llm_available"] for n in live):
        health = "degraded"
    else:
        health = "nominal"

    chips = list(cfg.get("chips") or [])
    if ctx:
        chips = [c for c in chips if not str(c).upper().startswith("CTX")]
        chips.append(f"CTX {int(ctx):,}")

    return {
        "t": now,
        "title": cfg.get("title") or "SPARK-PAIR",
        "subtitle": cfg.get("subtitle") or (models[0] if models else ""),
        "chips": chips,
        "health": health,
        "live": True,
        "expert_routing": None,  # vLLM/EXL3 does not expose per-expert load
        "expert_note": "backend does not expose MoE expert load",
        "cluster": {
            "running": running,
            "waiting": waiting,
            "kv_frac": kv,
            "ttft_p95_s": ttft,
            "mtp_accept": mtp,
            "model_id": models[0] if models else None,
            "ctx_len": ctx,
        },
        "nodes": nodes,
        "events": events,
        "source": {"kind": kind, "url": base},
    }
