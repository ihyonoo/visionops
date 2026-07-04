import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import InferencePrediction, InferenceRun, ModelArtifact, Project, TrainingRun
from app.schemas import InferencePredictionRead, InferenceRunCreate, InferenceRunRead
from app.services.jobs import enqueue_job

router = APIRouter(prefix="/api/projects/{project_id}/inference-runs", tags=["inference"])


def _require_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="프로젝트를 찾을 수 없습니다.",
        )
    return project


def _require_project_artifact(
    db: Session, project_id: str, artifact_id: str
) -> tuple[ModelArtifact, TrainingRun]:
    _require_project(db, project_id)
    artifact = db.get(ModelArtifact, artifact_id)
    if artifact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="모델 아티팩트를 찾을 수 없습니다.",
        )
    training_run = db.get(TrainingRun, artifact.training_run_id)
    if training_run is None or training_run.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="모델 아티팩트를 찾을 수 없습니다.",
        )
    if not Path(artifact.path).is_file():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="모델 아티팩트 파일을 찾을 수 없습니다.",
        )
    return artifact, training_run


def _validate_input_path(input_type: str, input_path: str) -> None:
    path = Path(input_path)
    if not path.is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="추론 입력 경로는 절대 경로여야 합니다.",
        )
    if input_type == "image" and not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="단일 이미지 추론 입력은 파일이어야 합니다.",
        )
    if input_type == "folder" and not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="폴더 추론 입력은 디렉터리여야 합니다.",
        )


def _require_inference_run(db: Session, project_id: str, run_id: str) -> InferenceRun:
    _require_project(db, project_id)
    run = db.get(InferenceRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추론 실행을 찾을 수 없습니다.",
        )
    return run


@router.post("", response_model=InferenceRunRead, status_code=status.HTTP_201_CREATED)
def create_inference_run(
    project_id: str,
    payload: InferenceRunCreate,
    db: Annotated[Session, Depends(get_db)],
) -> InferenceRun:
    artifact, _training_run = _require_project_artifact(db, project_id, payload.model_artifact_id)
    _validate_input_path(payload.input_type, payload.input_path)
    run = InferenceRun(
        id=uuid.uuid4().hex,
        project_id=project_id,
        model_artifact_id=artifact.id,
        name=payload.name,
        input_type=payload.input_type,
        input_path=payload.input_path,
        status="queued",
        config=payload.config.model_dump(),
        prediction_count=0,
    )
    db.add(run)
    db.flush()
    enqueue_job(db, "inference", run.id)
    db.refresh(run)
    return run


@router.get("", response_model=list[InferenceRunRead])
def list_inference_runs(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> list[InferenceRun]:
    _require_project(db, project_id)
    statement = (
        select(InferenceRun)
        .where(InferenceRun.project_id == project_id)
        .order_by(InferenceRun.created_at.desc())
    )
    return list(db.scalars(statement))


@router.get("/{run_id}", response_model=InferenceRunRead)
def get_inference_run(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> InferenceRun:
    return _require_inference_run(db, project_id, run_id)


@router.get("/{run_id}/predictions", response_model=list[InferencePredictionRead])
def list_inference_predictions(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> list[InferencePrediction]:
    run = _require_inference_run(db, project_id, run_id)
    statement = (
        select(InferencePrediction)
        .where(InferencePrediction.inference_run_id == run.id)
        .order_by(InferencePrediction.created_at.asc())
    )
    return list(db.scalars(statement))
