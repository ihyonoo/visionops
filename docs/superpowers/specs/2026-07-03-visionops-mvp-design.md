# VisionOps MVP Design

Date: 2026-07-03

## Summary

VisionOps is a local-first web platform for managing computer vision projects. The MVP focuses on an end-to-end Object Detection workflow: project creation, local YOLO dataset registration, dataset validation, train/val split generation, YOLO training, live monitoring, artifact review, model inference, and result visualization.

The first implementation target is a single-user local web app. It runs on a developer workstation or one GPU server without login, team permissions, cloud storage, or multi-tenant isolation.

## Product Scope

### MVP Includes

- Project creation, listing, and project detail pages.
- Object Detection as the first supported computer vision task.
- Local folder path registration for YOLO-format datasets.
- Basic dataset validation.
- Train/val split generation by copying files into a managed split directory.
- Ultralytics YOLO model selection and hyperparameter configuration.
- Training job queue with one active worker at a time.
- YOLO training through subprocess CLI execution.
- Live terminal log viewing.
- Metric chart viewing from YOLO training outputs.
- Training run list and detail pages.
- Model artifact tracking for best and last weights.
- Single-image and folder-based inference.
- Inference result gallery with bounding box overlays.

### MVP Excludes

- Login, team permissions, and user management.
- SaaS deployment and multi-tenancy.
- Cloud upload/storage.
- Multi-GPU parallel training.
- COCO, Pascal VOC, and other dataset importers.
- Classification and Segmentation implementation.
- Annotation editing.
- AutoML and hyperparameter search.
- Complex pipeline builders.

## User Flow

1. The user creates a project, such as `factory-defect-detection`.
2. The user registers a local YOLO-format dataset path.
3. VisionOps validates the dataset and shows image count, label count, class distribution, and errors.
4. The user creates a train/val split with a ratio and random seed.
5. VisionOps copies images and labels into a managed split directory and generates a YOLO `data.yaml`.
6. The user creates a training job by selecting a split, model preset, and hyperparameters.
7. The training job enters a queue.
8. The worker runs one queued job at a time through the Ultralytics CLI.
9. During training, the user sees status, metrics, and terminal logs.
10. After training, the user reviews metrics, logs, plots, and model artifacts.
11. The user selects a model artifact and runs inference on a single image or folder.
12. The user views inference results in a gallery with bounding box overlays.

## Architecture

The MVP uses a three-part local architecture:

- Frontend: React web UI.
- Backend API: FastAPI server.
- Worker: Python process for training and inference jobs.

The backend owns project metadata, API routes, local artifact paths, and job state. The worker executes queued training and inference jobs outside the API process so long-running work does not block web requests.

## Technology Stack

- Backend: FastAPI.
- Frontend: React.
- Worker: Python.
- Database: SQLite.
- Training engine: Ultralytics YOLO.
- Training execution: subprocess CLI.
- Realtime updates: SSE for log streaming, polling for run status and metrics.
- Storage: local filesystem artifact directory.

## Local Storage Layout

VisionOps stores metadata in SQLite and large files on disk.

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

## Core Data Model

### Project

Top-level workspace for a computer vision problem.

Fields:

- `id`
- `name`
- `description`
- `task_type`, initially `detection`
- `created_at`
- `updated_at`

### Dataset

Registered source dataset. The source path points to the user's local dataset and is not modified.

Fields:

- `id`
- `project_id`
- `name`
- `source_path`
- `format`, initially `yolo`
- `class_names`
- `image_count`
- `label_count`
- `validation_status`
- `validation_summary`
- `created_at`

### DatasetSplit

Versioned train/val split generated from a dataset.

Fields:

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

One model training experiment.

Fields:

- `id`
- `project_id`
- `dataset_id`
- `split_id`
- `name`
- `model_name`
- `trainer`, initially `ultralytics`
- `status`: `queued`, `running`, `completed`, `failed`, or `cancelled`
- `config`
- `metrics_summary`
- `artifact_path`
- `log_path`
- `started_at`
- `finished_at`
- `created_at`

### Job

Common execution queue item for training and inference.

Fields:

- `id`
- `type`: `training` or `inference`
- `target_id`
- `status`
- `priority`
- `locked_at`
- `error_message`
- `created_at`
- `updated_at`

### ModelArtifact

Tracked model file produced by training.

Fields:

- `id`
- `training_run_id`
- `kind`: `best`, `last`, or `exported`
- `path`
- `metrics_snapshot`
- `created_at`

### InferenceRun

One inference execution against one trained model artifact.

Fields:

- `id`
- `project_id`
- `model_artifact_id`
- `name`
- `input_type`: `single_image` or `folder`
- `input_path`
- `status`
- `config`
- `output_path`
- `prediction_count`
- `created_at`
- `started_at`
- `finished_at`

### InferencePrediction

Per-image prediction metadata for filtering and gallery display.

Fields:

- `id`
- `inference_run_id`
- `image_path`
- `output_image_path`
- `prediction_json`
- `class_names`
- `max_confidence`

## Dataset Format and Validation

The MVP supports YOLO detection datasets.

Primary source layout:

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

The app reads `data.yaml` when present to infer class names.

Class name priority:

1. `data.yaml` `names`
2. `classes.txt`
3. User-entered class names in the UI

Validation checks:

- Dataset path exists.
- `images` and `labels` directories exist.
- Supported image extensions: `jpg`, `jpeg`, `png`, `bmp`, `webp`.
- Image count and label count.
- Image/label basename matching.
- Empty labels are allowed as negative images.
- Label lines match `class_id x_center y_center width height`.
- `class_id` is within class list range.
- Bounding box values are normalized in the `0..1` range.
- Bounding box width and height are greater than zero.
- Corrupt images are reported.
- Class distribution is summarized.
- Unlabeled image count is reported.
- Label files without matching images are reported.

## Split Generation

The MVP uses copy-based train/val split generation.

The split output layout is:

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

Split inputs:

- Split name.
- Train ratio.
- Val ratio.
- Random seed.
- Stratify on/off.

Default values:

- `train_ratio`: `0.8`
- `val_ratio`: `0.2`
- `seed`: `42`
- `stratify`: `false`

Rules:

- Source dataset files are never modified.
- Images and labels are copied into the managed split directory.
- The generated split is independent and reproducible.
- `data.yaml` uses paths relative to the split directory.
- `split_manifest.json` records source paths, copied paths, ratio, seed, class distribution, and file lists.

Generated `data.yaml` example:

```yaml
path: /absolute/path/to/splits/<split_id>
train: images/train
val: images/val
names:
  0: defect
  1: scratch
```

Future versions can add `symlink` and `txt-list` split modes. The MVP only implements copy mode.

## Training Execution

The MVP uses an adapter boundary even though only Ultralytics YOLO is implemented first.

Conceptual trainer interface:

```python
class TrainerAdapter:
    def validate_config(self, config): ...
    def prepare(self, run, dataset_split): ...
    def train(self, run, on_log, on_metric): ...
    def collect_artifacts(self, run): ...
```

The first implementation is `UltralyticsTrainerAdapter`.

Training is executed through the Ultralytics CLI as a subprocess. Example:

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

Worker behavior:

1. Acquire the oldest queued job.
2. Mark the job and target run as `running`.
3. Generate or verify the split `data.yaml`.
4. Execute the YOLO CLI subprocess.
5. Append stdout and stderr to `stdout.log`.
6. Expose log updates through SSE.
7. Read `results.csv` for metric updates.
8. Register `best.pt`, `last.pt`, plots, and summaries as artifacts.
9. Mark the run as `completed`, `failed`, or `cancelled`.

The MVP job queue accepts multiple jobs but runs only one at a time.

## Training Monitoring

The training run detail page shows:

- Current status.
- Model name.
- Dataset and split.
- Elapsed time.
- Best metric summary.
- Loss charts.
- mAP, precision, and recall charts.
- Terminal log stream.
- Config snapshot.
- Artifact list.
- Error summary for failed runs.

Realtime strategy:

- Logs stream through SSE by tailing the run log file.
- Status and metrics are polled every 1 to 2 seconds.
- Metrics are read from Ultralytics `results.csv`.

## Inference Execution

Inference uses a separate adapter boundary.

Responsibilities:

- Load selected model artifact.
- Execute prediction for a single image or a folder.
- Save rendered output images.
- Save prediction JSON.
- Create summary metadata for the UI.

MVP options:

- `input_type`: `single_image` or `folder`
- `input_path`
- confidence threshold
- image size

Inference results are stored under the inference run artifact directory and shown as a gallery.

## UI Structure

The app opens directly to the Projects screen.

### Projects

- Project list.
- Create project.
- Project name, task type, recent run state, and recent activity summary.

### Project Detail

Project detail uses tabs:

- `Overview`
- `Datasets`
- `Training`
- `Inference`
- `Artifacts`

### Overview

- Recent datasets.
- Recent training runs.
- Best metric summary.
- Recent inference runs.
- Primary next-action buttons.

### Datasets

- Register local dataset path.
- Run validation.
- Show validation summary.
- Show class distribution.
- Create split.
- List splits with counts, ratio, and seed.

### Training

- List training runs.
- Filter by status.
- Create training run.
- Select model preset.
- Select dataset split.
- Configure core hyperparameters.

Initial model presets are `yolo11n`, `yolov8n`, and `yolov8s`. If an installed Ultralytics version does not support one preset, the UI marks it unavailable.

Core hyperparameters:

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

- Select model artifact.
- Select input type.
- Enter single image path or folder path.
- Configure confidence threshold and image size.
- List inference runs.

### Inference Run Detail

- Summary cards.
- Gallery.
- Class filter.
- Confidence threshold filter.
- Large image preview.
- Bounding box overlay.
- Prediction JSON viewer.

## UI Tone

VisionOps uses a quiet, dense operations dashboard style rather than a marketing website style.

Guidelines:

- First screen is project work, not a landing page.
- Use tables, tabs, split panes, and fixed-height panels.
- Avoid decorative hero sections.
- Use restrained colors and clear status indicators.
- Keep logs, charts, and galleries stable in size.
- Use explicit action buttons: `Register Dataset`, `Create Split`, `Start Training`, `Run Inference`.

## MVP Completion Criteria

The MVP is complete when a user can:

- Create a project.
- Register a local YOLO dataset.
- Validate the dataset.
- Create a copy-based train/val split.
- Start a YOLO training job.
- Watch live terminal logs.
- Watch metric charts.
- View completed training artifacts.
- Select the best model artifact.
- Run inference on a single image.
- Run inference on a folder.
- View inference results in a gallery.

## Post-MVP Roadmap

### Dataset Improvements

- COCO import.
- Pascal VOC import.
- YOLO export.
- Duplicate image detection.
- Class imbalance warnings.
- Bounding box preview.
- Dataset version diff.
- Split mode selection: copy, symlink, txt-list.

### Experiment Comparison

- Select multiple training runs.
- Overlay metric charts.
- Show hyperparameter diffs.
- Compare best artifacts.
- Compare sample predictions.

### Classification

- Folder-per-class dataset support.
- Train/val split.
- Accuracy, F1, and confusion matrix.
- Top-k prediction view.

### Segmentation

- YOLO segmentation or COCO segmentation dataset support.
- Mask overlay gallery.
- mIoU and Dice metrics.
- Polygon and mask validation.

### Execution Improvements

- Stable job cancellation.
- Job retry.
- Multiple workers.
- GPU selection.
- Resource monitoring.
- Scheduled jobs.

### Reporting

- Training report generation.
- Inference summary report.
- Dataset health report.
- HTML or PDF export.

### Team and Server Expansion

- Login.
- Project sharing.
- Permissions.
- Remote workers.
- PostgreSQL.
- Object storage.
- Docker deployment.
