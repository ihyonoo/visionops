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
    slug: Mapped[str] = mapped_column(String, default="", nullable=False)
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
    test_ratio: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    train_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    val_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    test_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
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


class NotificationChannel(TimestampMixin, Base):
    __tablename__ = "notification_channels"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    channel: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    enabled: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    events: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    last_status: Mapped[str] = mapped_column(String, default="unknown", nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationDelivery(TimestampMixin, Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    channel_id: Mapped[str | None] = mapped_column(
        ForeignKey("notification_channels.id"), nullable=True
    )
    channel: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    target_type: Mapped[str] = mapped_column(String, nullable=False)
    target_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
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
