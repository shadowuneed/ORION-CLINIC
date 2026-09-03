from __future__ import annotations

import os
from pathlib import Path


SERVICE_NAME = "orion-local-speech"
SERVICE_VERSION = "0.1.0"
HOST = "127.0.0.1"
PORT = 3101

MODEL_REPO = "ai-sage/GigaAM-Multilingual"
LARGE_CTC_VARIANT = "large_ctc"
LARGE_CTC_COMMIT = "3905cd51c3ed4e88c8edf33f3302969ba480a327"
CPU_CTC_VARIANT = "ctc"
CPU_CTC_COMMIT = "2f8a57144e6ec3adfd32fe0484d9ea9913305bc8"
TARGET_SAMPLE_RATE = 16_000

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(os.getenv("ORION_MODEL_DIR", str(BASE_DIR / "models"))).resolve()
HF_CACHE_DIR = Path(
    os.getenv("ORION_HF_CACHE_DIR", str(MODEL_DIR / "huggingface"))
).resolve()

CAMPPLUS_FILENAME = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
CAMPPLUS_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/"
    "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
)
CAMPPLUS_EXPECTED_BYTES = 28_281_164
CAMPPLUS_PATH = Path(
    os.getenv("ORION_SPEAKER_MODEL", str(MODEL_DIR / CAMPPLUS_FILENAME))
).resolve()

MAX_AUDIO_BYTES = int(os.getenv("ORION_MAX_AUDIO_BYTES", str(12 * 1024 * 1024)))
MIN_AUDIO_SECONDS = float(os.getenv("ORION_MIN_AUDIO_SECONDS", "0.35"))
# GigaAM's short-form implementation rejects audio above 25 seconds.
MAX_AUDIO_SECONDS = float(os.getenv("ORION_MAX_AUDIO_SECONDS", "24.5"))
MIN_RMS = float(os.getenv("ORION_MIN_RMS", "0.0001"))

SESSION_TTL_SECONDS = int(os.getenv("ORION_SESSION_TTL_SECONDS", str(4 * 60 * 60)))
MAX_SESSIONS = int(os.getenv("ORION_MAX_SESSIONS", "64"))

SPEAKER_MATCH_THRESHOLD = float(os.getenv("ORION_SPEAKER_MATCH_THRESHOLD", "0.55"))
SPEAKER_MARGIN_THRESHOLD = float(os.getenv("ORION_SPEAKER_MARGIN_THRESHOLD", "0.04"))
SPEAKER_PROFILE_ALPHA = float(os.getenv("ORION_SPEAKER_PROFILE_ALPHA", "0.15"))


def allowed_origins() -> list[str]:
    configured = os.getenv("ORION_ALLOWED_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://127.0.0.1:3200", "http://localhost:3200"]


def allow_model_download() -> bool:
    return os.getenv("ORION_ALLOW_MODEL_DOWNLOAD", "0").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def requested_device() -> str:
    value = os.getenv("ORION_STT_DEVICE", "auto").strip().lower()
    return value if value in {"auto", "cpu", "cuda"} else "auto"
