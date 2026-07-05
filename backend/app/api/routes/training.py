import csv
import mimetypes
import re
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models import Dataset, DatasetSplit, Job, ModelArtifact, Project, TrainingRun
from app.schemas import (
    ModelArtifactRead,
    TrainingDownloadRead,
    TrainingLogRead,
    TrainingMetricsRead,
    TrainingPreflightRead,
    TrainingRunCreate,
    TrainingRunRead,
)
from app.services.ids import new_id
from app.services.jobs import CANCELLED, enqueue_job
from app.services.logs import stream_log, tail_log_with_offset
from app.services.metrics import read_results_csv, summarize_metrics
from app.services.runtime import build_training_preflight, check_runtime

router = APIRouter(prefix="/api/projects/{project_id}/training-runs", tags=["training"])

REPORT_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
EXCLUDED_REPORT_IMAGE_PREFIXES = ("train_", "train-", "train_batch", "val_", "val-", "val_batch")
THUMBNAIL_IMAGE_PATTERNS = (
    "val_batch*_pred.jpg",
    "val_batch*_pred.jpeg",
    "val_batch*_pred.png",
    "val_batch*_labels.jpg",
    "val_batch*_labels.jpeg",
    "val_batch*_labels.png",
    "results.png",
    "confusion_matrix.png",
    "confusion_matrix_normalized.png",
    "*.png",
    "*.jpg",
    "*.jpeg",
)
ANSI_ESCAPE_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SAVE_DIR_PATTERN = re.compile(r"save_dir=([^,\n\r]+)")
RESULTS_SAVED_PATTERN = re.compile(r"Results saved to\s+([^\n\r]+)")


def _require_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="프로젝트를 찾을 수 없습니다.",
        )
    return project


def _require_project_split(db: Session, project_id: str, split_id: str) -> tuple[Dataset, DatasetSplit]:
    _require_project(db, project_id)
    split = db.get(DatasetSplit, split_id)
    if split is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="split을 찾을 수 없습니다.")

    dataset = db.get(Dataset, split.dataset_id)
    if dataset is None or dataset.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="split을 찾을 수 없습니다.")
    return dataset, split


def _require_training_run(db: Session, project_id: str, run_id: str) -> TrainingRun:
    _require_project(db, project_id)
    run = db.get(TrainingRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="학습 실행을 찾을 수 없습니다.",
        )
    return run


def _strip_ansi(value: str) -> str:
    return ANSI_ESCAPE_PATTERN.sub("", value)


def _logged_training_save_dir(run: TrainingRun) -> Path | None:
    if not run.log_path:
        return None
    log_path = Path(run.log_path)
    if not log_path.is_file():
        return None
    try:
        log_text = _strip_ansi(log_path.read_text(encoding="utf-8", errors="ignore"))
    except OSError:
        return None
    matches = [
        (match.start(), match.group(1))
        for pattern in (SAVE_DIR_PATTERN, RESULTS_SAVED_PATTERN)
        for match in pattern.finditer(log_text)
    ]
    for _position, raw_path in sorted(matches, reverse=True):
        candidate = Path(raw_path.strip().strip("'\"`")).expanduser()
        if candidate.is_dir():
            return candidate.resolve()
    return None


def _require_training_artifact(
    db: Session, project_id: str, run_id: str, artifact_id: str
) -> ModelArtifact:
    run = _require_training_run(db, project_id, run_id)
    artifact = db.get(ModelArtifact, artifact_id)
    if artifact is None or artifact.training_run_id != run.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="모델 파일을 찾을 수 없습니다.",
        )
    artifact_path = Path(artifact.path)
    if not artifact_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="모델 파일을 찾을 수 없습니다.",
        )
    return artifact


def _training_run_artifact_dir(run: TrainingRun) -> Path:
    if run.artifact_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="학습 산출물 경로를 찾을 수 없습니다.",
        )
    artifact_dir = Path(run.artifact_path).resolve()
    logged_save_dir = _logged_training_save_dir(run)
    if logged_save_dir is not None and logged_save_dir != artifact_dir:
        has_report_outputs = any(
            (logged_save_dir / filename).is_file()
            for filename in ("args.yaml", "results.png", "confusion_matrix.png")
        )
        if has_report_outputs:
            return logged_save_dir
    if not artifact_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="학습 산출물 경로를 찾을 수 없습니다.",
        )
    return artifact_dir


def _download_url(project_id: str, run_id: str, filename: str) -> str:
    return f"/api/projects/{project_id}/training-runs/{run_id}/downloads/{filename}"


def _is_report_image(path: Path) -> bool:
    filename = path.name.lower()
    if path.suffix.lower() not in REPORT_IMAGE_EXTENSIONS:
        return False
    return not filename.startswith(EXCLUDED_REPORT_IMAGE_PREFIXES)


def _static_training_downloads(project_id: str, run: TrainingRun, artifact_dir: Path) -> list[dict]:
    downloads: list[dict] = []
    results_csv_path = artifact_dir / "results.csv"
    if results_csv_path.is_file():
        downloads.append(
            {
                "filename": "results.csv",
                "label": "results.csv",
                "kind": "metrics",
                "url": f"/api/projects/{project_id}/training-runs/{run.id}/results.csv",
            }
        )

    args_yaml_path = artifact_dir / "args.yaml"
    if args_yaml_path.is_file():
        downloads.append(
            {
                "filename": "args.yaml",
                "label": "args.yaml",
                "kind": "config",
                "url": _download_url(project_id, run.id, "args.yaml"),
            }
        )

    report_images = sorted(
        (path for path in artifact_dir.iterdir() if path.is_file() and _is_report_image(path)),
        key=lambda path: path.name,
    )
    downloads.extend(
        {
            "filename": path.name,
            "label": path.name,
            "kind": "report_image",
            "url": _download_url(project_id, run.id, path.name),
        }
        for path in report_images
    )
    return downloads


def _training_thumbnail_path(artifact_dir: Path) -> Path | None:
    for pattern in THUMBNAIL_IMAGE_PATTERNS:
        candidates = sorted(
            path
            for path in artifact_dir.glob(pattern)
            if path.is_file() and path.suffix.lower() in REPORT_IMAGE_EXTENSIONS
        )
        if candidates:
            return candidates[0]
    return None


@router.post("", response_model=TrainingRunRead, status_code=status.HTTP_201_CREATED)
def create_training_run(
    project_id: str,
    payload: TrainingRunCreate,
    db: Annotated[Session, Depends(get_db)],
) -> TrainingRun:
    dataset, split = _require_project_split(db, project_id, payload.split_id)
    run = TrainingRun(
        id=new_id("trn"),
        project_id=project_id,
        dataset_id=dataset.id,
        split_id=split.id,
        name=payload.name,
        model_name=payload.model_name,
        trainer="ultralytics",
        status="queued",
        config=payload.config.model_dump(),
        metrics_summary={},
    )
    db.add(run)
    db.flush()
    enqueue_job(db, "training", run.id)
    db.refresh(run)
    return run


@router.post("/preflight", response_model=TrainingPreflightRead)
def preflight_training_run(
    project_id: str,
    payload: TrainingRunCreate,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    dataset, split = _require_project_split(db, project_id, payload.split_id)
    return build_training_preflight(
        dataset=dataset,
        split=split,
        config=payload.config.model_dump(),
        model_name=payload.model_name,
        runtime_check=check_runtime(),
    )


@router.get("", response_model=list[TrainingRunRead])
def list_training_runs(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> list[TrainingRun]:
    _require_project(db, project_id)
    statement = (
        select(TrainingRun)
        .where(TrainingRun.project_id == project_id)
        .order_by(TrainingRun.created_at.desc())
    )
    return list(db.scalars(statement))


@router.get("/{run_id}", response_model=TrainingRunRead)
def get_training_run(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> TrainingRun:
    return _require_training_run(db, project_id, run_id)


@router.post("/{run_id}/cancel", response_model=TrainingRunRead)
def cancel_training_run(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> TrainingRun:
    run = _require_training_run(db, project_id, run_id)
    if run.status in {"completed", "failed", "cancelled"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 종료된 학습 실행은 중단할 수 없습니다.",
        )
    if run.status == "queued":
        run.status = "cancelled"
        job = db.scalar(
            select(Job).where(
                Job.type == "training",
                Job.target_id == run.id,
                Job.status == "queued",
            )
        )
        if job is not None:
            job.status = CANCELLED
        db.commit()
        db.refresh(run)
        return run

    run.status = "cancel_requested"
    db.commit()
    db.refresh(run)
    return run


@router.get("/{run_id}/logs", response_model=TrainingLogRead)
def get_training_run_logs(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
    tail: Annotated[int, Query(ge=1, le=5000)] = 200,
) -> dict[str, int | list[str]]:
    run = _require_training_run(db, project_id, run_id)
    if run.log_path is None:
        return {"lines": [], "offset": 0}
    lines, offset = tail_log_with_offset(Path(run.log_path), max_lines=tail)
    return {"lines": lines, "offset": offset}


@router.get("/{run_id}/logs/stream")
def stream_training_run_logs(
    project_id: str,
    run_id: str,
    offset: Annotated[int | None, Query(ge=0)] = None,
) -> StreamingResponse:
    with SessionLocal() as db:
        run = _require_training_run(db, project_id, run_id)
        log_path = Path(run.log_path) if run.log_path is not None else None
    return StreamingResponse(
        stream_log(log_path, follow_from_end=offset is None, start_position=offset),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{run_id}/metrics", response_model=TrainingMetricsRead)
def get_training_run_metrics(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[dict] | dict]:
    run = _require_training_run(db, project_id, run_id)
    results_csv_path = (
        Path(run.artifact_path) / "results.csv" if run.artifact_path is not None else None
    )
    try:
        rows = read_results_csv(results_csv_path) if results_csv_path is not None else []
    except (csv.Error, OSError, UnicodeDecodeError):
        rows = []
    summary = summarize_metrics(rows) if rows else (run.metrics_summary or {})
    return {"summary": summary, "rows": rows}


@router.get("/{run_id}/artifacts", response_model=list[ModelArtifactRead])
def list_training_run_artifacts(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> list[ModelArtifact]:
    run = _require_training_run(db, project_id, run_id)
    statement = (
        select(ModelArtifact)
        .where(ModelArtifact.training_run_id == run.id)
        .order_by(ModelArtifact.kind.asc(), ModelArtifact.created_at.asc())
    )
    return list(db.scalars(statement))


@router.get("/{run_id}/artifacts/{artifact_id}/download")
def download_training_run_artifact(
    project_id: str,
    run_id: str,
    artifact_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    artifact = _require_training_artifact(db, project_id, run_id, artifact_id)
    artifact_path = Path(artifact.path)
    return FileResponse(
        artifact_path,
        filename=artifact_path.name,
        media_type="application/octet-stream",
    )


@router.get("/{run_id}/downloads", response_model=list[TrainingDownloadRead])
def list_training_run_downloads(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    run = _require_training_run(db, project_id, run_id)
    try:
        artifact_dir = _training_run_artifact_dir(run)
    except HTTPException:
        return []
    downloads = _static_training_downloads(project_id, run, artifact_dir)

    statement = (
        select(ModelArtifact)
        .where(ModelArtifact.training_run_id == run.id)
        .order_by(ModelArtifact.kind.asc(), ModelArtifact.created_at.asc())
    )
    artifacts = [
        artifact
        for artifact in db.scalars(statement)
        if Path(artifact.path).is_file()
    ]
    model_downloads = [
        {
            "filename": Path(artifact.path).name,
            "label": Path(artifact.path).name,
            "kind": f"model_{artifact.kind}",
            "url": f"/api/projects/{project_id}/training-runs/{run.id}/artifacts/{artifact.id}/download",
        }
        for artifact in artifacts
    ]
    return [*downloads[:1], *model_downloads, *downloads[1:]]


@router.get("/{run_id}/thumbnail")
def get_training_run_thumbnail(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    run = _require_training_run(db, project_id, run_id)
    artifact_dir = _training_run_artifact_dir(run)
    thumbnail_path = _training_thumbnail_path(artifact_dir)
    if thumbnail_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="학습 썸네일 이미지를 찾을 수 없습니다.",
        )
    return FileResponse(
        thumbnail_path,
        filename=thumbnail_path.name,
        media_type=mimetypes.guess_type(thumbnail_path.name)[0] or "application/octet-stream",
    )


@router.get("/{run_id}/downloads/{filename}")
def download_training_run_file(
    project_id: str,
    run_id: str,
    filename: str,
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    run = _require_training_run(db, project_id, run_id)
    artifact_dir = _training_run_artifact_dir(run).resolve()
    file_path = (artifact_dir / filename).resolve()
    if file_path.parent != artifact_dir:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="학습 산출물 파일을 찾을 수 없습니다.",
        )
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="학습 산출물 파일을 찾을 수 없습니다.",
        )
    allowed_names = {
        item["filename"]
        for item in _static_training_downloads(project_id, run, artifact_dir)
    }
    if file_path.name not in allowed_names:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="학습 산출물 파일을 찾을 수 없습니다.",
        )
    return FileResponse(
        file_path,
        filename=file_path.name,
        media_type="application/octet-stream",
    )


@router.get("/{run_id}/results.csv")
def download_training_results_csv(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    run = _require_training_run(db, project_id, run_id)
    try:
        artifact_dir = _training_run_artifact_dir(run)
    except HTTPException:
        artifact_dir = None
    results_csv_path = artifact_dir / "results.csv" if artifact_dir is not None else None
    if results_csv_path is None or not results_csv_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="results.csv 파일을 찾을 수 없습니다.",
        )
    return FileResponse(
        results_csv_path,
        filename="results.csv",
        media_type="text/csv",
    )
