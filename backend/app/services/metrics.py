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
    }
    for output_key, candidates in metric_map.items():
        value = _best_numeric(rows, candidates)
        if value is not None:
            summary[output_key] = value
    return summary
