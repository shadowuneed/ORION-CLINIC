from __future__ import annotations

import gc
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .config import (
    CAMPPLUS_PATH,
    CPU_CTC_COMMIT,
    CPU_CTC_VARIANT,
    HF_CACHE_DIR,
    LARGE_CTC_COMMIT,
    LARGE_CTC_VARIANT,
    MODEL_REPO,
    TARGET_SAMPLE_RATE,
    allow_model_download,
    requested_device,
)


logger = logging.getLogger("orion.local_speech")


class ModelUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class WordResult:
    text: str
    start: float
    end: float


@dataclass(frozen=True, slots=True)
class SpeechResult:
    text: str
    words: list[WordResult]


class SpeechEngine:
    """Lazy, pinned GigaAM runner that never writes utterances to disk."""

    def __init__(self) -> None:
        self._model: Any | None = None
        self._torch: Any | None = None
        self._device = "unresolved"
        self._variant = "unresolved"
        self._revision = "unresolved"
        self._precision = "unresolved"
        self._status = "not_loaded"
        self._error: str | None = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    def status(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": self._status,
            "repo": MODEL_REPO,
            "variant": self._variant,
            "revision": self._revision,
            "device": self._device,
            "precision": self._precision,
            "localFilesOnly": not allow_model_download(),
        }
        if self._error:
            result["error"] = self._error
        return result

    @staticmethod
    def _cuda_available(torch_module: Any) -> bool:
        try:
            return bool(torch_module.cuda.is_available())
        except Exception:
            return False

    def _load_one(self, *, variant: str, revision: str, device: str) -> None:
        import torch
        from transformers import AutoModel

        HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        model = AutoModel.from_pretrained(
            MODEL_REPO,
            revision=revision,
            trust_remote_code=True,
            cache_dir=str(HF_CACHE_DIR),
            local_files_only=not allow_model_download(),
        )
        model.eval()
        model.to(device)

        inner_name = str(model.config.cfg["model"]["cfg"]["model_name"])
        if variant not in inner_name:
            raise ModelUnavailableError(
                f"Закреплённая ревизия вернула неожиданную модель: {inner_name}."
            )

        self._torch = torch
        self._model = model
        self._device = device
        self._variant = variant
        self._revision = revision
        # GigaAM keeps preprocessing/weights in FP32 and applies FP16 autocast in
        # its CUDA forward pass. Casting the whole model breaks FP16 preprocessing.
        self._precision = "fp16_autocast" if device == "cuda" else "fp32"
        self._status = "ready"
        self._error = None

    def _load(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            self._status = "loading"
            self._error = None
            try:
                import torch
            except Exception as exc:
                self._status = "unavailable"
                self._error = "PyTorch не установлен. Запустите services/local-speech/setup.ps1."
                raise ModelUnavailableError(self._error) from exc

            preference = requested_device()
            use_cuda = preference != "cpu" and self._cuda_available(torch)
            if preference == "cuda" and not use_cuda:
                logger.warning("CUDA requested but unavailable; using CPU CTC fallback")

            attempts = (
                [
                    (LARGE_CTC_VARIANT, LARGE_CTC_COMMIT, "cuda"),
                    (CPU_CTC_VARIANT, CPU_CTC_COMMIT, "cpu"),
                ]
                if use_cuda
                else [(CPU_CTC_VARIANT, CPU_CTC_COMMIT, "cpu")]
            )
            failures: list[str] = []
            for variant, revision, device in attempts:
                try:
                    self._load_one(variant=variant, revision=revision, device=device)
                    return
                except Exception as exc:
                    failures.append(f"{variant}/{device}: {type(exc).__name__}")
                    self._model = None
                    self._torch = torch
                    if device == "cuda":
                        try:
                            torch.cuda.empty_cache()
                        except Exception:
                            pass
                    gc.collect()

            self._status = "unavailable"
            self._device = "none"
            self._variant = "none"
            self._revision = "none"
            self._precision = "none"
            suffix = "; ".join(failures)
            self._error = (
                "Локальная STT-модель не найдена или не загрузилась. "
                "Запустите services/local-speech/setup.ps1 без -SkipModels. "
                f"Попытки: {suffix}."
            )
            raise ModelUnavailableError(self._error)

    def _switch_to_cpu_after_oom(self) -> None:
        torch = self._torch
        self._model = None
        if torch is not None:
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
        gc.collect()
        self._load_one(
            variant=CPU_CTC_VARIANT,
            revision=CPU_CTC_COMMIT,
            device="cpu",
        )

    def _infer(self, samples: np.ndarray) -> SpeechResult:
        assert self._model is not None
        assert self._torch is not None
        torch = self._torch
        model = self._model
        inner = model.model

        waveform = torch.from_numpy(samples).to(self._device).unsqueeze(0)
        lengths = torch.tensor(
            [samples.size],
            dtype=torch.long,
            device=self._device,
        )
        with torch.inference_mode():
            encoded, encoded_lengths = inner.forward(waveform, lengths)
            text, words = inner._decode(
                encoded,
                encoded_lengths,
                lengths,
                word_timestamps=True,
            )[0]

        tokens = [
            WordResult(
                text=str(word.text),
                start=round(float(word.start), 3),
                end=round(float(word.end), 3),
            )
            for word in (words or [])
        ]
        return SpeechResult(text=str(text).strip(), words=tokens)

    def transcribe(self, samples: np.ndarray) -> SpeechResult:
        self._load()
        with self._inference_lock:
            try:
                return self._infer(samples)
            except Exception as exc:
                is_cuda_oom = (
                    self._device == "cuda"
                    and self._torch is not None
                    and (
                        isinstance(exc, self._torch.cuda.OutOfMemoryError)
                        or "out of memory" in str(exc).lower()
                    )
                )
                if not is_cuda_oom:
                    raise
                logger.warning("CUDA memory exhausted; switching to CPU CTC fallback")
                self._switch_to_cpu_after_oom()
                return self._infer(samples)

    def warmup(self) -> None:
        """Load the pinned model at service start without processing audio."""
        self._load()


class SpeakerEngine:
    """Optional local CAMPPlus embedding extractor."""

    def __init__(self, model_path: Path = CAMPPLUS_PATH) -> None:
        self._model_path = model_path
        self._extractor: Any | None = None
        self._status = "not_loaded"
        self._error: str | None = None
        self._load_lock = threading.Lock()
        self._compute_lock = threading.Lock()

    def _load(self) -> bool:
        if self._extractor is not None:
            return True
        with self._load_lock:
            if self._extractor is not None:
                return True
            if not self._model_path.is_file():
                self._status = "missing_model"
                self._error = "CAMPPlus не скачан; используется порядок реплик."
                return False
            try:
                import sherpa_onnx

                config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=str(self._model_path),
                    num_threads=2,
                    debug=False,
                    provider="cpu",
                )
                if not config.validate():
                    raise RuntimeError("invalid CAMPPlus configuration")
                self._extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
                self._status = "ready"
                self._error = None
                return True
            except Exception as exc:
                self._status = "unavailable"
                self._error = f"CAMPPlus недоступен: {type(exc).__name__}."
                return False

    def status(self) -> dict[str, Any]:
        # Probe lazily without loading the ONNX model just for health checks.
        if self._status == "not_loaded" and not self._model_path.is_file():
            self._status = "missing_model"
            self._error = "CAMPPlus не скачан; используется порядок реплик."
        result: dict[str, Any] = {
            "status": self._status,
            "model": self._model_path.name,
            "fallback": "order_only",
        }
        if self._error:
            result["message"] = self._error
        return result

    def embedding(self, samples: np.ndarray) -> tuple[np.ndarray | None, str]:
        if not self._load():
            return None, self._status
        assert self._extractor is not None
        with self._compute_lock:
            stream = self._extractor.create_stream()
            stream.accept_waveform(
                sample_rate=TARGET_SAMPLE_RATE,
                waveform=np.ascontiguousarray(samples, dtype=np.float32),
            )
            stream.input_finished()
            if not self._extractor.is_ready(stream):
                return None, "audio_too_short_for_embedding"
            vector = np.asarray(self._extractor.compute(stream), dtype=np.float32)
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(vector).all() or norm <= 1e-8:
            return None, "invalid_embedding"
        return np.ascontiguousarray(vector / norm, dtype=np.float32), "ready"

    def warmup(self) -> None:
        self._load()
