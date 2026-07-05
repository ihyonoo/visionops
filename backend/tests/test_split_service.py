import json
from pathlib import Path

import pytest
import yaml
from PIL import Image

from app.services.split import create_copy_split


def _write_image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (16, 16), color="white").save(path)


def _make_dataset(root: Path, image_count: int = 4) -> Path:
    (root / "images").mkdir(parents=True)
    (root / "labels").mkdir()
    (root / "data.yaml").write_text(yaml.safe_dump({"names": ["scratch"]}), encoding="utf-8")
    for index in range(image_count):
        _write_image(root / "images" / f"img{index}.jpg")
        (root / "labels" / f"img{index}.txt").write_text(
            "0 0.5 0.5 0.25 0.25\n", encoding="utf-8"
        )
    return root


def _make_classification_dataset(root: Path, per_class: int = 4) -> Path:
    for class_name in ("ok", "ng"):
        class_dir = root / class_name
        class_dir.mkdir(parents=True)
        for index in range(per_class):
            _write_image(class_dir / f"{class_name}-{index}.jpg")
    return root


def test_create_copy_split_writes_expected_artifacts(tmp_path):
    dataset_root = _make_dataset(tmp_path / "dataset", image_count=4)
    split_root = tmp_path / "split"

    result = create_copy_split(dataset_root, split_root, train_ratio=0.75, val_ratio=0.25, seed=42)

    assert result.train_count == 3
    assert result.val_count == 1
    assert (split_root / "images" / "train").is_dir()
    assert (split_root / "images" / "val").is_dir()
    assert (split_root / "labels" / "train").is_dir()
    assert (split_root / "labels" / "val").is_dir()
    assert len(list((split_root / "images" / "train").glob("*.jpg"))) == 3
    assert len(list((split_root / "images" / "val").glob("*.jpg"))) == 1
    assert len(list((split_root / "labels" / "train").glob("*.txt"))) == 3
    assert len(list((split_root / "labels" / "val").glob("*.txt"))) == 1

    data_yaml = yaml.safe_load((split_root / "data.yaml").read_text(encoding="utf-8"))
    assert data_yaml == {
        "path": str(split_root.resolve()),
        "train": "images/train",
        "val": "images/val",
        "names": ["scratch"],
    }

    manifest = json.loads((split_root / "split_manifest.json").read_text(encoding="utf-8"))
    assert manifest["source_dataset_root"] == str(dataset_root.resolve())
    assert manifest["split_root"] == str(split_root.resolve())
    assert manifest["train_ratio"] == 0.75
    assert manifest["val_ratio"] == 0.25
    assert manifest["seed"] == 42
    assert len(manifest["train_files"]) == 3
    assert len(manifest["val_files"]) == 1
    assert manifest["class_distribution"] == {"scratch": 4}


def test_create_copy_split_can_write_optional_test_subset(tmp_path):
    dataset_root = _make_dataset(tmp_path / "dataset", image_count=10)
    split_root = tmp_path / "split"

    result = create_copy_split(
        dataset_root,
        split_root,
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        seed=42,
    )

    assert result.train_count == 8
    assert result.val_count == 1
    assert result.test_count == 1
    assert len(list((split_root / "images" / "test").glob("*.jpg"))) == 1
    assert len(list((split_root / "labels" / "test").glob("*.txt"))) == 1

    data_yaml = yaml.safe_load((split_root / "data.yaml").read_text(encoding="utf-8"))
    assert data_yaml["test"] == "images/test"

    manifest = json.loads((split_root / "split_manifest.json").read_text(encoding="utf-8"))
    assert manifest["test_ratio"] == 0.1
    assert len(manifest["test_files"]) == 1
    assert manifest["test_count"] == 1


def test_create_copy_split_preserves_nested_paths_and_creates_empty_missing_label(tmp_path):
    dataset_root = tmp_path / "dataset"
    (dataset_root / "images" / "nested").mkdir(parents=True)
    (dataset_root / "labels" / "nested").mkdir(parents=True)
    (dataset_root / "data.yaml").write_text(yaml.safe_dump({"names": ["scratch"]}), encoding="utf-8")
    _write_image(dataset_root / "images" / "nested" / "with-label.png")
    _write_image(dataset_root / "images" / "nested" / "negative.webp")
    (dataset_root / "labels" / "nested" / "with-label.txt").write_text(
        "0 0.5 0.5 0.25 0.25\n", encoding="utf-8"
    )

    create_copy_split(dataset_root, tmp_path / "split", train_ratio=1.0, val_ratio=0.0, seed=42)

    copied_label = tmp_path / "split" / "labels" / "train" / "nested" / "with-label.txt"
    empty_label = tmp_path / "split" / "labels" / "train" / "nested" / "negative.txt"
    assert copied_label.read_text(encoding="utf-8") == "0 0.5 0.5 0.25 0.25\n"
    assert empty_label.exists()
    assert empty_label.read_text(encoding="utf-8") == ""
    assert (tmp_path / "split" / "images" / "train" / "nested" / "with-label.png").exists()
    assert (tmp_path / "split" / "images" / "train" / "nested" / "negative.webp").exists()


def test_create_copy_split_rejects_non_empty_existing_split_root(tmp_path):
    dataset_root = _make_dataset(tmp_path / "dataset", image_count=2)
    split_root = tmp_path / "split"
    stale_file = split_root / "stale.txt"
    stale_file.parent.mkdir(parents=True)
    stale_file.write_text("old artifact", encoding="utf-8")

    with pytest.raises(ValueError, match="split_root가 비어 있지 않습니다"):
        create_copy_split(dataset_root, split_root, train_ratio=0.5, val_ratio=0.5, seed=42)

    assert stale_file.read_text(encoding="utf-8") == "old artifact"
    assert not (split_root / "data.yaml").exists()


def test_create_classification_copy_split_writes_class_folder_layout(tmp_path):
    from app.services.split import create_classification_copy_split

    dataset_root = _make_classification_dataset(tmp_path / "cls", per_class=4)
    split_root = tmp_path / "split"

    result = create_classification_copy_split(
        dataset_root=dataset_root,
        split_root=split_root,
        train_ratio=0.5,
        val_ratio=0.25,
        test_ratio=0.25,
        seed=7,
    )

    assert result.train_count == 4
    assert result.val_count == 2
    assert result.test_count == 2
    assert result.dataset_yaml_path == split_root
    assert len(list((split_root / "train" / "ok").glob("*.jpg"))) == 2
    assert len(list((split_root / "train" / "ng").glob("*.jpg"))) == 2
    assert len(list((split_root / "val" / "ok").glob("*.jpg"))) == 1
    assert len(list((split_root / "test" / "ng").glob("*.jpg"))) == 1

    manifest = json.loads((split_root / "split_manifest.json").read_text(encoding="utf-8"))
    assert manifest["class_distribution"] == {"ng": 4, "ok": 4}
    assert manifest["task_type"] == "classification"
