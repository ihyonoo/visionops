from dataclasses import dataclass
from collections.abc import Mapping
from pathlib import Path
import subprocess
from typing import Any

@dataclass(frozen=True)
class TrainingResult:
    exit_code: int
    run_dir: Path
    stdout_log_path: Path
    results_csv_path: Path


def _model_weight_name(model_name: str) -> str:
    return model_name if model_name.endswith(".pt") else f"{model_name}.pt"


TRAINING_CLI_KEYS = [
    "epochs",
    "imgsz",
    "batch",
    "learning_rate",
    "patience",
    "device",
    "optimizer",
    "lrf",
    "momentum",
    "weight_decay",
    "warmup_epochs",
    "cos_lr",
    "close_mosaic",
    "cache",
    "workers",
    "seed",
    "deterministic",
    "amp",
    "freeze",
    "dropout",
    "mosaic",
    "mixup",
    "degrees",
    "translate",
    "scale",
    "fliplr",
]

TRAINING_CLI_ARG_NAMES = {
    "learning_rate": "lr0",
}


def _format_cli_value(value: Any) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    return str(value)


def _training_config_args(config: Mapping[str, Any]) -> list[str]:
    args: list[str] = []
    for key in TRAINING_CLI_KEYS:
        if key not in config or config[key] is None:
            continue
        cli_key = TRAINING_CLI_ARG_NAMES.get(key, key)
        args.append(f"{cli_key}={_format_cli_value(config[key])}")
    return args


def build_yolo_train_command(
    *,
    yolo_executable: str = "yolo",
    task_type: str = "detection",
    model_name: str,
    data_path: Path | None = None,
    data_yaml_path: Path | None = None,
    config: Mapping[str, Any],
    run_parent: Path,
    run_name: str,
) -> list[str]:
    run_parent = run_parent.resolve()
    resolved_data_path = data_path or data_yaml_path
    if resolved_data_path is None:
        raise ValueError("data_path is required")
    resolved_data_path = resolved_data_path.resolve()
    task_command = "classify" if task_type == "classification" else "detect"
    return [
        yolo_executable,
        task_command,
        "train",
        f"model={_model_weight_name(model_name)}",
        f"data={resolved_data_path}",
        *_training_config_args(config),
        f"project={run_parent}",
        f"name={run_name}",
        "exist_ok=True",
    ]


def run_yolo_training(
    *,
    task_type: str = "detection",
    model_name: str,
    data_path: Path | None = None,
    data_yaml_path: Path | None = None,
    config: Mapping[str, Any],
    run_parent: Path,
    run_name: str,
    yolo_executable: str | None = None,
) -> TrainingResult:
    from app.services.runtime import runtime_yolo_executable

    run_dir = run_parent / run_name
    log_dir = run_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_log_path = log_dir / "stdout.log"
    command = build_yolo_train_command(
        yolo_executable=yolo_executable or runtime_yolo_executable(),
        task_type=task_type,
        model_name=model_name,
        data_path=data_path,
        data_yaml_path=data_yaml_path,
        config=config,
        run_parent=run_parent,
        run_name=run_name,
    )

    with stdout_log_path.open("w", encoding="utf-8") as log_file:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            log_file.write(line)
            log_file.flush()
        exit_code = process.wait()

    return TrainingResult(
        exit_code=exit_code,
        run_dir=run_dir,
        stdout_log_path=stdout_log_path,
        results_csv_path=run_dir / "results.csv",
    )
