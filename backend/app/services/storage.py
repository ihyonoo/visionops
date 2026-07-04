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

    def inference_input_dir(self, project_id: str, run_id: str) -> Path:
        path = self.project_dir(project_id) / "runs" / "inference_inputs" / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path
