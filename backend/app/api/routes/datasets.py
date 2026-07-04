import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Dataset, Project
from app.schemas import DatasetCreate, DatasetRead
from app.services.dataset_validation import validate_yolo_dataset

router = APIRouter(prefix="/api/projects/{project_id}/datasets", tags=["datasets"])


def _require_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
def create_dataset(
    project_id: str,
    payload: DatasetCreate,
    db: Annotated[Session, Depends(get_db)],
) -> Dataset:
    _require_project(db, project_id)
    validation = validate_yolo_dataset(Path(payload.source_path))
    if validation.status != "valid":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"validation_summary": validation.to_summary()},
        )
    dataset = Dataset(
        id=uuid.uuid4().hex,
        project_id=project_id,
        name=payload.name,
        source_path=payload.source_path,
        format="yolo",
        class_names=validation.class_names,
        image_count=validation.image_count,
        label_count=validation.label_count,
        validation_status=validation.status,
        validation_summary=validation.to_summary(),
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


@router.get("", response_model=list[DatasetRead])
def list_datasets(project_id: str, db: Annotated[Session, Depends(get_db)]) -> list[Dataset]:
    _require_project(db, project_id)
    statement = (
        select(Dataset)
        .where(Dataset.project_id == project_id)
        .order_by(Dataset.created_at.desc())
    )
    return list(db.scalars(statement))


@router.get("/{dataset_id}", response_model=DatasetRead)
def get_dataset(
    project_id: str,
    dataset_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> Dataset:
    _require_project(db, project_id)
    dataset = db.get(Dataset, dataset_id)
    if dataset is None or dataset.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    return dataset
