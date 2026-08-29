"""Offline mapper tests — no network."""
import unittest

from observatory.collect import map_sparkdash_node


SNAP = {
    "id": "spark-56bc",
    "online": True,
    "uptime": 930000,
    "hardware": {"device": "NVIDIA DGX Spark"},
    "metrics": {
        "gpu": {
            "temperature": 58,
            "usage": 12,
            "power": {"draw": 14.05, "limit": 120},
            "vram": {"used": 98000, "total": 124610},
            "throttle": {"active": False, "thermal": False, "smClockMHz": 2450, "reason": "ok"},
        },
        "unifiedMemory": {
            "total": 124610,
            "gpuUsed": 98236,
            "cpuUsed": 24221,
            "used": 122457,
            "oomRisk": "high",
        },
        "network": {
            "interfaces": [
                {"name": "enP7s7", "rxSpeed": 1e9, "txSpeed": 1e9},
                {"name": "enp1s0f0np0", "rxSpeed": 2e9, "txSpeed": 0},
            ]
        },
        "llm": [
            {
                "available": True,
                "backend": "vllm",
                "modelId": "GLM-5.3-Flash-EXL3",
                "generationTps": 13.5,
                "prefillTps": 0,
                "kvCacheUsage": 0.21,
                "requestsRunning": 1,
                "requestsWaiting": 0,
                "ttftP95Seconds": 2.3,
                "mtpAcceptanceRate": 0.31,
                "contextLength": 640000,
                "error": None,
            }
        ],
    },
}


class MapTests(unittest.TestCase):
    def test_maps_live_node(self):
        n = map_sparkdash_node(
            {
                "id": "spark-56bc",
                "label": "SPARK-A",
                "lan_ifaces": ["enP7s7"],
                "roce_ifaces": ["enp1s0f0np0"],
            },
            SNAP,
        )
        self.assertTrue(n["online"])
        self.assertEqual(n["temp_c"], 58)
        self.assertAlmostEqual(n["mem_total_gib"], 124610 / 1024, places=2)
        self.assertEqual(n["decode_tps"], 13.5)
        self.assertEqual(n["running"], 1)
        self.assertGreater(n["lan_gbs"], 1.0)
        self.assertGreater(n["roce_gbs"], 1.0)
        self.assertEqual(n["oom_risk"], "high")
        self.assertEqual(n["model_id"], "GLM-5.3-Flash-EXL3")

    def test_missing_snapshot(self):
        n = map_sparkdash_node({"id": "x", "label": "X"}, None)
        self.assertFalse(n["online"])
        self.assertEqual(n["error"], "no snapshot")


if __name__ == "__main__":
    unittest.main()
