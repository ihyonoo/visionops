from pathlib import Path

import yaml
from PIL import Image


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
    assert body["project_id"] == project_id
    assert body["name"] == "line-a"
    assert body["validation_status"] == "valid"
    assert body["class_names"] == ["scratch"]
    assert body["image_count"] == 1
    assert body["label_count"] == 1


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


def test_invalid_dataset_registration_returns_422(client, tmp_path):
    project_id = create_project(client)
    invalid_path = tmp_path / "invalid"
    invalid_path.mkdir()

    response = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": "broken", "source_path": str(invalid_path)},
    )

    assert response.status_code == 422
    assert "validation_summary" in response.json()["detail"]


def test_dataset_create_rejects_blank_fields(client):
    project_id = create_project(client)

    response = client.post(
        f"/api/projects/{project_id}/datasets",
        json={"name": " ", "source_path": ""},
    )

    assert response.status_code == 422
