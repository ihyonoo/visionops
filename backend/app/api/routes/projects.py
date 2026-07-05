from pathlib import Path
import re
import shutil
from typing import Annotated
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
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
from app.schemas import ProjectCreate, ProjectRead, ProjectUpdate
from app.services.ids import new_id
from app.services.storage import StoragePaths

router = APIRouter(prefix="/api/projects", tags=["projects"])
IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".webp"}


def project_slug_from_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKC", name).strip().lower()
    slug = re.sub(r"[^\w\s-]", "", normalized, flags=re.UNICODE)
    slug = re.sub(r"[\s_]+", "-", slug, flags=re.UNICODE)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "project"


def unique_project_slug(db: Session, name: str, exclude_project_id: str | None = None) -> str:
    base_slug = project_slug_from_name(name)
    query = select(Project.slug)
    if exclude_project_id is not None:
        query = query.where(Project.id != exclude_project_id)
    existing_slugs = {slug for slug in db.scalars(query) if slug}
    if base_slug not in existing_slugs:
        return base_slug

    suffix = 2
    while f"{base_slug}-{suffix}" in existing_slugs:
        suffix += 1
    return f"{base_slug}-{suffix}"


def _first_dataset_image(dataset: Dataset) -> Path | None:
    dataset_root = Path(dataset.source_path)
    images_root = dataset_root if dataset.format == "yolo-classification" else dataset_root / "images"
    if not images_root.is_dir():
        return None
    for image_path in sorted(images_root.rglob("*")):
        if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS:
            return image_path
    return None


def _project_has_resources(db: Session, project_id: str) -> bool:
    dataset_id = db.scalar(select(Dataset.id).where(Dataset.project_id == project_id).limit(1))
    if dataset_id is not None:
        return True

    training_run_id = db.scalar(
        select(TrainingRun.id).where(TrainingRun.project_id == project_id).limit(1)
    )
    if training_run_id is not None:
        return True

    inference_run_id = db.scalar(
        select(InferenceRun.id).where(InferenceRun.project_id == project_id).limit(1)
    )
    if inference_run_id is not None:
        return True

    split_id = db.scalar(
        select(DatasetSplit.id)
        .join(Dataset, DatasetSplit.dataset_id == Dataset.id)
        .where(Dataset.project_id == project_id)
        .limit(1)
    )
    return split_id is not None


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Annotated[Session, Depends(get_db)]) -> Project:
    project = Project(
        id=new_id("prj"),
        name=payload.name,
        slug=unique_project_slug(db, payload.name),
        description=payload.description,
        task_type=payload.task_type,
    )
    try:
        StoragePaths(settings.artifact_root).project_dir(project.id)
    except OSError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="프로젝트 저장소를 생성할 수 없습니다.",
        ) from exc
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=list[ProjectRead])
def list_projects(db: Annotated[Session, Depends(get_db)]) -> list[Project]:
    return list(db.scalars(select(Project).order_by(Project.created_at.desc())))


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: str, db: Annotated[Session, Depends(get_db)]) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if payload.name is not None:
        project.name = payload.name
        project.slug = unique_project_slug(db, payload.name, exclude_project_id=project.id)
    if payload.description is not None:
        project.description = payload.description
    if payload.task_type is not None and payload.task_type != project.task_type:
        if _project_has_resources(db, project.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="리소스가 있는 프로젝트의 작업 유형은 변경할 수 없습니다.",
            )
        project.task_type = payload.task_type
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}/thumbnail")
def get_project_thumbnail(project_id: str, db: Annotated[Session, Depends(get_db)]) -> FileResponse:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    datasets = db.scalars(
        select(Dataset)
        .where(Dataset.project_id == project_id)
        .order_by(Dataset.created_at.desc())
    )
    for dataset in datasets:
        image_path = _first_dataset_image(dataset)
        if image_path is not None:
            return FileResponse(image_path)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project thumbnail not found")


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, db: Annotated[Session, Depends(get_db)]) -> None:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    dataset_ids = list(db.scalars(select(Dataset.id).where(Dataset.project_id == project_id)))
    training_run_ids = list(
        db.scalars(select(TrainingRun.id).where(TrainingRun.project_id == project_id))
    )
    inference_run_ids = list(
        db.scalars(select(InferenceRun.id).where(InferenceRun.project_id == project_id))
    )

    if inference_run_ids:
        db.execute(
            delete(InferencePrediction).where(
                InferencePrediction.inference_run_id.in_(inference_run_ids)
            )
        )
        db.execute(
            delete(Job).where(
                Job.type == "inference",
                Job.target_id.in_(inference_run_ids),
            )
        )
    db.execute(delete(InferenceRun).where(InferenceRun.project_id == project_id))

    if training_run_ids:
        db.execute(
            delete(ModelArtifact).where(ModelArtifact.training_run_id.in_(training_run_ids))
        )
        db.execute(
            delete(Job).where(
                Job.type == "training",
                Job.target_id.in_(training_run_ids),
            )
        )
    db.execute(delete(TrainingRun).where(TrainingRun.project_id == project_id))

    if dataset_ids:
        db.execute(delete(DatasetSplit).where(DatasetSplit.dataset_id.in_(dataset_ids)))
    db.execute(delete(Dataset).where(Dataset.project_id == project_id))
    db.delete(project)
    db.commit()

    project_dir = StoragePaths(settings.artifact_root).ensure_root() / "projects" / project_id
    shutil.rmtree(project_dir, ignore_errors=True)
