# VisionOps MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the VisionOps local-first MVP: project management, YOLO dataset validation, copy-based train/val split, queued YOLO CLI training, live logs/metrics, model artifacts, inference, gallery results, and light/dark theme.

**Architecture:** Use a monorepo with a FastAPI backend, a Python worker, SQLite metadata, local filesystem artifacts, and a React frontend. The backend owns API routes and metadata; the worker executes training/inference jobs through subprocess adapters; the frontend provides dashboard-style project, dataset, training, and inference screens.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.x, Pydantic, PyYAML, Pillow, pytest, React, TypeScript, Vite, TanStack Query, Recharts, Vitest, Playwright.

---

## Scope Check

The spec covers several subsystems, but they are one vertical MVP workflow rather than independent products. This plan keeps them in one implementation plan while preserving task boundaries:

- Tasks 1-4 establish backend project/dataset foundations.
- Tasks 5-8 establish job execution, training, logs, and artifacts.
- Tasks 9-10 establish inference.
- Tasks 11-14 establish frontend, theme, and user flows.
- Task 15 performs end-to-end verification and docs cleanup.

## File Structure

Create this structure:

```text
vision_ops/
  backend/
    pyproject.toml
    app/
      __init__.py
      main.py
      db.py
      models.py
      schemas.py
      core/
        __init__.py
        config.py
      api/
        __init__.py
        routes/
          __init__.py
          projects.py
          datasets.py
          splits.py
          training.py
          inference.py
      services/
        __init__.py
        storage.py
        dataset_validation.py
        split.py
        jobs.py
        training.py
        metrics.py
        inference.py
        logs.py
      worker.py
    tests/
      conftest.py
      test_projects_api.py
      test_dataset_validation.py
      test_split_service.py
      test_jobs.py
      test_training_service.py
      test_inference_service.py
  frontend/
    package.json
    index.html
    vite.config.ts
    tsconfig.json
    src/
      main.tsx
      App.tsx
      api/client.ts
      api/types.ts
      theme/theme.ts
      theme/ThemeProvider.tsx
      components/
        Layout.tsx
        StatusBadge.tsx
        MetricChart.tsx
        LogViewer.tsx
      pages/
        ProjectsPage.tsx
        ProjectDetailPage.tsx
        TrainingRunPage.tsx
        InferenceRunPage.tsx
      styles.css
    tests/
      theme.test.tsx
  .gitignore
  README.md
```

Boundary rules:

- `backend/app/models.py` contains DB tables only.
- `backend/app/schemas.py` contains request/response models only.
- `backend/app/services/*` contains business logic with no FastAPI route decorators.
- `backend/app/api/routes/*` maps HTTP calls to services.
- `backend/app/worker.py` is the single-worker job loop.
- `frontend/src/api/*` is the only frontend code that knows API paths.
- `frontend/src/theme/*` owns light/dark/system behavior.

---

### Task 1: Repository Scaffold

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/conftest.py`
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`

- [ ] **Step 1: Create scaffold files**

Create `.gitignore`:

```gitignore
.DS_Store
__pycache__/
.pytest_cache/
.ruff_cache/
.venv/
dist/
node_modules/
coverage/
vision_ops_data/
*.db
*.log
```

Create `backend/pyproject.toml`:

```toml
[project]
name = "visionops-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.30.0",
  "sqlalchemy>=2.0.30",
  "pydantic>=2.8.0",
  "pydantic-settings>=2.4.0",
  "pyyaml>=6.0.0",
  "pillow>=10.4.0",
  "pandas>=2.2.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.2.0",
  "httpx>=0.27.0",
  "ruff>=0.5.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.ruff]
line-length = 100
target-version = "py311"
```

Create `backend/app/main.py`:

```python
from fastapi import FastAPI

app = FastAPI(title="VisionOps API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

Create `backend/tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
```

Create `frontend/package.json`:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc && vite build",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.50.0",
    "recharts": "^2.12.7",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0",
    "jsdom": "^24.1.0"
  }
}
```

Create `frontend/src/App.tsx`:

```tsx
export default function App() {
  return <main className="app-shell">VisionOps</main>;
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
cd ../frontend && npm install
```

Expected: Python and Node dependencies install without errors.

- [ ] **Step 3: Verify scaffold**

Run:

```bash
cd backend && . .venv/bin/activate && pytest -q
cd ../frontend && npm test && npm run build
```

Expected: Backend tests pass or report no tests collected; frontend test/build passes after minimal files are complete.

- [ ] **Step 4: Commit**

```bash
git add .gitignore README.md backend frontend
git commit -m "chore: scaffold VisionOps app"
```

---

### Task 2: Backend Settings, Storage, and Database Models

**Files:**
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/db.py`
- Create: `backend/app/models.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/storage.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_storage_and_db.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_storage_and_db.py`:

```python
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
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_storage_and_db.py -q
```

Expected: FAIL because `app.db`, `app.models`, and `StoragePaths` do not exist.

- [ ] **Step 2: Implement settings and DB**

Create `backend/app/core/config.py`:

```python
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./vision_ops_data/app.db"
    artifact_root: Path = Path("./vision_ops_data")

    model_config = SettingsConfigDict(env_prefix="VISIONOPS_")


settings = Settings()
```

Create `backend/app/db.py`:

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

Create `backend/app/models.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    task_type: Mapped[str] = mapped_column(String, default="detection", nullable=False)


class Dataset(TimestampMixin, Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    format: Mapped[str] = mapped_column(String, default="yolo", nullable=False)
    class_names: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    image_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    label_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    validation_status: Mapped[str] = mapped_column(String, default="unknown", nullable=False)
    validation_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class DatasetSplit(TimestampMixin, Base):
    __tablename__ = "dataset_splits"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    train_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    val_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    train_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    val_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    split_path: Mapped[str] = mapped_column(Text, nullable=False)
    dataset_yaml_path: Mapped[str] = mapped_column(Text, nullable=False)


class TrainingRun(TimestampMixin, Base):
    __tablename__ = "training_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), nullable=False)
    split_id: Mapped[str] = mapped_column(ForeignKey("dataset_splits.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    model_name: Mapped[str] = mapped_column(String, nullable=False)
    trainer: Mapped[str] = mapped_column(String, default="ultralytics", nullable=False)
    status: Mapped[str] = mapped_column(String, default="queued", nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    metrics_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    artifact_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    log_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    target_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="queued", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class ModelArtifact(TimestampMixin, Base):
    __tablename__ = "model_artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    training_run_id: Mapped[str] = mapped_column(ForeignKey("training_runs.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    metrics_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class InferenceRun(TimestampMixin, Base):
    __tablename__ = "inference_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False)
    model_artifact_id: Mapped[str] = mapped_column(ForeignKey("model_artifacts.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    input_type: Mapped[str] = mapped_column(String, nullable=False)
    input_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, default="queued", nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    output_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    prediction_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class InferencePrediction(TimestampMixin, Base):
    __tablename__ = "inference_predictions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    inference_run_id: Mapped[str] = mapped_column(ForeignKey("inference_runs.id"), nullable=False)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    output_image_path: Mapped[str] = mapped_column(Text, nullable=False)
    prediction_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    class_names: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    max_confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
```

- [ ] **Step 3: Implement storage paths**

Create `backend/app/services/storage.py`:

```python
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class StoragePaths:
    root: Path

    def ensure_root(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        return self.root

    def project_dir(self, project_id: str) -> Path:
        path = self.ensure_root() / "projects" / project_id
        (path / "datasets").mkdir(parents=True, exist_ok=True)
        (path / "runs" / "train").mkdir(parents=True, exist_ok=True)
        (path / "runs" / "inference").mkdir(parents=True, exist_ok=True)
        return path

    def dataset_dir(self, project_id: str, dataset_id: str) -> Path:
        path = self.project_dir(project_id) / "datasets" / dataset_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def split_dir(self, project_id: str, dataset_id: str, split_id: str) -> Path:
        path = self.dataset_dir(project_id, dataset_id) / "splits" / split_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def train_run_dir(self, project_id: str, run_id: str) -> Path:
        path = self.project_dir(project_id) / "runs" / "train" / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def inference_run_dir(self, project_id: str, run_id: str) -> Path:
        path = self.project_dir(project_id) / "runs" / "inference" / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path
```

- [ ] **Step 4: Initialize tables on startup**

Modify `backend/app/main.py`:

```python
from fastapi import FastAPI

from app.db import Base, engine

app = FastAPI(title="VisionOps API")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 5: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_storage_and_db.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/test_storage_and_db.py
git commit -m "feat: add backend database and storage foundations"
```

---

### Task 3: Project CRUD API

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/api/routes/projects.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write failing API tests**

Create tests for:

- `POST /api/projects` creates a project.
- `GET /api/projects` lists projects.
- `GET /api/projects/{project_id}` returns one project.

Use this assertion shape:

```python
def test_create_and_get_project(client):
    created = client.post("/api/projects", json={"name": "factory", "description": "defects"})
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "factory"
    assert body["task_type"] == "detection"

    fetched = client.get(f"/api/projects/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_projects_api.py -q
```

Expected: FAIL with 404 for `/api/projects`.

- [ ] **Step 2: Implement schemas**

Create `ProjectCreate` and `ProjectRead` in `backend/app/schemas.py`:

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectRead(BaseModel):
    id: str
    name: str
    description: str
    task_type: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 3: Implement route**

Create `backend/app/api/routes/projects.py` with:

- `router = APIRouter(prefix="/api/projects", tags=["projects"])`
- `create_project`
- `list_projects`
- `get_project`

Use `uuid.uuid4().hex` for ids and `StoragePaths(settings.artifact_root).project_dir(project.id)` after insert.

- [ ] **Step 4: Register route**

Modify `backend/app/main.py` to include:

```python
from app.api.routes import projects

app.include_router(projects.router)
```

- [ ] **Step 5: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_projects_api.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/test_projects_api.py
git commit -m "feat: add project CRUD API"
```

---

### Task 4: YOLO Dataset Registration and Validation

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/dataset_validation.py`
- Create: `backend/app/api/routes/datasets.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_dataset_validation.py`

- [ ] **Step 1: Write failing service tests**

Create a temporary YOLO dataset:

```text
dataset/
  data.yaml
  images/a.jpg
  labels/a.txt
```

Test:

```python
def test_valid_yolo_dataset(tmp_path):
    dataset = make_yolo_dataset(tmp_path, names=["defect"])
    result = validate_yolo_dataset(dataset)
    assert result.status == "valid"
    assert result.image_count == 1
    assert result.label_count == 1
    assert result.class_names == ["defect"]
```

Also test missing `data.yaml`:

```python
def test_dataset_requires_data_yaml(tmp_path):
    (tmp_path / "images").mkdir()
    (tmp_path / "labels").mkdir()
    result = validate_yolo_dataset(tmp_path)
    assert result.status == "invalid"
    assert "data.yaml" in result.errors[0]
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_dataset_validation.py -q
```

Expected: FAIL because validation service does not exist.

- [ ] **Step 2: Implement validation service**

Create `backend/app/services/dataset_validation.py` with:

- `ValidationResult` dataclass.
- `load_class_names(dataset_root: Path) -> list[str]`.
- `validate_yolo_label_line(line: str, class_count: int) -> str | None`.
- `validate_yolo_dataset(dataset_root: Path) -> ValidationResult`.

Implementation requirements:

- Require `data.yaml`.
- Require `names`.
- Accept `names: ["a", "b"]` and `names: {0: "a", 1: "b"}`.
- Require `images/` and `labels/`.
- Count image files with `jpg`, `jpeg`, `png`, `bmp`, `webp`.
- Allow empty labels.
- Report missing label files as warnings, not errors.
- Report malformed label rows as errors.
- Report class ids outside `names` range as errors.

- [ ] **Step 3: Add dataset API**

Create endpoints:

- `POST /api/projects/{project_id}/datasets`
- `GET /api/projects/{project_id}/datasets`
- `GET /api/projects/{project_id}/datasets/{dataset_id}`

Request body:

```json
{
  "name": "defects-v1",
  "source_path": "/absolute/path/to/dataset"
}
```

Behavior:

- Validate immediately.
- Store validation summary in DB.
- Store class names, image count, label count, validation status.

- [ ] **Step 4: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_dataset_validation.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_dataset_validation.py
git commit -m "feat: add YOLO dataset validation"
```

---

### Task 5: Copy-Based Train/Val Split

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/split.py`
- Create: `backend/app/api/routes/splits.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_split_service.py`

- [ ] **Step 1: Write failing split tests**

Test that a 4-image dataset with seed `42` creates this structure:

```text
split/
  images/train/
  images/val/
  labels/train/
  labels/val/
  data.yaml
  split_manifest.json
```

Assertion:

```python
def test_create_copy_split(tmp_path):
    dataset_root = make_yolo_dataset(tmp_path / "source", image_count=4, names=["defect"])
    split_root = tmp_path / "split"
    manifest = create_copy_split(
        dataset_root=dataset_root,
        split_root=split_root,
        train_ratio=0.75,
        val_ratio=0.25,
        seed=42,
    )
    assert len(list((split_root / "images" / "train").glob("*.jpg"))) == 3
    assert len(list((split_root / "images" / "val").glob("*.jpg"))) == 1
    assert (split_root / "data.yaml").exists()
    assert (split_root / "split_manifest.json").exists()
    assert manifest["seed"] == 42
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_split_service.py -q
```

Expected: FAIL because split service does not exist.

- [ ] **Step 2: Implement split service**

Create `backend/app/services/split.py`:

- Load source `data.yaml`.
- Collect images.
- Shuffle with `random.Random(seed)`.
- Compute `train_count = round(total * train_ratio)` and put the remainder in val.
- Copy images and matching labels.
- Create empty label files for unlabeled negative images.
- Write split `data.yaml` with `path`, `train: images/train`, `val: images/val`, and copied `names`.
- Write `split_manifest.json`.

- [ ] **Step 3: Add split API**

Create endpoints:

- `POST /api/projects/{project_id}/datasets/{dataset_id}/splits`
- `GET /api/projects/{project_id}/datasets/{dataset_id}/splits`

Request body:

```json
{
  "name": "split-80-20",
  "train_ratio": 0.8,
  "val_ratio": 0.2,
  "seed": 42
}
```

Behavior:

- Reject if ratios do not sum to `1.0`.
- Reject if dataset validation status is not `valid`.
- Store counts and paths in `DatasetSplit`.

- [ ] **Step 4: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_split_service.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_split_service.py
git commit -m "feat: add copy based dataset splits"
```

---

### Task 6: Job Queue and Worker Loop

**Files:**
- Modify: `backend/app/services/jobs.py`
- Create: `backend/app/worker.py`
- Create: `backend/tests/test_jobs.py`

- [ ] **Step 1: Write failing tests**

Test:

```python
def test_queue_claims_oldest_job(db_session):
    first = enqueue_job(db_session, job_type="training", target_id="run-1")
    second = enqueue_job(db_session, job_type="training", target_id="run-2")
    claimed = claim_next_job(db_session)
    assert claimed.id == first.id
    assert claimed.status == "running"
    assert second.status == "queued"
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_jobs.py -q
```

Expected: FAIL because job service does not exist.

- [ ] **Step 2: Implement job service**

Create `backend/app/services/jobs.py`:

- `enqueue_job(db, job_type, target_id, priority=100)`.
- `claim_next_job(db)`.
- `complete_job(db, job, status="completed")`.
- `fail_job(db, job, message)`.

Use `queued`, `running`, `completed`, `failed`, and `cancelled`.

- [ ] **Step 3: Implement worker loop**

Create `backend/app/worker.py`:

```python
import time

from app.db import SessionLocal
from app.models import Job
from app.services.jobs import claim_next_job, fail_job


def process_job(db, job: Job) -> None:
    fail_job(db, job, f"No handler registered for job type: {job.type}")


def run_worker(poll_seconds: float = 1.0) -> None:
    while True:
        with SessionLocal() as db:
            job = claim_next_job(db)
            if job is None:
                time.sleep(poll_seconds)
                continue
            process_job(db, job)
```

- [ ] **Step 4: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_jobs.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_jobs.py
git commit -m "feat: add local job queue"
```

---

### Task 7: Training Run API and Ultralytics CLI Adapter

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/training.py`
- Create: `backend/app/services/metrics.py`
- Create: `backend/app/api/routes/training.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_training_service.py`

- [ ] **Step 1: Write failing adapter test with fake CLI**

Create a fake executable script in a temp directory that writes `results.csv`, `weights/best.pt`, and `weights/last.pt`.

Expected test shape:

```python
def test_training_adapter_runs_cli_and_collects_artifacts(tmp_path):
    fake_yolo = make_fake_yolo(tmp_path)
    run_dir = tmp_path / "run"
    result = run_yolo_training(
        yolo_executable=str(fake_yolo),
        model_name="yolo11n.pt",
        data_yaml=tmp_path / "data.yaml",
        run_dir=run_dir,
        config={"epochs": 1, "imgsz": 640, "batch": 1, "lr0": 0.01, "device": "cpu"},
    )
    assert result.exit_code == 0
    assert (run_dir / "logs" / "stdout.log").exists()
    assert (run_dir / "weights" / "best.pt").exists()
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_training_service.py -q
```

Expected: FAIL because training service does not exist.

- [ ] **Step 2: Implement training subprocess service**

Create `backend/app/services/training.py`:

- `TrainingResult` dataclass.
- `build_yolo_train_command(...) -> list[str]`.
- `run_yolo_training(...) -> TrainingResult`.
- Use `subprocess.Popen`.
- Stream stdout/stderr to `logs/stdout.log`.
- Set CLI args:
  - `detect`
  - `train`
  - `model=<model>.pt`
  - `data=<data_yaml>`
  - `epochs=<epochs>`
  - `imgsz=<imgsz>`
  - `batch=<batch>`
  - `lr0=<learning_rate>`
  - `patience=<patience>`
  - `device=<device>`
  - `project=<run_parent>`
  - `name=<run_name>`
  - `exist_ok=True`

- [ ] **Step 3: Implement metrics parser**

Create `backend/app/services/metrics.py`:

- `read_results_csv(path: Path) -> list[dict]`.
- `summarize_metrics(rows: list[dict]) -> dict`.
- Summary includes last epoch, best mAP50 if available, best precision if available, best recall if available.

- [ ] **Step 4: Add training API**

Endpoints:

- `POST /api/projects/{project_id}/training-runs`
- `GET /api/projects/{project_id}/training-runs`
- `GET /api/projects/{project_id}/training-runs/{run_id}`

Training create body:

```json
{
  "name": "baseline-yolo11n",
  "split_id": "split-id",
  "model_name": "yolo11n",
  "config": {
    "epochs": 100,
    "batch": 16,
    "imgsz": 640,
    "learning_rate": 0.01,
    "patience": 50,
    "device": "cpu"
  }
}
```

Behavior:

- Create `TrainingRun` with status `queued`.
- Create `Job` with type `training`.
- Return the created run.

- [ ] **Step 5: Wire worker training handler**

Modify `backend/app/worker.py`:

- If job type is `training`, load `TrainingRun`, `DatasetSplit`, and run directory.
- Mark run `running`.
- Execute `run_yolo_training`.
- Parse metrics.
- Register `ModelArtifact` records for `best.pt` and `last.pt`.
- Mark run `completed` or `failed`.

- [ ] **Step 6: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_training_service.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests/test_training_service.py
git commit -m "feat: add queued YOLO training"
```

---

### Task 8: Training Logs, Metrics, and Artifacts API

**Files:**
- Create: `backend/app/services/logs.py`
- Modify: `backend/app/api/routes/training.py`
- Create: `backend/tests/test_training_logs_metrics.py`

- [ ] **Step 1: Write failing tests**

Test:

```python
def test_tail_log_reads_last_lines(tmp_path):
    path = tmp_path / "stdout.log"
    path.write_text("a\nb\nc\n", encoding="utf-8")
    assert tail_log(path, max_lines=2) == ["b", "c"]
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_training_logs_metrics.py -q
```

Expected: FAIL because `tail_log` does not exist.

- [ ] **Step 2: Implement log service**

Create `backend/app/services/logs.py`:

- `tail_log(path: Path, max_lines: int = 200) -> list[str]`.
- `stream_log(path: Path, poll_seconds: float = 0.5)` generator for SSE.

- [ ] **Step 3: Add API endpoints**

Add to training router:

- `GET /api/projects/{project_id}/training-runs/{run_id}/logs?tail=200`
- `GET /api/projects/{project_id}/training-runs/{run_id}/logs/stream`
- `GET /api/projects/{project_id}/training-runs/{run_id}/metrics`
- `GET /api/projects/{project_id}/training-runs/{run_id}/artifacts`

SSE endpoint returns `text/event-stream`.

- [ ] **Step 4: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_training_logs_metrics.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_training_logs_metrics.py
git commit -m "feat: add training monitoring APIs"
```

---

### Task 9: Inference Adapter and Inference API

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/inference.py`
- Create: `backend/app/api/routes/inference.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_inference_service.py`

- [ ] **Step 1: Write failing inference service test**

Use a fake YOLO executable that creates output images and a JSON file.

Test:

```python
def test_inference_adapter_creates_outputs(tmp_path):
    fake_yolo = make_fake_yolo_predict(tmp_path)
    output_dir = tmp_path / "outputs"
    result = run_yolo_inference(
        yolo_executable=str(fake_yolo),
        model_path=tmp_path / "best.pt",
        input_path=tmp_path / "images",
        output_dir=output_dir,
        config={"conf": 0.25, "imgsz": 640},
    )
    assert result.exit_code == 0
    assert output_dir.exists()
```

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_inference_service.py -q
```

Expected: FAIL because inference service does not exist.

- [ ] **Step 2: Implement inference subprocess service**

Create `backend/app/services/inference.py`:

- `InferenceResult` dataclass.
- `build_yolo_predict_command(...) -> list[str]`.
- `run_yolo_inference(...) -> InferenceResult`.
- CLI command shape:

```bash
yolo detect predict model=<best.pt> source=<input_path> conf=<conf> imgsz=<imgsz> project=<parent> name=<run_id> save=True save_txt=True save_conf=True exist_ok=True
```

- [ ] **Step 3: Add inference API**

Endpoints:

- `POST /api/projects/{project_id}/inference-runs`
- `GET /api/projects/{project_id}/inference-runs`
- `GET /api/projects/{project_id}/inference-runs/{run_id}`
- `GET /api/projects/{project_id}/inference-runs/{run_id}/predictions`

Create body:

```json
{
  "name": "batch-test",
  "model_artifact_id": "artifact-id",
  "input_type": "folder",
  "input_path": "/absolute/path/to/images",
  "config": {
    "conf": 0.25,
    "imgsz": 640
  }
}
```

- [ ] **Step 4: Wire worker inference handler**

Modify worker:

- If job type is `inference`, load `InferenceRun` and `ModelArtifact`.
- Mark inference run `running`.
- Execute `run_yolo_inference`.
- Scan output directory for rendered images.
- Write `predictions.json`.
- Store `InferencePrediction` rows.
- Mark inference run `completed` or `failed`.

- [ ] **Step 5: Verify**

Run:

```bash
cd backend && . .venv/bin/activate && pytest tests/test_inference_service.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/test_inference_service.py
git commit -m "feat: add queued YOLO inference"
```

---

### Task 10: Backend Route Registration and API Smoke Tests

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_api_smoke.py`

- [ ] **Step 1: Write smoke tests**

Test:

```python
def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_includes_core_routes(client):
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/api/projects" in paths
```

- [ ] **Step 2: Register all routers**

Modify `backend/app/main.py` to include:

```python
from app.api.routes import datasets, inference, projects, splits, training

app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(splits.router)
app.include_router(training.router)
app.include_router(inference.router)
```

- [ ] **Step 3: Verify backend suite**

Run:

```bash
cd backend && . .venv/bin/activate && pytest -q
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py backend/tests/test_api_smoke.py
git commit -m "test: add backend API smoke coverage"
```

---

### Task 11: Frontend Shell, API Client, and Theme

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/theme/theme.ts`
- Create: `frontend/src/theme/ThemeProvider.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/tests/theme.test.tsx`

- [ ] **Step 1: Write failing theme test**

Create test:

```tsx
import { describe, expect, it } from "vitest";
import { resolveTheme } from "../src/theme/theme";

describe("resolveTheme", () => {
  it("returns explicit light or dark", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("uses system preference for system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
```

Run:

```bash
cd frontend && npm test
```

Expected: FAIL because theme module does not exist.

- [ ] **Step 2: Implement theme**

Create `frontend/src/theme/theme.ts`:

```ts
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  return prefersDark ? "dark" : "light";
}
```

Create `ThemeProvider` that:

- Reads `visionops-theme` from local storage.
- Defaults to `system`.
- Applies `data-theme="light"` or `data-theme="dark"` to `document.documentElement`.
- Renders a compact segmented control for `light`, `dark`, `system`.

- [ ] **Step 3: Implement API client**

Create `frontend/src/api/client.ts`:

```ts
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
```

- [ ] **Step 4: Style light and dark tokens**

In `frontend/src/styles.css`, define:

- `:root[data-theme="light"]`
- `:root[data-theme="dark"]`
- background, surface, border, text, muted text, accent, danger, success, warning.

- [ ] **Step 5: Verify**

Run:

```bash
cd frontend && npm test && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat: add frontend shell and theme support"
```

---

### Task 12: Frontend Projects, Datasets, and Splits

**Files:**
- Create: `frontend/src/pages/ProjectsPage.tsx`
- Create: `frontend/src/pages/ProjectDetailPage.tsx`
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/StatusBadge.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Define API types**

Add TypeScript types:

```ts
export type Project = {
  id: string;
  name: string;
  description: string;
  task_type: "detection";
  created_at: string;
  updated_at: string;
};

export type Dataset = {
  id: string;
  project_id: string;
  name: string;
  source_path: string;
  validation_status: "valid" | "invalid";
  image_count: number;
  label_count: number;
  class_names: string[];
};
```

- [ ] **Step 2: Implement ProjectsPage**

Create:

- Project table.
- Create project form.
- Row click opens project detail.

Use TanStack Query for `GET /api/projects` and mutation for `POST /api/projects`.

- [ ] **Step 3: Implement ProjectDetailPage**

Implement tabs:

- `Overview`
- `Datasets`
- `Training`
- `Inference`
- `Artifacts`

Datasets tab supports:

- Dataset path registration.
- Validation summary display.
- Split creation form.
- Split list.

- [ ] **Step 4: Verify frontend**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat: add project dataset and split UI"
```

---

### Task 13: Frontend Training UI and Live Monitoring

**Files:**
- Create: `frontend/src/pages/TrainingRunPage.tsx`
- Create: `frontend/src/components/MetricChart.tsx`
- Create: `frontend/src/components/LogViewer.tsx`
- Modify: `frontend/src/pages/ProjectDetailPage.tsx`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add training types**

Add:

```ts
export type TrainingRun = {
  id: string;
  project_id: string;
  dataset_id: string;
  split_id: string;
  name: string;
  model_name: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  config: Record<string, unknown>;
  metrics_summary: Record<string, unknown> | null;
  artifact_path: string | null;
  log_path: string | null;
  created_at: string;
};
```

- [ ] **Step 2: Implement training tab**

Training tab supports:

- Training run table.
- Status filter.
- Create training run form.
- Model preset select: `yolo11n`, `yolov8n`, `yolov8s`.
- Hyperparameter inputs: epochs, batch, image size, learning rate, patience, device.

- [ ] **Step 3: Implement TrainingRunPage**

Page sections:

- Header with status, model, elapsed time.
- Metric summary cards.
- `MetricChart` for losses and mAP/precision/recall.
- `LogViewer` connected to SSE `/logs/stream`, with fallback tail fetch.
- Artifact list.
- Config snapshot.

- [ ] **Step 4: Verify frontend**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat: add training dashboard UI"
```

---

### Task 14: Frontend Inference UI and Gallery

**Files:**
- Create: `frontend/src/pages/InferenceRunPage.tsx`
- Modify: `frontend/src/pages/ProjectDetailPage.tsx`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add inference types**

Add:

```ts
export type InferenceRun = {
  id: string;
  project_id: string;
  model_artifact_id: string;
  name: string;
  input_type: "single_image" | "folder";
  input_path: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  config: Record<string, unknown>;
  output_path: string | null;
  prediction_count: number;
};

export type InferencePrediction = {
  id: string;
  inference_run_id: string;
  image_path: string;
  output_image_path: string;
  prediction_json: Record<string, unknown>;
  class_names: string[];
  max_confidence: number;
};
```

- [ ] **Step 2: Implement inference tab**

Inference tab supports:

- Model artifact selection.
- Input type segmented control.
- Input path field.
- Confidence threshold input.
- Image size input.
- Inference run table.

- [ ] **Step 3: Implement InferenceRunPage**

Page sections:

- Summary cards.
- Class filter.
- Confidence filter.
- Gallery grid.
- Large preview panel.
- Prediction JSON viewer.

- [ ] **Step 4: Verify frontend**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat: add inference gallery UI"
```

---

### Task 15: End-to-End Smoke Flow and Documentation

**Files:**
- Modify: `README.md`
- Create: `backend/tests/test_end_to_end_smoke.py`
- Modify: `docs/superpowers/specs/2026-07-03-visionops-mvp-design.md` only if implementation decisions changed.

- [ ] **Step 1: Add backend smoke test**

Test a no-real-GPU smoke flow with fake training/inference executables:

1. Create project.
2. Register temp YOLO dataset with `data.yaml`.
3. Create split.
4. Create training run.
5. Run worker handler once with fake YOLO train.
6. Assert model artifact exists.
7. Create inference run.
8. Run worker handler once with fake YOLO predict.
9. Assert inference run completed.

- [ ] **Step 2: Add README commands**

Document:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

```bash
cd backend
. .venv/bin/activate
python -m app.worker
```

```bash
cd frontend
npm install
npm run dev
```

Include:

- Dataset root must contain `data.yaml`.
- MVP split mode is copy.
- YOLO CLI must be available for real training.
- Default frontend URL is Vite's printed local URL.

- [ ] **Step 3: Run full verification**

Run:

```bash
cd backend && . .venv/bin/activate && pytest -q
cd ../frontend && npm test && npm run build
```

Expected: all tests and frontend build pass.

- [ ] **Step 4: Commit**

```bash
git add README.md backend/tests/test_end_to_end_smoke.py docs/superpowers/specs/2026-07-03-visionops-mvp-design.md
git commit -m "docs: add VisionOps MVP runbook"
```

---

## Self-Review

Spec coverage:

- Local-first web app: Tasks 1, 2, 11.
- FastAPI + React + Python worker: Tasks 1, 6, 11.
- SQLite and local artifacts: Task 2.
- Project management: Task 3 and Task 12.
- YOLO dataset with required `data.yaml`: Task 4.
- Copy-based split: Task 5.
- Job queue with one active worker: Task 6.
- Ultralytics CLI subprocess training: Task 7.
- Live terminal log and metrics: Task 8 and Task 13.
- Artifacts: Task 7 and Task 13.
- Inference single image/folder: Task 9 and Task 14.
- Gallery: Task 14.
- Light/dark/system theme: Task 11.
- End-to-end verification: Task 15.

Known implementation choices:

- MVP uses `Base.metadata.create_all` instead of Alembic migrations. This is acceptable for the local-first MVP; Alembic belongs in the team/server expansion phase.
- MVP uses polling for status/metrics and SSE only for logs.
- MVP uses fake YOLO executables in tests so tests do not require GPU, network, or real Ultralytics execution.
