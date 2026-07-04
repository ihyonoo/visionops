from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, constr

NonEmptyString = constr(strip_whitespace=True, min_length=1)


class ProjectCreate(BaseModel):
    name: NonEmptyString
    description: str = ""


class ProjectRead(BaseModel):
    id: str
    name: str
    description: str
    task_type: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DatasetCreate(BaseModel):
    name: NonEmptyString
    source_path: NonEmptyString


class DatasetRead(BaseModel):
    id: str
    project_id: str
    name: str
    source_path: str
    format: str
    class_names: list[str]
    image_count: int
    label_count: int
    validation_status: str
    validation_summary: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DatasetSplitCreate(BaseModel):
    name: NonEmptyString
    train_ratio: float
    val_ratio: float
    seed: int = 42


class DatasetSplitRead(BaseModel):
    id: str
    dataset_id: str
    name: str
    train_ratio: float
    val_ratio: float
    seed: int
    train_count: int
    val_count: int
    split_path: str
    dataset_yaml_path: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TrainingConfig(BaseModel):
    epochs: int = Field(default=50, gt=0)
    batch: int = Field(default=16, gt=0)
    imgsz: int = Field(default=640, gt=0)
    learning_rate: float = Field(default=0.01, gt=0)
    patience: int = Field(default=20, gt=0)
    device: NonEmptyString = "cpu"


class TrainingRunCreate(BaseModel):
    name: NonEmptyString
    split_id: str
    model_name: NonEmptyString
    config: TrainingConfig = Field(default_factory=TrainingConfig)


class TrainingRunRead(BaseModel):
    id: str
    project_id: str
    dataset_id: str
    split_id: str
    name: str
    model_name: str
    trainer: str
    status: str
    config: dict
    metrics_summary: dict
    artifact_path: str | None
    log_path: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TrainingLogRead(BaseModel):
    lines: list[str]
    offset: int = 0


class TrainingMetricsRead(BaseModel):
    summary: dict
    rows: list[dict]


class ModelArtifactRead(BaseModel):
    id: str
    training_run_id: str
    kind: str
    path: str
    metrics_snapshot: dict
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InferenceConfig(BaseModel):
    conf: float = Field(default=0.25, gt=0, le=1)
    imgsz: int = Field(default=640, gt=0)


class InferenceRunCreate(BaseModel):
    name: NonEmptyString
    model_artifact_id: str
    input_type: Literal["image", "single_image", "folder"]
    input_path: NonEmptyString
    config: InferenceConfig = Field(default_factory=InferenceConfig)

    @field_validator("input_type")
    @classmethod
    def normalize_input_type(cls, value: str) -> str:
        if value == "single_image":
            return "image"
        return value


class InferenceRunRead(BaseModel):
    id: str
    project_id: str
    model_artifact_id: str
    name: str
    input_type: str
    input_path: str
    status: str
    config: dict
    output_path: str | None
    prediction_count: int
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InferencePredictionRead(BaseModel):
    id: str
    inference_run_id: str
    image_path: str
    output_image_path: str
    prediction_json: dict
    class_names: list[str]
    max_confidence: float
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
