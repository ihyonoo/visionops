from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml
from PIL import Image

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass
class ValidationResult:
    status: str
    class_names: list[str] = field(default_factory=list)
    image_count: int = 0
    label_count: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    class_distribution: dict[str, int] = field(default_factory=dict)
    unlabeled_image_count: int = 0
    orphan_label_count: int = 0

    def to_summary(self) -> dict[str, Any]:
        return asdict(self)


def _normalize_names(raw_names: Any) -> list[str]:
    if isinstance(raw_names, list):
        return [str(name) for name in raw_names]
    if isinstance(raw_names, dict):
        normalized_keys: list[int] = []
        names_by_id: dict[int, str] = {}
        for key, name in raw_names.items():
            if isinstance(key, bool):
                raise ValueError("data.yaml names mapping keys must be integer-like and contiguous 0..n-1")
            try:
                class_id = int(key)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    "data.yaml names mapping keys must be integer-like and contiguous 0..n-1"
                ) from exc
            if class_id in names_by_id:
                raise ValueError("data.yaml names mapping keys must be unique after integer conversion")
            normalized_keys.append(class_id)
            names_by_id[class_id] = str(name)

        expected_keys = list(range(len(normalized_keys)))
        if sorted(normalized_keys) != expected_keys:
            raise ValueError("data.yaml names mapping keys must be integer-like and contiguous 0..n-1")
        return [names_by_id[class_id] for class_id in expected_keys]
    raise ValueError("data.yaml names must be a list or id-to-name mapping")


def load_class_names(dataset_root: Path) -> list[str]:
    data_yaml = dataset_root / "data.yaml"
    if not data_yaml.exists():
        raise FileNotFoundError("data.yaml is required")

    data = yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}
    if "names" not in data:
        raise ValueError("data.yaml must contain names")
    names = _normalize_names(data["names"])
    if not names:
        raise ValueError("data.yaml names must not be empty")
    return names


def validate_yolo_label_line(line: str, class_count: int) -> str | None:
    parts = line.split()
    if len(parts) != 5:
        return "Label row must have 5 values: class_id x_center y_center width height"

    try:
        class_id = int(parts[0])
        values = [float(value) for value in parts[1:]]
    except ValueError:
        return "Label row contains non-numeric values"

    if class_id < 0 or class_id >= class_count:
        return f"class_id {class_id} is outside class range 0..{class_count - 1}"

    x_center, y_center, width, height = values
    if not all(0 <= value <= 1 for value in (x_center, y_center, width, height)):
        return "Bounding box values must be normalized between 0 and 1"
    if width <= 0 or height <= 0:
        return "Bounding box width and height must be greater than 0"
    return None


def _image_files(images_dir: Path) -> list[Path]:
    return sorted(
        path for path in images_dir.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def _display_path(path: Path) -> str:
    return path.as_posix()


def validate_yolo_dataset(dataset_root: Path) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = []
    class_names: list[str] = []

    if not dataset_root.exists():
        return ValidationResult(status="invalid", errors=[f"Dataset path does not exist: {dataset_root}"])

    try:
        class_names = load_class_names(dataset_root)
    except (FileNotFoundError, ValueError) as exc:
        errors.append(str(exc))

    images_dir = dataset_root / "images"
    labels_dir = dataset_root / "labels"
    if not images_dir.exists():
        errors.append("images directory is required")
    if not labels_dir.exists():
        errors.append("labels directory is required")

    if errors:
        return ValidationResult(status="invalid", class_names=class_names, errors=errors)

    images = _image_files(images_dir)
    labels = sorted(path for path in labels_dir.rglob("*.txt") if path.is_file())
    expected_label_paths = {
        image_path.relative_to(images_dir).with_suffix(".txt")
        for image_path in images
    }
    actual_label_paths = {
        label_path.relative_to(labels_dir)
        for label_path in labels
    }
    class_distribution = {name: 0 for name in class_names}
    unlabeled_count = 0

    for image_path in images:
        try:
            with Image.open(image_path) as image:
                image.verify()
        except Exception as exc:  # Pillow raises multiple concrete exceptions for corrupt files.
            errors.append(f"Corrupt image {image_path}: {exc}")

        relative_label_path = image_path.relative_to(images_dir).with_suffix(".txt")
        label_path = labels_dir / relative_label_path
        if not label_path.exists():
            relative_image_path = image_path.relative_to(dataset_root)
            warnings.append(f"Missing label for image: {_display_path(relative_image_path)}")
            unlabeled_count += 1
            continue

        lines = [
            line.strip()
            for line in label_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if not lines:
            unlabeled_count += 1
            continue

        for line_number, line in enumerate(lines, start=1):
            error = validate_yolo_label_line(line, len(class_names))
            if error is not None:
                errors.append(f"{label_path.name}:{line_number}: {error}")
                continue
            class_id = int(line.split()[0])
            class_distribution[class_names[class_id]] += 1

    orphan_labels = sorted(actual_label_paths - expected_label_paths)
    for relative_label_path in orphan_labels:
        warnings.append(
            "Label has no matching image: "
            f"{_display_path(Path('labels') / relative_label_path)}"
        )

    return ValidationResult(
        status="invalid" if errors else "valid",
        class_names=class_names,
        image_count=len(images),
        label_count=len(labels),
        warnings=warnings,
        errors=errors,
        class_distribution=class_distribution,
        unlabeled_image_count=unlabeled_count,
        orphan_label_count=len(orphan_labels),
    )
