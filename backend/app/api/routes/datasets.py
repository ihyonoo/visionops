import uuid
from pathlib import Path
from pathlib import PurePosixPath
import shutil
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import Dataset, Project
from app.schemas import DatasetCreate, DatasetRead
from app.services.dataset_validation import validate_yolo_dataset
from app.services.storage import StoragePaths

router = APIRouter(prefix="/api/projects/{project_id}/datasets", tags=["datasets"])
IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".webp"}


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


def _first_dataset_image(dataset: Dataset) -> Path | None:
    images_root = Path(dataset.source_path) / "images"
    if not images_root.is_dir():
        return None
    for image_path in sorted(images_root.rglob("*")):
        if image_path.is_file() and image_path.suffix.lower() in IMAGE_EXTENSIONS:
            return image_path
    return None


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


def _safe_upload_path(filename: str) -> Path:
    normalized = filename.replace("\\", "/")
    raw_parts = PurePosixPath(normalized).parts
    parts = [part for part in raw_parts if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="업로드 파일 경로가 올바르지 않습니다.",
        )
    if PurePosixPath(normalized).is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="업로드 파일 경로가 올바르지 않습니다.",
        )
    return Path(*parts)


def _strip_common_folder(paths: list[Path]) -> list[Path]:
    if not paths:
        return []
    first_parts = [path.parts[0] for path in paths if len(path.parts) > 1]
    if len(first_parts) != len(paths) or len(set(first_parts)) != 1:
        return paths
    return [Path(*path.parts[1:]) for path in paths]


def _save_upload_group(files: list[UploadFile], destination_root: Path) -> None:
    if not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="업로드할 폴더 파일이 비어 있습니다.",
        )

    relative_paths = _strip_common_folder([_safe_upload_path(file.filename) for file in files])
    destination_root.mkdir(parents=True, exist_ok=True)
    for upload, relative_path in zip(files, relative_paths, strict=True):
        destination_path = destination_root / relative_path
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        upload.file.seek(0)
        with destination_path.open("wb") as output:
            shutil.copyfileobj(upload.file, output)


def _save_dataset_upload(
    *,
    project_id: str,
    dataset_id: str,
    images: list[UploadFile],
    labels: list[UploadFile],
    data_yaml: UploadFile,
) -> Path:
    dataset_root = StoragePaths(settings.artifact_root).dataset_dir(project_id, dataset_id)
    if dataset_root.exists():
        shutil.rmtree(dataset_root)
    dataset_root.mkdir(parents=True, exist_ok=True)
    _save_upload_group(images, dataset_root / "images")
    _save_upload_group(labels, dataset_root / "labels")
    data_yaml.file.seek(0)
    with (dataset_root / "data.yaml").open("wb") as output:
        shutil.copyfileobj(data_yaml.file, output)
    return dataset_root


@router.post("/upload", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
def upload_dataset(
    project_id: str,
    name: Annotated[str, Form(min_length=1)],
    images: Annotated[list[UploadFile], File()],
    labels: Annotated[list[UploadFile], File()],
    data_yaml: Annotated[UploadFile, File()],
    db: Annotated[Session, Depends(get_db)],
) -> Dataset:
    _require_project(db, project_id)
    dataset_id = uuid.uuid4().hex
    dataset_root = _save_dataset_upload(
        project_id=project_id,
        dataset_id=dataset_id,
        images=images,
        labels=labels,
        data_yaml=data_yaml,
    )
    validation = validate_yolo_dataset(dataset_root)
    if validation.status != "valid":
        shutil.rmtree(dataset_root, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"validation_summary": validation.to_summary()},
        )

    dataset = Dataset(
        id=dataset_id,
        project_id=project_id,
        name=name.strip(),
        source_path=str(dataset_root),
        format="yolo",
        class_names=validation.class_names,
        image_count=validation.image_count,
        label_count=validation.label_count,
        validation_status=validation.status,
        validation_summary=validation.to_summary(),
    )
    try:
        db.add(dataset)
        db.commit()
        db.refresh(dataset)
    except Exception as exc:
        db.rollback()
        shutil.rmtree(dataset_root, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="데이터셋 저장에 실패했습니다.",
        ) from exc
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
    return _require_dataset(db, project_id, dataset_id)


@router.get("/{dataset_id}/thumbnail")
def get_dataset_thumbnail(
    project_id: str,
    dataset_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    dataset = _require_dataset(db, project_id, dataset_id)
    image_path = _first_dataset_image(dataset)
    if image_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset thumbnail not found")
    return FileResponse(image_path)
