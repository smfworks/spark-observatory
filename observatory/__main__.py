"""python -m observatory [--config config.toml]"""
from __future__ import annotations

import argparse
from pathlib import Path

from .server import serve


def main() -> None:
    p = argparse.ArgumentParser(description="Spark Observatory live ops wall")
    p.add_argument(
        "--config",
        default=str(Path(__file__).resolve().parent.parent / "config.toml"),
        help="path to config.toml (copy from config.example.toml)",
    )
    args = p.parse_args()
    serve(args.config)


if __name__ == "__main__":
    main()
