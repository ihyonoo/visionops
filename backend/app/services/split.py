import json
import random
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.services.dataset_validation import IMAGE_EXTENSIONS, load_class_names


@dataclass(frozen=True)
class CopySplitResult:
    train_count: int
    val_count: int
    dataset_yaml_path: Path
    manifest_path: Path


def _image_files(images_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in images_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def _copy_label_or_create_empty(source_label: Path, destination_label: Path) -> None:
    destination_label.parent.mkdir(parents=True, exist_ok=True)
    if source_label.exists():
        shutil.copy2(source_label, destination_label)
        return
    destination_label.write_text("", encoding="utf-8")


def _read_source_names(dataset_root: Path) -> Any:
    data = yaml.safe_load((dataset_root / "data.yaml").read_text(encoding="utf-8")) or {}
    return data["names"]


def _class_distribution(label_paths: list[Path], class_names: list[str]) -> dict[str, int]:
    distribution = {name: 0 for name in class_names}
    for label_path in label_paths:
        for line in label_path.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if not parts:
                continue
            try:
                class_id = int(parts[0])
            except ValueError:
                continue
            if 0 <= class_id < len(class_names):
                distribution[class_names[class_id]] += 1
    return distribution


def _copy_split_subset(
    image_paths: list[Path],
    dataset_root: Path,
    split_root: Path,
    subset: str,
) -> tuple[list[str], list[dict[str, str]], list[Path]]:
    images_dir = dataset_root / "images"
    labels_dir = dataset_root / "labels"
    subset_files: list[str] = []
    copied_paths: list[dict[str, str]] = []
    copied_label_paths: list[Path] = []

    for source_image in image_paths:
        relative_image = source_image.relative_to(images_dir)
        relative_label = relative_image.with_suffix(".txt")
        source_label = labels_dir / relative_label
        destination_image = split_root / "images" / subset / relative_image
        destination_label = split_root / "labels" / subset / relative_label

        destination_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_image, destination_image)
        _copy_label_or_create_empty(source_label, destination_label)

        subset_files.append(relative_image.as_posix())
        copied_label_paths.append(destination_label)
        copied_paths.append(
            {
                "source_image": str(source_image),
                "copied_image": str(destination_image),
                "source_label": str(source_label),
                "copied_label": str(destination_label),
            }
        )

    return subset_files, copied_paths, copied_label_paths


def create_copy_split(
    dataset_root: Path,
    split_root: Path,
    train_ratio: float,
    val_ratio: float,
    seed: int,
) -> CopySplitResult:
    if not 0 <= train_ratio <= 1 or not 0 <= val_ratio <= 1:
        raise ValueError("train_ratio와 val_ratio는 0과 1 사이여야 합니다.")
    if abs((train_ratio + val_ratio) - 1.0) > 1e-6:
        raise ValueError("train_ratio와 val_ratio의 합은 1.0이어야 합니다.")

    dataset_root = dataset_root.resolve()
    split_root = split_root.resolve()
    if split_root.exists() and any(split_root.iterdir()):
        raise ValueError("split_root가 비어 있지 않습니다.")

    class_names = load_class_names(dataset_root)
    source_names = _read_source_names(dataset_root)
    image_paths = _image_files(dataset_root / "images")

    shuffled_images = image_paths[:]
    random.Random(seed).shuffle(shuffled_images)
    train_count = round(len(shuffled_images) * train_ratio)
    train_images = shuffled_images[:train_count]
    val_images = shuffled_images[train_count:]

    split_root.parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path(
        tempfile.mkdtemp(prefix=f".{split_root.name}.tmp-", dir=split_root.parent)
    ).resolve()
    try:
        train_files, train_copied_paths, train_label_paths = _copy_split_subset(
            train_images, dataset_root, temp_root, "train"
        )
        val_files, val_copied_paths, val_label_paths = _copy_split_subset(
            val_images, dataset_root, temp_root, "val"
        )

        dataset_yaml_path = temp_root / "data.yaml"
        dataset_yaml_path.write_text(
            yaml.safe_dump(
                {
                    "path": str(split_root),
                    "train": "images/train",
                    "val": "images/val",
                    "names": source_names,
                },
                sort_keys=False,
                allow_unicode=True,
            ),
            encoding="utf-8",
        )

        manifest_path = temp_root / "split_manifest.json"
        manifest = {
            "source_dataset_root": str(dataset_root),
            "split_root": str(split_root),
            "train_ratio": train_ratio,
            "val_ratio": val_ratio,
            "seed": seed,
            "train_files": train_files,
            "val_files": val_files,
            "train_count": len(train_files),
            "val_count": len(val_files),
            "copied_paths": train_copied_paths + val_copied_paths,
            "class_distribution": _class_distribution(
                train_label_paths + val_label_paths, class_names
            ),
        }
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        if split_root.exists():
            split_root.rmdir()
        temp_root.replace(split_root)
    except Exception:
        shutil.rmtree(temp_root, ignore_errors=True)
        if split_root.exists() and not any(split_root.iterdir()):
            split_root.rmdir()
        raise

    return CopySplitResult(
        train_count=len(train_files),
        val_count=len(val_files),
        dataset_yaml_path=split_root / "data.yaml",
        manifest_path=split_root / "split_manifest.json",
    )
