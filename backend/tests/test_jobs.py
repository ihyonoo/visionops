from collections.abc import Generator
from datetime import datetime, timezone

import pytest

from app.db import SessionLocal
from app.models import Job
from app.services.jobs import claim_next_job, complete_job, enqueue_job, fail_job
from app.worker import JOB_HANDLERS, process_job


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _set_created_at(db, job: Job, created_at: datetime) -> Job:
    job.created_at = created_at
    db.commit()
    db.refresh(job)
    return job


def test_queue_claims_oldest_job_and_leaves_second_queued(db):
    first = enqueue_job(db, "train", "run-1")
    second = enqueue_job(db, "train", "run-2")
    _set_created_at(db, first, datetime(2026, 1, 1, tzinfo=timezone.utc))
    _set_created_at(db, second, datetime(2026, 1, 2, tzinfo=timezone.utc))

    claimed = claim_next_job(db)

    assert claimed is not None
    assert claimed.id == first.id
    assert claimed.status == "running"
    assert claimed.locked_at is not None
    db.refresh(second)
    assert second.status == "queued"


def test_priority_wins_before_created_at_when_priorities_differ(db):
    older = enqueue_job(db, "train", "run-older", priority=100)
    newer_high_priority = enqueue_job(db, "train", "run-newer", priority=10)
    _set_created_at(db, older, datetime(2026, 1, 1, tzinfo=timezone.utc))
    _set_created_at(db, newer_high_priority, datetime(2026, 1, 2, tzinfo=timezone.utc))

    claimed = claim_next_job(db)

    assert claimed is not None
    assert claimed.id == newer_high_priority.id


def test_complete_job_sets_completed_or_provided_terminal_status(db):
    completed = enqueue_job(db, "train", "run-complete")
    cancelled = enqueue_job(db, "train", "run-cancel")

    complete_job(db, completed)
    complete_job(db, cancelled, status="cancelled")

    assert completed.status == "completed"
    assert cancelled.status == "cancelled"


def test_complete_job_rejects_non_terminal_status(db):
    job = enqueue_job(db, "train", "run-invalid")

    with pytest.raises(ValueError):
        complete_job(db, job, status="running")

    db.refresh(job)
    assert job.status == "queued"


def test_fail_job_sets_failed_and_error_message(db):
    job = enqueue_job(db, "train", "run-fail")

    fail_job(db, job, "핸들러를 찾을 수 없습니다.")

    assert job.status == "failed"
    assert job.error_message == "핸들러를 찾을 수 없습니다."


def test_claim_next_job_returns_none_with_empty_queue(db):
    assert claim_next_job(db) is None


def test_two_sessions_do_not_claim_same_job(db):
    first = enqueue_job(db, "train", "run-1")
    second = enqueue_job(db, "train", "run-2")
    _set_created_at(db, first, datetime(2026, 1, 1, tzinfo=timezone.utc))
    _set_created_at(db, second, datetime(2026, 1, 2, tzinfo=timezone.utc))

    first_session = SessionLocal()
    second_session = SessionLocal()
    try:
        first_claim = claim_next_job(first_session)
        second_claim = claim_next_job(second_session)
    finally:
        first_session.close()
        second_session.close()

    assert first_claim is not None
    assert second_claim is not None
    assert first_claim.id != second_claim.id


def test_process_job_marks_unknown_type_failed(db):
    job = enqueue_job(db, "unknown", "run-unknown")
    claimed = claim_next_job(db)

    assert claimed is not None
    process_job(db, claimed)

    db.refresh(job)
    assert job.status == "failed"
    assert job.error_message == "처리할 수 없는 작업 유형입니다: unknown"


def test_process_job_marks_failed_when_handler_raises(db, monkeypatch):
    job = enqueue_job(db, "explode", "run-explode")
    claimed = claim_next_job(db)

    def raise_error(db, job):
        job.error_message = "uncommitted side effect"
        raise RuntimeError("kaboom")

    monkeypatch.setitem(JOB_HANDLERS, "explode", raise_error)

    assert claimed is not None
    process_job(db, claimed)

    db.refresh(job)
    assert job.status == "failed"
    assert job.error_message == "kaboom"
