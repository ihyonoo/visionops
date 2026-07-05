from collections.abc import Generator
from pathlib import Path

import pytest
import yaml
from PIL import Image

from app.core.config import settings
from app.db import SessionLocal
from app.models import Dataset, DatasetSplit, Project


def _write_valid_yolo_dataset(root: Path, *, count: int = 8) -> Path:
    (root / "images").mkdir(parents=True)
    (root / "labels").mkdir()
    (root / "data.yaml").write_text(yaml.safe_dump({"names": ["scratch"]}), encoding="utf-8")
    for index in range(count):
        Image.new("RGB", (16, 16), color="white").save(root / "images" / f"part-{index}.jpg")
        (root / "labels" / f"part-{index}.txt").write_text(
            "0 0.5 0.5 0.25 0.25\n",
            encoding="utf-8",
        )
    return root


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _create_project_dataset_split(db, tmp_path: Path) -> tuple[Project, Dataset, DatasetSplit]:
    dataset_root = _write_valid_yolo_dataset(tmp_path / "dataset")
    split_root = _write_valid_yolo_dataset(tmp_path / "split")
    project = Project(id="project-1", name="라인 A", description="", task_type="detection")
    dataset = Dataset(
        id="dataset-1",
        project_id=project.id,
        name="dataset",
        source_path=str(dataset_root),
        format="yolo",
        class_names=["scratch"],
        image_count=8,
        label_count=8,
        validation_status="valid",
        validation_summary={
            "warnings": [],
            "errors": [],
            "class_distribution": {"scratch": 8},
            "unlabeled_image_count": 0,
            "orphan_label_count": 0,
        },
    )
    split = DatasetSplit(
        id="split-1",
        dataset_id=dataset.id,
        name="split",
        train_ratio=0.75,
        val_ratio=0.25,
        seed=42,
        train_count=6,
        val_count=2,
        split_path=str(split_root),
        dataset_yaml_path=str(split_root / "data.yaml"),
    )
    db.add_all([project, dataset, split])
    db.commit()
    return project, dataset, split


def test_training_preflight_blocks_missing_runtime_packages(client, db, tmp_path, monkeypatch):
    from app.api.routes import training as training_route

    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    runtime_check = {
        "ready": False,
        "install_required": True,
        "packages": {
            "torch": {"installed": False, "version": None},
            "torchvision": {"installed": False, "version": None},
            "ultralytics": {"installed": False, "version": None},
        },
        "devices": [
            {"id": "cpu", "label": "CPU", "kind": "cpu", "available": True, "details": {}}
        ],
        "yolo_cli": {"installed": False, "path": None},
        "install_options": [],
    }
    monkeypatch.setattr(training_route, "check_runtime", lambda: runtime_check)

    response = client.post(
        f"/api/projects/{project.id}/training-runs/preflight",
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

    assert response.status_code == 200
    body = response.json()
    assert body["can_start"] is False
    assert any("PyTorch" in issue for issue in body["blocking_issues"])
    assert any("Ultralytics" in issue for issue in body["blocking_issues"])
    assert body["selected_device"]["id"] == "cpu"


def test_training_preflight_warns_for_cpu_and_recommends_small_dataset_settings(
    client, db, tmp_path, monkeypatch
):
    from app.api.routes import training as training_route

    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    runtime_check = {
        "ready": True,
        "install_required": False,
        "packages": {
            "torch": {"installed": True, "version": "2.5.0"},
            "torchvision": {"installed": True, "version": "0.20.0"},
            "ultralytics": {"installed": True, "version": "8.3.0"},
        },
        "devices": [
            {"id": "cpu", "label": "CPU", "kind": "cpu", "available": True, "details": {}}
        ],
        "yolo_cli": {"installed": True, "path": "/tmp/yolo"},
        "install_options": [],
    }
    monkeypatch.setattr(training_route, "check_runtime", lambda: runtime_check)

    response = client.post(
        f"/api/projects/{project.id}/training-runs/preflight",
        json={
            "name": "baseline",
            "split_id": split.id,
            "model_name": "yolov8n",
            "config": {
                "epochs": 2,
                "batch": 16,
                "imgsz": 640,
                "learning_rate": 0.01,
                "patience": 3,
                "device": "cpu",
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["can_start"] is True
    assert any("CPU" in warning for warning in body["warnings"])
    assert any("데이터셋" in recommendation for recommendation in body["recommendations"])
    assert body["suggested_config"]["batch"] <= 16
    assert body["command_preview"]["kind"] == "yolo_cli"
    assert body["command_preview"]["argv"][:3] == ["/tmp/yolo", "detect", "train"]
    assert "model=yolov8n.pt" in body["command_preview"]["argv"]
    assert f"data={split.dataset_yaml_path}" in body["command_preview"]["argv"]
    assert "epochs=2" in body["command_preview"]["argv"]
    assert "batch=16" in body["command_preview"]["argv"]
    assert "imgsz=640" in body["command_preview"]["argv"]
    assert "lr0=0.01" in body["command_preview"]["argv"]
    assert "device=cpu" in body["command_preview"]["argv"]
    assert (
        f"project={settings.artifact_root / 'projects' / project.id / 'runs' / 'train'}"
        in body["command_preview"]["argv"]
    )
    assert "name=<new-run-id>" in body["command_preview"]["argv"]
    assert "exist_ok=True" in body["command_preview"]["argv"]
    assert body["command_preview"]["shell"].startswith("/tmp/yolo detect train")
    assert "name=<new-run-id>" in body["command_preview"]["shell"]


def test_training_preflight_blocks_invalid_dataset_before_training(client, db, tmp_path, monkeypatch):
    from app.api.routes import training as training_route

    project, _dataset, split = _create_project_dataset_split(db, tmp_path)
    label_path = tmp_path / "split" / "labels" / "part-0.txt"
    label_path.write_text("9 0.5 0.5 0.25 0.25\n", encoding="utf-8")
    runtime_check = {
        "ready": True,
        "install_required": False,
        "packages": {
            "torch": {"installed": True, "version": "2.5.0"},
            "torchvision": {"installed": True, "version": "0.20.0"},
            "ultralytics": {"installed": True, "version": "8.3.0"},
        },
        "devices": [
            {"id": "cpu", "label": "CPU", "kind": "cpu", "available": True, "details": {}}
        ],
        "yolo_cli": {"installed": True, "path": "/tmp/yolo"},
        "install_options": [],
    }
    monkeypatch.setattr(training_route, "check_runtime", lambda: runtime_check)

    response = client.post(
        f"/api/projects/{project.id}/training-runs/preflight",
        json={
            "name": "baseline",
            "split_id": split.id,
            "model_name": "yolov8n",
            "config": {
                "epochs": 2,
                "batch": 16,
                "imgsz": 640,
                "learning_rate": 0.01,
                "patience": 3,
                "device": "cpu",
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["can_start"] is False
    assert any("데이터셋 오류" in issue for issue in body["blocking_issues"])
    assert any("class_id 9" in issue for issue in body["blocking_issues"])
