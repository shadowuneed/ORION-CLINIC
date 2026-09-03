from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .config import (
    MAX_SESSIONS,
    SESSION_TTL_SECONDS,
    SPEAKER_MARGIN_THRESHOLD,
    SPEAKER_MATCH_THRESHOLD,
    SPEAKER_PROFILE_ALPHA,
)


class SessionNotFoundError(KeyError):
    pass


@dataclass(slots=True)
class SessionState:
    session_id: str
    created_at: float
    last_access: float
    doctor_first: bool
    utterance_count: int = 0
    profiles: dict[str, np.ndarray] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}
        self._lock = threading.RLock()

    def _prune_locked(self, now: float) -> None:
        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if now - session.last_access > SESSION_TTL_SECONDS
        ]
        for session_id in expired:
            self._sessions.pop(session_id, None)
        if len(self._sessions) >= MAX_SESSIONS:
            oldest = min(self._sessions.values(), key=lambda item: item.last_access)
            self._sessions.pop(oldest.session_id, None)

    def create(self, *, doctor_first: bool = True) -> SessionState:
        now = time.monotonic()
        with self._lock:
            self._prune_locked(now)
            session_id = str(uuid.uuid4())
            session = SessionState(
                session_id=session_id,
                created_at=now,
                last_access=now,
                doctor_first=doctor_first,
            )
            self._sessions[session_id] = session
            return session

    def get(self, session_id: str) -> SessionState:
        try:
            parsed = str(uuid.UUID(session_id))
        except (ValueError, AttributeError) as exc:
            raise SessionNotFoundError(session_id) from exc
        now = time.monotonic()
        with self._lock:
            self._prune_locked(now)
            session = self._sessions.get(parsed)
            if session is None:
                raise SessionNotFoundError(session_id)
            session.last_access = now
            return session

    def delete(self, session_id: str) -> bool:
        try:
            parsed = str(uuid.UUID(session_id))
        except (ValueError, AttributeError):
            return False
        with self._lock:
            return self._sessions.pop(parsed, None) is not None

    def count(self) -> int:
        with self._lock:
            self._prune_locked(time.monotonic())
            return len(self._sessions)


ROLE_LABELS = {
    "doctor": "Врач",
    "patient": "Пациент",
    "unknown": "Не определён",
}


def _speaker_payload(
    role: str,
    *,
    confidence: float | None,
    method: str,
    status: str,
) -> dict[str, Any]:
    return {
        "id": role,
        "label": ROLE_LABELS[role],
        "confidence": None if confidence is None else round(confidence, 3),
        "method": method,
        "status": status,
    }


def unidentified_speaker(status: str) -> dict[str, Any]:
    return _speaker_payload(
        "unknown",
        confidence=None,
        method="order_fallback",
        status=status,
    )


def _update_profile(current: np.ndarray, observed: np.ndarray) -> np.ndarray:
    blended = (1.0 - SPEAKER_PROFILE_ALPHA) * current + SPEAKER_PROFILE_ALPHA * observed
    norm = float(np.linalg.norm(blended))
    return np.ascontiguousarray(blended / max(norm, 1e-8), dtype=np.float32)


def identify_speaker(
    session: SessionState,
    *,
    embedding: np.ndarray | None,
    embedding_status: str,
    utterance_index: int,
) -> dict[str, Any]:
    with session.lock:
        accepted_position = session.utterance_count
        session.utterance_count += 1
        first_role = "doctor" if session.doctor_first else "patient"
        second_role = "patient" if session.doctor_first else "doctor"
        if embedding is None:
            return _speaker_payload(
                first_role if accepted_position == 0 else "unknown",
                confidence=None,
                method="order_fallback",
                status=embedding_status,
            )

        if first_role not in session.profiles:
            if accepted_position > 0:
                return _speaker_payload(
                    "unknown",
                    confidence=None,
                    method="embedding",
                    status="first_voice_profile_missing",
                )
            session.profiles[first_role] = embedding
            return _speaker_payload(
                first_role,
                confidence=1.0,
                method="embedding",
                status="enrolled_first_voice",
            )

        first_similarity = float(np.dot(session.profiles[first_role], embedding))
        if second_role not in session.profiles:
            if first_similarity >= SPEAKER_MATCH_THRESHOLD:
                session.profiles[first_role] = _update_profile(
                    session.profiles[first_role], embedding
                )
                return _speaker_payload(
                    first_role,
                    confidence=max(0.0, min(1.0, first_similarity)),
                    method="embedding",
                    status="matched_first_voice_uncalibrated_cosine",
                )
            session.profiles[second_role] = embedding
            return _speaker_payload(
                second_role,
                confidence=max(0.0, min(1.0, 1.0 - first_similarity)),
                method="embedding",
                status="enrolled_second_distinct_voice",
            )

        scores = {
            role: float(np.dot(profile, embedding))
            for role, profile in session.profiles.items()
        }
        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        best_role, best_score = ranked[0]
        margin = best_score - ranked[1][1]
        if best_score < SPEAKER_MATCH_THRESHOLD or margin < SPEAKER_MARGIN_THRESHOLD:
            return _speaker_payload(
                "unknown",
                confidence=max(0.0, min(1.0, best_score)),
                method="embedding",
                status="below_similarity_or_margin_threshold",
            )

        session.profiles[best_role] = _update_profile(session.profiles[best_role], embedding)
        return _speaker_payload(
            best_role,
            confidence=max(0.0, min(1.0, best_score)),
            method="embedding",
            status="matched_uncalibrated_cosine",
        )
