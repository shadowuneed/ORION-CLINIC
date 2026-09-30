"""Session lifecycle regressions; no HTTP, audio, model loading, or real clock."""

from __future__ import annotations

import unittest
import uuid
from unittest.mock import patch

from orion_local.sessions import SessionNotFoundError, SessionStore


class SessionStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        clock_patch = patch("orion_local.sessions.time.monotonic", return_value=0.0)
        self.clock = clock_patch.start()
        self.addCleanup(clock_patch.stop)
        capacity_patch = patch("orion_local.sessions.MAX_SESSIONS", 2)
        capacity_patch.start()
        self.addCleanup(capacity_patch.stop)
        ttl_patch = patch("orion_local.sessions.SESSION_TTL_SECONDS", 10.0)
        ttl_patch.start()
        self.addCleanup(ttl_patch.stop)
        self.store = SessionStore()

    def test_health_count_at_64_sessions_does_not_evict_or_refresh_them(self) -> None:
        with patch("orion_local.sessions.MAX_SESSIONS", 64):
            sessions = [self.store.create() for _ in range(64)]
            self.clock.return_value = 5.0

            for _ in range(3):
                self.assertEqual(self.store.count(), 64)
            for session in sessions:
                self.assertEqual(session.last_access, 0.0)
                self.assertIs(self.store.get(session.session_id), session)
            self.assertEqual(self.store.count(), 64)

    def test_get_at_capacity_preserves_all_active_session_objects(self) -> None:
        first = self.store.create(doctor_first=False)
        first.utterance_count = 3
        self.clock.return_value = 1.0
        second = self.store.create()
        self.clock.return_value = 2.0

        self.assertIs(self.store.get(first.session_id), first)
        self.assertIs(self.store.get(second.session_id), second)
        self.assertEqual(first.utterance_count, 3)
        self.assertFalse(first.doctor_first)
        self.assertEqual(self.store.count(), 2)

    def test_missing_session_lookup_at_capacity_does_not_evict_another(self) -> None:
        first = self.store.create()
        second = self.store.create()
        self.clock.return_value = 2.0

        with self.assertRaises(SessionNotFoundError):
            self.store.get(str(uuid.UUID(int=0)))

        self.assertIs(self.store.get(first.session_id), first)
        self.assertIs(self.store.get(second.session_id), second)
        self.assertEqual(self.store.count(), 2)

    def test_create_at_capacity_evicts_only_the_least_recently_accessed(self) -> None:
        first = self.store.create()
        self.clock.return_value = 1.0
        second = self.store.create()
        self.clock.return_value = 2.0
        self.assertIs(self.store.get(first.session_id), first)
        self.clock.return_value = 3.0

        third = self.store.create()

        self.assertEqual(self.store.count(), 2)
        with self.assertRaises(SessionNotFoundError):
            self.store.get(second.session_id)
        self.assertIs(self.store.get(first.session_id), first)
        self.assertIs(self.store.get(third.session_id), third)

    def test_create_prunes_expired_sessions_before_considering_capacity(self) -> None:
        expired = self.store.create()
        self.clock.return_value = 5.0
        active = self.store.create()
        self.clock.return_value = 11.0

        created = self.store.create()

        self.assertEqual(self.store.count(), 2)
        with self.assertRaises(SessionNotFoundError):
            self.store.get(expired.session_id)
        self.assertIs(self.store.get(active.session_id), active)
        self.assertIs(self.store.get(created.session_id), created)

    def test_count_expires_only_sessions_past_the_idle_ttl(self) -> None:
        first = self.store.create()
        self.clock.return_value = 1.0
        second = self.store.create()

        self.clock.return_value = 10.0
        self.assertEqual(self.store.count(), 2)
        self.clock.return_value = 10.001
        self.assertEqual(self.store.count(), 1)
        with self.assertRaises(SessionNotFoundError):
            self.store.get(first.session_id)
        self.assertEqual(second.last_access, 1.0)
        self.clock.return_value = 11.001
        self.assertEqual(self.store.count(), 0)

    def test_get_refreshes_idle_ttl_and_preserves_the_existing_boundary(self) -> None:
        session = self.store.create()

        self.clock.return_value = 10.0
        self.assertIs(self.store.get(session.session_id), session)
        self.assertEqual(session.last_access, 10.0)
        self.clock.return_value = 20.0
        self.assertIs(self.store.get(session.session_id), session)
        self.clock.return_value = 30.001
        with self.assertRaises(SessionNotFoundError):
            self.store.get(session.session_id)
        self.assertEqual(self.store.count(), 0)

    def test_repeated_insertions_never_exceed_capacity(self) -> None:
        sessions = []
        for index in range(5):
            self.clock.return_value = float(index)
            sessions.append(self.store.create())
            self.assertEqual(self.store.count(), min(index + 1, 2))

        for session in sessions[:-2]:
            with self.assertRaises(SessionNotFoundError):
                self.store.get(session.session_id)
        for session in sessions[-2:]:
            self.assertIs(self.store.get(session.session_id), session)


if __name__ == "__main__":
    unittest.main()
