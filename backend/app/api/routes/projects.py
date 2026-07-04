import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import Project
from app.schemas import ProjectCreate, ProjectRead
from app.services.storage import StoragePaths

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Annotated[Session, Depends(get_db)]) -> Project:
    project = Project(
        id=uuid.uuid4().hex,
        name=payload.name,
        description=payload.description,
        task_type="detection",
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
