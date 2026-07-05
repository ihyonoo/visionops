from pathlib import Path
import os

from app.services.metrics import read_results_csv, summarize_metrics
from app.services.training import build_yolo_train_command, run_yolo_training


def _write_fake_yolo(bin_dir: Path) -> Path:
    executable = bin_dir / "yolo"
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        """#!/usr/bin/env python3
import sys
from pathlib import Path

args = dict(arg.split("=", 1) for arg in sys.argv[3:] if "=" in arg)
run_dir = Path(args["project"]) / args["name"]
(run_dir / "weights").mkdir(parents=True, exist_ok=True)
(run_dir / "results.csv").write_text(
    "epoch, metrics/precision(B), metrics/recall(B), metrics/mAP50(B)\\n"
    "0,0.50,0.40,0.45\\n"
    "1,0.70,0.60,0.65\\n",
    encoding="utf-8",
)
(run_dir / "weights" / "best.pt").write_text("best", encoding="utf-8")
(run_dir / "weights" / "last.pt").write_text("last", encoding="utf-8")
print("fake training started")
print("fake warning", file=sys.stderr)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return executable


def test_build_yolo_train_command_matches_ultralytics_cli_shape(tmp_path):
    command = build_yolo_train_command(
        model_name="yolov8n",
        data_yaml_path=tmp_path / "data.yaml",
        config={
            "epochs": 3,
            "imgsz": 640,
            "batch": 4,
            "learning_rate": 0.001,
            "patience": 5,
            "device": "cpu",
            "optimizer": "AdamW",
            "weight_decay": 0.0007,
            "cos_lr": True,
            "amp": False,
            "workers": 4,
        },
        run_parent=tmp_path / "runs",
        run_name="run-1",
    )

    assert command == [
        "yolo",
        "detect",
        "train",
        "model=yolov8n.pt",
        f"data={tmp_path / 'data.yaml'}",
        "epochs=3",
        "imgsz=640",
        "batch=4",
        "lr0=0.001",
        "patience=5",
        "device=cpu",
        "optimizer=AdamW",
        "weight_decay=0.0007",
        "cos_lr=True",
        "workers=4",
        "amp=False",
        f"project={tmp_path / 'runs'}",
        "name=run-1",
        "exist_ok=True",
    ]


def test_build_yolo_train_command_resolves_project_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    command = build_yolo_train_command(
        model_name="yolov8n",
        data_yaml_path=Path("data.yaml"),
        config={},
        run_parent=Path("relative-runs"),
        run_name="run-1",
    )

    assert f"data={tmp_path / 'data.yaml'}" in command
    assert f"project={tmp_path / 'relative-runs'}" in command


def test_build_yolo_train_command_supports_classification_task(tmp_path):
    command = build_yolo_train_command(
        task_type="classification",
        model_name="yolo11x-cls",
        data_path=tmp_path / "split",
        config={"epochs": 5, "imgsz": 224, "batch": 8, "device": "cpu"},
        run_parent=tmp_path / "runs",
        run_name="cls-run",
    )

    assert command[:4] == ["yolo", "classify", "train", "model=yolo11x-cls.pt"]
    assert f"data={tmp_path / 'split'}" in command
    assert f"project={tmp_path / 'runs'}" in command


def test_run_yolo_training_writes_stdout_log_and_returns_success(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    _write_fake_yolo(bin_dir)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    data_yaml = tmp_path / "data.yaml"
    data_yaml.write_text("names: [scratch]\n", encoding="utf-8")

    result = run_yolo_training(
        model_name="yolov8n",
        data_yaml_path=data_yaml,
        config={
            "epochs": 2,
            "imgsz": 320,
            "batch": 2,
            "learning_rate": 0.01,
            "patience": 3,
            "device": "cpu",
        },
        run_parent=tmp_path / "runs",
        run_name="exp",
    )

    assert result.exit_code == 0
    assert result.run_dir == tmp_path / "runs" / "exp"
    assert result.results_csv_path.exists()
    assert (result.run_dir / "weights" / "best.pt").exists()
    assert (result.run_dir / "weights" / "last.pt").exists()
    log_text = result.stdout_log_path.read_text(encoding="utf-8")
    assert "fake training started" in log_text
    assert "fake warning" in log_text


def test_metrics_parser_summarizes_last_epoch_and_best_values(tmp_path):
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "epoch, metrics/precision(B), metrics/recall(B), metrics/mAP50(B)\n"
        "0,0.10,0.20,0.30\n"
        "1,0.40,0.35,0.50\n"
        "2,0.30,0.60,0.45\n",
        encoding="utf-8",
    )

    rows = read_results_csv(csv_path)
    summary = summarize_metrics(rows)

    assert rows[0]["metrics/precision(B)"] == 0.10
    assert summary == {
        "last_epoch": 2,
        "best_mAP50": 0.50,
        "best_precision": 0.40,
        "best_recall": 0.60,
    }


def test_metrics_parser_summarizes_classification_accuracy(tmp_path):
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "epoch, train/loss, val/loss, metrics/accuracy_top1, metrics/accuracy_top5\n"
        "0,1.2,1.1,0.70,0.91\n"
        "1,0.8,0.7,0.82,0.96\n",
        encoding="utf-8",
    )

    rows = read_results_csv(csv_path)
    summary = summarize_metrics(rows)

    assert summary["last_epoch"] == 1
    assert summary["best_accuracy_top1"] == 0.82
    assert summary["best_accuracy_top5"] == 0.96
    assert summary["last_val_loss"] == 0.7
