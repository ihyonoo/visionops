from collections.abc import Generator
import json
import os
from pathlib import Path
import re

from PIL import Image, ImageChops
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Dataset,
    InferencePrediction,
    InferenceRun,
    Job,
    ModelArtifact,
    Project,
    TrainingRun,
)
from app.services.inference import build_yolo_predict_command, run_yolo_inference
from app.worker import handle_inference_job


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def make_fake_yolo_predict(tmp_path: Path, exit_code: int = 0, nested: bool = False) -> Path:
    executable = tmp_path / "bin" / "yolo"
    executable.parent.mkdir(parents=True, exist_ok=True)
    rendered_image = "sub/image1.jpg" if nested else "image1.jpg"
    label_file = "labels/sub/image1.txt" if nested else "labels/image1.txt"
    executable.write_text(
        f"""#!/usr/bin/env python3
import sys
from pathlib import Path

args = dict(arg.split("=", 1) for arg in sys.argv[3:] if "=" in arg)
run_dir = Path(args["project"]) / args["name"]
run_dir.mkdir(parents=True, exist_ok=True)
if {exit_code} == 0:
    (run_dir / "{rendered_image}").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / "{label_file}").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / "{rendered_image}").write_text("rendered", encoding="utf-8")
    (run_dir / "{label_file}").write_text("0 0.5 0.5 0.2 0.3 0.91\\n", encoding="utf-8")
print("fake inference")
sys.exit({exit_code})
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return executable


def make_absolute_project_yolo_predict(tmp_path: Path) -> Path:
    executable = tmp_path / "bin" / "yolo"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        """#!/usr/bin/env python3
import sys
from pathlib import Path

args = dict(arg.split("=", 1) for arg in sys.argv[3:] if "=" in arg)
project = Path(args["project"])
if not project.is_absolute():
    print(f"project path is not absolute: {project}")
    sys.exit(9)
run_dir = project / args["name"]
run_dir.mkdir(parents=True, exist_ok=True)
(run_dir / "image1.jpg").write_text("rendered", encoding="utf-8")
(run_dir / "labels").mkdir(parents=True, exist_ok=True)
(run_dir / "labels" / "image1.txt").write_text(
    "0 0.5 0.5 0.2 0.3 0.91\\n",
    encoding="utf-8",
)
print("absolute project inference")
sys.exit(0)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return executable


def make_fake_yolo_predict_without_detections(tmp_path: Path) -> Path:
    executable = tmp_path / "bin" / "yolo"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        """#!/usr/bin/env python3
import sys
from pathlib import Path

args = dict(arg.split("=", 1) for arg in sys.argv[3:] if "=" in arg)
run_dir = Path(args["project"]) / args["name"]
run_dir.mkdir(parents=True, exist_ok=True)
print("fake inference without detections")
sys.exit(0)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return executable


def make_fake_yolo_predict_with_plain_output(tmp_path: Path) -> Path:
    executable = tmp_path / "bin" / "yolo"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        """#!/usr/bin/env python3
import shutil
import sys
from pathlib import Path

args = dict(arg.split("=", 1) for arg in sys.argv[3:] if "=" in arg)
source = Path(args["source"])
input_image = next(path for path in source.iterdir() if path.suffix.lower() == ".jpg")
run_dir = Path(args["project"]) / args["name"]
run_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(input_image, run_dir / input_image.name)
(run_dir / "labels").mkdir(parents=True, exist_ok=True)
(run_dir / "labels" / f"{input_image.stem}.txt").write_text(
    "0 0.5 0.5 0.5 0.5 0.91\\n",
    encoding="utf-8",
)
print("plain yolo output")
sys.exit(0)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return executable


def _create_project_training_artifact(db, tmp_path: Path, project_id: str = "project-1"):
    project = Project(id=project_id, name="라인 A", description="", task_type="detection")
    dataset = Dataset(
        id=f"dataset-{project_id}",
        project_id=project.id,
        name="dataset",
        source_path=str(tmp_path / "dataset"),
        format="yolo",
        class_names=["scratch"],
        image_count=1,
        label_count=1,
        validation_status="valid",
        validation_summary={},
    )
    training_run = TrainingRun(
        id=f"training-{project_id}",
        project_id=project.id,
        dataset_id=dataset.id,
        split_id="split-1",
        name="baseline",
        model_name="yolov8n",
        trainer="ultralytics",
        status="completed",
        config={},
        metrics_summary={},
    )
    model_path = tmp_path / f"{project_id}-best.pt"
    model_path.write_text("weights", encoding="utf-8")
    artifact = ModelArtifact(
        id=f"artifact-{project_id}",
        training_run_id=training_run.id,
        kind="best",
        path=str(model_path),
        metrics_snapshot={},
    )
    db.add_all([project, dataset, training_run, artifact])
    db.commit()
    return project, dataset, training_run, artifact


def test_inference_adapter_creates_outputs(tmp_path):
    fake_yolo = make_fake_yolo_predict(tmp_path)
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    output_dir = tmp_path / "outputs"

    result = run_yolo_inference(
        yolo_executable=str(fake_yolo),
        model_path=tmp_path / "best.pt",
        input_path=input_dir,
        output_dir=output_dir,
        config={"conf": 0.25, "imgsz": 640},
    )

    assert result.exit_code == 0
    assert output_dir.exists()
    assert (output_dir / "labels" / "image1.txt").exists()
    assert "fake inference" in result.stdout_log_path.read_text(encoding="utf-8")


def test_build_yolo_predict_command_matches_ultralytics_cli_shape(tmp_path):
    command = build_yolo_predict_command(
        yolo_executable="custom-yolo",
        model_path=tmp_path / "best.pt",
        input_path=tmp_path / "images",
        output_dir=tmp_path / "runs" / "predict-1",
        config={"conf": 0.25, "imgsz": 640},
    )

    assert command == [
        "custom-yolo",
        "detect",
        "predict",
        f"model={tmp_path / 'best.pt'}",
        f"source={tmp_path / 'images'}",
        "conf=0.25",
        "imgsz=640",
        f"project={tmp_path / 'runs'}",
        "name=predict-1",
        "save=True",
        "save_txt=True",
        "save_conf=True",
        "exist_ok=True",
    ]


def test_build_yolo_classification_predict_command(tmp_path):
    from app.services.inference import build_yolo_predict_command

    command = build_yolo_predict_command(
        task_type="classification",
        model_path=tmp_path / "best.pt",
        input_path=tmp_path / "images",
        output_dir=tmp_path / "runs" / "predict",
        config={"conf": 0.25, "imgsz": 224},
    )

    assert command[:3] == ["yolo", "classify", "predict"]
    assert f"model={tmp_path / 'best.pt'}" in command
    assert f"source={tmp_path / 'images'}" in command


def test_classification_prediction_payload_from_probabilities():
    from app.services.inference import classification_prediction_payload

    payload = classification_prediction_payload(
        image_path=Path("/tmp/image.jpg"),
        names={0: "ng", 1: "ok", 2: "hold"},
        indices=[1, 0, 2],
        confidences=[0.9, 0.08, 0.02],
    )

    assert payload == {
        "image_path": "/tmp/image.jpg",
        "ranking": [
            {"class_id": 1, "class_name": "ok", "confidence": 0.9},
            {"class_id": 0, "class_name": "ng", "confidence": 0.08},
            {"class_id": 2, "class_name": "hold", "confidence": 0.02},
        ],
    }


def test_post_inference_run_creates_queued_run_and_job(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    input_dir = tmp_path / "images"
    input_dir.mkdir()

    response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "batch-test",
            "model_artifact_id": artifact.id,
            "input_type": "folder",
            "input_path": str(input_dir),
            "config": {"conf": 0.25, "imgsz": 640},
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert re.fullmatch(r"inf_[2-9a-z]{10}", body["id"])
    assert body["project_id"] == project.id
    assert body["model_artifact_id"] == artifact.id
    assert body["status"] == "queued"
    assert body["config"]["conf"] == 0.25

    run = db.get(InferenceRun, body["id"])
    assert run is not None
    job = db.scalar(select(Job).where(Job.type == "inference", Job.target_id == run.id))
    assert job is not None
    assert re.fullmatch(r"job_[2-9a-z]{10}", job.id)
    assert job.status == "queued"


def test_upload_inference_folder_creates_managed_input_and_queued_job(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)

    response = client.post(
        f"/api/projects/{project.id}/inference-runs/upload",
        data={
            "name": "uploaded-folder",
            "model_artifact_id": artifact.id,
            "input_type": "folder",
            "conf": "0.35",
            "imgsz": "512",
        },
        files=[
            ("inputs", ("images/nested/part-a.jpg", b"image-a", "image/jpeg")),
            ("inputs", ("images/part-b.png", b"image-b", "image/png")),
        ],
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "uploaded-folder"
    assert body["input_type"] == "folder"
    assert body["config"] == {
        "conf": 0.35,
        "imgsz": 512,
        "input_image_count": 2,
        "uploaded_folder_name": "images",
    }
    input_path = Path(body["input_path"])
    assert input_path.is_dir()
    assert (input_path / "nested" / "part-a.jpg").read_bytes() == b"image-a"
    assert (input_path / "part-b.png").read_bytes() == b"image-b"

    run = db.get(InferenceRun, body["id"])
    assert run is not None
    job = db.scalar(select(Job).where(Job.type == "inference", Job.target_id == run.id))
    assert job is not None
    assert job.status == "queued"


def test_upload_inference_single_image_creates_managed_file(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)

    response = client.post(
        f"/api/projects/{project.id}/inference-runs/upload",
        data={
            "name": "uploaded-image",
            "model_artifact_id": artifact.id,
            "input_type": "image",
        },
        files=[("inputs", ("sample.jpg", b"image", "image/jpeg"))],
    )

    assert response.status_code == 201
    body = response.json()
    assert body["input_type"] == "image"
    assert Path(body["input_path"]).is_file()
    assert Path(body["input_path"]).read_bytes() == b"image"


def test_upload_inference_folder_rejects_single_flat_image(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)

    response = client.post(
        f"/api/projects/{project.id}/inference-runs/upload",
        data={
            "name": "wrong-folder",
            "model_artifact_id": artifact.id,
            "input_type": "folder",
        },
        files=[("inputs", ("sample.jpg", b"image", "image/jpeg"))],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "폴더 추론에는 이미지 폴더를 선택하세요."


def test_upload_inference_image_rejects_folder_upload(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)

    response = client.post(
        f"/api/projects/{project.id}/inference-runs/upload",
        data={
            "name": "wrong-image",
            "model_artifact_id": artifact.id,
            "input_type": "image",
        },
        files=[("inputs", ("images/sample.jpg", b"image", "image/jpeg"))],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "단일 이미지 추론에는 이미지 파일 1개만 선택하세요."


def test_post_inference_run_accepts_single_image_alias(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    input_image = tmp_path / "image1.jpg"
    input_image.write_text("source", encoding="utf-8")

    response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "single-test",
            "model_artifact_id": artifact.id,
            "input_type": "single_image",
            "input_path": str(input_image),
            "config": {"conf": 0.25, "imgsz": 640},
        },
    )

    assert response.status_code == 201
    assert response.json()["input_type"] == "image"


def test_post_inference_run_validates_artifact_project_scope(client, db, tmp_path):
    project, _dataset, _training_run, _artifact = _create_project_training_artifact(
        db, tmp_path, "project-1"
    )
    other_project, _other_dataset, _other_training_run, other_artifact = (
        _create_project_training_artifact(db, tmp_path, "project-2")
    )

    response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "wrong-artifact",
            "model_artifact_id": other_artifact.id,
            "input_type": "folder",
            "input_path": str(tmp_path / "images"),
            "config": {"conf": 0.25, "imgsz": 640},
        },
    )

    assert response.status_code == 404
    assert other_project.id == "project-2"


def test_post_inference_run_rejects_invalid_input_type(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)

    response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "bad-input-type",
            "model_artifact_id": artifact.id,
            "input_type": "video",
            "input_path": str(tmp_path / "images"),
            "config": {"conf": 0.25, "imgsz": 640},
        },
    )

    assert response.status_code == 422


def test_post_inference_run_rejects_bad_input_paths(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    input_file = tmp_path / "image1.jpg"
    input_file.write_text("source", encoding="utf-8")

    relative_response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "relative-path",
            "model_artifact_id": artifact.id,
            "input_type": "folder",
            "input_path": "images",
        },
    )
    file_as_folder_response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "file-as-folder",
            "model_artifact_id": artifact.id,
            "input_type": "folder",
            "input_path": str(input_file),
        },
    )
    missing_image_response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "missing-image",
            "model_artifact_id": artifact.id,
            "input_type": "image",
            "input_path": str(tmp_path / "missing.jpg"),
        },
    )

    assert relative_response.status_code == 400
    assert file_as_folder_response.status_code == 400
    assert missing_image_response.status_code == 400


def test_post_inference_run_rejects_missing_model_artifact_file(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    Path(artifact.path).unlink()
    input_dir = tmp_path / "images"
    input_dir.mkdir()

    response = client.post(
        f"/api/projects/{project.id}/inference-runs",
        json={
            "name": "missing-model-file",
            "model_artifact_id": artifact.id,
            "input_type": "folder",
            "input_path": str(input_dir),
        },
    )

    assert response.status_code == 400


def test_inference_worker_completes_run_and_writes_predictions_json(
    db, tmp_path, monkeypatch
):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    bin_dir = tmp_path / "bin"
    make_fake_yolo_predict(bin_dir.parent)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "image1.jpg").write_text("source", encoding="utf-8")
    run = InferenceRun(
        id="inference-1",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(id="job-inference-1", type="inference", target_id=run.id, status="running")
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "completed"
    assert run.started_at is not None
    assert run.finished_at is not None
    assert run.output_path is not None
    assert run.prediction_count == 1
    assert job.status == "completed"

    predictions_json = Path(run.output_path) / "predictions.json"
    assert predictions_json.exists()
    payload = json.loads(predictions_json.read_text(encoding="utf-8"))
    assert payload["prediction_count"] == 1
    assert payload["predictions"][0]["detections"][0]["class_name"] == "scratch"

    prediction = db.scalar(
        select(InferencePrediction).where(InferencePrediction.inference_run_id == run.id)
    )
    assert prediction is not None
    assert re.fullmatch(r"pred_[2-9a-z]{10}", prediction.id)
    assert prediction.image_path == str(input_dir / "image1.jpg")
    assert prediction.max_confidence == 0.91
    assert prediction.class_names == ["scratch"]


def test_inference_worker_writes_classification_predictions(db, tmp_path, monkeypatch):
    from types import SimpleNamespace

    import app.worker as worker_module

    project, dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    project.task_type = "classification"
    dataset.format = "yolo-classification"
    dataset.class_names = ["ng", "ok", "hold"]
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    image_path = input_dir / "image1.jpg"
    image_path.write_text("source", encoding="utf-8")
    run = InferenceRun(
        id="inference-classification",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="classification-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"imgsz": 224},
    )
    job = Job(
        id="job-inference-classification",
        type="inference",
        target_id=run.id,
        status="running",
    )
    db.add_all([run, job])
    db.commit()

    def fake_classification_inference(*, model_path, input_path, output_dir, config):
        (output_dir / "logs").mkdir(parents=True, exist_ok=True)
        stdout_log_path = output_dir / "logs" / "stdout.log"
        stdout_log_path.write_text("classification inference", encoding="utf-8")
        return SimpleNamespace(
            exit_code=0,
            output_dir=output_dir,
            stdout_log_path=stdout_log_path,
            predictions=[
                {
                    "image_path": str(image_path),
                    "ranking": [
                        {"class_id": 1, "class_name": "ok", "confidence": 0.91},
                        {"class_id": 0, "class_name": "ng", "confidence": 0.08},
                    ],
                }
            ],
        )

    monkeypatch.setattr(
        worker_module,
        "run_yolo_classification_inference",
        fake_classification_inference,
    )

    handle_inference_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "completed"
    assert run.prediction_count == 1
    assert job.status == "completed"
    prediction = db.scalar(
        select(InferencePrediction).where(InferencePrediction.inference_run_id == run.id)
    )
    assert prediction is not None
    assert prediction.image_path == str(image_path)
    assert prediction.output_image_path == str(image_path)
    assert prediction.prediction_json == {
        "ranking": [
            {"class_id": 1, "class_name": "ok", "confidence": 0.91},
            {"class_id": 0, "class_name": "ng", "confidence": 0.08},
        ],
        "top": {"class_id": 1, "class_name": "ok", "confidence": 0.91},
    }
    assert prediction.class_names == ["ok", "ng"]
    assert prediction.max_confidence == 0.91


def test_inference_worker_passes_absolute_project_path_to_yolo(db, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "artifact_root", Path("relative-artifacts"))
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    fake_yolo = make_absolute_project_yolo_predict(tmp_path)
    monkeypatch.setenv("PATH", f"{fake_yolo.parent}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    Image.new("RGB", (240, 160), color="white").save(input_dir / "image1.jpg")
    run = InferenceRun(
        id="inference-relative-root",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(id="job-inference-relative-root", type="inference", target_id=run.id, status="running")
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "completed"
    assert job.status == "completed"
    assert run.output_path is not None
    assert Path(run.output_path).is_absolute()
    prediction = db.scalar(
        select(InferencePrediction).where(InferencePrediction.inference_run_id == run.id)
    )
    assert prediction is not None
    assert prediction.output_image_path != prediction.image_path
    assert Path(prediction.output_image_path).is_absolute()
    assert "visionops_rendered" in Path(prediction.output_image_path).parts
    assert Path(prediction.output_image_path).is_file()


def test_inference_worker_generates_visionops_rendered_image_from_detections(
    db, tmp_path, monkeypatch
):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    fake_yolo = make_fake_yolo_predict_with_plain_output(tmp_path)
    monkeypatch.setenv("PATH", f"{fake_yolo.parent}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    source_image = input_dir / "image1.jpg"
    Image.new("RGB", (240, 160), color="white").save(source_image)
    run = InferenceRun(
        id="inference-visionops-render",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(id="job-inference-visionops-render", type="inference", target_id=run.id, status="running")
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    db.refresh(run)
    assert run.status == "completed"
    prediction = db.scalar(
        select(InferencePrediction).where(InferencePrediction.inference_run_id == run.id)
    )
    assert prediction is not None
    assert "visionops_rendered" in Path(prediction.output_image_path).parts
    assert Path(prediction.output_image_path).is_file()
    assert Path(prediction.output_image_path) != Path(run.output_path, source_image.name)

    original = Image.open(source_image).convert("RGB")
    rendered = Image.open(prediction.output_image_path).convert("RGB")
    assert ImageChops.difference(original, rendered).getbbox() is not None


def test_inference_worker_records_input_images_when_no_detections(
    db, tmp_path, monkeypatch
):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    bin_dir = tmp_path / "bin"
    make_fake_yolo_predict_without_detections(bin_dir.parent)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "image1.jpg").write_text("source", encoding="utf-8")
    run = InferenceRun(
        id="inference-no-detections",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(id="job-inference-no-detections", type="inference", target_id=run.id, status="running")
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    db.refresh(run)
    assert run.status == "completed"
    assert run.prediction_count == 1
    prediction = db.scalar(
        select(InferencePrediction).where(InferencePrediction.inference_run_id == run.id)
    )
    assert prediction is not None
    assert prediction.image_path == str(input_dir / "image1.jpg")
    assert prediction.output_image_path == ""
    assert prediction.prediction_json["output_image_path"] == ""
    assert prediction.prediction_json["detections"] == []
    assert prediction.max_confidence == 0.0


def test_inference_worker_maps_nested_output_to_nested_input(db, tmp_path, monkeypatch):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    bin_dir = tmp_path / "bin"
    make_fake_yolo_predict(bin_dir.parent, nested=True)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    nested_input = input_dir / "sub" / "image1.jpg"
    nested_input.parent.mkdir(parents=True)
    nested_input.write_text("source", encoding="utf-8")
    run = InferenceRun(
        id="inference-nested",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(id="job-inference-nested", type="inference", target_id=run.id, status="running")
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    prediction = db.scalar(
        select(InferencePrediction).where(InferencePrediction.inference_run_id == run.id)
    )
    assert prediction is not None
    assert prediction.image_path == str(nested_input)


def test_inference_worker_avoids_guessing_duplicate_basename(db, tmp_path, monkeypatch):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    bin_dir = tmp_path / "bin"
    make_fake_yolo_predict(bin_dir.parent)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    for folder in ("a", "b"):
        path = input_dir / folder / "image1.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source", encoding="utf-8")
    run = InferenceRun(
        id="inference-duplicate-name",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(
        id="job-inference-duplicate-name",
        type="inference",
        target_id=run.id,
        status="running",
    )
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    prediction = db.scalar(
        select(InferencePrediction).where(InferencePrediction.inference_run_id == run.id)
    )
    assert prediction is not None
    assert prediction.image_path == str(input_dir)


def test_inference_worker_marks_failed_on_nonzero_exit(db, tmp_path, monkeypatch):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    bin_dir = tmp_path / "bin"
    make_fake_yolo_predict(bin_dir.parent, exit_code=7)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    run = InferenceRun(
        id="inference-fails",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(id="job-inference-fails", type="inference", target_id=run.id, status="running")
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "failed"
    assert run.finished_at is not None
    assert job.status == "failed"
    assert job.error_message == "추론 프로세스가 실패했습니다. 종료 코드: 7"


def test_inference_worker_marks_failed_when_yolo_executable_missing(db, tmp_path, monkeypatch):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    empty_bin = tmp_path / "empty-bin"
    empty_bin.mkdir()
    monkeypatch.setenv("PATH", str(empty_bin))
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    run = InferenceRun(
        id="inference-missing-yolo",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(
        id="job-inference-missing-yolo",
        type="inference",
        target_id=run.id,
        status="running",
    )
    db.add_all([run, job])
    db.commit()

    handle_inference_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "failed"
    assert run.output_path is not None
    assert Path(run.output_path, "logs", "stdout.log").exists()
    assert job.status == "failed"
    assert job.error_message == "YOLO 실행 파일을 찾을 수 없습니다."


def test_inference_worker_marks_failed_when_postprocessing_raises(
    db, tmp_path, monkeypatch
):
    import app.worker as worker_module

    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    bin_dir = tmp_path / "bin"
    make_fake_yolo_predict(bin_dir.parent)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "image1.jpg").write_text("source", encoding="utf-8")
    run = InferenceRun(
        id="inference-postprocess-error",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="folder",
        input_path=str(input_dir),
        status="queued",
        config={"conf": 0.25, "imgsz": 640},
    )
    job = Job(
        id="job-inference-postprocess-error",
        type="inference",
        target_id=run.id,
        status="running",
    )
    db.add_all([run, job])
    db.commit()

    def fail_write(*args, **kwargs):
        raise RuntimeError("prediction write exploded")

    monkeypatch.setattr(worker_module, "_write_inference_predictions", fail_write)

    handle_inference_job(db, job)

    db.refresh(run)
    db.refresh(job)
    assert run.status == "failed"
    assert run.finished_at is not None
    assert run.output_path is not None
    assert job.status == "failed"
    assert job.error_message == "prediction write exploded"


def test_predictions_endpoint_returns_rows_and_rejects_outside_project(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    other_project = Project(id="project-2", name="라인 B", description="", task_type="detection")
    run = InferenceRun(
        id="inference-api",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="image",
        input_path=str(tmp_path / "image1.jpg"),
        status="completed",
        config={"conf": 0.25, "imgsz": 640},
        output_path=str(tmp_path / "outputs"),
        prediction_count=1,
    )
    prediction = InferencePrediction(
        id="prediction-1",
        inference_run_id=run.id,
        image_path=str(tmp_path / "image1.jpg"),
        output_image_path=str(tmp_path / "outputs" / "image1.jpg"),
        prediction_json={"detections": []},
        class_names=["scratch"],
        max_confidence=0.0,
    )
    db.add_all([other_project, run, prediction])
    db.commit()

    response = client.get(f"/api/projects/{project.id}/inference-runs/{run.id}/predictions")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == prediction.id

    outside_response = client.get(
        f"/api/projects/{other_project.id}/inference-runs/{run.id}/predictions"
    )

    assert outside_response.status_code == 404


def test_prediction_image_endpoint_serves_rendered_image(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    output_dir = tmp_path / "outputs"
    output_dir.mkdir()
    rendered_image = output_dir / "image1.jpg"
    rendered_image.write_bytes(b"rendered-image")
    run = InferenceRun(
        id="inference-image-api",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="image",
        input_path=str(tmp_path / "image1.jpg"),
        status="completed",
        config={"conf": 0.25, "imgsz": 640},
        output_path=str(output_dir),
        prediction_count=1,
    )
    prediction = InferencePrediction(
        id="prediction-image-1",
        inference_run_id=run.id,
        image_path=str(tmp_path / "image1.jpg"),
        output_image_path=str(rendered_image),
        prediction_json={"detections": []},
        class_names=["scratch"],
        max_confidence=0.0,
    )
    db.add_all([run, prediction])
    db.commit()

    response = client.get(
        f"/api/projects/{project.id}/inference-runs/{run.id}/predictions/{prediction.id}/image"
    )

    assert response.status_code == 200
    assert response.content == b"rendered-image"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "no-store, max-age=0"


def test_prediction_image_endpoint_rejects_missing_rendered_image(client, db, tmp_path):
    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    run = InferenceRun(
        id="inference-missing-render-api",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="batch-test",
        input_type="image",
        input_path=str(tmp_path / "image1.jpg"),
        status="completed",
        config={"conf": 0.25, "imgsz": 640},
        output_path=str(tmp_path / "outputs"),
        prediction_count=1,
    )
    prediction = InferencePrediction(
        id="prediction-missing-render-1",
        inference_run_id=run.id,
        image_path=str(tmp_path / "image1.jpg"),
        output_image_path="",
        prediction_json={"detections": [], "output_image_path": ""},
        class_names=["scratch"],
        max_confidence=0.0,
    )
    db.add_all([run, prediction])
    db.commit()

    response = client.get(
        f"/api/projects/{project.id}/inference-runs/{run.id}/predictions/{prediction.id}/image"
    )

    assert response.status_code == 404


def test_delete_inference_run_removes_records_jobs_and_managed_files(client, db, tmp_path):
    from app.core.config import settings
    from app.services.storage import StoragePaths

    project, _dataset, _training_run, artifact = _create_project_training_artifact(db, tmp_path)
    storage_paths = StoragePaths(settings.artifact_root)
    output_dir = storage_paths.inference_run_dir(project.id, "inference-delete")
    input_dir = storage_paths.inference_input_dir(project.id, "inference-delete")
    output_image = output_dir / "visionops_rendered" / "part.jpg"
    input_image = input_dir / "part.jpg"
    output_image.parent.mkdir(parents=True, exist_ok=True)
    input_image.parent.mkdir(parents=True, exist_ok=True)
    output_image.write_text("rendered", encoding="utf-8")
    input_image.write_text("input", encoding="utf-8")

    run = InferenceRun(
        id="inference-delete",
        project_id=project.id,
        model_artifact_id=artifact.id,
        name="delete-me",
        input_type="folder",
        input_path=str(input_dir),
        status="completed",
        config={"conf": 0.25, "imgsz": 640},
        output_path=str(output_dir),
        prediction_count=1,
    )
    prediction = InferencePrediction(
        id="prediction-delete",
        inference_run_id=run.id,
        image_path=str(input_image),
        output_image_path=str(output_image),
        prediction_json={"detections": [], "output_image_path": str(output_image)},
        class_names=["scratch"],
        max_confidence=0.0,
    )
    job = Job(id="job-inference-delete", type="inference", target_id=run.id, status="completed")
    db.add_all([run, prediction, job])
    db.commit()
    run_id = run.id
    prediction_id = prediction.id
    job_id = job.id

    response = client.delete(f"/api/projects/{project.id}/inference-runs/{run_id}")

    assert response.status_code == 204
    db.expire_all()
    assert db.get(InferenceRun, run_id) is None
    assert db.get(InferencePrediction, prediction_id) is None
    assert db.get(Job, job_id) is None
    assert not output_dir.exists()
    assert not input_dir.exists()
