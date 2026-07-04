from app.db import Base, engine
from app.models import Project
from app.services.storage import StoragePaths


def test_storage_paths_create_project_dirs(tmp_path):
    paths = StoragePaths(root=tmp_path)
    project_dir = paths.project_dir("project-1")

    assert project_dir.exists()
    assert (project_dir / "datasets").exists()
    assert (project_dir / "runs" / "train").exists()
    assert (project_dir / "runs" / "inference").exists()


def test_models_create_tables():
    Base.metadata.create_all(bind=engine)

    assert Project.__tablename__ == "projects"

