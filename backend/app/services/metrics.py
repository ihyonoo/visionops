import csv
from pathlib import Path
from typing import Any


def _coerce_value(value: str) -> Any:
    stripped = value.strip()
    if stripped == "":
        return None
    try:
        number = float(stripped)
    except ValueError:
        return stripped
    if number.is_integer():
        return int(number)
    return number


def _clean_row(row: dict) -> dict | None:
    cleaned = {}
    for key, value in row.items():
        if key is None or not isinstance(value, str):
            return None
        if value is None:
            return None
        cleaned[key.strip()] = _coerce_value(value)
    return cleaned


def read_results_csv(path: Path) -> list[dict]:
    if not path.is_file():
        return []

    with path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        rows: list[dict] = []
        for row in reader:
            cleaned = _clean_row(row)
            if cleaned is not None:
                rows.append(cleaned)
    return rows


def _best_numeric(rows: list[dict], candidates: tuple[str, ...]) -> float | int | None:
    values = []
    for row in rows:
        for key in candidates:
            value = row.get(key)
            if isinstance(value, int | float):
                values.append(value)
                break
    if not values:
        return None
    return max(values)


def summarize_metrics(rows: list[dict]) -> dict:
    if not rows:
        return {}

    summary: dict[str, float | int] = {}
    last_epoch = rows[-1].get("epoch")
    if isinstance(last_epoch, int | float):
        summary["last_epoch"] = last_epoch

    metric_map = {
        "best_mAP50": ("metrics/mAP50(B)", "metrics/mAP50", "mAP50"),
        "best_precision": ("metrics/precision(B)", "metrics/precision", "precision"),
        "best_recall": ("metrics/recall(B)", "metrics/recall", "recall"),
        "best_accuracy_top1": ("metrics/accuracy_top1", "accuracy_top1"),
        "best_accuracy_top5": ("metrics/accuracy_top5", "accuracy_top5"),
    }
    for output_key, candidates in metric_map.items():
        value = _best_numeric(rows, candidates)
        if value is not None:
            summary[output_key] = value

    last_row = rows[-1]
    loss_map = {
        "last_val_loss": "val/loss",
        "last_train_loss": "train/loss",
    }
    for output_key, source_key in loss_map.items():
        value = last_row.get(source_key)
        if isinstance(value, int | float):
            summary[output_key] = value
    return summary
