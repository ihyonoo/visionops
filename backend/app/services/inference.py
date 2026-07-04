from dataclasses import dataclass
from pathlib import Path
import subprocess
from typing import Any

from app.services.runtime import runtime_yolo_executable


@dataclass(frozen=True)
class InferenceResult:
    exit_code: int
    output_dir: Path
    stdout_log_path: Path


def build_yolo_predict_command(
    *,
    model_path: Path,
    input_path: Path,
    output_dir: Path,
    config: dict[str, Any] | None = None,
    yolo_executable: str = "yolo",
) -> list[str]:
    values = {"conf": 0.25, "imgsz": 640}
    values.update(config or {})
    return [
        yolo_executable,
        "detect",
        "predict",
        f"model={model_path}",
        f"source={input_path}",
        f"conf={values['conf']}",
        f"imgsz={values['imgsz']}",
        f"project={output_dir.parent}",
        f"name={output_dir.name}",
        "save=True",
        "save_txt=True",
        "save_conf=True",
        "exist_ok=True",
    ]


def run_yolo_inference(
    *,
    model_path: Path,
    input_path: Path,
    output_dir: Path,
    config: dict[str, Any] | None = None,
    yolo_executable: str | None = None,
) -> InferenceResult:
    log_dir = output_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_log_path = log_dir / "stdout.log"
    command = build_yolo_predict_command(
        yolo_executable=yolo_executable or runtime_yolo_executable(),
        model_path=model_path,
        input_path=input_path,
        output_dir=output_dir,
        config=config,
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

    return InferenceResult(
        exit_code=exit_code,
        output_dir=output_dir,
        stdout_log_path=stdout_log_path,
    )
