import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Job

QUEUED = "queued"
RUNNING = "running"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"


def enqueue_job(db: Session, job_type: str, target_id: str, priority: int = 100) -> Job:
    job = Job(
        id=uuid.uuid4().hex,
        type=job_type,
        target_id=target_id,
        status=QUEUED,
        priority=priority,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim_next_job(db: Session, max_attempts: int = 3) -> Job | None:
    for _ in range(max_attempts):
        candidate_id = db.scalar(
            select(Job.id)
            .where(Job.status == QUEUED)
            .order_by(Job.priority.asc(), Job.created_at.asc())
            .limit(1)
        )
        if candidate_id is None:
            return None

        result = db.execute(
            update(Job)
            .where(Job.id == candidate_id, Job.status == QUEUED)
            .values(status=RUNNING, locked_at=datetime.now(timezone.utc))
            .execution_options(synchronize_session=False)
        )
        if result.rowcount == 0:
            db.rollback()
            continue

        db.commit()
        return db.get(Job, candidate_id)

    return None


def complete_job(db: Session, job: Job, status: str = COMPLETED) -> Job:
    if status not in {COMPLETED, CANCELLED}:
        raise ValueError(f"작업 완료 상태는 '{COMPLETED}' 또는 '{CANCELLED}'만 허용됩니다.")

    job.status = status
    db.commit()
    db.refresh(job)
    return job


def fail_job(db: Session, job: Job, message: str) -> Job:
    job.status = FAILED
    job.error_message = message
    db.commit()
    db.refresh(job)
    return job
