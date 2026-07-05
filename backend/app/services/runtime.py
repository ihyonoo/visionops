from __future__ import annotations

import json
import shlex
from dataclasses import asdict, dataclass
from importlib import metadata as importlib_metadata
from importlib.metadata import PackageNotFoundError
from pathlib import Path
import shutil
import subprocess
import sys

from app.services.dataset_validation import validate_yolo_dataset
from app.core.config import settings
from app.services.training import build_yolo_train_command


REQUIRED_PACKAGES = {
    "torch": "PyTorch",
    "torchvision": "TorchVision",
    "ultralytics": "Ultralytics",
}
RUNTIME_ROOT = Path.home() / ".visionops" / "runtime"


@dataclass(frozen=True)
class RuntimePackage:
    installed: bool
    version: str | None


@dataclass(frozen=True)
class RuntimeDevice:
    id: str
    label: str
    kind: str
    available: bool
    details: dict


@dataclass(frozen=True)
class InstallOption:
    profile: str
    label: str
    commands: list[str]


def _package_status(package: str) -> RuntimePackage:
    try:
        version = importlib_metadata.version(package)
    except PackageNotFoundError:
        return RuntimePackage(installed=False, version=None)
    return RuntimePackage(installed=True, version=version)


def _managed_runtime_bin(name: str) -> Path:
    if sys.platform == "win32":
        executable_name = f"{name}.exe" if name == "python" else name
        return RUNTIME_ROOT / "venv" / "Scripts" / executable_name
    return RUNTIME_ROOT / "venv" / "bin" / name


def _runtime_python_path() -> Path:
    runtime_python = _managed_runtime_bin("python")
    if runtime_python.exists():
        return runtime_python
    return Path(sys.executable)


def _runtime_yolo_path() -> str | None:
    runtime_yolo = _managed_runtime_bin("yolo")
    if runtime_yolo.exists():
        return str(runtime_yolo)
    return shutil.which("yolo")


def runtime_yolo_executable() -> str:
    return _runtime_yolo_path() or "yolo"


def _package_versions_from_python(python_path: Path) -> dict[str, str | None]:
    package_names = list(REQUIRED_PACKAGES)
    probe = """
import json
from importlib import metadata

versions = {}
for package in __packages__:
    try:
        versions[package] = metadata.version(package)
    except metadata.PackageNotFoundError:
        versions[package] = None
print(json.dumps(versions))
""".replace("__packages__", repr(package_names))
    try:
        process = subprocess.run(
            [str(python_path), "-c", probe],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except Exception:
        return {package: None for package in REQUIRED_PACKAGES}

    if process.returncode != 0:
        return {package: None for package in REQUIRED_PACKAGES}

    try:
        versions = json.loads(process.stdout)
    except json.JSONDecodeError:
        return {package: None for package in REQUIRED_PACKAGES}

    return {
        package: versions.get(package)
        for package in REQUIRED_PACKAGES
    }


def _runtime_package_statuses(python_path: Path) -> dict[str, RuntimePackage]:
    if python_path == Path(sys.executable):
        return {
            package: _package_status(package)
            for package in REQUIRED_PACKAGES
        }

    versions = _package_versions_from_python(python_path)
    return {
        package: RuntimePackage(installed=version is not None, version=version)
        for package, version in versions.items()
    }


def _detect_accelerators() -> list[RuntimeDevice]:
    try:
        import torch
    except Exception:
        return []

    devices: list[RuntimeDevice] = []
    try:
        if torch.cuda.is_available():
            for index in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(index)
                devices.append(
                    RuntimeDevice(
                        id=str(index),
                        label=f"CUDA GPU {index} - {torch.cuda.get_device_name(index)}",
                        kind="cuda",
                        available=True,
                        details={
                            "total_memory_gb": round(props.total_memory / (1024**3), 2),
                        },
                    )
                )
    except Exception:
        pass

    try:
        if torch.backends.mps.is_available():
            devices.append(
                RuntimeDevice(
                    id="mps",
                    label="Apple Metal GPU",
                    kind="mps",
                    available=True,
                    details={},
                )
            )
    except Exception:
        pass

    return devices


def _command_string(args: list[str]) -> str:
    if sys.platform == "win32":
        return subprocess.list2cmdline(args)
    return shlex.join(args)


def _install_options(devices: list[RuntimeDevice]) -> list[InstallOption]:
    runtime_python = _managed_runtime_bin("python")
    venv_root = RUNTIME_ROOT / "venv"
    options = [
        InstallOption(
            profile="cpu",
            label="CPU runtime",
            commands=[
                _command_string([sys.executable, "-m", "venv", str(venv_root)]),
                _command_string([str(runtime_python), "-m", "pip", "install", "--upgrade", "pip"]),
                _command_string([str(runtime_python), "-m", "pip", "install", "torch", "torchvision", "ultralytics"]),
            ],
        ),
    ]
    if any(device.kind == "cuda" and device.available for device in devices):
        options.append(
            InstallOption(
                profile="cuda",
                label="NVIDIA CUDA runtime",
                commands=[
                    _command_string([sys.executable, "-m", "venv", str(venv_root)]),
                    _command_string([str(runtime_python), "-m", "pip", "install", "--upgrade", "pip"]),
                    _command_string([
                        str(runtime_python),
                        "-m",
                        "pip",
                        "install",
                        "torch",
                        "torchvision",
                        "--index-url",
                        "https://download.pytorch.org/whl/cu121",
                    ]),
                    _command_string([str(runtime_python), "-m", "pip", "install", "ultralytics"]),
                ],
            )
        )
    return options


def check_runtime() -> dict:
    runtime_python = _runtime_python_path()
    packages = {
        package: asdict(status)
        for package, status in _runtime_package_statuses(runtime_python).items()
    }
    yolo_path = _runtime_yolo_path()
    devices = [
        RuntimeDevice(
            id="cpu",
            label="CPU",
            kind="cpu",
            available=True,
            details={},
        ),
        *_detect_accelerators(),
    ]
    packages_ready = all(package["installed"] for package in packages.values())
    ready = packages_ready and yolo_path is not None
    install_options = _install_options(devices)
    return {
        "ready": ready,
        "install_required": not ready,
        "python": {
            "executable": str(runtime_python),
            "version": sys.version.split()[0],
        },
        "packages": packages,
        "yolo_cli": {
            "installed": yolo_path is not None,
            "path": yolo_path,
        },
        "devices": [asdict(device) for device in devices],
        "install_options": [asdict(option) for option in install_options],
    }


def install_runtime(profile: str) -> dict:
    options = {option.profile: option for option in _install_options(_detect_accelerators())}
    option = options.get(profile)
    if option is None:
        raise ValueError("지원하지 않는 런타임 설치 프로필입니다.")

    log_path = RUNTIME_ROOT / "install.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as log_file:
        for command in option.commands:
            log_file.write(f"$ {command}\n")
            log_file.flush()
            process = subprocess.run(
                command,
                shell=True,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
                check=False,
            )
            if process.returncode != 0:
                return {
                    "profile": profile,
                    "status": "failed",
                    "commands": option.commands,
                    "log_path": str(log_path),
                    "message": f"설치 명령이 실패했습니다. 종료 코드: {process.returncode}",
                }

    return {
        "profile": profile,
        "status": "completed",
        "commands": option.commands,
        "log_path": str(log_path),
        "message": "설치가 완료되었습니다.",
    }


def build_training_preflight(
    *,
    dataset,
    split,
    config: dict,
    model_name: str,
    runtime_check: dict,
) -> dict:
    blocking_issues: list[str] = []
    warnings: list[str] = []
    recommendations: list[str] = []

    packages = runtime_check.get("packages", {})
    if not packages.get("torch", {}).get("installed"):
        blocking_issues.append("PyTorch가 설치되어 있지 않습니다.")
    if not packages.get("torchvision", {}).get("installed"):
        blocking_issues.append("TorchVision이 설치되어 있지 않습니다.")
    if not packages.get("ultralytics", {}).get("installed"):
        blocking_issues.append("Ultralytics가 설치되어 있지 않습니다.")
    if not runtime_check.get("yolo_cli", {}).get("installed"):
        blocking_issues.append("YOLO CLI를 찾을 수 없습니다.")

    device_id = str(config.get("device") or "cpu")
    devices = runtime_check.get("devices", [])
    selected_device = next((device for device in devices if device.get("id") == device_id), None)
    if selected_device is None:
        blocking_issues.append(f"선택한 학습 장치를 사용할 수 없습니다: {device_id}")
        selected_device = {
            "id": device_id,
            "label": device_id,
            "kind": "unknown",
            "available": False,
            "details": {},
        }
    elif selected_device.get("kind") == "cpu":
        warnings.append("CPU 학습은 가능하지만 데이터셋과 설정에 따라 매우 느릴 수 있습니다.")

    validation_root = Path(split.dataset_yaml_path).parent if split.dataset_yaml_path else Path(split.split_path)
    try:
        validation = validate_yolo_dataset(validation_root)
    except Exception as exc:
        validation = None
        blocking_issues.append(f"데이터셋 오류: {exc}")

    if validation is not None:
        for error in validation.errors:
            blocking_issues.append(f"데이터셋 오류: {error}")
        for warning in validation.warnings:
            warnings.append(f"데이터셋 경고: {warning}")

    image_count = validation.image_count if validation is not None else int(dataset.image_count or 0)
    if image_count < 20:
        recommendations.append("데이터셋 이미지 수가 적습니다. 먼저 작은 epochs로 빠르게 검증하세요.")

    if split.train_count <= 0 or split.val_count <= 0:
        blocking_issues.append("train/val split에 비어 있는 subset이 있습니다.")

    suggested_config = dict(config)
    if selected_device.get("kind") == "cpu":
        suggested_config["batch"] = min(int(config.get("batch", 16)), 8)
        suggested_config["imgsz"] = min(int(config.get("imgsz", 640)), 640)

    yolo_executable = runtime_check.get("yolo_cli", {}).get("path") or runtime_yolo_executable()
    run_parent = settings.artifact_root / "projects" / dataset.project_id / "runs" / "train"
    command = build_yolo_train_command(
        yolo_executable=str(yolo_executable),
        model_name=model_name,
        data_yaml_path=Path(split.dataset_yaml_path),
        config=config,
        run_parent=run_parent,
        run_name="<new-run-id>",
    )

    return {
        "can_start": not blocking_issues,
        "blocking_issues": blocking_issues,
        "warnings": warnings,
        "recommendations": recommendations,
        "devices": devices,
        "selected_device": selected_device,
        "runtime": runtime_check,
        "suggested_config": suggested_config,
        "command_preview": {
            "kind": "yolo_cli",
            "argv": command,
            "shell": shlex.join(command),
        },
    }
