from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import soundfile as sf

from .config import (
    MAX_AUDIO_SECONDS,
    MIN_AUDIO_SECONDS,
    MIN_RMS,
    TARGET_SAMPLE_RATE,
)


class AudioValidationError(ValueError):
    """The supplied utterance cannot safely be sent to the speech model."""


@dataclass(frozen=True, slots=True)
class DecodedAudio:
    samples: np.ndarray
    sample_rate: int
    duration_seconds: float
    rms: float


def _decode_wav(payload: bytes) -> tuple[np.ndarray, int]:
    try:
        samples, sample_rate = sf.read(
            io.BytesIO(payload),
            dtype="float32",
            always_2d=True,
        )
    except (RuntimeError, sf.LibsndfileError) as exc:
        raise AudioValidationError("Не удалось прочитать WAV-аудио.") from exc

    if samples.shape[1] > 2:
        raise AudioValidationError("Поддерживается не более двух аудиоканалов.")
    mono = samples.mean(axis=1, dtype=np.float32)
    return np.ascontiguousarray(mono, dtype=np.float32), int(sample_rate)


def _decode_pcm(
    payload: bytes,
    encoding: str,
    sample_rate: int,
    channels: int,
) -> tuple[np.ndarray, int]:
    if not 8_000 <= sample_rate <= 96_000:
        raise AudioValidationError("Частота PCM должна быть от 8000 до 96000 Гц.")
    if channels not in {1, 2}:
        raise AudioValidationError("PCM поддерживает один или два канала.")

    if encoding == "pcm_s16le":
        width = 2
        dtype = "<i2"
        scale = 32768.0
    elif encoding == "pcm_f32le":
        width = 4
        dtype = "<f4"
        scale = 1.0
    else:
        raise AudioValidationError(f"Неподдерживаемая PCM-кодировка: {encoding}.")

    frame_width = width * channels
    if not payload or len(payload) % frame_width:
        raise AudioValidationError("Размер PCM не совпадает с форматом кадров.")

    values = np.frombuffer(payload, dtype=dtype)
    if encoding == "pcm_s16le":
        values = values.astype(np.float32) / scale
    else:
        values = values.astype(np.float32, copy=False)
    if channels == 2:
        values = values.reshape(-1, 2).mean(axis=1, dtype=np.float32)
    return np.ascontiguousarray(values, dtype=np.float32), sample_rate


def _resample(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if sample_rate == TARGET_SAMPLE_RATE:
        return samples
    import torch
    import torchaudio.functional as audio_functional

    tensor = torch.from_numpy(samples)
    resampled = audio_functional.resample(tensor, sample_rate, TARGET_SAMPLE_RATE)
    return np.ascontiguousarray(resampled.cpu().numpy(), dtype=np.float32)


def decode_audio(
    payload: bytes,
    *,
    encoding: str = "wav",
    sample_rate: int = TARGET_SAMPLE_RATE,
    channels: int = 1,
) -> DecodedAudio:
    normalized_encoding = encoding.strip().lower()
    if normalized_encoding == "wav":
        samples, source_rate = _decode_wav(payload)
    else:
        samples, source_rate = _decode_pcm(
            payload,
            normalized_encoding,
            sample_rate,
            channels,
        )

    if samples.size == 0 or not np.isfinite(samples).all():
        raise AudioValidationError("Аудио пустое или содержит некорректные значения.")

    samples = np.clip(samples, -1.0, 1.0)
    samples = _resample(samples, source_rate)
    duration = samples.size / TARGET_SAMPLE_RATE
    if duration < MIN_AUDIO_SECONDS:
        raise AudioValidationError(
            f"Реплика короче {MIN_AUDIO_SECONDS:.2f} секунды. Запишите чуть дольше."
        )
    if duration > MAX_AUDIO_SECONDS:
        raise AudioValidationError(
            f"Реплика длиннее {MAX_AUDIO_SECONDS:.1f} секунды. Разделите её на части."
        )

    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    if rms < MIN_RMS:
        raise AudioValidationError("В реплике не обнаружен различимый голос.")

    return DecodedAudio(
        samples=np.ascontiguousarray(samples, dtype=np.float32),
        sample_rate=TARGET_SAMPLE_RATE,
        duration_seconds=duration,
        rms=rms,
    )
