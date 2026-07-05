from pathlib import Path
from typing import Any

import yaml
from PIL import Image

from app.services.dataset_validation import validate_yolo_dataset


def make_yolo_dataset(root: Path, names: Any, image_count: int = 1) -> Path:
    (root / "images").mkdir(parents=True)
    (root / "labels").mkdir(parents=True)
    (root / "data.yaml").write_text(yaml.safe_dump({"names": names}), encoding="utf-8")

    for index in range(image_count):
        image_name = f"img{index}.jpg"
        Image.new("RGB", (16, 16), color="white").save(root / "images" / image_name)
        (root / "labels" / f"img{index}.txt").write_text(
            "0 0.5 0.5 0.25 0.25\n", encoding="utf-8"
        )

    return root


def test_valid_yolo_dataset(tmp_path):
    dataset = make_yolo_dataset(tmp_path / "dataset", names=["defect"])

    result = validate_yolo_dataset(dataset)

    assert result.status == "valid"
    assert result.image_count == 1
    assert result.label_count == 1
    assert result.class_names == ["defect"]
    assert result.errors == []


def test_valid_yolo_dataset_accepts_contiguous_names_mapping(tmp_path):
    dataset = make_yolo_dataset(tmp_path / "dataset", names={0: "scratch", 1: "dent"})

    result = validate_yolo_dataset(dataset)

    assert result.status == "valid"
    assert result.class_names == ["scratch", "dent"]
    assert result.errors == []


def test_sparse_names_mapping_is_invalid(tmp_path):
    dataset = make_yolo_dataset(tmp_path / "dataset", names={0: "scratch", 2: "dent"})

    result = validate_yolo_dataset(dataset)

    assert result.status == "invalid"
    assert any("contiguous" in error and "0..n-1" in error for error in result.errors)


def test_dataset_requires_data_yaml(tmp_path):
    (tmp_path / "images").mkdir()
    (tmp_path / "labels").mkdir()

    result = validate_yolo_dataset(tmp_path)

    assert result.status == "invalid"
    assert "data.yaml" in result.errors[0]


def test_invalid_label_row_is_reported(tmp_path):
    dataset = make_yolo_dataset(tmp_path / "dataset", names=["defect"])
    (dataset / "labels" / "img0.txt").write_text("0 1.5 0.5 0.2 0.2\n", encoding="utf-8")

    result = validate_yolo_dataset(dataset)

    assert result.status == "invalid"
    assert any("normalized" in error for error in result.errors)


def test_nested_images_use_mirrored_label_paths(tmp_path):
    dataset = tmp_path / "dataset"
    (dataset / "images" / "train").mkdir(parents=True)
    (dataset / "labels" / "train").mkdir(parents=True)
    (dataset / "data.yaml").write_text(yaml.safe_dump({"names": ["defect"]}), encoding="utf-8")
    Image.new("RGB", (16, 16), color="white").save(dataset / "images" / "train" / "a.jpg")
    (dataset / "labels" / "train" / "a.txt").write_text(
        "0 0.5 0.5 0.25 0.25\n", encoding="utf-8"
    )

    result = validate_yolo_dataset(dataset)

    assert result.status == "valid"
    assert result.unlabeled_image_count == 0
    assert result.orphan_label_count == 0
    assert result.class_distribution == {"defect": 1}


def test_orphan_labels_compare_relative_paths_not_stems(tmp_path):
    dataset = tmp_path / "dataset"
    (dataset / "images" / "train").mkdir(parents=True)
    (dataset / "labels" / "val").mkdir(parents=True)
    (dataset / "data.yaml").write_text(yaml.safe_dump({"names": ["defect"]}), encoding="utf-8")
    Image.new("RGB", (16, 16), color="white").save(dataset / "images" / "train" / "same.jpg")
    (dataset / "labels" / "val" / "same.txt").write_text(
        "0 0.5 0.5 0.25 0.25\n", encoding="utf-8"
    )

    result = validate_yolo_dataset(dataset)

    assert result.status == "valid"
    assert result.unlabeled_image_count == 1
    assert result.orphan_label_count == 1
    assert any("images/train/same.jpg" in warning for warning in result.warnings)
    assert any("labels/val/same.txt" in warning for warning in result.warnings)


def make_classification_dataset(root: Path) -> Path:
    for class_name in ("ok", "ng"):
        class_dir = root / class_name
        class_dir.mkdir(parents=True)
        Image.new("RGB", (16, 16), color="white").save(class_dir / f"{class_name}.jpg")
    return root


def test_valid_classification_dataset_from_class_folders(tmp_path):
    from app.services.dataset_validation import validate_classification_dataset

    result = validate_classification_dataset(make_classification_dataset(tmp_path / "cls"))

    assert result.status == "valid"
    assert result.class_names == ["ng", "ok"]
    assert result.image_count == 2
    assert result.label_count == 0
    assert result.class_distribution == {"ng": 1, "ok": 1}


def test_valid_classification_dataset_from_train_val_layout(tmp_path):
    from app.services.dataset_validation import validate_classification_dataset

    for subset in ("train", "val"):
        for class_name in ("ok", "ng"):
            class_dir = tmp_path / "cls" / subset / class_name
            class_dir.mkdir(parents=True)
            Image.new("RGB", (16, 16), color="white").save(class_dir / f"{subset}-{class_name}.jpg")

    result = validate_classification_dataset(tmp_path / "cls")

    assert result.status == "valid"
    assert result.class_names == ["ng", "ok"]
    assert result.image_count == 4
    assert result.class_distribution == {"ng": 2, "ok": 2}


def test_classification_dataset_requires_two_classes(tmp_path):
    from app.services.dataset_validation import validate_classification_dataset

    class_dir = tmp_path / "cls" / "only"
    class_dir.mkdir(parents=True)
    Image.new("RGB", (16, 16), color="white").save(class_dir / "one.jpg")

    result = validate_classification_dataset(tmp_path / "cls")

    assert result.status == "invalid"
    assert any("최소 2개" in error for error in result.errors)
