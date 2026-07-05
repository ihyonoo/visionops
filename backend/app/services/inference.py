from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
import json
from pathlib import Path
import subprocess
from typing import Any

from app.services.runtime import runtime_yolo_executable


@dataclass(frozen=True)
class InferenceResult:
    exit_code: int
    output_dir: Path
    stdout_log_path: Path


@dataclass(frozen=True)
class ClassificationPredictionResult:
    exit_code: int
    output_dir: Path
    stdout_log_path: Path
    predictions: list[dict[str, Any]]


def build_yolo_predict_command(
    *,
    task_type: str = "detection",
    model_path: Path,
    input_path: Path,
    output_dir: Path,
    config: dict[str, Any] | None = None,
    yolo_executable: str = "yolo",
) -> list[str]:
    values = {"conf": 0.25, "imgsz": 640}
    values.update(config or {})
    task_command = "classify" if task_type == "classification" else "detect"
    command = [
        yolo_executable,
        task_command,
        "predict",
        f"model={model_path}",
        f"source={input_path}",
        f"conf={values['conf']}",
        f"imgsz={values['imgsz']}",
        f"project={output_dir.parent}",
        f"name={output_dir.name}",
    ]
    if task_type != "classification":
        command.extend(
            [
                "save=True",
                "save_txt=True",
                "save_conf=True",
            ]
        )
    command.append("exist_ok=True")
    return command


def classification_prediction_payload(
    *,
    image_path: Path,
    names: dict[int, str],
    indices: list[int],
    confidences: list[float],
) -> dict[str, Any]:
    ranking = []
    for index, confidence in zip(indices, confidences, strict=False):
        ranking.append(
            {
                "class_id": index,
                "class_name": names.get(index, str(index)),
                "confidence": confidence,
            }
        )
    return {
        "image_path": str(image_path),
        "ranking": ranking,
    }


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _source_images(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path] if input_path.suffix.lower() in IMAGE_EXTENSIONS else []
    if not input_path.is_dir():
        return []
    return sorted(
        path
        for path in input_path.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def _confidence_value(data: Any, index: int) -> float:
    value = data[index]
    if hasattr(value, "item"):
        return float(value.item())
    return float(value)


def run_yolo_classification_inference(
    *,
    model_path: Path,
    input_path: Path,
    output_dir: Path,
    config: dict[str, Any] | None = None,
) -> ClassificationPredictionResult:
    from ultralytics import YOLO

    values = {"imgsz": 640}
    values.update(config or {})
    log_dir = output_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_log_path = log_dir / "stdout.log"
    predictions: list[dict[str, Any]] = []

    with stdout_log_path.open("w", encoding="utf-8") as log_file:
        with redirect_stdout(log_file), redirect_stderr(log_file):
            model = YOLO(str(model_path))
            names = {
                int(key): value
                for key, value in getattr(model, "names", {}).items()
            }
            for image_path in _source_images(input_path):
                results = model.predict(str(image_path), imgsz=values["imgsz"], verbose=True)
                probs = results[0].probs if results and getattr(results[0], "probs", None) else None
                if probs is None:
                    predictions.append(
                        classification_prediction_payload(
                            image_path=image_path,
                            names=names,
                            indices=[],
                            confidences=[],
                        )
                    )
                    continue

                indices = [int(index) for index in probs.top5]
                confidences = [_confidence_value(probs.data, index) for index in indices]
                predictions.append(
                    classification_prediction_payload(
                        image_path=image_path,
                        names=names,
                        indices=indices,
                        confidences=confidences,
                    )
                )

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "predictions.json").write_text(
        json.dumps(
            {
                "prediction_count": len(predictions),
                "predictions": predictions,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return ClassificationPredictionResult(
        exit_code=0,
        output_dir=output_dir,
        stdout_log_path=stdout_log_path,
        predictions=predictions,
    )


def run_yolo_inference(
    *,
    task_type: str = "detection",
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
        task_type=task_type,
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
