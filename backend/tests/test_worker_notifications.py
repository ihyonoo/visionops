from collections.abc import Generator
from datetime import datetime, timezone

import pytest

from app.db import SessionLocal
from app.models import InferenceRun, Project, TrainingRun
from app.worker import notify_inference_finished, notify_training_finished


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_notify_training_finished_uses_project_and_run(db, monkeypatch):
    project = Project(id="prj_1", name="Bearing QA")
    run = TrainingRun(
        id="trn_1",
        project_id=project.id,
        dataset_id="dst_1",
        split_id="spl_1",
        name="YOLO baseline",
        model_name="yolov8n",
        status="completed",
        metrics_summary={"mAP50": 0.91},
        finished_at=datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc),
    )
    db.add_all([project, run])
    db.commit()

    captured = []

    def capture_notification(db, event):
        captured.append(event)
        return []

    monkeypatch.setattr("app.worker.send_work_notification", capture_notification)

    notify_training_finished(db, run, "training_completed")

    assert len(captured) == 1
    event = captured[0]
    assert event.event_type == "training_completed"
    assert event.target_type == "training"
    assert event.target_id == run.id
    assert event.project_name == "Bearing QA"
    assert event.run_name == "YOLO baseline"
    assert event.status == "completed"
    assert event.occurred_at == run.finished_at
    assert event.summary == {"mAP50": 0.91}


def test_notify_inference_finished_uses_prediction_count(db, monkeypatch):
    project = Project(id="prj_2", name="Line Scan")
    run = InferenceRun(
        id="inf_1",
        project_id=project.id,
        model_artifact_id="art_1",
        name="night shift",
        input_type="folder",
        input_path="/tmp/input",
        status="completed",
        prediction_count=7,
        finished_at=datetime(2026, 1, 3, 3, 4, tzinfo=timezone.utc),
    )
    db.add_all([project, run])
    db.commit()

    captured = []

    def capture_notification(db, event):
        captured.append(event)
        return []

    monkeypatch.setattr("app.worker.send_work_notification", capture_notification)

    notify_inference_finished(db, run, "inference_completed")

    assert len(captured) == 1
    event = captured[0]
    assert event.event_type == "inference_completed"
    assert event.target_type == "inference"
    assert event.target_id == run.id
    assert event.project_name == "Line Scan"
    assert event.run_name == "night shift"
    assert event.status == "completed"
    assert event.occurred_at == run.finished_at
    assert event.summary == {"prediction_count": 7}


def test_notification_failure_does_not_raise_or_mutate_run_state(db, monkeypatch):
    project = Project(id="prj_3", name="Safe Notify")
    run = TrainingRun(
        id="trn_2",
        project_id=project.id,
        dataset_id="dst_2",
        split_id="spl_2",
        name="stable run",
        model_name="yolov8n",
        status="completed",
        metrics_summary={"mAP50": 0.88},
        finished_at=datetime(2026, 1, 4, 3, 4, tzinfo=timezone.utc),
    )
    db.add_all([project, run])
    db.commit()

    def raise_notification_error(db, event):
        raise RuntimeError("delivery unavailable")

    monkeypatch.setattr("app.worker.send_work_notification", raise_notification_error)

    notify_training_finished(db, run, "training_completed")

    db.refresh(run)
    assert run.status == "completed"
