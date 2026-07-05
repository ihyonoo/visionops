import re
from pathlib import Path

from sqlalchemy import select
import yaml
from PIL import Image

from app.core.config import settings
from app.db import SessionLocal
from app.models import Dataset, DatasetSplit, InferencePrediction, InferenceRun, Job, ModelArtifact, TrainingRun
from app.services.storage import StoragePaths


def make_dataset(root: Path) -> Path:
    (root / "images").mkdir(parents=True)
    (root / "labels").mkdir()
    (root / "data.yaml").write_text(yaml.safe_dump({"names": ["scratch"]}), encoding="utf-8")
    Image.new("RGB", (16, 16), color="white").save(root / "images" / "part.jpg")
    (root / "labels" / "part.txt").write_text("0 0.5 0.5 0.25 0.25\n", encoding="utf-8")
    return root


def create_project(client, name: str = "factory") -> str:
    response = client.post("/api/projects", json={"name": name, "description": ""})
    assert response.status_code == 201
    return response.json()["id"]


def test_register_valid_dataset(client, tmp_path):
    project_id = create_project(client)
    dataset_path = make_dataset(tmp_path / "dataset")

    response = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "line-a", "source_path": str(dataset_path)},
    )

    assert response.status_code == 201
    body = response.json()
    assert re.fullmatch(r"ds_[2-9a-z]{10}", body["id"])
    assert body["project_id"] == project_id
    assert body["name"] == "line-a"
    assert body["validation_status"] == "unknown"
    assert body["validation_summary"] == {}
    assert body["class_names"] == ["scratch"]
    assert body["image_count"] == 1
    assert body["label_count"] == 1


def test_upload_dataset_from_image_label_folders_and_yaml(client):
    project_id = create_project(client)

    response = client.post(
        f"/api/projects/{project_id}/datasets/upload",
        data={"name": "line-a-upload"},
        files=[
            (
                "images",
                ("images/nested/part.jpg", _image_bytes(), "image/jpeg"),
            ),
            (
                "labels",
                (
                    "labels/nested/part.txt",
                    b"0 0.5 0.5 0.25 0.25\n",
                    "text/plain",
                ),
            ),
            ("data_yaml", ("data.yaml", yaml.safe_dump({"names": ["scratch"]}), "text/yaml")),
        ],
    )

    assert response.status_code == 201
    body = response.json()
    assert re.fullmatch(r"ds_[2-9a-z]{10}", body["id"])
    assert body["name"] == "line-a-upload"
    assert body["validation_status"] == "unknown"
    assert body["validation_summary"] == {}
    assert body["class_names"] == ["scratch"]
    assert body["image_count"] == 1
    assert body["label_count"] == 1
    dataset_root = Path(body["source_path"])
    assert (dataset_root / "images" / "nested" / "part.jpg").is_file()
    assert (dataset_root / "labels" / "nested" / "part.txt").is_file()
    assert (dataset_root / "data.yaml").is_file()


def test_dataset_thumbnail_serves_first_dataset_image(client, tmp_path):
    project_id = create_project(client)
    dataset_path = make_dataset(tmp_path / "dataset")
    created = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "line-a", "source_path": str(dataset_path)},
    )
    assert created.status_code == 201
    dataset_id = created.json()["id"]

    response = client.get(f"/api/projects/{project_id}/datasets/{dataset_id}/thumbnail")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/")
    assert response.content


def test_register_dataset_requires_existing_project(client, tmp_path):
    dataset_path = make_dataset(tmp_path / "dataset")

    response = client.post(
        "/api/projects/missing/datasets",
        json={"name": "line-a", "source_path": str(dataset_path)},
    )

    assert response.status_code == 404


def test_list_and_get_datasets_are_scoped_to_project(client, tmp_path):
    first_project_id = create_project(client, "first")
    second_project_id = create_project(client, "second")
    dataset_path = make_dataset(tmp_path / "dataset")
    created = client.post(
        f"/api/projects/{first_project_id}/datasets",
        json={"name": "line-a", "source_path": str(dataset_path)},
    )
    assert created.status_code == 201
    dataset_id = created.json()["id"]

    first_list = client.get(f"/api/projects/{first_project_id}/datasets")
    second_list = client.get(f"/api/projects/{second_project_id}/datasets")
    scoped_get = client.get(f"/api/projects/{second_project_id}/datasets/{dataset_id}")

    assert first_list.status_code == 200
    assert [dataset["id"] for dataset in first_list.json()] == [dataset_id]
    assert second_list.status_code == 200
    assert second_list.json() == []
    assert scoped_get.status_code == 404


def test_invalid_dataset_registration_is_saved_without_validation_block(client, tmp_path):
    project_id = create_project(client)
    invalid_path = tmp_path / "invalid"
    invalid_path.mkdir()

    response = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "broken", "source_path": str(invalid_path)},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "broken"
    assert body["source_path"] == str(invalid_path)
    assert body["validation_status"] == "unknown"
    assert body["validation_summary"] == {}
    assert body["class_names"] == []
    assert body["image_count"] == 0
    assert body["label_count"] == 0


def test_dataset_create_rejects_blank_fields(client):
    project_id = create_project(client)

    response = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": " ", "source_path": ""},
    )

    assert response.status_code == 422


def test_update_dataset_name(client, tmp_path):
    project_id = create_project(client)
    dataset_path = make_dataset(tmp_path / "dataset")
    created = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "line-a", "source_path": str(dataset_path)},
    )
    assert created.status_code == 201
    dataset_id = created.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}/datasets/{dataset_id}",
        json={"name": "line-a-renamed"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == dataset_id
    assert body["name"] == "line-a-renamed"
    assert body["source_path"] == str(dataset_path)


def test_delete_dataset_removes_related_records_and_managed_files(client):
    project_id = create_project(client)
    project_root = StoragePaths(settings.artifact_root).project_dir(project_id)
    dataset_root = project_root / "datasets" / "dataset-delete"
    dataset_root.mkdir(parents=True, exist_ok=True)
    (dataset_root / "marker.txt").write_text("managed", encoding="utf-8")
    train_run_dir = project_root / "runs" / "train" / "training-delete"
    train_run_dir.mkdir(parents=True, exist_ok=True)
    (train_run_dir / "marker.txt").write_text("train", encoding="utf-8")
    inference_run_dir = project_root / "runs" / "inference" / "inference-delete"
    inference_run_dir.mkdir(parents=True, exist_ok=True)
    (inference_run_dir / "marker.txt").write_text("infer", encoding="utf-8")
    inference_input_dir = project_root / "runs" / "inference_inputs" / "inference-delete"
    inference_input_dir.mkdir(parents=True, exist_ok=True)
    (inference_input_dir / "marker.txt").write_text("input", encoding="utf-8")

    with SessionLocal() as db:
        dataset = Dataset(
            id="dataset-delete",
            project_id=project_id,
            name="line-a",
            source_path=str(dataset_root),
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
            split_path=str(dataset_root / "splits" / "split-delete"),
            dataset_yaml_path=str(dataset_root / "splits" / "split-delete" / "data.yaml"),
        )
        training_run = TrainingRun(
            id="training-delete",
            project_id=project_id,
            dataset_id=dataset.id,
            split_id=split.id,
            name="train",
            model_name="yolov8n",
            trainer="ultralytics",
            status="completed",
            config={},
            metrics_summary={},
            artifact_path=str(train_run_dir),
            log_path=None,
        )
        artifact = ModelArtifact(
            id="artifact-delete",
            training_run_id=training_run.id,
            kind="best",
            path=str(train_run_dir / "weights" / "best.pt"),
            metrics_snapshot={},
        )
        inference_run = InferenceRun(
            id="inference-delete",
            project_id=project_id,
            model_artifact_id=artifact.id,
            name="infer",
            input_type="folder",
            input_path=str(inference_input_dir),
            status="completed",
            config={},
            output_path=str(inference_run_dir),
            prediction_count=1,
        )
        prediction = InferencePrediction(
            id="prediction-delete",
            inference_run_id=inference_run.id,
            image_path=str(inference_input_dir / "part.jpg"),
            output_image_path=str(inference_run_dir / "part.jpg"),
            prediction_json={},
            class_names=["scratch"],
            max_confidence=0.9,
        )
        training_job = Job(id="job-training-delete", type="training", target_id=training_run.id)
        inference_job = Job(id="job-inference-delete", type="inference", target_id=inference_run.id)
        db.add_all([
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

    response = client.delete(f"/api/projects/{project_id}/datasets/dataset-delete")

    assert response.status_code == 204
    with SessionLocal() as db:
        assert db.get(Dataset, "dataset-delete") is None
        assert db.get(DatasetSplit, "split-delete") is None
        assert db.get(TrainingRun, "training-delete") is None
        assert db.get(ModelArtifact, "artifact-delete") is None
        assert db.get(InferenceRun, "inference-delete") is None
        assert db.get(InferencePrediction, "prediction-delete") is None
        assert db.scalar(select(Job).where(Job.target_id.in_(["training-delete", "inference-delete"]))) is None
    assert not dataset_root.exists()
    assert not train_run_dir.exists()
    assert not inference_run_dir.exists()
    assert not inference_input_dir.exists()


def _image_bytes() -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    Image.new("RGB", (16, 16), color="white").save(buffer, format="JPEG")
    return buffer.getvalue()
