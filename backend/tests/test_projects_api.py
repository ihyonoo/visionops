import re

from fastapi.testclient import TestClient
from PIL import Image
import pytest
from sqlalchemy import select
import yaml

from app.core.config import settings
from app.db import SessionLocal
from app.main import app
from app.models import (
    Dataset,
    DatasetSplit,
    InferencePrediction,
    InferenceRun,
    Job,
    ModelArtifact,
    Project,
    TrainingRun,
)
from app.services.storage import StoragePaths


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_create_list_and_get_project(client):
    created = client.post(
        "/api/projects",
        json={"name": "factory", "description": "defects"},
    )
    assert created.status_code == 201
    body = created.json()
    assert re.fullmatch(r"prj_[2-9a-z]{10}", body["id"])
    assert body["name"] == "factory"
    assert body["description"] == "defects"
    assert body["task_type"] == "detection"

    listed = client.get("/api/projects")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == body["id"]

    fetched = client.get(f"/api/projects/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]


def test_project_slug_is_generated_from_name_and_kept_unique(client):
    first = client.post(
        "/api/projects",
        json={"name": "Suitcase Inspection", "description": ""},
    )
    second = client.post(
        "/api/projects",
        json={"name": "Suitcase Inspection", "description": ""},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["slug"] == "suitcase-inspection"
    assert second.json()["slug"] == "suitcase-inspection-2"


def test_project_slug_updates_when_project_is_renamed(client):
    created = client.post(
        "/api/projects",
        json={"name": "Factory A", "description": ""},
    )
    assert created.status_code == 201
    project_id = created.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}",
        json={"name": "검수 라인 A"},
    )

    assert response.status_code == 200
    assert response.json()["slug"] == "검수-라인-a"


def test_missing_project_returns_404(client):
    response = client.get("/api/projects/missing")

    assert response.status_code == 404


def test_update_project_name_and_description(client):
    created = client.post(
        "/api/projects",
        json={"name": "factory", "description": "defects"},
    )
    assert created.status_code == 201
    project_id = created.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}",
        json={"name": "factory-renamed", "description": "updated"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "factory-renamed"
    assert body["description"] == "updated"


def test_project_thumbnail_serves_first_dataset_image(client, tmp_path):
    created_project = client.post(
        "/api/projects",
        json={"name": "factory", "description": "defects"},
    )
    assert created_project.status_code == 201
    project_id = created_project.json()["id"]
    dataset_root = tmp_path / "dataset"
    (dataset_root / "images").mkdir(parents=True)
    (dataset_root / "labels").mkdir()
    (dataset_root / "data.yaml").write_text(yaml.safe_dump({"names": ["scratch"]}), encoding="utf-8")
    Image.new("RGB", (16, 16), color="white").save(dataset_root / "images" / "part.jpg")
    (dataset_root / "labels" / "part.txt").write_text("0 0.5 0.5 0.25 0.25\n", encoding="utf-8")

    created_dataset = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "line-a", "source_path": str(dataset_root)},
    )
    assert created_dataset.status_code == 201

    response = client.get(f"/api/projects/{project_id}/thumbnail")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/")
    assert response.content


def test_classification_project_thumbnail_serves_first_class_image(client, tmp_path):
    created_project = client.post(
        "/api/projects",
        json={"name": "분류 프로젝트", "description": "", "task_type": "classification"},
    )
    assert created_project.status_code == 201
    project_id = created_project.json()["id"]
    dataset_root = tmp_path / "cls"
    for class_name in ("ok", "ng"):
        class_dir = dataset_root / class_name
        class_dir.mkdir(parents=True)
        Image.new("RGB", (16, 16), color="white").save(class_dir / f"{class_name}.jpg")

    created_dataset = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "cls", "source_path": str(dataset_root)},
    )
    assert created_dataset.status_code == 201

    response = client.get(f"/api/projects/{project_id}/thumbnail")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/")
    assert response.content


def test_delete_project_removes_related_records_and_managed_files(client, db):
    project = Project(id="project-delete", name="factory", description="", task_type="detection")
    dataset = Dataset(
        id="dataset-delete",
        project_id=project.id,
        name="line-a",
        source_path=str(settings.artifact_root / "projects" / project.id / "datasets" / "dataset-delete"),
        format="yolo",
        class_names=["scratch"],
        image_count=1,
        label_count=1,
        validation_status="valid",
        validation_summary={},
    )
    split = DatasetSplit(
        id="split-delete",
        dataset_id=dataset.id,
        name="default",
        train_ratio=0.8,
        val_ratio=0.2,
        seed=42,
        train_count=1,
        val_count=1,
        split_path="/tmp/split",
        dataset_yaml_path="/tmp/data.yaml",
    )
    training_run = TrainingRun(
        id="training-delete",
        project_id=project.id,
        dataset_id=dataset.id,
        split_id=split.id,
        name="train",
        model_name="yolov8n",
        trainer="ultralytics",
        status="completed",
        config={},
        metrics_summary={},
        artifact_path=None,
        log_path=None,
    )
    artifact = ModelArtifact(
        id="artifact-delete",
        training_run_id=training_run.id,
        kind="best",
        path="/tmp/best.pt",
        metrics_snapshot={},
    )
    inference_run = InferenceRun(
        id="inference-delete",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="infer",
        input_type="folder",
        input_path="/tmp/images",
        status="completed",
        config={},
        output_path="/tmp/output",
        prediction_count=1,
    )
    prediction = InferencePrediction(
        id="prediction-delete",
        inference_run_id=inference_run.id,
        image_path="/tmp/images/part.jpg",
        output_image_path="/tmp/output/part.jpg",
        prediction_json={},
        class_names=["scratch"],
        max_confidence=0.9,
    )
    training_job = Job(id="job-training-delete", type="training", target_id=training_run.id)
    inference_job = Job(id="job-inference-delete", type="inference", target_id=inference_run.id)
    db.add_all([
        project,
        dataset,
        split,
        training_run,
        artifact,
        inference_run,
        prediction,
        training_job,
        inference_job,
    ])
    db.commit()
    project_id = project.id
    dataset_id = dataset.id
    split_id = split.id
    training_run_id = training_run.id
    artifact_id = artifact.id
    inference_run_id = inference_run.id
    prediction_id = prediction.id
    project_dir = StoragePaths(settings.artifact_root).project_dir(project_id)
    marker = project_dir / "datasets" / dataset_id / "marker.txt"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("managed", encoding="utf-8")

    response = client.delete(f"/api/projects/{project_id}")

    assert response.status_code == 204
    db.expire_all()
    assert db.get(Project, project_id) is None
    assert db.get(Dataset, dataset_id) is None
    assert db.get(DatasetSplit, split_id) is None
    assert db.get(TrainingRun, training_run_id) is None
    assert db.get(ModelArtifact, artifact_id) is None
    assert db.get(InferenceRun, inference_run_id) is None
    assert db.get(InferencePrediction, prediction_id) is None
    assert db.scalar(select(Job).where(Job.target_id.in_([training_run_id, inference_run_id]))) is None
    assert not project_dir.exists()


def test_create_project_storage_failure_does_not_persist_project(monkeypatch):
    def fail_project_dir(self, project_id):
        raise OSError("storage unavailable")

    monkeypatch.setattr(StoragePaths, "project_dir", fail_project_dir)
    non_raising_client = TestClient(app, raise_server_exceptions=False)

    response = non_raising_client.post(
        "/api/projects",
        json={"name": "factory", "description": "defects"},
    )

    assert response.status_code == 500
    listed = non_raising_client.get("/api/projects")
    assert listed.status_code == 200
    assert listed.json() == []


def test_create_classification_project(client):
    response = client.post(
        "/api/projects",
        json={
            "name": "분류 프로젝트",
            "description": "class folders",
            "task_type": "classification",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "분류 프로젝트"
    assert body["task_type"] == "classification"


def test_create_project_rejects_unknown_task_type(client):
    response = client.post(
        "/api/projects",
        json={
            "name": "bad",
            "description": "",
            "task_type": "tracking",
        },
    )

    assert response.status_code == 422


def test_update_project_task_type(client):
    created = client.post(
        "/api/projects",
        json={"name": "task 변경", "description": "", "task_type": "detection"},
    )
    project_id = created.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}",
        json={"task_type": "classification"},
    )

    assert response.status_code == 200
    assert response.json()["task_type"] == "classification"


def test_update_project_task_type_rejects_project_with_dataset(client, tmp_path):
    created = client.post(
        "/api/projects",
        json={"name": "task 보호", "description": "", "task_type": "detection"},
    )
    assert created.status_code == 201
    project_id = created.json()["id"]
    dataset_root = tmp_path / "dataset"
    (dataset_root / "images").mkdir(parents=True)
    (dataset_root / "labels").mkdir()
    (dataset_root / "data.yaml").write_text(yaml.safe_dump({"names": ["scratch"]}), encoding="utf-8")
    Image.new("RGB", (16, 16), color="white").save(dataset_root / "images" / "part.jpg")
    (dataset_root / "labels" / "part.txt").write_text("0 0.5 0.5 0.25 0.25\n", encoding="utf-8")
    created_dataset = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "line-a", "source_path": str(dataset_root)},
    )
    assert created_dataset.status_code == 201

    response = client.patch(
        f"/api/projects/{project_id}",
        json={"task_type": "classification"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "리소스가 있는 프로젝트의 작업 유형은 변경할 수 없습니다."
