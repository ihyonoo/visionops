import re
from pathlib import Path

import yaml
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import SessionLocal
from app.models import Dataset, DatasetSplit, Project, TrainingRun


def _split_rows() -> list[DatasetSplit]:
    with SessionLocal() as db:
        return list(db.scalars(select(DatasetSplit)))


def _split_dirs(project_id: str, dataset_id: str) -> list[Path]:
    split_parent = (
        settings.artifact_root / "projects" / project_id / "datasets" / dataset_id / "splits"
    )
    if not split_parent.exists():
        return []
    return [path for path in split_parent.iterdir() if path.is_dir()]


def _make_dataset(root: Path, image_count: int = 4) -> Path:
    (root / "images").mkdir(parents=True)
    (root / "labels").mkdir()
    (root / "data.yaml").write_text(yaml.safe_dump({"names": ["scratch"]}), encoding="utf-8")
    for index in range(image_count):
        Image.new("RGB", (16, 16), color="white").save(root / "images" / f"img{index}.jpg")
        (root / "labels" / f"img{index}.txt").write_text(
            "0 0.5 0.5 0.25 0.25\n", encoding="utf-8"
        )
    return root


def _create_project(client, name: str = "factory") -> str:
    response = client.post("/api/projects", json={"name": name, "description": ""})
    assert response.status_code == 201
    return response.json()["id"]


def _create_dataset(client, project_id: str, dataset_path: Path) -> str:
    response = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "line-a", "source_path": str(dataset_path)},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_create_and_list_splits(client, tmp_path):
    project_id = _create_project(client)
    dataset_id = _create_dataset(
        client, project_id, _make_dataset(tmp_path / "dataset", image_count=10)
    )

    response = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={
            "name": "split-80-10-10",
            "train_ratio": 0.8,
            "val_ratio": 0.1,
            "test_ratio": 0.1,
            "seed": 42,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert re.fullmatch(r"spl_[2-9a-z]{10}", body["id"])
    assert body["dataset_id"] == dataset_id
    assert body["name"] == "split-80-10-10"
    assert body["train_ratio"] == 0.8
    assert body["val_ratio"] == 0.1
    assert body["test_ratio"] == 0.1
    assert body["train_count"] == 8
    assert body["val_count"] == 1
    assert body["test_count"] == 1
    assert Path(body["split_path"]).exists()
    assert Path(body["dataset_yaml_path"]).exists()
    data_yaml = yaml.safe_load(Path(body["dataset_yaml_path"]).read_text(encoding="utf-8"))
    assert data_yaml["test"] == "images/test"
    assert (Path(body["split_path"]) / "images" / "test").exists()

    list_response = client.get(f"/api/projects/{project_id}/datasets/{dataset_id}/splits")

    assert list_response.status_code == 200
    splits = list_response.json()
    assert len(splits) == 1
    assert splits[0]["id"] == body["id"]
    assert splits[0]["test_count"] == 1


def test_create_classification_split_uses_class_folder_layout(client, tmp_path):
    with SessionLocal() as db:
        project = Project(
            id="project-cls",
            name="분류",
            slug="classification",
            description="",
            task_type="classification",
        )
        db.add(project)
        dataset_root = tmp_path / "cls"
        for class_name in ("ok", "ng"):
            class_dir = dataset_root / class_name
            class_dir.mkdir(parents=True)
            for index in range(2):
                Image.new("RGB", (16, 16), color="white").save(class_dir / f"{index}.jpg")
        dataset = Dataset(
            id="dataset-cls",
            project_id=project.id,
            name="cls",
            source_path=str(dataset_root),
            format="yolo-classification",
            class_names=["ng", "ok"],
            image_count=4,
            label_count=0,
            validation_status="valid",
            validation_summary={},
        )
        db.add(dataset)
        db.commit()

    response = client.post(
        "/api/projects/project-cls/datasets/dataset-cls/splits",
        json={
            "name": "split",
            "train_ratio": 0.5,
            "val_ratio": 0.5,
            "test_ratio": 0,
            "seed": 3,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["train_count"] == 2
    assert body["val_count"] == 2
    assert Path(body["dataset_yaml_path"]).is_dir()
    assert (Path(body["split_path"]) / "train" / "ok").is_dir()


def test_update_split_name(client, tmp_path):
    project_id = _create_project(client)
    dataset_id = _create_dataset(client, project_id, _make_dataset(tmp_path / "dataset"))
    created = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={"name": "split-80-20", "train_ratio": 0.75, "val_ratio": 0.25, "seed": 42},
    )
    assert created.status_code == 201
    split_id = created.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits/{split_id}",
        json={"name": "split-renamed"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == split_id
    assert body["name"] == "split-renamed"
    assert body["train_count"] == 3


def test_delete_split_removes_record_and_artifact_directory(client, tmp_path):
    project_id = _create_project(client)
    dataset_id = _create_dataset(client, project_id, _make_dataset(tmp_path / "dataset"))
    created = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={"name": "split-80-20", "train_ratio": 0.75, "val_ratio": 0.25, "seed": 42},
    )
    assert created.status_code == 201
    split_id = created.json()["id"]
    split_path = Path(created.json()["split_path"])
    assert split_path.exists()

    response = client.delete(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits/{split_id}",
    )

    assert response.status_code == 204
    assert _split_rows() == []
    assert not split_path.exists()


def test_delete_split_rejects_split_used_by_training_run(client, tmp_path):
    project_id = _create_project(client)
    dataset_id = _create_dataset(client, project_id, _make_dataset(tmp_path / "dataset"))
    created = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={"name": "split-80-20", "train_ratio": 0.75, "val_ratio": 0.25, "seed": 42},
    )
    assert created.status_code == 201
    split_id = created.json()["id"]
    with SessionLocal() as db:
        db.add(
            TrainingRun(
                id="training-uses-split",
                project_id=project_id,
                dataset_id=dataset_id,
                split_id=split_id,
                name="train",
                model_name="yolov8n",
                trainer="ultralytics",
                status="queued",
                config={},
                metrics_summary={},
            )
        )
        db.commit()

    response = client.delete(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits/{split_id}",
    )

    assert response.status_code == 400
    assert [split.id for split in _split_rows()] == [split_id]


def test_create_split_rejects_invalid_ratio(client, tmp_path):
    project_id = _create_project(client)
    dataset_id = _create_dataset(client, project_id, _make_dataset(tmp_path / "dataset"))

    response = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={
            "name": "bad-split",
            "train_ratio": 0.8,
            "val_ratio": 0.2,
            "test_ratio": 0.2,
            "seed": 42,
        },
    )

    assert response.status_code == 400


def test_create_split_rejects_out_of_range_ratio_with_400(client, tmp_path):
    project_id = _create_project(client)
    dataset_id = _create_dataset(client, project_id, _make_dataset(tmp_path / "dataset"))

    response = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={
            "name": "bad-split",
            "train_ratio": -0.1,
            "val_ratio": 0.6,
            "test_ratio": 0.5,
            "seed": 42,
        },
    )

    assert response.status_code == 400


def test_create_split_cleans_artifacts_when_generation_fails(client, tmp_path, monkeypatch):
    from app.api.routes import splits as splits_route

    project_id = _create_project(client)
    dataset_id = _create_dataset(client, project_id, _make_dataset(tmp_path / "dataset"))

    def fail_create_copy_split(*, split_root: Path, **kwargs):
        (split_root / "partial.txt").write_text("partial artifact", encoding="utf-8")
        raise ValueError("원본 이미지 파일을 읽을 수 없습니다.")

    monkeypatch.setattr(splits_route, "create_copy_split", fail_create_copy_split)

    response = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={"name": "bad-source", "train_ratio": 0.75, "val_ratio": 0.25, "seed": 42},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "원본 이미지 파일을 읽을 수 없습니다."
    assert _split_rows() == []
    assert _split_dirs(project_id, dataset_id) == []


def test_create_split_rolls_back_and_cleans_artifacts_when_commit_fails(
    client, tmp_path, monkeypatch
):
    project_id = _create_project(client)
    dataset_id = _create_dataset(client, project_id, _make_dataset(tmp_path / "dataset"))
    original_commit = Session.commit

    def fail_split_commit(self):
        if any(isinstance(instance, DatasetSplit) for instance in self.new):
            raise RuntimeError("commit failed")
        return original_commit(self)

    monkeypatch.setattr(Session, "commit", fail_split_commit)

    response = client.post(
        f"/api/projects/{project_id}/datasets/{dataset_id}/splits",
        json={"name": "commit-fail", "train_ratio": 0.75, "val_ratio": 0.25, "seed": 42},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "split 저장에 실패했습니다."
    assert _split_rows() == []
    assert _split_dirs(project_id, dataset_id) == []
