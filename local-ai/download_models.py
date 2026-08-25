from __future__ import annotations

import argparse
import shutil
import sys
import urllib.request
from pathlib import Path

from huggingface_hub import snapshot_download

from orion_local.config import (
    CAMPPLUS_EXPECTED_BYTES,
    CAMPPLUS_PATH,
    CAMPPLUS_URL,
    CPU_CTC_COMMIT,
    HF_CACHE_DIR,
    LARGE_CTC_COMMIT,
    MODEL_REPO,
)


def _download_stt(revision: str) -> None:
    print(f"Caching {MODEL_REPO}@{revision} ...")
    snapshot_download(
        repo_id=MODEL_REPO,
        revision=revision,
        cache_dir=str(HF_CACHE_DIR),
        allow_patterns=["config.json", "modeling_gigaam.py", "pytorch_model.bin"],
    )


def _download_speaker() -> None:
    if CAMPPLUS_PATH.is_file() and CAMPPLUS_PATH.stat().st_size == CAMPPLUS_EXPECTED_BYTES:
        print(f"CAMPPlus already present: {CAMPPLUS_PATH}")
        return
    CAMPPLUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    partial = CAMPPLUS_PATH.with_suffix(CAMPPLUS_PATH.suffix + ".part")
    request = urllib.request.Request(CAMPPLUS_URL, headers={"User-Agent": "ORION-local-setup/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as target:
            shutil.copyfileobj(response, target, length=1024 * 1024)
        actual = partial.stat().st_size
        if actual != CAMPPLUS_EXPECTED_BYTES:
            raise RuntimeError(
                f"Unexpected CAMPPlus size: {actual}; expected {CAMPPLUS_EXPECTED_BYTES}."
            )
        partial.replace(CAMPPLUS_PATH)
        print(f"Saved CAMPPlus: {CAMPPLUS_PATH}")
    finally:
        if partial.exists():
            partial.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description="Download pinned ORION local speech models")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--all-stt", action="store_true", help="Cache both large_ctc and ctc")
    parser.add_argument("--skip-speaker", action="store_true")
    args = parser.parse_args()

    import torch

    use_cuda = args.device == "cuda" or (args.device == "auto" and torch.cuda.is_available())
    if use_cuda:
        _download_stt(LARGE_CTC_COMMIT)
        if args.all_stt:
            _download_stt(CPU_CTC_COMMIT)
    else:
        _download_stt(CPU_CTC_COMMIT)
        if args.all_stt:
            _download_stt(LARGE_CTC_COMMIT)
    if not args.skip_speaker:
        _download_speaker()
    return 0


if __name__ == "__main__":
    sys.exit(main())
