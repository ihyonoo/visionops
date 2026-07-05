import time
from collections.abc import Callable
from datetime import datetime, timezone
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import SessionLocal
from app.models import (
    Dataset,
    DatasetSplit,
    InferencePrediction,
    InferenceRun,
    Job,
    ModelArtifact,
    Project,
    TrainingRun,
)
from app.services.jobs import COMPLETED, FAILED, claim_next_job, fail_job
from app.services.ids import new_id
from app.services.inference import run_yolo_classification_inference, run_yolo_inference
from app.services.metrics import read_results_csv, summarize_metrics
from app.services.notifications import NotificationEvent, send_work_notification
from app.services.storage import StoragePaths
from app.services.training import run_yolo_training

JobHandler = Callable[[Session, Job], None]
JOB_HANDLERS: dict[str, JobHandler] = {}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
BOX_COLORS = [
    (0, 86, 255),
    (0, 166, 90),
    (255, 133, 27),
    (147, 51, 234),
    (220, 38, 38),
]


def _project_name(db: Session, project_id: str) -> str:
    project = db.get(Project, project_id)
    if project is None:
        return project_id
    return project.name


def _event_text(
    *,
    event_type: str,
    target_type: str,
    project_name: str,
    run_name: str,
    status: str,
) -> str:
    result = "completed" if event_type.endswith("_completed") else "failed"
    return f"{target_type.title()} {run_name} {result} in {project_name} (status: {status})."


def _work_notification_event(
    *,
    event_type: str,
    target_type: str,
    target_id: str,
    project_name: str,
    run_name: str,
    status: str,
    occurred_at: datetime,
    summary: dict,
) -> NotificationEvent:
    event = NotificationEvent(
        event_type=event_type,
        target_type=target_type,
        target_id=target_id,
        text=_event_text(
            event_type=event_type,
            target_type=target_type,
            project_name=project_name,
            run_name=run_name,
            status=status,
        ),
    )
    object.__setattr__(event, "project_name", project_name)
    object.__setattr__(event, "run_name", run_name)
    object.__setattr__(event, "status", status)
    object.__setattr__(event, "occurred_at", occurred_at)
    object.__setattr__(event, "summary", summary)
    return event


def _send_notification_safely(db: Session, event: NotificationEvent) -> None:
    try:
        send_work_notification(db, event)
    except Exception:
        db.rollback()


def notify_training_finished(db: Session, run: TrainingRun, event_type: str) -> None:
    try:
        event = _work_notification_event(
            event_type=event_type,
            target_type="training",
            target_id=run.id,
            project_name=_project_name(db, run.project_id),
            run_name=run.name,
            status=run.status,
            occurred_at=run.finished_at or datetime.now(timezone.utc),
            summary=run.metrics_summary or {},
        )
        _send_notification_safely(db, event)
    except Exception:
        db.rollback()


def notify_inference_finished(db: Session, run: InferenceRun, event_type: str) -> None:
    try:
        event = _work_notification_event(
            event_type=event_type,
            target_type="inference",
            target_id=run.id,
            project_name=_project_name(db, run.project_id),
            run_name=run.name,
            status=run.status,
            occurred_at=run.finished_at or datetime.now(timezone.utc),
            summary={"prediction_count": run.prediction_count},
        )
        _send_notification_safely(db, event)
    except Exception:
        db.rollback()


def _training_config(run: TrainingRun) -> dict:
    defaults = {
        "epochs": 50,
        "batch": 16,
        "imgsz": 640,
        "learning_rate": 0.01,
        "patience": 20,
        "device": "cpu",
        "optimizer": "auto",
        "lrf": 0.01,
        "momentum": 0.937,
        "weight_decay": 0.0005,
        "warmup_epochs": 3.0,
        "cos_lr": False,
        "close_mosaic": 10,
        "cache": False,
        "workers": 8,
        "seed": 0,
        "deterministic": True,
        "amp": True,
        "freeze": 0,
        "dropout": 0.0,
        "mosaic": 1.0,
        "mixup": 0.0,
        "degrees": 0.0,
        "translate": 0.1,
        "scale": 0.5,
        "fliplr": 0.5,
    }
    defaults.update(run.config or {})
    return defaults


def _register_artifact(
    db: Session,
    *,
    run: TrainingRun,
    kind: str,
    path: Path,
    metrics_summary: dict,
) -> None:
    if not path.exists():
        return
    artifact = db.scalar(
        select(ModelArtifact).where(
            ModelArtifact.training_run_id == run.id,
            ModelArtifact.kind == kind,
        )
    )
    if artifact is None:
        artifact = ModelArtifact(
            id=new_id("art"),
            training_run_id=run.id,
            kind=kind,
        )
        db.add(artifact)
    artifact.path = str(path)
    artifact.metrics_snapshot = metrics_summary


def handle_training_job(db: Session, job: Job) -> None:
    run = db.get(TrainingRun, job.target_id)
    if run is None:
        fail_job(db, job, "학습 실행을 찾을 수 없습니다.")
        return

    split = db.get(DatasetSplit, run.split_id)
    if split is None:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = "학습에 사용할 split을 찾을 수 없습니다."
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    dataset = db.get(Dataset, run.dataset_id)
    if dataset is None:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = "학습에 사용할 데이터셋을 찾을 수 없습니다."
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    if split.dataset_id != run.dataset_id or dataset.project_id != run.project_id:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = "학습 실행과 데이터셋 split의 소속이 일치하지 않습니다."
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    project = db.get(Project, run.project_id)
    is_classification_project = project.task_type == "classification" if project else False
    is_classification_dataset = dataset.format == "yolo-classification"
    if is_classification_project != is_classification_dataset:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = "프로젝트 task와 데이터셋 형식이 일치하지 않습니다."
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    if is_classification_project and is_classification_dataset:
        task_type = "classification"
        data_path = Path(split.split_path)
    else:
        task_type = "detection"
        data_path = Path(split.dataset_yaml_path)

    now = datetime.now(timezone.utc)
    run_dir = StoragePaths(settings.artifact_root).train_run_dir(run.project_id, run.id).resolve()
    stdout_log_path = run_dir / "logs" / "stdout.log"
    run.status = "running"
    run.started_at = now
    run.artifact_path = str(run_dir)
    run.log_path = str(stdout_log_path)
    db.commit()

    config = _training_config(run)
    try:
        result = run_yolo_training(
            task_type=task_type,
            model_name=run.model_name,
            data_path=data_path,
            config=config,
            run_parent=run_dir.parent,
            run_name=run_dir.name,
        )
    except Exception as exc:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        if isinstance(exc, FileNotFoundError):
            job.error_message = "YOLO 실행 파일을 찾을 수 없습니다."
        else:
            job.error_message = str(exc) or "학습 실행에 실패했습니다."
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    run.artifact_path = str(result.run_dir)
    run.log_path = str(result.stdout_log_path)
    if result.exit_code != 0:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = f"학습 프로세스가 실패했습니다. 종료 코드: {result.exit_code}"
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    if not result.results_csv_path.is_file():
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = "학습 결과 파일을 찾을 수 없습니다."
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    best_weight_path = result.run_dir / "weights" / "best.pt"
    last_weight_path = result.run_dir / "weights" / "last.pt"
    if not best_weight_path.is_file() or not last_weight_path.is_file():
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = "학습 모델 아티팩트 파일을 찾을 수 없습니다."
        db.commit()
        notify_training_finished(db, run, "training_failed")
        return

    try:
        rows = read_results_csv(result.results_csv_path)
        metrics_summary = summarize_metrics(rows)
        run.metrics_summary = metrics_summary
        run.status = "completed"
        run.finished_at = datetime.now(timezone.utc)
        _register_artifact(
            db,
            run=run,
            kind="best",
            path=best_weight_path,
            metrics_summary=metrics_summary,
        )
        _register_artifact(
            db,
            run=run,
            kind="last",
            path=last_weight_path,
            metrics_summary=metrics_summary,
        )
        job.status = COMPLETED
        job.error_message = None
        db.commit()
    except Exception as exc:
        db.rollback()
        run = db.get(TrainingRun, run.id)
        job = db.get(Job, job.id)
        if run is not None:
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.artifact_path = str(result.run_dir)
            run.log_path = str(result.stdout_log_path)
        if job is not None:
            job.status = FAILED
            job.error_message = str(exc) or "학습 결과 처리에 실패했습니다."
        db.commit()
        if run is not None:
            notify_training_finished(db, run, "training_failed")
        return

    notify_training_finished(db, run, "training_completed")


JOB_HANDLERS["training"] = handle_training_job


def _inference_config(run: InferenceRun) -> dict:
    defaults = {"conf": 0.25, "imgsz": 640}
    defaults.update(run.config or {})
    return defaults


def _class_names_for_artifact(db: Session, artifact: ModelArtifact) -> list[str]:
    training_run = db.get(TrainingRun, artifact.training_run_id)
    if training_run is None:
        return []
    dataset = db.get(Dataset, training_run.dataset_id)
    if dataset is None:
        return []
    return dataset.class_names or []


def _parse_label_file(label_path: Path, class_names: list[str]) -> tuple[list[dict], float]:
    detections: list[dict] = []
    max_confidence = 0.0
    if not label_path.is_file():
        return detections, max_confidence

    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        try:
            class_id = int(float(parts[0]))
            x_center = float(parts[1])
            y_center = float(parts[2])
            width = float(parts[3])
            height = float(parts[4])
            confidence = float(parts[5]) if len(parts) > 5 else None
        except ValueError:
            continue

        if confidence is not None:
            max_confidence = max(max_confidence, confidence)
        class_name = class_names[class_id] if 0 <= class_id < len(class_names) else str(class_id)
        detections.append(
            {
                "class_id": class_id,
                "class_name": class_name,
                "bbox": {
                    "x_center": x_center,
                    "y_center": y_center,
                    "width": width,
                    "height": height,
                },
                "confidence": confidence,
            }
        )
    return detections, max_confidence


def _rendered_images(output_dir: Path) -> list[Path]:
    if not output_dir.exists():
        return []
    return sorted(
        path
        for path in output_dir.rglob("*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
        and "labels" not in path.relative_to(output_dir).parts
        and "logs" not in path.relative_to(output_dir).parts
        and "visionops_rendered" not in path.relative_to(output_dir).parts
    )


def _input_image_index(input_path: Path) -> tuple[dict[Path, Path], dict[str, list[Path]]]:
    paths = [input_path] if input_path.is_file() else sorted(
        path
        for path in input_path.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )
    by_relative = {}
    by_name: dict[str, list[Path]] = {}
    for path in paths:
        relative = Path(path.name) if input_path.is_file() else path.relative_to(input_path)
        by_relative[relative] = path
        by_name.setdefault(path.name, []).append(path)
    return by_relative, by_name


def _source_image_path(run: InferenceRun, rendered_image: Path) -> str:
    input_path = Path(run.input_path)
    if run.input_type == "image":
        return str(input_path)
    by_relative, by_name = _input_image_index(input_path)
    try:
        relative = rendered_image.relative_to(Path(run.output_path or rendered_image.parent))
    except ValueError:
        relative = Path(rendered_image.name)
    relative_match = by_relative.get(relative)
    if relative_match is not None:
        return str(relative_match)
    name_matches = by_name.get(rendered_image.name, [])
    if len(name_matches) == 1:
        return str(name_matches[0])
    return str(input_path)


def _label_path_for_rendered_image(output_dir: Path, rendered_image: Path) -> Path:
    relative = rendered_image.relative_to(output_dir).with_suffix(".txt")
    nested_label_path = output_dir / "labels" / relative
    if nested_label_path.is_file():
        return nested_label_path
    return output_dir / "labels" / f"{rendered_image.stem}.txt"


def _render_prediction_image(
    *,
    image_path: Path,
    output_dir: Path,
    relative_image_path: Path,
    detections: list[dict],
) -> Path | None:
    if not detections:
        return None

    try:
        image = Image.open(image_path).convert("RGB")
    except Exception:
        return None

    width, height = image.size
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=max(14, min(width, height) // 28))
    line_width = max(2, round(min(width, height) / 180))

    for detection in detections:
        bbox = detection.get("bbox", {})
        try:
            x_center = float(bbox["x_center"])
            y_center = float(bbox["y_center"])
            box_width = float(bbox["width"])
            box_height = float(bbox["height"])
            class_id = int(detection.get("class_id", 0))
        except (KeyError, TypeError, ValueError):
            continue

        left = max(0, int((x_center - box_width / 2) * width))
        top = max(0, int((y_center - box_height / 2) * height))
        right = min(width - 1, int((x_center + box_width / 2) * width))
        bottom = min(height - 1, int((y_center + box_height / 2) * height))
        if right <= left or bottom <= top:
            continue

        color = BOX_COLORS[class_id % len(BOX_COLORS)]
        draw.rectangle((left, top, right, bottom), outline=color, width=line_width)

        class_name = str(detection.get("class_name") or class_id)
        confidence = detection.get("confidence")
        label = (
            f"{class_name} {float(confidence):.2f}"
            if isinstance(confidence, int | float)
            else class_name
        )
        text_box = draw.textbbox((0, 0), label, font=font)
        text_width = text_box[2] - text_box[0]
        text_height = text_box[3] - text_box[1]
        label_top = max(0, top - text_height - 2 * line_width)
        label_bottom = label_top + text_height + 2 * line_width
        draw.rectangle(
            (left, label_top, min(width - 1, left + text_width + 2 * line_width), label_bottom),
            fill=color,
        )
        draw.text((left + line_width, label_top + line_width), label, fill=(255, 255, 255), font=font)

    destination = output_dir / "visionops_rendered" / relative_image_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)
    return destination


def _ensure_valid_inference_inputs(run: InferenceRun, artifact: ModelArtifact) -> None:
    model_path = Path(artifact.path)
    input_path = Path(run.input_path)
    if not model_path.is_file():
        raise ValueError("추론에 사용할 모델 아티팩트 파일을 찾을 수 없습니다.")
    if run.input_type == "image" and not input_path.is_file():
        raise ValueError("단일 이미지 추론 입력 파일을 찾을 수 없습니다.")
    if run.input_type == "folder" and not input_path.is_dir():
        raise ValueError("폴더 추론 입력 디렉터리를 찾을 수 없습니다.")


def _write_inference_predictions(
    db: Session,
    *,
    run: InferenceRun,
    output_dir: Path,
    class_names: list[str],
) -> int:
    predictions_payload: list[dict] = []
    db.execute(delete(InferencePrediction).where(InferencePrediction.inference_run_id == run.id))
    input_by_relative, _input_by_name = _input_image_index(Path(run.input_path))
    recorded_inputs: set[str] = set()

    def add_prediction(
        *,
        image_path: Path,
        output_image_path: Path | None,
        detections: list[dict],
        max_confidence: float,
    ) -> None:
        rendered_image_path = str(output_image_path) if output_image_path is not None else ""
        prediction_json = {
            "image_path": str(image_path),
            "output_image_path": rendered_image_path,
            "detections": detections,
        }
        predictions_payload.append(prediction_json)
        recorded_inputs.add(str(image_path))
        db.add(
            InferencePrediction(
                id=new_id("pred"),
                inference_run_id=run.id,
                image_path=str(image_path),
                output_image_path=rendered_image_path,
                prediction_json=prediction_json,
                class_names=class_names,
                max_confidence=max_confidence,
            )
        )

    for rendered_image in _rendered_images(output_dir):
        detections, max_confidence = _parse_label_file(
            _label_path_for_rendered_image(output_dir, rendered_image),
            class_names,
        )
        source_image_path = Path(_source_image_path(run, rendered_image))
        visionops_rendered_image = _render_prediction_image(
            image_path=source_image_path,
            output_dir=output_dir,
            relative_image_path=rendered_image.relative_to(output_dir),
            detections=detections,
        )
        add_prediction(
            image_path=source_image_path,
            output_image_path=visionops_rendered_image,
            detections=detections,
            max_confidence=max_confidence,
        )

    for image_path in input_by_relative.values():
        if str(image_path) in recorded_inputs:
            continue
        add_prediction(
            image_path=image_path,
            output_image_path=None,
            detections=[],
            max_confidence=0.0,
        )

    (output_dir / "predictions.json").write_text(
        json.dumps(
            {
                "run_id": run.id,
                "prediction_count": len(predictions_payload),
                "predictions": predictions_payload,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return len(predictions_payload)


def _write_classification_predictions(
    db: Session,
    *,
    run: InferenceRun,
    predictions: list[dict],
) -> int:
    db.execute(delete(InferencePrediction).where(InferencePrediction.inference_run_id == run.id))

    for item in predictions:
        ranking = item.get("ranking") or []
        top = ranking[0] if ranking else None
        db.add(
            InferencePrediction(
                id=new_id("pred"),
                inference_run_id=run.id,
                image_path=item["image_path"],
                output_image_path=item["image_path"],
                prediction_json={"ranking": ranking, "top": top},
                class_names=[entry["class_name"] for entry in ranking],
                max_confidence=float(top["confidence"]) if top else 0.0,
            )
        )

    return len(predictions)


def handle_inference_job(db: Session, job: Job) -> None:
    run = db.get(InferenceRun, job.target_id)
    if run is None:
        fail_job(db, job, "추론 실행을 찾을 수 없습니다.")
        return

    artifact = db.get(ModelArtifact, run.model_artifact_id)
    if artifact is None:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = "추론에 사용할 모델 아티팩트를 찾을 수 없습니다."
        db.commit()
        notify_inference_finished(db, run, "inference_failed")
        return

    project = db.get(Project, run.project_id)
    task_type = project.task_type if project is not None else "detection"
    now = datetime.now(timezone.utc)
    output_dir = StoragePaths(settings.artifact_root).inference_run_dir(run.project_id, run.id)
    stdout_log_path = output_dir / "logs" / "stdout.log"
    run.status = "running"
    run.started_at = now
    run.output_path = str(output_dir)
    db.commit()

    try:
        _ensure_valid_inference_inputs(run, artifact)
        if task_type == "classification":
            result = run_yolo_classification_inference(
                model_path=Path(artifact.path),
                input_path=Path(run.input_path),
                output_dir=output_dir,
                config=_inference_config(run),
            )
        else:
            result = run_yolo_inference(
                task_type=task_type,
                model_path=Path(artifact.path),
                input_path=Path(run.input_path),
                output_dir=output_dir,
                config=_inference_config(run),
            )
    except Exception as exc:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        run.output_path = str(output_dir)
        job.status = FAILED
        if isinstance(exc, FileNotFoundError):
            stdout_log_path.parent.mkdir(parents=True, exist_ok=True)
            stdout_log_path.touch(exist_ok=True)
            job.error_message = "YOLO 실행 파일을 찾을 수 없습니다."
        else:
            job.error_message = str(exc) or "추론 실행에 실패했습니다."
        db.commit()
        notify_inference_finished(db, run, "inference_failed")
        return

    run.output_path = str(result.output_dir)
    if result.exit_code != 0:
        run.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = FAILED
        job.error_message = f"추론 프로세스가 실패했습니다. 종료 코드: {result.exit_code}"
        db.commit()
        notify_inference_finished(db, run, "inference_failed")
        return

    try:
        if task_type == "classification":
            prediction_count = _write_classification_predictions(
                db,
                run=run,
                predictions=result.predictions,
            )
        else:
            prediction_count = _write_inference_predictions(
                db,
                run=run,
                output_dir=result.output_dir,
                class_names=_class_names_for_artifact(db, artifact),
            )
        run.prediction_count = prediction_count
        run.status = "completed"
        run.finished_at = datetime.now(timezone.utc)
        job.status = COMPLETED
        job.error_message = None
        db.commit()
    except Exception as exc:
        db.rollback()
        run = db.get(InferenceRun, run.id)
        job = db.get(Job, job.id)
        if run is not None:
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.output_path = str(result.output_dir)
        if job is not None:
            job.status = FAILED
            job.error_message = str(exc) or "추론 결과 처리에 실패했습니다."
        db.commit()
        if run is not None:
            notify_inference_finished(db, run, "inference_failed")
        return

    notify_inference_finished(db, run, "inference_completed")


JOB_HANDLERS["inference"] = handle_inference_job


def process_job(db: Session, job: Job) -> None:
    handler = JOB_HANDLERS.get(job.type)
    if handler is None:
        fail_job(db, job, f"처리할 수 없는 작업 유형입니다: {job.type}")
        return

    try:
        handler(db, job)
    except Exception as exc:
        db.rollback()
        current_job = db.get(Job, job.id)
        if current_job is not None:
            fail_job(db, current_job, str(exc))


def run_worker(poll_seconds: float = 1.0) -> None:
    while True:
        db = SessionLocal()
        try:
            job = claim_next_job(db)
            if job is not None:
                process_job(db, job)
        finally:
            db.close()
        if job is None:
            time.sleep(poll_seconds)


if __name__ == "__main__":
    run_worker()
