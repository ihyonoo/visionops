from dataclasses import dataclass
from pathlib import Path
import subprocess


@dataclass(frozen=True)
class TrainingResult:
    exit_code: int
    run_dir: Path
    stdout_log_path: Path
    results_csv_path: Path


def _model_weight_name(model_name: str) -> str:
    return model_name if model_name.endswith(".pt") else f"{model_name}.pt"


def build_yolo_train_command(
    *,
    model_name: str,
    data_yaml_path: Path,
    epochs: int,
    imgsz: int,
    batch: int,
    learning_rate: float,
    patience: int,
    device: str,
    run_parent: Path,
    run_name: str,
) -> list[str]:
    return [
        "yolo",
        "detect",
        "train",
        f"model={_model_weight_name(model_name)}",
        f"data={data_yaml_path}",
        f"epochs={epochs}",
        f"imgsz={imgsz}",
        f"batch={batch}",
        f"lr0={learning_rate}",
        f"patience={patience}",
        f"device={device}",
        f"project={run_parent}",
        f"name={run_name}",
        "exist_ok=True",
    ]


def run_yolo_training(
    *,
    model_name: str,
    data_yaml_path: Path,
    epochs: int,
    imgsz: int,
    batch: int,
    learning_rate: float,
    patience: int,
    device: str,
    run_parent: Path,
    run_name: str,
) -> TrainingResult:
    run_dir = run_parent / run_name
    log_dir = run_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_log_path = log_dir / "stdout.log"
    command = build_yolo_train_command(
        model_name=model_name,
        data_yaml_path=data_yaml_path,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        learning_rate=learning_rate,
        patience=patience,
        device=device,
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
