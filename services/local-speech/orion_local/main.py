from __future__ import annotations

import logging
import threading
import time
from email import policy
from email.parser import BytesParser
from typing import Any, Literal

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .audio import AudioValidationError, DecodedAudio, decode_audio
from .config import (
    MAX_AUDIO_BYTES,
    SERVICE_NAME,
    SERVICE_VERSION,
    allowed_origins,
)
from .engines import ModelUnavailableError, SpeakerEngine, SpeechEngine
from .schemas import SessionCreate, SessionResponse, TranscriptionResponse
from .sessions import (
    SessionNotFoundError,
    SessionState,
    SessionStore,
    identify_speaker,
    unidentified_speaker,
)


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("orion.local_speech")

app = FastAPI(
    title="ORION Local Speech",
    version=SERVICE_VERSION,
    description="Loopback-only local utterance STT and speaker identification.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

speech_engine = SpeechEngine()
speaker_engine = SpeakerEngine()
sessions = SessionStore()


def _warm_speech_engine() -> None:
    try:
        speech_engine.warmup()
        speaker_engine.warmup()
        logger.info("Local STT model is ready on %s", speech_engine.status()["device"])
    except Exception:
        logger.exception("Local STT warmup failed; health will expose the model status")


@app.on_event("startup")
def start_model_warmup() -> None:
    threading.Thread(
        target=_warm_speech_engine,
        name="orion-stt-warmup",
        daemon=True,
    ).start()


async def _read_limited(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="Аудио превышает лимит размера.")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Некорректный Content-Length.") from exc

    result = bytearray()
    async for chunk in request.stream():
        result.extend(chunk)
        if len(result) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Аудио превышает лимит размера.")
    if not result:
        raise HTTPException(status_code=422, detail="Аудио не передано.")
    return bytes(result)


def _multipart_in_memory(payload: bytes, content_type: str) -> tuple[bytes, dict[str, str]]:
    try:
        envelope = (
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii")
            + payload
        )
    except UnicodeEncodeError as exc:
        raise HTTPException(status_code=400, detail="Некорректный Content-Type.") from exc
    message = BytesParser(policy=policy.default).parsebytes(envelope)
    if not message.is_multipart():
        raise HTTPException(status_code=400, detail="Ожидался multipart/form-data.")

    audio: bytes | None = None
    fields: dict[str, str] = {}
    for part in message.iter_parts():
        params = dict(part.get_params(header="content-disposition", failobj=[]))
        name = params.get("name")
        if not name:
            continue
        value = part.get_payload(decode=True) or b""
        if name == "audio":
            if audio is not None:
                raise HTTPException(status_code=400, detail="Передайте только одно поле audio.")
            audio = value
        else:
            try:
                fields[name] = value.decode("utf-8").strip()
            except UnicodeDecodeError as exc:
                raise HTTPException(status_code=400, detail=f"Некорректное поле {name}.") from exc
    if not audio:
        raise HTTPException(status_code=422, detail="В multipart отсутствует поле audio.")
    return audio, fields


def _parse_non_negative_int(value: str, field: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Поле {field} должно быть числом.") from exc
    if parsed < 0:
        raise HTTPException(status_code=422, detail=f"Поле {field} не может быть отрицательным.")
    return parsed


def _get_session(session_id: str) -> SessionState:
    try:
        return sessions.get(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Сессия не найдена или истекла.") from exc


def _process_utterance(
    *,
    session: SessionState,
    utterance_index: int,
    audio: DecodedAudio,
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        speech = speech_engine.transcribe(audio.samples)
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Local STT inference failed; transcript is not logged")
        raise HTTPException(status_code=500, detail="Локальное распознавание завершилось ошибкой.") from exc

    recognized_text = speech.text.strip()
    if recognized_text:
        embedding, embedding_status = speaker_engine.embedding(audio.samples)
        speaker = identify_speaker(
            session,
            embedding=embedding,
            embedding_status=embedding_status,
            utterance_index=utterance_index,
        )
    else:
        speaker = unidentified_speaker("empty_transcript_not_enrolled")
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return {
        "sessionId": session.session_id,
        "utteranceIndex": utterance_index,
        "text": recognized_text,
        "tokens": [
            {"text": token.text, "start": token.start, "end": token.end}
            for token in speech.words
        ],
        # GigaAM supports mixed RU/KK text but does not expose calibrated LID.
        "language": None,
        "languageDetection": "not_available",
        "speaker": speaker,
        "durationMs": round(audio.duration_seconds * 1000),
        "processingMs": elapsed_ms,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "network": "loopback_only",
        "audioPersistence": "none",
        "stt": speech_engine.status(),
        "speaker": speaker_engine.status(),
        "activeSessions": sessions.count(),
    }


@app.post("/v1/sessions", response_model=SessionResponse, status_code=201)
def create_session(payload: SessionCreate | None = Body(default=None)) -> dict[str, Any]:
    session = sessions.create(doctor_first=True if payload is None else payload.doctor_first)
    stt_status = speech_engine.status()
    speaker_status = speaker_engine.status()
    return {
        "sessionId": session.session_id,
        "engine": {
            "stt": "gigaam-multilingual",
            "speaker": "campplus" if speaker_status["status"] == "ready" else "order-fallback",
            "device": stt_status["device"],
            "modelStatus": stt_status["status"],
        },
        "speakerCalibration": (
            "Первая различимая реплика — врач; второй отличный голос — пациент. "
            "До готовности CAMPPlus используется только порядок реплик."
        ),
    }


@app.post("/v1/transcribe", response_model=TranscriptionResponse)
async def transcribe_multipart(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    if not content_type.lower().startswith("multipart/form-data"):
        raise HTTPException(status_code=415, detail="Используйте multipart/form-data.")
    body = await _read_limited(request)
    payload, fields = _multipart_in_memory(body, content_type)
    session_id = fields.get("session_id", "")
    if not session_id:
        raise HTTPException(status_code=422, detail="Поле session_id обязательно.")
    utterance_index = _parse_non_negative_int(fields.get("utterance_index", "0"), "utterance_index")
    encoding = fields.get("encoding", "wav").lower()
    sample_rate = _parse_non_negative_int(fields.get("sample_rate", "16000"), "sample_rate")
    channels = _parse_non_negative_int(fields.get("channels", "1"), "channels")
    try:
        audio = decode_audio(
            payload,
            encoding=encoding,
            sample_rate=sample_rate,
            channels=channels,
        )
    except AudioValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _process_utterance(
        session=_get_session(session_id),
        utterance_index=utterance_index,
        audio=audio,
    )


@app.post(
    "/v1/sessions/{session_id}/utterances",
    response_model=TranscriptionResponse,
)
async def transcribe_raw(
    session_id: str,
    request: Request,
    utterance_index: int = Query(default=0, ge=0),
    encoding: Literal["wav", "pcm_s16le", "pcm_f32le"] = Query(default="wav"),
    sample_rate: int = Query(default=16_000, ge=8_000, le=96_000),
    channels: int = Query(default=1, ge=1, le=2),
) -> dict[str, Any]:
    payload = await _read_limited(request)
    try:
        audio = decode_audio(
            payload,
            encoding=encoding,
            sample_rate=sample_rate,
            channels=channels,
        )
    except AudioValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _process_utterance(
        session=_get_session(session_id),
        utterance_index=utterance_index,
        audio=audio,
    )


@app.delete("/v1/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str) -> Response:
    if not sessions.delete(session_id):
        raise HTTPException(status_code=404, detail="Сессия не найдена или истекла.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
