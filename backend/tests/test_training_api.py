from collections.abc import Generator
import os
from pathlib import Path

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Dataset, DatasetSplit, Job, ModelArtifact, Project, TrainingRun
from app.services.jobs import claim_next_job
from app.worker import handle_training_job, process_job


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _write_fake_yolo(bin_dir: Path) -> None:
    executable = bin_dir / "yolo"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        """#!/usr/bin/env python3
import sys
from pathlib import Path

args = dict(arg.split("=", 1) for arg in sys.argv[3:] if "=" in arg)
run_dir = Path(args["project"]) / args["name"]
(run_dir / "weights").mkdir(parents=True, exist_ok=True)
(run_dir / "results.csv").write_text(
    "epoch, metrics/precision(B), metrics/recall(B), metrics/mAP50(B)\\n"
    "0,0.51,0.41,0.46\\n"
    "1,0.72,0.63,0.68\\n",
    encoding="utf-8",
)
(run_dir / "weights" / "best.pt").write_text("best", encoding="utf-8")
(run_dir / "weights" / "last.pt").write_text("last", encoding="utf-8")
print("worker fake training")
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)


def _write_failing_yolo(bin_dir: Path) -> None:
    executable = bin_dir / "yolo"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        """#!/usr/bin/env python3
import sys

print("fake training failed")
sys.exit(7)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)


def _create_project_dataset_split(db, tmp_path: Path) -> tuple[Project, Dataset, DatasetSplit]:
    project = Project(id="project-1", name="라인 A", description="", task_type="detection")
    dataset_root = tmp_path / "dataset"
    dataset_root.mkdir()
    data_yaml = dataset_root / "data.yaml"
    data_yaml.write_text("names: [scratch]\n", encoding="utf-8")
    dataset = Dataset(
        id="dataset-1",
        project_id=project.id,
        name="dataset",
        source_path=str(dataset_root),
        format="yolo",
        class_names=["scratch"],
        image_count=2,
        label_count=2,
        validation_status="valid",
        validation_summary={},
    )
    split = DatasetSplit(
        id="split-1",
        dataset_id=dataset.id,
        name="split",
        train_ratio=0.8,
        val_ratio=0.2,
        seed=42,
        train_count=1,
        val_count=1,
        split_path=str(tmp_path / "split"),
        dataset_yaml_path=str(data_yaml),
    )
    db.add_all([project, dataset, split])
    db.commit()
    return project, dataset, split


def test_post_training_run_creates_queued_run_and_job(client, db, tmp_path):
    project, dataset, split = _create_project_dataset_split(db, tmp_path)

    response = client.post(
        f"/api/projects/{project.id}/training-runs",
        json={
            "name": "baseline",
            "split_id": split.id,
            "model_name": "yolov8n",
            "config": {
                "epochs": 2,
                "batch": 2,
                "imgsz": 320,
                "learning_rate": 0.01,
                "patience": 3,
                "device": "cpu",
            },
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["project_id"] == project.id
    assert body["dataset_id"] == dataset.id
    assert body["split_id"] == split.id
    assert body["status"] == "queued"
    assert body["config"]["epochs"] == 2

    run = db.get(TrainingRun, body["id"])
    assert run is not None
    job = db.scalar(select(Job).where(Job.type == "training", Job.target_id == run.id))
    assert job is not None
    assert job.status == "queued"


def test_post_training_run_rejects_invalid_config(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)

    response = client.post(
        f"/api/projects/{project.id}/training-runs",
        json={
            "name": "bad-config",
            "split_id": split.id,
            "model_name": "yolov8n",
            "config": {
                "epochs": 0,
                "batch": 0,
                "imgsz": -1,
                "learning_rate": 0,
                "patience": 0,
                "device": " ",
            },
        },
    )

    assert response.status_code == 422


def test_training_worker_completes_run_and_creates_artifacts(db, tmp_path, monkeypatch):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    bin_dir = tmp_path / "bin"
    _write_fake_yolo(bin_dir)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")

    run = TrainingRun(
        id="run-1",
        project_id=project.id,
        dataset_id=split.dataset_id,
        split_id=split.id,
        name="baseline",
        model_name="yolov8n",
        trainer="ultralytics",
        status="queued",
        config={
            "epochs": 2,
            "batch": 2,
            "imgsz": 320,
            "learning_rate": 0.01,
            "patience": 3,
            "device": "cpu",
        },
        metrics_summary={},
    )
    db.add(run)
    db.commit()
    db.add(Job(id="job-1", type="training", target_id=run.id, status="queued", priority=100))
    db.commit()

    claimed = claim_next_job(db)
    assert claimed is not None
    process_job(db, claimed)

    db.refresh(run)
    assert run.status == "completed"
    assert run.started_at is not None
    assert run.finished_at is not None
    assert run.artifact_path is not None
    assert run.log_path is not None
    assert run.metrics_summary == {
        "last_epoch": 1,
        "best_mAP50": 0.68,
        "best_precision": 0.72,
        "best_recall": 0.63,
    }
    db.refresh(claimed)
    assert claimed.status == "completed"

    artifacts = list(
        db.scalars(select(ModelArtifact).where(ModelArtifact.training_run_id == run.id))
    )
    assert {artifact.kind for artifact in artifacts} == {"best", "last"}
    assert all(Path(artifact.path).exists() for artifact in artifacts)
    assert Path(run.log_path).read_text(encoding="utf-8").strip() == "worker fake training"


def test_training_worker_marks_failed_nonzero_exit_and_keeps_log_path(db, tmp_path, monkeypatch):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    bin_dir = tmp_path / "bin"
    _write_failing_yolo(bin_dir)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")

    run = TrainingRun(
        id="run-fails",
        project_id=project.id,
        dataset_id=split.dataset_id,
        split_id=split.id,
        name="baseline",
        model_name="yolov8n",
        trainer="ultralytics",
        status="queued",
        config={
            "epochs": 2,
            "batch": 2,
            "imgsz": 320,
            "learning_rate": 0.01,
            "patience": 3,
            "device": "cpu",
        },
        metrics_summary={},
    )
    job = Job(id="job-fails", type="training", target_id=run.id, status="running", priority=100)
    db.add_all([run, job])
    db.commit()

    handle_training_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "failed"
    assert run.finished_at is not None
    assert run.log_path is not None
    assert Path(run.log_path).read_text(encoding="utf-8").strip() == "fake training failed"
    assert job.status == "failed"
    assert job.error_message == "학습 프로세스가 실패했습니다. 종료 코드: 7"


def test_training_worker_keeps_log_path_when_yolo_executable_missing(db, tmp_path, monkeypatch):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    empty_bin = tmp_path / "empty-bin"
    empty_bin.mkdir()
    monkeypatch.setenv("PATH", str(empty_bin))

    run = TrainingRun(
        id="run-missing-yolo",
        project_id=project.id,
        dataset_id=split.dataset_id,
        split_id=split.id,
        name="baseline",
        model_name="yolov8n",
        trainer="ultralytics",
        status="queued",
        config={
            "epochs": 2,
            "batch": 2,
            "imgsz": 320,
            "learning_rate": 0.01,
            "patience": 3,
            "device": "cpu",
        },
        metrics_summary={},
    )
    job = Job(id="job-missing-yolo", type="training", target_id=run.id, status="running", priority=100)
    db.add_all([run, job])
    db.commit()

    handle_training_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "failed"
    assert run.log_path is not None
    assert Path(run.log_path).exists()
    assert job.status == "failed"
    assert job.error_message == "YOLO 실행 파일을 찾을 수 없습니다."


def test_training_artifact_registration_is_idempotent(db, tmp_path, monkeypatch):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    bin_dir = tmp_path / "bin"
    _write_fake_yolo(bin_dir)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")

    run = TrainingRun(
        id="run-idempotent",
        project_id=project.id,
        dataset_id=split.dataset_id,
        split_id=split.id,
        name="baseline",
        model_name="yolov8n",
        trainer="ultralytics",
        status="queued",
        config={
            "epochs": 2,
            "batch": 2,
            "imgsz": 320,
            "learning_rate": 0.01,
            "patience": 3,
            "device": "cpu",
        },
        metrics_summary={},
    )
    job = Job(id="job-idempotent", type="training", target_id=run.id, status="running", priority=100)
    db.add_all([run, job])
    db.commit()

    handle_training_job(db, job)
    handle_training_job(db, job)

    artifacts = list(
        db.scalars(select(ModelArtifact).where(ModelArtifact.training_run_id == run.id))
    )
    assert sorted(artifact.kind for artifact in artifacts) == ["best", "last"]
    assert len(artifacts) == 2


def test_training_worker_marks_run_failed_when_result_processing_raises(
    db, tmp_path, monkeypatch
):
    import app.worker as worker_module

    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    bin_dir = tmp_path / "bin"
    _write_fake_yolo(bin_dir)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")

    run = TrainingRun(
        id="run-postprocess-error",
        project_id=project.id,
        dataset_id=split.dataset_id,
        split_id=split.id,
        name="baseline",
        model_name="yolov8n",
        trainer="ultralytics",
        status="queued",
        config={
            "epochs": 2,
            "batch": 2,
            "imgsz": 320,
            "learning_rate": 0.01,
            "patience": 3,
            "device": "cpu",
        },
        metrics_summary={},
    )
    job = Job(
        id="job-postprocess-error",
        type="training",
        target_id=run.id,
        status="running",
        priority=100,
    )
    db.add_all([run, job])
    db.commit()

    def fail_summary(rows):
        raise RuntimeError("summary exploded")

    monkeypatch.setattr(worker_module, "summarize_metrics", fail_summary)

    handle_training_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "failed"
    assert run.finished_at is not None
    assert job.status == "failed"
    assert job.error_message == "summary exploded"
