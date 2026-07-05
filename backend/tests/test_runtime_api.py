import pytest

from app.services import runtime as runtime_service


@pytest.fixture(autouse=True)
def isolated_runtime_root(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime_service, "RUNTIME_ROOT", tmp_path / "runtime")


def test_runtime_check_uses_managed_runtime_when_venv_exists(client, tmp_path, monkeypatch):
    runtime_root = tmp_path / "runtime"
    runtime_python = runtime_root / "venv" / "bin" / "python"
    runtime_yolo = runtime_root / "venv" / "bin" / "yolo"
    runtime_python.parent.mkdir(parents=True)
    runtime_python.write_text("#!/bin/sh\n", encoding="utf-8")
    runtime_yolo.write_text("#!/bin/sh\n", encoding="utf-8")
    runtime_python.chmod(0o755)
    runtime_yolo.chmod(0o755)

    def current_env_missing(package: str) -> str:
        raise runtime_service.PackageNotFoundError(package)

    class CompletedProcess:
        returncode = 0
        stdout = '{"torch": "2.12.1", "torchvision": "0.27.1", "ultralytics": "8.4.87"}'

    monkeypatch.setattr(runtime_service, "RUNTIME_ROOT", runtime_root)
    monkeypatch.setattr(runtime_service.importlib_metadata, "version", current_env_missing)
    monkeypatch.setattr(runtime_service.subprocess, "run", lambda *args, **kwargs: CompletedProcess())
    monkeypatch.setattr(runtime_service.shutil, "which", lambda executable: None)
    monkeypatch.setattr(runtime_service, "_detect_accelerators", lambda: [])

    response = client.get("/api/runtime/check")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["python"]["executable"] == str(runtime_python)
    assert body["packages"]["torch"] == {"installed": True, "version": "2.12.1"}
    assert body["packages"]["ultralytics"] == {"installed": True, "version": "8.4.87"}
    assert body["yolo_cli"] == {"installed": True, "path": str(runtime_yolo)}


def test_runtime_check_reports_packages_devices_and_install_plan(client, monkeypatch):
    versions = {
        "torch": "2.5.0",
        "torchvision": "0.20.0",
    }

    def fake_version(package: str) -> str:
        if package not in versions:
            raise runtime_service.PackageNotFoundError(package)
        return versions[package]

    monkeypatch.setattr(runtime_service.importlib_metadata, "version", fake_version)
    monkeypatch.setattr(runtime_service.shutil, "which", lambda executable: None)
    monkeypatch.setattr(runtime_service, "_detect_accelerators", lambda: [])

    response = client.get("/api/runtime/check")

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["install_required"] is True
    assert body["packages"]["torch"]["installed"] is True
    assert body["packages"]["ultralytics"]["installed"] is False
    assert body["yolo_cli"]["installed"] is False
    assert body["devices"] == [
        {
            "id": "cpu",
            "label": "CPU",
            "kind": "cpu",
            "available": True,
            "details": {},
        }
    ]
    assert [option["profile"] for option in body["install_options"]] == ["cpu"]
    assert "ultralytics" in " ".join(body["install_options"][0]["commands"])


def test_runtime_check_offers_cuda_install_only_when_cuda_device_exists(client, monkeypatch):
    def missing_package(package: str) -> str:
        raise runtime_service.PackageNotFoundError(package)

    monkeypatch.setattr(runtime_service.importlib_metadata, "version", missing_package)
    monkeypatch.setattr(runtime_service.shutil, "which", lambda executable: None)
    monkeypatch.setattr(
        runtime_service,
        "_detect_accelerators",
        lambda: [
            runtime_service.RuntimeDevice(
                id="0",
                label="CUDA GPU 0 - RTX",
                kind="cuda",
                available=True,
                details={"total_memory_gb": 12},
            )
        ],
    )

    response = client.get("/api/runtime/check")

    assert response.status_code == 200
    body = response.json()
    assert [option["profile"] for option in body["install_options"]] == ["cpu", "cuda"]


def test_runtime_install_plan_uses_windows_venv_scripts_path(monkeypatch):
    monkeypatch.setattr(runtime_service.sys, "platform", "win32")

    option = runtime_service._install_options([])[0]

    assert "Scripts" in option.commands[1]
    assert "python.exe" in option.commands[1]
    assert "bin/python" not in option.commands[1]


def test_runtime_install_invokes_managed_installer(client, monkeypatch):
    called = {}

    def fake_install(profile: str) -> dict:
        called["profile"] = profile
        return {
            "profile": profile,
            "status": "completed",
            "commands": ["python -m venv ~/.visionops/runtime/venv"],
            "log_path": "/tmp/install.log",
            "message": "설치가 완료되었습니다.",
        }

    monkeypatch.setattr(runtime_service, "install_runtime", fake_install)

    response = client.post("/api/runtime/install", json={"profile": "cpu"})

    assert response.status_code == 200
    assert called == {"profile": "cpu"}
    assert response.json()["status"] == "completed"
