import shutil
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import Dataset, DatasetSplit, Project, TrainingRun
from app.schemas import DatasetSplitCreate, DatasetSplitRead, DatasetSplitUpdate
from app.services.ids import new_id
from app.services.split import create_classification_copy_split, create_copy_split
from app.services.storage import StoragePaths

router = APIRouter(
    prefix="/api/projects/{project_id}/datasets/{dataset_id}/splits",
    tags=["splits"],
)


def _require_project(db: Session, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _require_dataset(db: Session, project_id: str, dataset_id: str) -> Dataset:
    _require_project(db, project_id)
    dataset = db.get(Dataset, dataset_id)
    if dataset is None or dataset.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    return dataset


def _require_split(db: Session, project_id: str, dataset_id: str, split_id: str) -> DatasetSplit:
    _require_dataset(db, project_id, dataset_id)
    split = db.get(DatasetSplit, split_id)
    if split is None or split.dataset_id != dataset_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="split을 찾을 수 없습니다.")
    return split


def _remove_split_root(split_root: Path) -> None:
    shutil.rmtree(split_root, ignore_errors=True)


def _is_managed_split_path(path: Path, project_id: str, dataset_id: str) -> bool:
    try:
        resolved_path = path.resolve()
        managed_root = (
            StoragePaths(settings.artifact_root)
            .ensure_root()
            / "projects"
            / project_id
            / "datasets"
            / dataset_id
            / "splits"
        ).resolve()
    except OSError:
        return False
    return managed_root in resolved_path.parents


@router.post("", response_model=DatasetSplitRead, status_code=status.HTTP_201_CREATED)
def create_split(
    project_id: str,
    dataset_id: str,
    payload: DatasetSplitCreate,
    db: Annotated[Session, Depends(get_db)],
) -> DatasetSplit:
    if (
        not 0 <= payload.train_ratio <= 1
        or not 0 <= payload.val_ratio <= 1
        or not 0 <= payload.test_ratio <= 1
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="train_ratio, val_ratio, test_ratio는 0과 1 사이여야 합니다.",
        )
    if abs((payload.train_ratio + payload.val_ratio + payload.test_ratio) - 1.0) > 1e-6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="train_ratio, val_ratio, test_ratio의 합은 1.0이어야 합니다.",
        )

    project = _require_project(db, project_id)
    dataset = db.get(Dataset, dataset_id)
    if dataset is None or dataset.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")

    split_id = new_id("spl")
    split_root = StoragePaths(settings.artifact_root).split_dir(project_id, dataset_id, split_id)
    split_function = (
        create_classification_copy_split
        if project.task_type == "classification"
        else create_copy_split
    )
    try:
        split_result = split_function(
            dataset_root=Path(dataset.source_path),
            split_root=split_root,
            train_ratio=payload.train_ratio,
            val_ratio=payload.val_ratio,
            test_ratio=payload.test_ratio,
            seed=payload.seed,
        )
    except (OSError, ValueError) as exc:
        _remove_split_root(split_root)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc) or "split을 생성할 수 없습니다.",
        ) from exc

    split = DatasetSplit(
        id=split_id,
        dataset_id=dataset_id,
        name=payload.name,
        train_ratio=payload.train_ratio,
        val_ratio=payload.val_ratio,
        test_ratio=payload.test_ratio,
        seed=payload.seed,
        train_count=split_result.train_count,
        val_count=split_result.val_count,
        test_count=split_result.test_count,
        split_path=str(split_root),
        dataset_yaml_path=str(split_result.dataset_yaml_path),
    )
    try:
        db.add(split)
        db.commit()
        db.refresh(split)
    except Exception as exc:
        db.rollback()
        _remove_split_root(split_root)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="split 저장에 실패했습니다.",
        ) from exc
    return split


@router.get("", response_model=list[DatasetSplitRead])
def list_splits(
    project_id: str,
    dataset_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> list[DatasetSplit]:
    _require_dataset(db, project_id, dataset_id)
    statement = (
        select(DatasetSplit)
        .where(DatasetSplit.dataset_id == dataset_id)
        .order_by(DatasetSplit.created_at.desc())
    )
    return list(db.scalars(statement))


@router.patch("/{split_id}", response_model=DatasetSplitRead)
def update_split(
    project_id: str,
    dataset_id: str,
    split_id: str,
    payload: DatasetSplitUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> DatasetSplit:
    split = _require_split(db, project_id, dataset_id, split_id)
    split.name = payload.name
    db.add(split)
    db.commit()
    db.refresh(split)
    return split


@router.delete("/{split_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_split(
    project_id: str,
    dataset_id: str,
    split_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    split = _require_split(db, project_id, dataset_id, split_id)
    training_run = db.scalar(select(TrainingRun.id).where(TrainingRun.split_id == split_id))
    if training_run is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="학습 실행에 연결된 split은 삭제할 수 없습니다.",
        )

    split_path = Path(split.split_path)
    db.delete(split)
    db.commit()
    if _is_managed_split_path(split_path, project_id, dataset_id):
        _remove_split_root(split_path)
