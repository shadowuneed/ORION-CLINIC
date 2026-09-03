from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class SessionCreate(ApiModel):
    doctor_first: bool = Field(default=True, alias="doctorFirst")


class EngineInfo(ApiModel):
    stt: str
    speaker: str
    device: str
    model_status: str = Field(alias="modelStatus")


class SessionResponse(ApiModel):
    session_id: str = Field(alias="sessionId")
    engine: EngineInfo
    speaker_calibration: str = Field(alias="speakerCalibration")


class WordToken(ApiModel):
    text: str
    start: float
    end: float


class SpeakerResult(ApiModel):
    id: Literal["doctor", "patient", "unknown"]
    label: str
    confidence: float | None
    method: Literal["embedding", "order_fallback"]
    status: str


class TranscriptionResponse(ApiModel):
    session_id: str = Field(alias="sessionId")
    utterance_index: int = Field(alias="utteranceIndex")
    text: str
    tokens: list[WordToken]
    language: None = None
    language_detection: Literal["not_available"] = Field(
        default="not_available", alias="languageDetection"
    )
    speaker: SpeakerResult
    duration_ms: int = Field(alias="durationMs")
    processing_ms: int = Field(alias="processingMs")
