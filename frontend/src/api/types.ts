export type JsonObject = Record<string, unknown>;
export type Timestamp = string;

export type NotificationChannelName = "slack" | "discord" | "telegram";

export type NotificationEvents = {
  training_completed: boolean;
  training_failed: boolean;
  inference_completed: boolean;
  inference_failed: boolean;
};

export type NotificationSetting = {
  channel: NotificationChannelName;
  enabled: boolean;
  events: NotificationEvents;
  has_secret: boolean;
  masked_secret: string | null;
  last_status: "sent" | "failed" | string | null;
  last_error: string | null;
  last_sent_at: Timestamp | null;
};

export type NotificationSettingUpdate = {
  enabled: boolean;
  events: NotificationEvents;
  webhook_url?: string;
  bot_token?: string;
  chat_id?: string;
};

export type NotificationTestResult = {
  channel: NotificationChannelName;
  status: "sent" | "failed";
  message: string;
};

export type ProjectTaskType = "detection" | "classification";

export type Project = {
  id: string;
  name: string;
  slug?: string;
  description: string;
  task_type: ProjectTaskType;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ProjectCreate = {
  name: string;
  description?: string;
  task_type: ProjectTaskType;
};

export type ProjectUpdate = {
  name?: string;
  description?: string;
  task_type?: ProjectTaskType;
};

export type Dataset = {
  id: string;
  project_id: string;
  name: string;
  source_path: string;
  format?: string;
  class_names: string[];
  image_count: number;
  label_count: number;
  validation_status: "valid" | "invalid" | "unknown" | string;
  validation_summary?: JsonObject | null;
  created_at?: Timestamp;
};

export type DatasetCreate = {
  name: string;
  source_path: string;
};

export type DatasetSplit = {
  id: string;
  dataset_id: string;
  name: string;
  train_ratio: number;
  val_ratio: number;
  test_ratio: number;
  seed: number;
  train_count: number;
  val_count: number;
  test_count: number;
  split_path: string;
  dataset_yaml_path: string;
  created_at: Timestamp;
};

export type DatasetSplitCreate = {
  name: string;
  train_ratio: number;
  val_ratio: number;
  test_ratio?: number;
  seed?: number;
};

export type DatasetSplitUpdate = {
  name: string;
};

export type TrainingConfig = {
  epochs: number;
  batch: number;
  imgsz: number;
  learning_rate: number;
  patience: number;
  device: string;
  optimizer: string;
  lrf: number;
  momentum: number;
  weight_decay: number;
  warmup_epochs: number;
  cos_lr: boolean;
  close_mosaic: number;
  cache: boolean;
  workers: number;
  seed: number;
  deterministic: boolean;
  amp: boolean;
  freeze: number;
  dropout: number;
  mosaic: number;
  mixup: number;
  degrees: number;
  translate: number;
  scale: number;
  fliplr: number;
};

export type TrainingRunStatus = "queued" | "pending" | "running" | "completed" | "failed" | string;

export type TrainingRun = {
  id: string;
  project_id: string;
  dataset_id: string;
  split_id: string;
  name: string;
  model_name: string;
  trainer: string;
  status: TrainingRunStatus;
  config: TrainingConfig & JsonObject;
  metrics_summary: JsonObject | null;
  artifact_path: string | null;
  log_path: string | null;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type TrainingRunCreate = {
  name: string;
  split_id: string;
  model_name: string;
  config: TrainingConfig;
};

export type RuntimeDevice = {
  id: string;
  label: string;
  kind: string;
  available: boolean;
  details: JsonObject;
};

export type RuntimeCheck = {
  ready: boolean;
  install_required: boolean;
  python: JsonObject;
  packages: Record<string, { installed: boolean; version: string | null }>;
  yolo_cli: { installed: boolean; path: string | null };
  devices: RuntimeDevice[];
  install_options: Array<{
    profile: string;
    label: string;
    commands: string[];
  }>;
};

export type RuntimeInstallResult = {
  profile: string;
  status: string;
  commands: string[];
  log_path: string;
  message: string;
};

export type TrainingPreflight = {
  can_start: boolean;
  blocking_issues: string[];
  command_preview?: {
    argv: string[];
    kind: string;
    shell: string;
  };
  warnings: string[];
  recommendations: string[];
  devices: RuntimeDevice[];
  selected_device: RuntimeDevice;
  runtime: RuntimeCheck;
  suggested_config: TrainingConfig & JsonObject;
};

export type TrainingLog = {
  lines: string[];
  offset: number;
};

export type TrainingMetrics = {
  summary: JsonObject;
  rows: JsonObject[];
};

export type ModelArtifact = {
  id: string;
  training_run_id: string;
  kind: string;
  path: string;
  metrics_snapshot: JsonObject;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type TrainingDownload = {
  filename: string;
  label: string;
  kind: string;
  url: string;
};

export type InferenceConfig = {
  conf?: number;
  imgsz?: number;
};

export type InferenceInputTypeCreate = "image" | "single_image" | "folder";
export type InferenceInputType = "image" | "folder";

export type InferenceRun = {
  id: string;
  project_id: string;
  model_artifact_id: string;
  name: string;
  input_type: InferenceInputType;
  input_path: string;
  status: string;
  config: JsonObject;
  output_path: string | null;
  prediction_count: number;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type InferenceRunCreate = {
  name: string;
  model_artifact_id: string;
  input_type: InferenceInputTypeCreate;
  input_path: string;
  config?: InferenceConfig;
};

export type InferencePrediction = {
  id: string;
  inference_run_id: string;
  image_path: string;
  output_image_path: string;
  prediction_json: JsonObject;
  class_names: string[];
  max_confidence: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};
