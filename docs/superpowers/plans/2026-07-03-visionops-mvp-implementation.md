# VisionOps MVP 구현 계획

> **Agent 작업자 필수 지침:** 이 계획을 구현할 때는 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`를 사용한다. 각 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 로컬 우선 VisionOps MVP를 구현한다. 프로젝트 관리, YOLO 데이터셋 검증, 복사 기반 train/val split, YOLO CLI 학습 queue, 실시간 로그/metric, model artifact, inference, 결과 gallery, light/dark theme을 포함한다.

**아키텍처:** monorepo 안에 FastAPI backend, Python worker, SQLite metadata, local filesystem artifact storage, React frontend를 둔다. Backend는 API와 metadata를 관리하고, worker는 subprocess adapter를 통해 training/inference job을 실행하며, frontend는 프로젝트 중심 dashboard UI를 제공한다.

**기술 스택:** Python 3.11+, FastAPI, SQLAlchemy 2.x, Pydantic, PyYAML, Pillow, pytest, React, TypeScript, Vite, TanStack Query, Recharts, Vitest.

---

## 범위 확인

설계서는 여러 하위 시스템을 포함하지만, 모두 하나의 end-to-end MVP workflow를 만들기 위한 구성요소다. 따라서 하나의 구현 계획으로 진행하되 task 경계를 명확히 나눈다.

- Task 1-4: backend foundation, project, dataset.
- Task 5-8: split, job queue, training, monitoring.
- Task 9-10: inference와 backend smoke 검증.
- Task 11-14: frontend shell, theme, project/dataset/training/inference UI.
- Task 15: end-to-end smoke flow와 README.

## 파일 구조

최종 구조는 아래를 기준으로 한다.

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
      api/
        client.ts
        types.ts
      theme/
        theme.ts
        ThemeProvider.tsx
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

경계 규칙:

- `backend/app/models.py`: DB table 정의만 둔다.
- `backend/app/schemas.py`: request/response schema만 둔다.
- `backend/app/services/*`: business logic을 둔다. FastAPI route decorator를 넣지 않는다.
- `backend/app/api/routes/*`: HTTP endpoint와 service 연결만 담당한다.
- `backend/app/worker.py`: 단일 worker loop와 job handler dispatch만 담당한다.
- `frontend/src/api/*`: frontend에서 API path를 아는 유일한 위치다.
- `frontend/src/theme/*`: light/dark/system theme 동작을 담당한다.

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

- [ ] **Step 1: 기본 파일 생성**

`.gitignore`:

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

`backend/pyproject.toml`:

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

`backend/app/main.py`:

```python
from fastapi import FastAPI

app = FastAPI(title="VisionOps API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

`backend/tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
```

`frontend/package.json`:

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

`frontend/src/App.tsx`:

```tsx
export default function App() {
  return <main className="app-shell">VisionOps</main>;
}
```

- [ ] **Step 2: 의존성 설치**

Run:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
cd ../frontend
npm install
```

Expected: Python/Node dependency 설치가 오류 없이 끝난다.

- [ ] **Step 3: scaffold 검증**

Run:

```bash
cd backend
. .venv/bin/activate
pytest -q
cd ../frontend
npm test
npm run build
```

Expected: backend test는 pass 또는 no tests collected 상태, frontend test/build는 pass.

- [ ] **Step 4: commit**

```bash
git add .gitignore README.md backend frontend
git commit -m "chore: scaffold VisionOps app"
```

---

### Task 2: Backend 설정, Storage, DB 모델

**Files:**
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/db.py`
- Create: `backend/app/models.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/storage.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_storage_and_db.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_storage_and_db.py`:

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
cd backend
. .venv/bin/activate
pytest tests/test_storage_and_db.py -q
```

Expected: `app.db`, `app.models`, `StoragePaths`가 없어서 FAIL.

- [ ] **Step 2: settings와 DB 구현**

`backend/app/core/config.py`:

```python
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./vision_ops_data/app.db"
    artifact_root: Path = Path("./vision_ops_data")

    model_config = SettingsConfigDict(env_prefix="VISIONOPS_")


settings = Settings()
```

`backend/app/db.py`:

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

- [ ] **Step 3: SQLAlchemy model 구현**

`backend/app/models.py`에는 설계서의 엔티티를 그대로 만든다.

필수 table:

- `Project`
- `Dataset`
- `DatasetSplit`
- `TrainingRun`
- `Job`
- `ModelArtifact`
- `InferenceRun`
- `InferencePrediction`

필수 규칙:

- id는 `String` primary key.
- `config`, `summary`, `class_names`, `prediction_json` 계열은 `JSON`.
- 시간 필드는 `DateTime(timezone=True)`.
- `Project.task_type` 기본값은 `detection`.
- `Dataset.format` 기본값은 `yolo`.
- `TrainingRun.trainer` 기본값은 `ultralytics`.
- run/job status 기본값은 `queued`.

- [ ] **Step 4: storage path 구현**

`backend/app/services/storage.py`:

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

- [ ] **Step 5: startup에서 table 생성**

`backend/app/main.py`:

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

- [ ] **Step 6: 검증**

Run:

```bash
cd backend
. .venv/bin/activate
pytest tests/test_storage_and_db.py -q
```

Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add backend/app backend/tests/test_storage_and_db.py
git commit -m "feat: add backend database and storage foundations"
```

---

### Task 3: Project CRUD API

**Files:**
- Create/Modify: `backend/app/schemas.py`
- Create: `backend/app/api/routes/projects.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_projects_api.py`

- [ ] **Step 1: 실패하는 API 테스트 작성**

`backend/tests/test_projects_api.py`:

```python
def test_create_list_and_get_project(client):
    created = client.post(
        "/api/projects",
        json={"name": "factory", "description": "defects"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "factory"
    assert body["description"] == "defects"
    assert body["task_type"] == "detection"

    listed = client.get("/api/projects")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == body["id"]

    fetched = client.get(f"/api/projects/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]
```

Run:

```bash
cd backend
. .venv/bin/activate
pytest tests/test_projects_api.py -q
```

Expected: `/api/projects` route가 없어서 FAIL.

- [ ] **Step 2: schema 구현**

`backend/app/schemas.py`에 `ProjectCreate`, `ProjectRead`를 만든다.

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

- [ ] **Step 3: route 구현**

`backend/app/api/routes/projects.py`:

- `router = APIRouter(prefix="/api/projects", tags=["projects"])`
- `POST /`
- `GET /`
- `GET /{project_id}`

구현 규칙:

- id는 `uuid.uuid4().hex`.
- 생성 직후 `StoragePaths(settings.artifact_root).project_dir(project.id)` 호출.
- 없는 project 조회는 404.

- [ ] **Step 4: route 등록**

`backend/app/main.py`:

```python
from app.api.routes import projects

app.include_router(projects.router)
```

- [ ] **Step 5: 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest tests/test_projects_api.py -q
git add backend/app backend/tests/test_projects_api.py
git commit -m "feat: add project CRUD API"
```

---

### Task 4: YOLO Dataset 등록과 검증

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/dataset_validation.py`
- Create: `backend/app/api/routes/datasets.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_dataset_validation.py`

- [ ] **Step 1: 실패하는 service 테스트 작성**

테스트 helper는 `Pillow`로 작은 이미지를 생성한다.

필수 테스트:

```python
def test_valid_yolo_dataset(tmp_path):
    dataset = make_yolo_dataset(tmp_path, names=["defect"])
    result = validate_yolo_dataset(dataset)
    assert result.status == "valid"
    assert result.image_count == 1
    assert result.label_count == 1
    assert result.class_names == ["defect"]


def test_dataset_requires_data_yaml(tmp_path):
    (tmp_path / "images").mkdir()
    (tmp_path / "labels").mkdir()
    result = validate_yolo_dataset(tmp_path)
    assert result.status == "invalid"
    assert "data.yaml" in result.errors[0]
```

Run:

```bash
cd backend
. .venv/bin/activate
pytest tests/test_dataset_validation.py -q
```

Expected: validation service가 없어서 FAIL.

- [ ] **Step 2: validation service 구현**

`backend/app/services/dataset_validation.py`:

- `ValidationResult` dataclass.
- `load_class_names(dataset_root: Path) -> list[str]`.
- `validate_yolo_label_line(line: str, class_count: int) -> str | None`.
- `validate_yolo_dataset(dataset_root: Path) -> ValidationResult`.

구현 규칙:

- `data.yaml` 필수.
- `data.yaml` 안의 `names` 필수.
- `names: ["a", "b"]`와 `names: {0: "a", 1: "b"}` 모두 허용.
- `images/`, `labels/` 필수.
- 이미지 확장자는 `jpg`, `jpeg`, `png`, `bmp`, `webp`.
- 빈 label file은 negative image로 허용.
- label file 누락은 warning.
- label row 형식 오류는 error.
- class id가 `names` 범위를 벗어나면 error.

- [ ] **Step 3: dataset API 구현**

Endpoints:

- `POST /api/projects/{project_id}/datasets`
- `GET /api/projects/{project_id}/datasets`
- `GET /api/projects/{project_id}/datasets/{dataset_id}`

Create body:

```json
{
  "name": "defects-v1",
  "source_path": "/absolute/path/to/dataset"
}
```

동작:

- 등록 즉시 validation 실행.
- validation summary를 DB에 저장.
- class names, image count, label count, validation status 저장.

- [ ] **Step 4: 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest tests/test_dataset_validation.py -q
git add backend/app backend/tests/test_dataset_validation.py
git commit -m "feat: add YOLO dataset validation"
```

---

### Task 5: 복사 기반 Train/Val Split

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/split.py`
- Create: `backend/app/api/routes/splits.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_split_service.py`

- [ ] **Step 1: 실패하는 split 테스트 작성**

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
    assert (split_root / "labels" / "train").exists()
    assert (split_root / "labels" / "val").exists()
    assert (split_root / "data.yaml").exists()
    assert (split_root / "split_manifest.json").exists()
    assert manifest["seed"] == 42
```

Run:

```bash
cd backend
. .venv/bin/activate
pytest tests/test_split_service.py -q
```

Expected: split service가 없어서 FAIL.

- [ ] **Step 2: split service 구현**

`backend/app/services/split.py`:

- source `data.yaml`을 읽는다.
- 이미지 목록을 수집한다.
- `random.Random(seed)`로 shuffle한다.
- `train_count = round(total * train_ratio)`.
- 나머지는 val로 둔다.
- 이미지와 matching label을 복사한다.
- label이 없는 negative image는 빈 label file을 생성한다.
- split `data.yaml`을 생성한다.
- `split_manifest.json`을 생성한다.

- [ ] **Step 3: split API 구현**

Endpoints:

- `POST /api/projects/{project_id}/datasets/{dataset_id}/splits`
- `GET /api/projects/{project_id}/datasets/{dataset_id}/splits`

Create body:

```json
{
  "name": "split-80-20",
  "train_ratio": 0.8,
  "val_ratio": 0.2,
  "seed": 42
}
```

규칙:

- ratio 합이 `1.0`이 아니면 400.
- dataset validation status가 `valid`가 아니면 400.
- split path와 `data.yaml` path를 `DatasetSplit`에 저장.

- [ ] **Step 4: 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest tests/test_split_service.py -q
git add backend/app backend/tests/test_split_service.py
git commit -m "feat: add copy based dataset splits"
```

---

### Task 6: Job Queue와 Worker Loop

**Files:**
- Create: `backend/app/services/jobs.py`
- Create: `backend/app/worker.py`
- Create: `backend/tests/test_jobs.py`

- [ ] **Step 1: 실패하는 queue 테스트 작성**

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
cd backend
. .venv/bin/activate
pytest tests/test_jobs.py -q
```

Expected: job service가 없어서 FAIL.

- [ ] **Step 2: job service 구현**

`backend/app/services/jobs.py`:

- `enqueue_job(db, job_type, target_id, priority=100)`
- `claim_next_job(db)`
- `complete_job(db, job, status="completed")`
- `fail_job(db, job, message)`

상태값:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

- [ ] **Step 3: worker loop 구현**

`backend/app/worker.py`:

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

- [ ] **Step 4: 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest tests/test_jobs.py -q
git add backend/app backend/tests/test_jobs.py
git commit -m "feat: add local job queue"
```

---

### Task 7: Training Run API와 Ultralytics CLI Adapter

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/training.py`
- Create: `backend/app/services/metrics.py`
- Create: `backend/app/api/routes/training.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_training_service.py`

- [ ] **Step 1: fake CLI 기반 실패 테스트 작성**

실제 GPU나 Ultralytics 설치 없이 테스트하기 위해 temp directory에 fake `yolo` executable을 만든다. fake executable은 `results.csv`, `weights/best.pt`, `weights/last.pt`를 생성한다.

핵심 assertion:

```python
def test_training_adapter_runs_cli_and_collects_artifacts(tmp_path):
    fake_yolo = make_fake_yolo(tmp_path)
    run_dir = tmp_path / "run"
    result = run_yolo_training(
        yolo_executable=str(fake_yolo),
        model_name="yolo11n.pt",
        data_yaml=tmp_path / "data.yaml",
        run_dir=run_dir,
        config={"epochs": 1, "imgsz": 640, "batch": 1, "learning_rate": 0.01, "patience": 10, "device": "cpu"},
    )
    assert result.exit_code == 0
    assert (run_dir / "logs" / "stdout.log").exists()
    assert (run_dir / "weights" / "best.pt").exists()
```

- [ ] **Step 2: training subprocess service 구현**

`backend/app/services/training.py`:

- `TrainingResult` dataclass.
- `build_yolo_train_command(...) -> list[str]`.
- `run_yolo_training(...) -> TrainingResult`.

CLI argument:

```bash
yolo detect train model=<model>.pt data=<data_yaml> epochs=<epochs> imgsz=<imgsz> batch=<batch> lr0=<learning_rate> patience=<patience> device=<device> project=<run_parent> name=<run_name> exist_ok=True
```

stdout/stderr는 `logs/stdout.log`에 append한다.

- [ ] **Step 3: metrics parser 구현**

`backend/app/services/metrics.py`:

- `read_results_csv(path: Path) -> list[dict]`
- `summarize_metrics(rows: list[dict]) -> dict`

summary에는 가능한 경우 아래 값을 넣는다.

- last epoch
- best mAP50
- best precision
- best recall

- [ ] **Step 4: training API 구현**

Endpoints:

- `POST /api/projects/{project_id}/training-runs`
- `GET /api/projects/{project_id}/training-runs`
- `GET /api/projects/{project_id}/training-runs/{run_id}`

Create body:

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

동작:

- `TrainingRun`을 `queued`로 생성.
- `Job`을 type `training`으로 생성.
- 생성된 run 반환.

- [ ] **Step 5: worker training handler 연결**

`backend/app/worker.py`:

- job type이 `training`이면 `TrainingRun`, `DatasetSplit`을 load.
- run을 `running`으로 변경.
- `run_yolo_training` 실행.
- metrics summary parse.
- `best.pt`, `last.pt`를 `ModelArtifact`로 등록.
- 성공 시 `completed`, 실패 시 `failed`.

- [ ] **Step 6: 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest tests/test_training_service.py -q
git add backend/app backend/tests/test_training_service.py
git commit -m "feat: add queued YOLO training"
```

---

### Task 8: Training Logs, Metrics, Artifacts API

**Files:**
- Create: `backend/app/services/logs.py`
- Modify: `backend/app/api/routes/training.py`
- Create: `backend/tests/test_training_logs_metrics.py`

- [ ] **Step 1: 실패하는 log service 테스트 작성**

```python
def test_tail_log_reads_last_lines(tmp_path):
    path = tmp_path / "stdout.log"
    path.write_text("a\nb\nc\n", encoding="utf-8")
    assert tail_log(path, max_lines=2) == ["b", "c"]
```

- [ ] **Step 2: log service 구현**

`backend/app/services/logs.py`:

- `tail_log(path: Path, max_lines: int = 200) -> list[str]`
- `stream_log(path: Path, poll_seconds: float = 0.5)` SSE generator

- [ ] **Step 3: monitoring endpoint 구현**

Training router에 추가:

- `GET /api/projects/{project_id}/training-runs/{run_id}/logs?tail=200`
- `GET /api/projects/{project_id}/training-runs/{run_id}/logs/stream`
- `GET /api/projects/{project_id}/training-runs/{run_id}/metrics`
- `GET /api/projects/{project_id}/training-runs/{run_id}/artifacts`

SSE endpoint는 `text/event-stream`을 반환한다.

- [ ] **Step 4: 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest tests/test_training_logs_metrics.py -q
git add backend/app backend/tests/test_training_logs_metrics.py
git commit -m "feat: add training monitoring APIs"
```

---

### Task 9: Inference Adapter와 Inference API

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/services/inference.py`
- Create: `backend/app/api/routes/inference.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_inference_service.py`

- [ ] **Step 1: fake CLI 기반 실패 테스트 작성**

fake `yolo detect predict` executable로 output image와 label output을 생성한다.

핵심 assertion:

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

- [ ] **Step 2: inference subprocess service 구현**

`backend/app/services/inference.py`:

- `InferenceResult` dataclass.
- `build_yolo_predict_command(...) -> list[str]`.
- `run_yolo_inference(...) -> InferenceResult`.

CLI shape:

```bash
yolo detect predict model=<best.pt> source=<input_path> conf=<conf> imgsz=<imgsz> project=<parent> name=<run_id> save=True save_txt=True save_conf=True exist_ok=True
```

- [ ] **Step 3: inference API 구현**

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

- [ ] **Step 4: worker inference handler 연결**

Worker 동작:

- job type이 `inference`이면 `InferenceRun`, `ModelArtifact`를 load.
- inference run을 `running`으로 변경.
- `run_yolo_inference` 실행.
- output directory에서 rendered image scan.
- `predictions.json` 작성.
- `InferencePrediction` row 저장.
- 성공 시 `completed`, 실패 시 `failed`.

- [ ] **Step 5: 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest tests/test_inference_service.py -q
git add backend/app backend/tests/test_inference_service.py
git commit -m "feat: add queued YOLO inference"
```

---

### Task 10: Backend Route 등록과 Smoke Test

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_api_smoke.py`

- [ ] **Step 1: smoke test 작성**

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

- [ ] **Step 2: 모든 router 등록**

`backend/app/main.py`:

```python
from app.api.routes import datasets, inference, projects, splits, training

app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(splits.router)
app.include_router(training.router)
app.include_router(inference.router)
```

- [ ] **Step 3: backend 전체 검증과 commit**

```bash
cd backend
. .venv/bin/activate
pytest -q
git add backend/app/main.py backend/tests/test_api_smoke.py
git commit -m "test: add backend API smoke coverage"
```

---

### Task 11: Frontend Shell, API Client, Theme

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/theme/theme.ts`
- Create: `frontend/src/theme/ThemeProvider.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/tests/theme.test.tsx`

- [ ] **Step 1: 실패하는 theme test 작성**

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

- [ ] **Step 2: theme logic 구현**

`frontend/src/theme/theme.ts`:

```ts
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  return prefersDark ? "dark" : "light";
}
```

`ThemeProvider` 요구사항:

- `visionops-theme` local storage 값을 읽는다.
- 기본값은 `system`.
- `document.documentElement`에 `data-theme="light"` 또는 `data-theme="dark"`를 적용한다.
- `light`, `dark`, `system` segmented control을 제공한다.

- [ ] **Step 3: API client 구현**

`frontend/src/api/client.ts`:

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

- [ ] **Step 4: theme CSS token 작성**

`frontend/src/styles.css`:

- `:root[data-theme="light"]`
- `:root[data-theme="dark"]`
- background, surface, border, text, muted text, accent, danger, success, warning token

- [ ] **Step 5: 검증과 commit**

```bash
cd frontend
npm test
npm run build
git add frontend
git commit -m "feat: add frontend shell and theme support"
```

---

### Task 12: Frontend Projects, Datasets, Splits UI

**Files:**
- Create: `frontend/src/pages/ProjectsPage.tsx`
- Create: `frontend/src/pages/ProjectDetailPage.tsx`
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/StatusBadge.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: API type 정의**

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

- [ ] **Step 2: ProjectsPage 구현**

포함 기능:

- project table.
- create project form.
- row click으로 project detail 진입.
- TanStack Query로 `GET /api/projects`.
- mutation으로 `POST /api/projects`.

- [ ] **Step 3: ProjectDetailPage 구현**

Tab:

- `Overview`
- `Datasets`
- `Training`
- `Inference`
- `Artifacts`

Datasets tab:

- dataset path 등록.
- validation summary 표시.
- split 생성 form.
- split list.

- [ ] **Step 4: 검증과 commit**

```bash
cd frontend
npm run build
git add frontend/src
git commit -m "feat: add project dataset and split UI"
```

---

### Task 13: Frontend Training UI와 Live Monitoring

**Files:**
- Create: `frontend/src/pages/TrainingRunPage.tsx`
- Create: `frontend/src/components/MetricChart.tsx`
- Create: `frontend/src/components/LogViewer.tsx`
- Modify: `frontend/src/pages/ProjectDetailPage.tsx`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: training type 정의**

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

- [ ] **Step 2: Training tab 구현**

포함 기능:

- training run table.
- status filter.
- create training run form.
- model preset select: `yolo11n`, `yolov8n`, `yolov8s`.
- hyperparameter input: epochs, batch, image size, learning rate, patience, device.

- [ ] **Step 3: TrainingRunPage 구현**

화면 구성:

- status/model/elapsed time header.
- metric summary cards.
- losses chart.
- mAP/precision/recall chart.
- SSE `/logs/stream` 기반 `LogViewer`.
- artifact list.
- config snapshot.

- [ ] **Step 4: 검증과 commit**

```bash
cd frontend
npm run build
git add frontend/src
git commit -m "feat: add training dashboard UI"
```

---

### Task 14: Frontend Inference UI와 Gallery

**Files:**
- Create: `frontend/src/pages/InferenceRunPage.tsx`
- Modify: `frontend/src/pages/ProjectDetailPage.tsx`
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: inference type 정의**

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

- [ ] **Step 2: Inference tab 구현**

포함 기능:

- model artifact select.
- input type segmented control.
- input path field.
- confidence threshold input.
- image size input.
- inference run table.

- [ ] **Step 3: InferenceRunPage 구현**

화면 구성:

- summary cards.
- class filter.
- confidence filter.
- gallery grid.
- large preview panel.
- prediction JSON viewer.

- [ ] **Step 4: 검증과 commit**

```bash
cd frontend
npm run build
git add frontend/src
git commit -m "feat: add inference gallery UI"
```

---

### Task 15: End-to-End Smoke Flow와 문서

**Files:**
- Modify: `README.md`
- Create: `backend/tests/test_end_to_end_smoke.py`
- Modify: `docs/superpowers/specs/2026-07-03-visionops-mvp-design.md` only if implementation decision changed.

- [ ] **Step 1: backend smoke test 작성**

실제 GPU 없이 fake training/inference executable로 아래 흐름을 검증한다.

1. Project 생성.
2. `data.yaml`이 있는 temp YOLO dataset 등록.
3. Split 생성.
4. Training run 생성.
5. fake YOLO train으로 worker handler 1회 실행.
6. Model artifact 존재 확인.
7. Inference run 생성.
8. fake YOLO predict로 worker handler 1회 실행.
9. Inference run completed 확인.

- [ ] **Step 2: README 작성**

Backend 실행:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Worker 실행:

```bash
cd backend
. .venv/bin/activate
python -m app.worker
```

Frontend 실행:

```bash
cd frontend
npm install
npm run dev
```

README에 명시할 내용:

- dataset root에는 `data.yaml`이 있어야 한다.
- MVP split mode는 copy 방식이다.
- 실제 training/inference에는 YOLO CLI가 필요하다.
- frontend 기본 URL은 Vite가 출력하는 local URL이다.

- [ ] **Step 3: 전체 검증**

Run:

```bash
cd backend
. .venv/bin/activate
pytest -q
cd ../frontend
npm test
npm run build
```

Expected: backend tests, frontend tests, frontend build 모두 PASS.

- [ ] **Step 4: commit**

```bash
git add README.md backend/tests/test_end_to_end_smoke.py docs/superpowers/specs/2026-07-03-visionops-mvp-design.md
git commit -m "docs: add VisionOps MVP runbook"
```

---

## Self-Review

Spec coverage:

- 로컬 우선 웹앱: Task 1, 2, 11.
- FastAPI + React + Python worker: Task 1, 6, 11.
- SQLite와 local artifacts: Task 2.
- Project 관리: Task 3, 12.
- `data.yaml` 필수 YOLO dataset: Task 4.
- Copy-based split: Task 5.
- 한 번에 하나만 실행하는 job queue: Task 6.
- Ultralytics CLI subprocess training: Task 7.
- Live terminal log와 metrics: Task 8, 13.
- Artifacts: Task 7, 13.
- 단일 이미지/folder inference: Task 9, 14.
- Gallery: Task 14.
- Light/dark/system theme: Task 11.
- End-to-end smoke 검증: Task 15.

구현 선택:

- MVP는 Alembic migration 대신 `Base.metadata.create_all`을 사용한다. Alembic은 team/server 확장 단계에서 도입한다.
- Status/metrics는 polling, log는 SSE를 사용한다.
- 테스트에서는 fake YOLO executable을 사용해 GPU, network, 실제 Ultralytics 실행 없이 검증한다.
