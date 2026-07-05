from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, constr

NonEmptyString = constr(strip_whitespace=True, min_length=1)


class ProjectCreate(BaseModel):
    name: NonEmptyString
    description: str = ""


class ProjectUpdate(BaseModel):
    name: NonEmptyString | None = None
    description: str | None = None


class ProjectRead(BaseModel):
    id: str
    name: str
    slug: str
    description: str
    task_type: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DatasetCreate(BaseModel):
    name: NonEmptyString
    source_path: NonEmptyString


class DatasetUpdate(BaseModel):
    name: NonEmptyString


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
    test_ratio: float = 0.0
    seed: int = 42


class DatasetSplitUpdate(BaseModel):
    name: NonEmptyString


class DatasetSplitRead(BaseModel):
    id: str
    dataset_id: str
    name: str
    train_ratio: float
    val_ratio: float
    test_ratio: float
    seed: int
    train_count: int
    val_count: int
    test_count: int
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
    optimizer: str = "auto"
    lrf: float = Field(default=0.01, gt=0)
    momentum: float = Field(default=0.937, gt=0)
    weight_decay: float = Field(default=0.0005, ge=0)
    warmup_epochs: float = Field(default=3.0, ge=0)
    cos_lr: bool = False
    close_mosaic: int = Field(default=10, ge=0)
    cache: bool = False
    workers: int = Field(default=8, ge=0)
    seed: int = Field(default=0, ge=0)
    deterministic: bool = True
    amp: bool = True
    freeze: int = Field(default=0, ge=0)
    dropout: float = Field(default=0.0, ge=0, le=1)
    mosaic: float = Field(default=1.0, ge=0, le=1)
    mixup: float = Field(default=0.0, ge=0, le=1)
    degrees: float = Field(default=0.0, ge=0)
    translate: float = Field(default=0.1, ge=0, le=1)
    scale: float = Field(default=0.5, ge=0)
    fliplr: float = Field(default=0.5, ge=0, le=1)


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


class RuntimeInstallRequest(BaseModel):
    profile: Literal["cpu", "cuda"] = "cpu"


class RuntimeInstallRead(BaseModel):
    profile: str
    status: str
    commands: list[str]
    log_path: str
    message: str


class RuntimeCheckRead(BaseModel):
    ready: bool
    install_required: bool
    python: dict
    packages: dict
    yolo_cli: dict
    devices: list[dict]
    install_options: list[dict]


class TrainingPreflightRead(BaseModel):
    can_start: bool
    blocking_issues: list[str]
    warnings: list[str]
    recommendations: list[str]
    devices: list[dict]
    selected_device: dict
    runtime: dict
    suggested_config: dict
    command_preview: dict


NotificationChannelName = Literal["slack", "discord", "telegram"]
NotificationEventName = Literal[
    "training_completed",
    "training_failed",
    "inference_completed",
    "inference_failed",
]


class NotificationEvents(BaseModel):
    training_completed: bool = True
    training_failed: bool = True
    inference_completed: bool = True
    inference_failed: bool = True


class NotificationSettingUpdate(BaseModel):
    enabled: bool = False
    events: NotificationEvents = Field(default_factory=NotificationEvents)
    webhook_url: str | None = None
    bot_token: str | None = None
    chat_id: str | None = None


class NotificationSettingRead(BaseModel):
    channel: NotificationChannelName
    enabled: bool
    events: NotificationEvents
    has_secret: bool
    masked_secret: str | None
    last_status: str
    last_error: str | None
    last_sent_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class NotificationTestRequest(BaseModel):
    webhook_url: str | None = None
    bot_token: str | None = None
    chat_id: str | None = None


class NotificationTestRead(BaseModel):
    channel: NotificationChannelName
    status: Literal["sent", "failed"]
    message: str


class ModelArtifactRead(BaseModel):
    id: str
    training_run_id: str
    kind: str
    path: str
    metrics_snapshot: dict
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TrainingDownloadRead(BaseModel):
    filename: str
    label: str
    kind: str
    url: str


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
