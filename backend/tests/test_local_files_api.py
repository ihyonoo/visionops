import subprocess

from app.core.config import settings


def test_open_local_path_opens_managed_directory(client, monkeypatch):
    managed_dir = settings.artifact_root / "projects" / "project-1" / "datasets" / "dataset-1"
    managed_dir.mkdir(parents=True)
    opened_commands: list[list[str]] = []

    def fake_popen(command):
        opened_commands.append(command)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    response = client.post("/api/local-files/open", json={"path": str(managed_dir)})

    assert response.status_code == 200
    assert response.json()["opened_path"] == str(managed_dir.resolve())
    assert opened_commands
    assert opened_commands[0][-1] == str(managed_dir.resolve())


def test_open_local_path_opens_parent_for_managed_file(client, monkeypatch):
    log_path = (
        settings.artifact_root
        / "projects"
        / "project-1"
        / "runs"
        / "train"
        / "run-1"
        / "logs"
        / "stdout.log"
    )
    log_path.parent.mkdir(parents=True)
    log_path.write_text("done\n", encoding="utf-8")
    opened_commands: list[list[str]] = []

    def fake_popen(command):
        opened_commands.append(command)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    response = client.post("/api/local-files/open", json={"path": str(log_path)})

    assert response.status_code == 200
    assert response.json()["opened_path"] == str(log_path.parent.resolve())
    assert opened_commands[0][-1] == str(log_path.parent.resolve())


def test_open_local_path_rejects_paths_outside_managed_storage(client, tmp_path, monkeypatch):
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    opened_commands: list[list[str]] = []

    def fake_popen(command):
        opened_commands.append(command)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    response = client.post("/api/local-files/open", json={"path": str(outside_dir)})

    assert response.status_code == 403
    assert opened_commands == []
