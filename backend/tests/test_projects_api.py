from fastapi.testclient import TestClient

from app.main import app
from app.services.storage import StoragePaths


def test_create_list_and_get_project(client):
    created = client.post(
        "/api/projects",
        json={"name": "factory", "description": "defects"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "factory"
    assert body["description"] == "defects"
    assert body["task_type"] == "detection"

    listed = client.get("/api/projects")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == body["id"]

    fetched = client.get(f"/api/projects/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]


def test_missing_project_returns_404(client):
    response = client.get("/api/projects/missing")

    assert response.status_code == 404


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
