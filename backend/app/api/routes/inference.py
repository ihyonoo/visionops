import shutil
from pathlib import Path
from pathlib import PurePosixPath
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import InferencePrediction, InferenceRun, Job, ModelArtifact, Project, TrainingRun
from app.schemas import InferencePredictionRead, InferenceRunCreate, InferenceRunRead
from app.services.ids import new_id
from app.services.jobs import enqueue_job
from app.services.storage import StoragePaths

router = APIRouter(prefix="/api/projects/{project_id}/inference-runs", tags=["inference"])
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


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


def _upload_name_parts(filename: str) -> list[str]:
    normalized_filename = filename.replace("\\", "/")
    return [part for part in PurePosixPath(normalized_filename).parts if part not in {"", ".", ".."}]


def _normalize_upload_name(filename: str) -> Path:
    parts = _upload_name_parts(filename)
    if not parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="업로드 파일 이름이 올바르지 않습니다.",
        )
    if len(parts) > 1:
        parts = parts[1:]
    return Path(*parts)


def _require_image_uploads(files: list[UploadFile]) -> None:
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="추론할 이미지를 선택하세요.",
        )
    if any(Path(file.filename or "").suffix.lower() not in IMAGE_EXTENSIONS for file in files):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="추론 입력은 이미지 파일만 업로드할 수 있습니다.",
        )


def _store_inference_uploads(
    *, project_id: str, run_id: str, input_type: str, files: list[UploadFile]
) -> Path:
    _require_image_uploads(files)
    has_folder_paths = any(len(_upload_name_parts(file.filename or "")) > 1 for file in files)
    if input_type == "image" and (len(files) != 1 or has_folder_paths):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="단일 이미지 추론에는 이미지 파일 1개만 선택하세요.",
        )
    if input_type == "folder" and not has_folder_paths:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="폴더 추론에는 이미지 폴더를 선택하세요.",
        )

    input_root = StoragePaths(settings.artifact_root).inference_input_dir(project_id, run_id).resolve()
    for file in files:
        relative_name = _normalize_upload_name(file.filename or "")
        if input_type == "image":
            relative_name = Path(relative_name.name)
        destination = input_root / relative_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(file.file.read())

    if input_type == "image":
        return next(path for path in input_root.iterdir() if path.is_file())
    return input_root


def _require_inference_run(db: Session, project_id: str, run_id: str) -> InferenceRun:
    _require_project(db, project_id)
    run = db.get(InferenceRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추론 실행을 찾을 수 없습니다.",
        )
    return run


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def _remove_managed_path(path: Path | None, managed_root: Path) -> None:
    if path is None or not _is_relative_to(path, managed_root) or not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def _managed_inference_roots(project_id: str) -> tuple[Path, Path]:
    artifact_root = StoragePaths(settings.artifact_root).ensure_root()
    project_root = artifact_root / "projects" / project_id
    return project_root / "runs" / "inference", project_root / "runs" / "inference_inputs"


@router.post("", response_model=InferenceRunRead, status_code=status.HTTP_201_CREATED)
def create_inference_run(
    project_id: str,
    payload: InferenceRunCreate,
    db: Annotated[Session, Depends(get_db)],
) -> InferenceRun:
    artifact, _training_run = _require_project_artifact(db, project_id, payload.model_artifact_id)
    _validate_input_path(payload.input_type, payload.input_path)
    run = InferenceRun(
        id=new_id("inf"),
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


@router.post("/upload", response_model=InferenceRunRead, status_code=status.HTTP_201_CREATED)
def upload_inference_run(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
    name: Annotated[str, Form()],
    model_artifact_id: Annotated[str, Form()],
    input_type: Annotated[str, Form()],
    conf: Annotated[float, Form()] = 0.25,
    imgsz: Annotated[int, Form()] = 640,
    inputs: Annotated[list[UploadFile], File()] = [],
) -> InferenceRun:
    artifact, _training_run = _require_project_artifact(db, project_id, model_artifact_id)
    normalized_input_type = "image" if input_type == "single_image" else input_type
    if normalized_input_type not in {"image", "folder"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="지원하지 않는 추론 입력 유형입니다.",
        )

    run_id = new_id("inf")
    input_path = _store_inference_uploads(
        project_id=project_id,
        run_id=run_id,
        input_type=normalized_input_type,
        files=inputs,
    )
    run = InferenceRun(
        id=run_id,
        project_id=project_id,
        model_artifact_id=artifact.id,
        name=name,
        input_type=normalized_input_type,
        input_path=str(input_path),
        status="queued",
        config={"conf": conf, "imgsz": imgsz},
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


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inference_run(
    project_id: str,
    run_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    run = _require_inference_run(db, project_id, run_id)
    output_root, input_root = _managed_inference_roots(project_id)
    output_path = Path(run.output_path) if run.output_path else None
    input_path = Path(run.input_path)
    managed_input_path = input_path.parent if run.input_type == "image" else input_path

    db.execute(delete(InferencePrediction).where(InferencePrediction.inference_run_id == run.id))
    db.execute(delete(Job).where(Job.type == "inference", Job.target_id == run.id))
    db.delete(run)
    db.commit()

    _remove_managed_path(output_path, output_root)
    _remove_managed_path(managed_input_path, input_root)


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


@router.get("/{run_id}/predictions/{prediction_id}/image")
def get_inference_prediction_image(
    project_id: str,
    run_id: str,
    prediction_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    run = _require_inference_run(db, project_id, run_id)
    prediction = db.get(InferencePrediction, prediction_id)
    if prediction is None or prediction.inference_run_id != run.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추론 결과 이미지를 찾을 수 없습니다.",
        )
    if not prediction.output_image_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추론 결과 이미지 파일을 찾을 수 없습니다.",
        )
    image_path = Path(prediction.output_image_path)
    if not image_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추론 결과 이미지 파일을 찾을 수 없습니다.",
        )
    return FileResponse(
        image_path,
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )
