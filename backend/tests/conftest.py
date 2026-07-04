import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="visionops-tests-"))
settings.artifact_root = _TEST_ROOT / "artifacts"
settings.database_url = f"sqlite:///{_TEST_ROOT / 'app.db'}"

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def reset_database(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "artifact_root", tmp_path / "artifacts")
    engine.dispose()
    settings.artifact_root.mkdir(parents=True, exist_ok=True)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
