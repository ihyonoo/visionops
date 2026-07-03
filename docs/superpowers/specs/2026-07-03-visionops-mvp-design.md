# VisionOps MVP 설계서

작성일: 2026-07-03

## 요약

VisionOps는 Computer Vision 프로젝트를 관리하기 위한 로컬 우선(local-first) 웹 플랫폼이다. MVP는 Object Detection의 end-to-end 흐름에 집중한다. 사용자는 프로젝트를 만들고, 로컬 YOLO 데이터셋을 등록하고, 데이터셋을 검증하고, train/val split을 생성하고, YOLO 학습을 실행하고, 학습 상황을 실시간으로 확인하고, 학습 결과물을 검토한 뒤, 학습된 모델로 inference를 실행하고 결과를 시각화한다.

첫 구현 대상은 단일 사용자용 로컬 웹앱이다. 개발자 워크스테이션이나 GPU 서버 한 대에서 실행되는 형태를 기준으로 하며, 로그인, 팀 권한, 클라우드 스토리지, 멀티테넌시 격리는 MVP 범위에서 제외한다.

## 제품 범위

### MVP 포함 범위

- 프로젝트 생성, 목록, 상세 화면.
- 첫 번째 지원 태스크는 Object Detection.
- 로컬 폴더 경로 기반 YOLO format 데이터셋 등록.
- 기본 데이터셋 검증.
- 파일 복사 방식의 train/val split 생성.
- Ultralytics YOLO 모델 선택과 하이퍼파라미터 설정.
- 한 번에 하나의 active worker만 실행하는 training job queue.
- subprocess CLI 방식의 YOLO 학습 실행.
- 실시간 terminal log 조회.
- YOLO 학습 결과 기반 metric chart 조회.
- training run 목록과 상세 화면.
- best/last weights 모델 artifact 추적.
- 단일 이미지 inference.
- 폴더 단위 batch inference.
- bounding box overlay 기반 inference 결과 gallery.

### MVP 제외 범위

- 로그인, 팀 권한, 사용자 관리.
- SaaS 배포와 멀티테넌시.
- 클라우드 업로드와 클라우드 스토리지.
- 멀티 GPU 병렬 학습.
- COCO, Pascal VOC 등 다른 dataset importer.
- Classification과 Segmentation 구현.
- Annotation editor.
- AutoML과 hyperparameter search.
- 복잡한 pipeline builder.

## 사용자 흐름

1. 사용자가 `factory-defect-detection` 같은 프로젝트를 생성한다.
2. 사용자가 로컬 YOLO format 데이터셋 경로를 등록한다.
3. VisionOps가 데이터셋을 검증하고 image count, label count, class distribution, 오류를 보여준다.
4. 사용자가 ratio와 random seed를 입력해 train/val split을 생성한다.
5. VisionOps가 이미지와 라벨을 관리되는 split 디렉터리로 복사하고 YOLO `data.yaml`을 생성한다.
6. 사용자가 split, model preset, hyperparameter를 선택해 training job을 생성한다.
7. training job이 queue에 들어간다.
8. worker가 Ultralytics CLI로 queued job을 한 번에 하나씩 실행한다.
9. 학습 중 사용자는 status, metrics, terminal logs를 확인한다.
10. 학습 완료 후 사용자는 metrics, logs, plots, model artifacts를 검토한다.
11. 사용자가 model artifact를 선택하고 단일 이미지 또는 폴더에 inference를 실행한다.
12. 사용자가 bounding box overlay가 적용된 gallery에서 inference 결과를 확인한다.

## 아키텍처

MVP는 로컬에서 실행되는 3개 구성요소로 나눈다.

- Frontend: React 웹 UI.
- Backend API: FastAPI 서버.
- Worker: training/inference job을 실행하는 Python 프로세스.

Backend는 프로젝트 메타데이터, API route, local artifact path, job 상태를 관리한다. Worker는 오래 걸리는 training/inference 작업을 API 프로세스 밖에서 실행해서 웹 요청이 막히지 않게 한다.

## 기술 스택

- Backend: FastAPI.
- Frontend: React.
- Worker: Python.
- Database: SQLite.
- Training engine: Ultralytics YOLO.
- Training execution: subprocess CLI.
- Realtime updates: log streaming은 SSE, run status와 metrics는 polling.
- Storage: local filesystem artifact directory.

## 로컬 저장소 구조

VisionOps는 메타데이터는 SQLite에 저장하고, 큰 파일은 로컬 파일시스템에 저장한다.

```text
vision_ops_data/
  app.db
  projects/
    <project_id>/
      datasets/
        <dataset_id>/
          validation.json
          splits/
            <split_id>/
              images/
                train/
                val/
              labels/
                train/
                val/
              data.yaml
              split_manifest.json
      runs/
        train/
          <run_id>/
            config.json
            logs/
              stdout.log
            metrics/
              results.csv
              summary.json
            artifacts/
              weights/
              plots/
              samples/
        inference/
          <run_id>/
            config.json
            predictions.json
            outputs/
```

## 핵심 데이터 모델

### Project

Computer Vision 문제를 관리하는 최상위 workspace다.

필드:

- `id`
- `name`
- `description`
- `task_type`: 초기값은 `detection`
- `created_at`
- `updated_at`

### Dataset

프로젝트에 등록된 원본 데이터셋이다. `source_path`는 사용자의 로컬 데이터셋을 가리키며, 원본 데이터셋은 변경하지 않는다.

필드:

- `id`
- `project_id`
- `name`
- `source_path`
- `format`: 초기값은 `yolo`
- `class_names`
- `image_count`
- `label_count`
- `validation_status`
- `validation_summary`
- `created_at`

### DatasetSplit

특정 dataset에서 생성된 train/val split version이다.

필드:

- `id`
- `dataset_id`
- `name`
- `train_ratio`
- `val_ratio`
- `seed`
- `stratify`
- `train_count`
- `val_count`
- `split_path`
- `dataset_yaml_path`
- `created_at`

### TrainingRun

모델 학습 1회를 의미한다. 실험 비교의 기본 단위다.

필드:

- `id`
- `project_id`
- `dataset_id`
- `split_id`
- `name`
- `model_name`
- `trainer`: 초기값은 `ultralytics`
- `status`: `queued`, `running`, `completed`, `failed`, `cancelled`
- `config`
- `metrics_summary`
- `artifact_path`
- `log_path`
- `started_at`
- `finished_at`
- `created_at`

### Job

training과 inference 실행을 공통으로 다루는 queue item이다.

필드:

- `id`
- `type`: `training` 또는 `inference`
- `target_id`: training run id 또는 inference run id
- `status`
- `priority`
- `locked_at`
- `error_message`
- `created_at`
- `updated_at`

### ModelArtifact

학습 결과로 생성된 model file을 추적한다.

필드:

- `id`
- `training_run_id`
- `kind`: `best`, `last`, `exported`
- `path`
- `metrics_snapshot`
- `created_at`

### InferenceRun

특정 model artifact로 실행한 inference 1회를 의미한다.

필드:

- `id`
- `project_id`
- `model_artifact_id`
- `name`
- `input_type`: `single_image` 또는 `folder`
- `input_path`
- `status`
- `config`
- `output_path`
- `prediction_count`
- `created_at`
- `started_at`
- `finished_at`

### InferencePrediction

이미지별 prediction metadata다. Gallery filtering과 결과 조회를 위해 사용한다.

필드:

- `id`
- `inference_run_id`
- `image_path`
- `output_image_path`
- `prediction_json`
- `class_names`
- `max_confidence`

## 데이터셋 포맷과 검증

MVP는 YOLO detection dataset을 지원한다.

기본 source layout:

```text
dataset/
  images/
    img001.jpg
    img002.jpg
  labels/
    img001.txt
    img002.txt
  classes.txt
```

`data.yaml`이 있으면 class names를 읽는 데 사용한다.

Class name 우선순위:

1. `data.yaml`의 `names`
2. `classes.txt`
3. UI에서 사용자가 직접 입력한 class names

검증 항목:

- Dataset path 존재 여부.
- `images`와 `labels` 디렉터리 존재 여부.
- 지원 이미지 확장자: `jpg`, `jpeg`, `png`, `bmp`, `webp`.
- Image count와 label count.
- Image/label basename matching.
- 빈 label file은 negative image로 허용.
- Label line이 `class_id x_center y_center width height` 형식인지 확인.
- `class_id`가 class list 범위 안에 있는지 확인.
- Bounding box 값이 `0..1` 범위로 normalized 되어 있는지 확인.
- Bounding box width와 height가 0보다 큰지 확인.
- 깨진 이미지 파일 보고.
- Class distribution 요약.
- Unlabeled image count 보고.
- Matching image가 없는 label file 보고.

## Split 생성

MVP는 copy-based train/val split generation을 사용한다.

Split output layout:

```text
splits/
  <split_id>/
    images/
      train/
      val/
    labels/
      train/
      val/
    data.yaml
    split_manifest.json
```

Split 입력값:

- Split name.
- Train ratio.
- Val ratio.
- Random seed.
- Stratify on/off.

기본값:

- `train_ratio`: `0.8`
- `val_ratio`: `0.2`
- `seed`: `42`
- `stratify`: `false`

규칙:

- 원본 dataset file은 절대 변경하지 않는다.
- 이미지와 라벨을 managed split directory로 복사한다.
- 생성된 split은 독립적으로 학습 가능한 YOLO dataset이어야 한다.
- `data.yaml`은 split directory 기준의 상대 경로를 사용한다.
- `split_manifest.json`에는 source path, copied path, ratio, seed, class distribution, file list를 기록한다.

생성되는 `data.yaml` 예시:

```yaml
path: /absolute/path/to/splits/<split_id>
train: images/train
val: images/val
names:
  0: defect
  1: scratch
```

향후 버전에서는 `symlink`, `txt-list` split mode를 추가할 수 있다. MVP는 copy mode만 구현한다.

## 학습 실행

MVP에서는 Ultralytics YOLO만 구현하지만, 내부 구조는 trainer adapter 경계를 둔다.

개념적 trainer interface:

```python
class TrainerAdapter:
    def validate_config(self, config): ...
    def prepare(self, run, dataset_split): ...
    def train(self, run, on_log, on_metric): ...
    def collect_artifacts(self, run): ...
```

첫 구현체는 `UltralyticsTrainerAdapter`다.

학습은 Ultralytics CLI를 subprocess로 실행한다. 예시:

```bash
yolo detect train \
  model=yolo11n.pt \
  data=/absolute/path/to/data.yaml \
  epochs=100 \
  imgsz=640 \
  batch=16 \
  project=/absolute/path/to/runs/train \
  name=<run_id>
```

Worker 동작:

1. 가장 오래된 queued job을 가져온다.
2. job과 target run을 `running`으로 변경한다.
3. split의 `data.yaml`을 생성하거나 검증한다.
4. YOLO CLI subprocess를 실행한다.
5. stdout과 stderr를 `stdout.log`에 append한다.
6. SSE를 통해 log update를 노출한다.
7. `results.csv`를 읽어 metric update를 제공한다.
8. `best.pt`, `last.pt`, plots, summary를 artifact로 등록한다.
9. 결과에 따라 run을 `completed`, `failed`, `cancelled`로 변경한다.

MVP의 job queue는 여러 job을 받을 수 있지만, 실행은 한 번에 하나만 한다.

## 학습 모니터링

Training run detail 화면은 다음을 보여준다.

- 현재 status.
- Model name.
- Dataset과 split.
- Elapsed time.
- Best metric summary.
- Loss charts.
- mAP, precision, recall charts.
- Terminal log stream.
- Config snapshot.
- Artifact list.
- Failed run의 error summary.

Realtime 전략:

- Log는 run log file을 tailing해서 SSE로 stream한다.
- Status와 metrics는 1-2초 간격으로 polling한다.
- Metrics는 Ultralytics `results.csv`에서 읽는다.

## Inference 실행

Inference도 adapter 경계를 둔다.

책임:

- 선택된 model artifact load.
- 단일 이미지 또는 폴더 prediction 실행.
- Rendered output image 저장.
- Prediction JSON 저장.
- UI용 summary metadata 생성.

MVP 옵션:

- `input_type`: `single_image` 또는 `folder`
- `input_path`
- confidence threshold
- image size

Inference 결과는 inference run artifact directory에 저장하고 gallery로 보여준다.

## UI 구조

앱의 첫 화면은 Projects 화면이다. 별도의 marketing landing page는 만들지 않는다.

### Projects

- Project list.
- Create project.
- Project name, task type, recent run state, recent activity summary 표시.

### Project Detail

Project detail은 tab 구조를 사용한다.

- `Overview`
- `Datasets`
- `Training`
- `Inference`
- `Artifacts`

### Overview

- 최근 datasets.
- 최근 training runs.
- Best metric summary.
- 최근 inference runs.
- 주요 next-action buttons.

### Datasets

- Local dataset path 등록.
- Validation 실행.
- Validation summary 표시.
- Class distribution 표시.
- Split 생성.
- Split list 표시: counts, ratio, seed.

### Training

- Training run list.
- Status filter.
- Create training run.
- Model preset 선택.
- Dataset split 선택.
- 핵심 hyperparameter 설정.

초기 model preset:

- `yolo11n`
- `yolov8n`
- `yolov8s`

설치된 Ultralytics 버전이 특정 preset을 지원하지 않으면 UI에서 unavailable 상태로 표시한다.

핵심 hyperparameter:

- epochs
- batch
- image size
- learning rate
- patience
- device

### Training Run Detail

- Status header.
- Metric summary cards.
- Metric charts.
- Terminal log panel.
- Artifact browser.
- Config snapshot.
- Error summary.

### Inference

- Model artifact 선택.
- Input type 선택.
- Single image path 또는 folder path 입력.
- Confidence threshold와 image size 설정.
- Inference run list.

### Inference Run Detail

- Summary cards.
- Gallery.
- Class filter.
- Confidence threshold filter.
- Large image preview.
- Bounding box overlay.
- Prediction JSON viewer.

## UI 톤

VisionOps는 marketing website가 아니라 조용하고 밀도 있는 operations dashboard 스타일을 사용한다.

가이드라인:

- 첫 화면은 project work 화면이며 landing page가 아니다.
- Table, tabs, split panes, fixed-height panels를 중심으로 구성한다.
- 장식적인 hero section은 만들지 않는다.
- 절제된 색상과 명확한 status indicator를 사용한다.
- Logs, charts, galleries는 안정적인 크기를 유지한다.
- 핵심 action button은 명확하게 표시한다: `Register Dataset`, `Create Split`, `Start Training`, `Run Inference`.

## MVP 완료 기준

사용자가 아래 작업을 모두 할 수 있으면 MVP가 완료된 것으로 본다.

- Project 생성.
- Local YOLO dataset 등록.
- Dataset validation.
- Copy-based train/val split 생성.
- YOLO training job 시작.
- Live terminal log 확인.
- Metric chart 확인.
- 완료된 training artifact 확인.
- Best model artifact 선택.
- 단일 이미지 inference 실행.
- 폴더 inference 실행.
- Gallery에서 inference 결과 확인.

## Post-MVP 로드맵

### Dataset 개선

- COCO import.
- Pascal VOC import.
- YOLO export.
- Duplicate image detection.
- Class imbalance warning.
- Bounding box preview.
- Dataset version diff.
- Split mode 선택: copy, symlink, txt-list.

### Experiment 비교

- 여러 training run 선택.
- Metric chart overlay.
- Hyperparameter diff.
- Best artifact 비교.
- Sample prediction 비교.

### Classification

- Folder-per-class dataset 지원.
- Train/val split.
- Accuracy, F1, confusion matrix.
- Top-k prediction view.

### Segmentation

- YOLO segmentation 또는 COCO segmentation dataset 지원.
- Mask overlay gallery.
- mIoU와 Dice metrics.
- Polygon과 mask validation.

### 실행 고도화

- 안정적인 job cancellation.
- Job retry.
- Multiple workers.
- GPU selection.
- Resource monitoring.
- Scheduled jobs.

### Reporting

- Training report generation.
- Inference summary report.
- Dataset health report.
- HTML 또는 PDF export.

### Team/Server 확장

- Login.
- Project sharing.
- Permissions.
- Remote workers.
- PostgreSQL.
- Object storage.
- Docker deployment.
