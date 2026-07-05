import asyncio
from collections.abc import Generator
from pathlib import Path

import pytest

from app.db import SessionLocal
from app.api.routes.training import stream_training_run_logs
from app.models import Dataset, DatasetSplit, ModelArtifact, Project, TrainingRun
from app.services.logs import stream_log, tail_log, tail_log_with_offset
from app.services.metrics import read_results_csv


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _create_project_dataset_split(
    db,
    tmp_path: Path,
    *,
    project_id: str = "project-logs",
    split_id: str = "split-logs",
) -> tuple[Project, Dataset, DatasetSplit]:
    project = Project(id=project_id, name="검사 라인", description="", task_type="detection")
    dataset_root = tmp_path / f"dataset-{project_id}"
    dataset_root.mkdir()
    data_yaml = dataset_root / "data.yaml"
    data_yaml.write_text("names: [scratch]\n", encoding="utf-8")
    dataset = Dataset(
        id=f"dataset-{project_id}",
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
        id=split_id,
        dataset_id=dataset.id,
        name="split",
        train_ratio=0.8,
        val_ratio=0.2,
        seed=42,
        train_count=1,
        val_count=1,
        split_path=str(tmp_path / f"split-{split_id}"),
        dataset_yaml_path=str(data_yaml),
    )
    db.add_all([project, dataset, split])
    db.commit()
    return project, dataset, split


def _create_training_run(
    db,
    project: Project,
    split: DatasetSplit,
    *,
    run_id: str = "run-logs",
    artifact_path: Path | None = None,
    log_path: Path | None = None,
    metrics_summary: dict | None = None,
) -> TrainingRun:
    run = TrainingRun(
        id=run_id,
        project_id=project.id,
        dataset_id=split.dataset_id,
        split_id=split.id,
        name="baseline",
        model_name="yolov8n",
        trainer="ultralytics",
        status="completed",
        config={"epochs": 2},
        metrics_summary=metrics_summary or {},
        artifact_path=str(artifact_path) if artifact_path is not None else None,
        log_path=str(log_path) if log_path is not None else None,
    )
    db.add(run)
    db.commit()
    return run


def test_tail_log_reads_last_n_lines(tmp_path):
    log_path = tmp_path / "stdout.log"
    log_path.write_text("one\ntwo\nthree\nfour\n", encoding="utf-8")

    assert tail_log(log_path, max_lines=2) == ["three", "four"]


def test_logs_endpoint_returns_tail_lines(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    log_path = tmp_path / "stdout.log"
    log_path.write_text("first\nsecond\nthird\n", encoding="utf-8")
    run = _create_training_run(db, project, split, log_path=log_path)

    response = client.get(
        f"/api/projects/{project.id}/training-runs/{run.id}/logs?tail=2"
    )

    assert response.status_code == 200
    assert response.json() == {"lines": ["second", "third"], "offset": len("first\nsecond\nthird\n")}


def test_logs_endpoint_returns_empty_lines_when_log_missing(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    run = _create_training_run(db, project, split, log_path=tmp_path / "missing.log")

    response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/logs")

    assert response.status_code == 200
    assert response.json() == {"lines": [], "offset": 0}


def test_metrics_endpoint_returns_summary_and_rows_from_results_csv(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    artifact_dir = tmp_path / "artifacts" / "run-with-csv"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "results.csv").write_text(
        "epoch, metrics/precision(B), metrics/recall(B), metrics/mAP50(B)\n"
        "0,0.10,0.20,0.30\n"
        "1,0.40,0.35,0.50\n",
        encoding="utf-8",
    )
    run = _create_training_run(
        db,
        project,
        split,
        run_id="run-with-csv",
        artifact_path=artifact_dir,
        metrics_summary={"best_mAP50": 0.99},
    )

    response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/metrics")

    assert response.status_code == 200
    body = response.json()
    assert body["rows"] == [
        {
            "epoch": 0,
            "metrics/precision(B)": 0.10,
            "metrics/recall(B)": 0.20,
            "metrics/mAP50(B)": 0.30,
        },
        {
            "epoch": 1,
            "metrics/precision(B)": 0.40,
            "metrics/recall(B)": 0.35,
            "metrics/mAP50(B)": 0.50,
        },
    ]
    assert body["summary"] == {
        "last_epoch": 1,
        "best_mAP50": 0.50,
        "best_precision": 0.40,
        "best_recall": 0.35,
    }


def test_metrics_endpoint_returns_db_summary_when_csv_absent(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    artifact_dir = tmp_path / "artifacts" / "run-summary-only"
    artifact_dir.mkdir(parents=True)
    run = _create_training_run(
        db,
        project,
        split,
        run_id="run-summary-only",
        artifact_path=artifact_dir,
        metrics_summary={"best_mAP50": 0.62, "last_epoch": 4},
    )

    response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/metrics")

    assert response.status_code == 200
    assert response.json() == {
        "summary": {"best_mAP50": 0.62, "last_epoch": 4},
        "rows": [],
    }


def test_metrics_endpoint_skips_partial_results_csv_rows(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    artifact_dir = tmp_path / "artifacts" / "run-partial-csv"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "results.csv").write_text(
        "epoch,metrics/precision(B),metrics/recall(B),metrics/mAP50(B)\n"
        "0,0.10,0.20,0.30\n"
        "1,0.40\n",
        encoding="utf-8",
    )
    run = _create_training_run(
        db,
        project,
        split,
        run_id="run-partial-csv",
        artifact_path=artifact_dir,
        metrics_summary={"best_mAP50": 0.99},
    )

    response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/metrics")

    assert response.status_code == 200
    assert response.json() == {
        "summary": {
            "last_epoch": 0,
            "best_mAP50": 0.30,
            "best_precision": 0.10,
            "best_recall": 0.20,
        },
        "rows": [
            {
                "epoch": 0,
                "metrics/precision(B)": 0.10,
                "metrics/recall(B)": 0.20,
                "metrics/mAP50(B)": 0.30,
            }
        ],
    }


def test_results_csv_reader_returns_empty_for_directory(tmp_path):
    assert read_results_csv(tmp_path) == []


def test_metrics_endpoint_falls_back_to_db_summary_when_csv_decode_fails(
    client, db, tmp_path
):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    artifact_dir = tmp_path / "artifacts" / "run-bad-csv"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "results.csv").write_bytes(b"\xff\xfe\x00")
    run = _create_training_run(
        db,
        project,
        split,
        run_id="run-bad-csv",
        artifact_path=artifact_dir,
        metrics_summary={"best_mAP50": 0.72, "last_epoch": 3},
    )

    response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/metrics")

    assert response.status_code == 200
    assert response.json() == {
        "summary": {"best_mAP50": 0.72, "last_epoch": 3},
        "rows": [],
    }


def test_artifacts_endpoint_returns_best_and_last_artifacts(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    run = _create_training_run(db, project, split)
    best_path = tmp_path / "best.pt"
    last_path = tmp_path / "last.pt"
    best_path.write_text("best", encoding="utf-8")
    last_path.write_text("last", encoding="utf-8")
    db.add_all(
        [
            ModelArtifact(
                id="artifact-best",
                training_run_id=run.id,
                kind="best",
                path=str(best_path),
                metrics_snapshot={"best_mAP50": 0.7},
            ),
            ModelArtifact(
                id="artifact-last",
                training_run_id=run.id,
                kind="last",
                path=str(last_path),
                metrics_snapshot={"best_mAP50": 0.65},
            ),
        ]
    )
    db.commit()

    response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/artifacts")

    assert response.status_code == 200
    body = response.json()
    assert [artifact["kind"] for artifact in body] == ["best", "last"]
    assert {artifact["path"] for artifact in body} == {str(best_path), str(last_path)}
    assert body[0]["metrics_snapshot"] == {"best_mAP50": 0.7}


def test_training_artifact_and_results_csv_downloads(client, db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    artifact_dir = tmp_path / "artifacts" / "run-download"
    artifact_dir.mkdir(parents=True)
    best_path = artifact_dir / "best.pt"
    last_path = artifact_dir / "last.pt"
    best_path.write_bytes(b"best-weights")
    last_path.write_bytes(b"last-weights")
    (artifact_dir / "results.csv").write_text("epoch,mAP50\n1,0.7\n", encoding="utf-8")
    (artifact_dir / "args.yaml").write_text("epochs: 2\n", encoding="utf-8")
    (artifact_dir / "results.png").write_bytes(b"plot")
    (artifact_dir / "confusion_matrix.png").write_bytes(b"matrix")
    (artifact_dir / "train_batch0.jpg").write_bytes(b"train-sample")
    (artifact_dir / "val_batch0_pred.jpg").write_bytes(b"val-sample")
    run = _create_training_run(db, project, split, artifact_path=artifact_dir)
    artifacts = [
        ModelArtifact(
            id="artifact-best",
            training_run_id=run.id,
            kind="best",
            path=str(best_path),
            metrics_snapshot={},
        ),
        ModelArtifact(
            id="artifact-last",
            training_run_id=run.id,
            kind="last",
            path=str(last_path),
            metrics_snapshot={},
        ),
    ]
    db.add_all(artifacts)
    db.commit()

    downloads_response = client.get(
        f"/api/projects/{project.id}/training-runs/{run.id}/downloads"
    )
    artifact_response = client.get(
        f"/api/projects/{project.id}/training-runs/{run.id}/artifacts/{artifacts[0].id}/download"
    )
    results_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/results.csv")
    args_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/downloads/args.yaml")
    plot_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/downloads/results.png")
    thumbnail_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/thumbnail")

    assert downloads_response.status_code == 200
    downloads = downloads_response.json()
    assert [item["filename"] for item in downloads] == [
        "results.csv",
        "best.pt",
        "last.pt",
        "args.yaml",
        "confusion_matrix.png",
        "results.png",
    ]
    assert "train_batch0.jpg" not in {item["filename"] for item in downloads}
    assert "val_batch0_pred.jpg" not in {item["filename"] for item in downloads}
    assert artifact_response.status_code == 200
    assert artifact_response.content == b"best-weights"
    assert "best.pt" in artifact_response.headers["content-disposition"]
    assert results_response.status_code == 200
    assert results_response.text == "epoch,mAP50\n1,0.7\n"
    assert "results.csv" in results_response.headers["content-disposition"]
    assert args_response.status_code == 200
    assert args_response.text == "epochs: 2\n"
    assert "args.yaml" in args_response.headers["content-disposition"]
    assert plot_response.status_code == 200
    assert plot_response.content == b"plot"
    assert thumbnail_response.status_code == 200
    assert thumbnail_response.content == b"val-sample"


def test_training_downloads_use_logged_yolo_save_dir_when_artifact_path_was_relative(
    client, db, tmp_path
):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    recorded_dir = tmp_path / "recorded" / "run-legacy"
    actual_dir = tmp_path / "runs" / "detect" / "recorded" / "run-legacy"
    (recorded_dir / "weights").mkdir(parents=True)
    (actual_dir / "weights").mkdir(parents=True)
    (recorded_dir / "results.csv").write_text("epoch,mAP50\n1,0.7\n", encoding="utf-8")
    (recorded_dir / "weights" / "best.pt").write_text("best", encoding="utf-8")
    (recorded_dir / "weights" / "last.pt").write_text("last", encoding="utf-8")
    (actual_dir / "results.csv").write_text("epoch,mAP50\n1,0.9\n", encoding="utf-8")
    (actual_dir / "args.yaml").write_text("epochs: 30\n", encoding="utf-8")
    (actual_dir / "results.png").write_bytes(b"plot")
    log_path = recorded_dir / "logs" / "stdout.log"
    log_path.parent.mkdir(parents=True)
    log_path.write_text(f"engine/trainer: save_dir={actual_dir}, epochs=30\n", encoding="utf-8")
    run = _create_training_run(db, project, split, artifact_path=recorded_dir)
    run.log_path = str(log_path)
    db.commit()

    downloads_response = client.get(
        f"/api/projects/{project.id}/training-runs/{run.id}/downloads"
    )
    args_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/downloads/args.yaml")
    plot_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/downloads/results.png")
    results_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/results.csv")

    assert downloads_response.status_code == 200
    assert [item["filename"] for item in downloads_response.json()] == [
        "results.csv",
        "args.yaml",
        "results.png",
    ]
    assert args_response.status_code == 200
    assert args_response.text == "epochs: 30\n"
    assert plot_response.status_code == 200
    assert plot_response.content == b"plot"
    assert results_response.status_code == 200
    assert results_response.text == "epoch,mAP50\n1,0.9\n"


def test_training_downloads_use_results_saved_to_log_when_save_dir_is_absent(
    client, db, tmp_path
):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    recorded_dir = tmp_path / "recorded" / "run-with-results-log"
    actual_dir = tmp_path / "runs" / "detect" / "recorded" / "run-with-results-log"
    (recorded_dir / "weights").mkdir(parents=True)
    actual_dir.mkdir(parents=True)
    (recorded_dir / "results.csv").write_text("epoch,mAP50\n1,0.5\n", encoding="utf-8")
    (actual_dir / "results.csv").write_text("epoch,mAP50\n1,0.95\n", encoding="utf-8")
    (actual_dir / "args.yaml").write_text("epochs: 50\n", encoding="utf-8")
    log_path = recorded_dir / "logs" / "stdout.log"
    log_path.parent.mkdir(parents=True)
    log_path.write_text(f"Results saved to \x1b[1m{actual_dir}\x1b[0m\n", encoding="utf-8")
    run = _create_training_run(db, project, split, artifact_path=recorded_dir)
    run.log_path = str(log_path)
    db.commit()

    downloads_response = client.get(
        f"/api/projects/{project.id}/training-runs/{run.id}/downloads"
    )
    args_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/downloads/args.yaml")
    results_response = client.get(f"/api/projects/{project.id}/training-runs/{run.id}/results.csv")

    assert downloads_response.status_code == 200
    assert [item["filename"] for item in downloads_response.json()] == [
        "results.csv",
        "args.yaml",
    ]
    assert args_response.status_code == 200
    assert args_response.text == "epochs: 50\n"
    assert results_response.status_code == 200
    assert results_response.text == "epoch,mAP50\n1,0.95\n"


def test_training_log_metrics_and_artifacts_reject_run_outside_project(
    client, db, tmp_path
):
    project, _dataset, split = _create_project_dataset_split(
        db, tmp_path, project_id="project-owner", split_id="split-owner"
    )
    other_project, _other_dataset, other_split = _create_project_dataset_split(
        db, tmp_path, project_id="project-other", split_id="split-other"
    )
    run = _create_training_run(db, other_project, other_split, run_id="outside-run")

    for suffix in ("logs", "metrics", "artifacts", "downloads"):
        response = client.get(
            f"/api/projects/{project.id}/training-runs/{run.id}/{suffix}"
        )

        assert response.status_code == 404


def test_logs_stream_endpoint_returns_text_event_stream(db, tmp_path):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    log_path = tmp_path / "stdout.log"
    log_path.write_text("hello\n", encoding="utf-8")
    run = _create_training_run(db, project, split, log_path=log_path)

    response = stream_training_run_logs(project.id, run.id)

    async def read_first_two_events() -> list[str]:
        generator = stream_log(log_path, poll_seconds=0)
        try:
            return [await anext(generator), await anext(generator)]
        finally:
            await generator.aclose()

    assert response.media_type == "text/event-stream"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    assert asyncio.run(read_first_two_events()) == [
        ": connected\n\n",
        "data: hello\n\n",
    ]


def test_stream_log_can_follow_from_end_without_replaying_existing_lines(tmp_path):
    log_path = tmp_path / "stdout.log"
    log_path.write_text("already tailed\n", encoding="utf-8")

    async def read_events() -> list[str]:
        generator = stream_log(log_path, poll_seconds=0, follow_from_end=True)
        try:
            connected = await anext(generator)
            log_path.write_text("already tailed\nnew line\n", encoding="utf-8")
            new_line = await anext(generator)
            return [connected, new_line]
        finally:
            await generator.aclose()

    assert asyncio.run(read_events()) == [
        ": connected\n\n",
        "data: new line\n\n",
    ]


def test_stream_log_can_resume_from_tail_offset(tmp_path):
    log_path = tmp_path / "stdout.log"
    log_path.write_text("tail line\n", encoding="utf-8")
    _lines, offset = tail_log_with_offset(log_path)
    log_path.write_text("tail line\nhandoff line\n", encoding="utf-8")

    async def read_events() -> list[str]:
        generator = stream_log(log_path, poll_seconds=0, start_position=offset)
        try:
            return [await anext(generator), await anext(generator)]
        finally:
            await generator.aclose()

    assert asyncio.run(read_events()) == [
        ": connected\n\n",
        "data: handoff line\n\n",
    ]


def test_logs_stream_endpoint_handles_missing_log_path(db, tmp_path, monkeypatch):
    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    run = _create_training_run(db, project, split, log_path=None)
    captured = {}

    def fake_stream_log(path, **kwargs):
        captured["path"] = path
        captured["kwargs"] = kwargs

        async def generator():
            yield ": connected\n\n"

        return generator()

    monkeypatch.setattr("app.api.routes.training.stream_log", fake_stream_log)

    response = stream_training_run_logs(project.id, run.id, offset=123)

    assert response.media_type == "text/event-stream"
    assert captured["path"] is None
    assert captured["kwargs"] == {"follow_from_end": False, "start_position": 123}
