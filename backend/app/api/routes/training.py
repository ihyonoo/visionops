import csv
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models import Dataset, DatasetSplit, ModelArtifact, Project, TrainingRun
from app.schemas import (
    ModelArtifactRead,
    TrainingLogRead,
    TrainingMetricsRead,
    TrainingRunCreate,
    TrainingRunRead,
)
from app.services.jobs import enqueue_job
from app.services.logs import stream_log, tail_log_with_offset
from app.services.metrics import read_results_csv, summarize_metrics

router = APIRouter(prefix="/api/projects/{project_id}/training-runs", tags=["training"])


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


@router.post("", response_model=TrainingRunRead, status_code=status.HTTP_201_CREATED)
def create_training_run(
    project_id: str,
    payload: TrainingRunCreate,
    db: Annotated[Session, Depends(get_db)],
) -> TrainingRun:
    dataset, split = _require_project_split(db, project_id, payload.split_id)
    run = TrainingRun(
        id=uuid.uuid4().hex,
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
