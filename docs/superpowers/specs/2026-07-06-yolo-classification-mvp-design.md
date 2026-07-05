# YOLO Classification MVP 설계

## 배경

VisionOps는 현재 YOLO 기반 Object Detection workflow를 중심으로 프로젝트, 데이터셋, split, 학습 실행, worker, 아티팩트, 추론 결과를 관리한다. 다음 Computer Vision task 확장은 한 번에 여러 task를 붙이기보다 Image Classification부터 시작한다.

Classification의 첫 구현은 별도 PyTorch trainer를 만들지 않고 Ultralytics YOLO classification path를 사용한다. 이후 ResNet, EfficientNet, MobileNet은 별도 trainer abstraction이 생긴 뒤 확장한다.

## 목표

- 프로젝트 task로 `classification`을 지원한다.
- YOLO Classification 학습을 실행하고 결과를 VisionOps의 기존 training run 흐름에서 관리한다.
- YOLO26, YOLO11, YOLOv8 classification 모델을 모두 선택할 수 있게 한다.
- 각 YOLO family는 `n`, `s`, `m`, `l`, `x` 사이즈를 모두 지원한다.
- 사용자가 직접 `.pt` 모델 경로를 입력하는 custom model path를 지원한다.
- Classification용 데이터셋 구조, split, metrics, inference 표시를 Detection과 분리한다.

## 비목표

- ResNet, EfficientNet, MobileNet 구현은 이번 MVP 범위에 포함하지 않는다.
- Segmentation, Pose Estimation, Tracking은 이번 MVP 범위에 포함하지 않는다.
- multi-label classification은 지원하지 않는다. 이번 범위는 이미지당 단일 class label을 전제로 한다.
- 데이터 라벨링 도구는 만들지 않는다. 사용자는 class folder 구조의 이미지 데이터셋을 준비하거나 업로드한다.

## 모델 범위

UI에서 제공할 YOLO Classification 모델은 다음과 같다.

| Family | Size | Model name |
| --- | --- | --- |
| YOLO26 | n, s, m, l, x | `yolo26n-cls` ... `yolo26x-cls` |
| YOLO11 | n, s, m, l, x | `yolo11n-cls` ... `yolo11x-cls` |
| YOLOv8 | n, s, m, l, x | `yolov8n-cls` ... `yolov8x-cls` |
| Custom | 직접 입력 | 로컬 `.pt` 경로 또는 Ultralytics가 해석 가능한 모델명 |

기본 추천값은 `yolo26s-cls`로 둔다. 빠른 CPU 실험은 `yolo26n-cls`, 정확도 우선은 `yolo26m-cls` 이상을 안내한다. `l`, `x`는 고급 선택지로 표시하되 숨기지는 않는다.

## 데이터셋 구조

Classification 데이터셋은 YOLO classification format을 따른다.

```text
dataset_root/
  train/
    class_a/
      image_001.jpg
    class_b/
      image_002.jpg
  val/
    class_a/
    class_b/
  test/        # optional
    class_a/
    class_b/
```

Detection의 `images/`, `labels/`, `data.yaml` 구조와 다르므로 데이터셋 validation과 split 생성은 task별로 분기한다.

Classification dataset 등록 시 VisionOps는 다음을 확인한다.

- `train` 또는 원본 class folder가 존재한다.
- class directory가 최소 2개 이상 존재한다.
- 각 class directory에 지원 이미지 확장자가 최소 1개 이상 존재한다.
- class 이름은 directory 이름에서 가져온다.

원본 데이터셋이 이미 `train/val/test` 구조면 그대로 등록한다. 원본이 `class_name/*.jpg` 형태의 flat class folder라면 VisionOps split 기능이 `train/val/test` 구조로 복사 생성한다.

## 백엔드 설계

### Task 분기

`Project.task_type`은 기존 기본값 `detection`에 `classification`을 추가한다. API와 UI는 선택된 프로젝트 task에 따라 데이터셋 검증, split 생성, training command, metrics 표시, inference 결과 처리를 분기한다.

### Training command

Detection은 현재 다음 형태다.

```text
yolo detect train model=<model>.pt data=<dataset.yaml> ...
```

Classification은 다음 형태를 사용한다.

```text
yolo classify train model=<model>.pt data=<classification_dataset_dir> ...
```

`build_yolo_train_command`는 task를 인자로 받아 `detect` 또는 `classify`를 선택한다. Detection은 기존 `dataset_yaml_path`를 유지하고, Classification은 split root directory를 `data`로 전달한다.

### Training run 저장

기존 `TrainingRun` 모델은 그대로 재사용한다.

- `model_name`: `yolo26s-cls` 같은 선택 모델명 또는 custom path
- `trainer`: `ultralytics`
- `config`: 기존 training config 재사용
- `metrics_summary`: classification metrics summary 저장
- `artifact_path`, `log_path`: 기존과 동일

추가 DB 컬럼은 MVP에서 만들지 않는다. task 정보는 `Project.task_type`과 연결된 dataset/split에서 유도한다.

### Metrics

YOLO classification 결과의 `results.csv`를 읽어 다음 우선순위로 summary를 만든다.

- `metrics/accuracy_top1`
- `metrics/accuracy_top5`
- `val/loss`
- `train/loss`

Detection 전용 `metrics/mAP50`, `metrics/precision`, `metrics/recall`, `box_loss`, `dfl_loss` 표시는 classification project에서 사용하지 않는다.

### Artifacts

기존과 동일하게 다음 weight를 등록한다.

- `weights/best.pt`
- `weights/last.pt`

다운로드 대상은 기존 `results.csv`, `args.yaml`, report image를 최대한 재사용한다. Classification 학습 산출물에 confusion matrix나 results image가 있으면 report image grid에 그대로 노출한다.

## 프론트엔드 설계

### 프로젝트 생성

프로젝트 생성 또는 수정 UI에서 task type을 선택할 수 있게 한다.

- Object Detection
- Image Classification

기존 프로젝트는 `detection`으로 유지한다.

### 데이터셋 탭

Classification 프로젝트에서는 dataset 안내와 upload 검증 문구를 class folder 구조 기준으로 보여준다. Detection 프로젝트의 labels/data.yaml 안내는 숨긴다.

### 학습 설정

Classification 프로젝트의 모델 선택은 다음 그룹으로 표시한다.

```text
YOLO26: Nano, Small, Medium, Large, XLarge
YOLO11: Nano, Small, Medium, Large, XLarge
YOLOv8: Nano, Small, Medium, Large, XLarge
Custom .pt
```

각 옵션 value는 `.pt` 없는 모델명으로 저장한다. 백엔드의 `_model_weight_name`이 `.pt` suffix를 보정한다.

### 학습 결과 화면

Classification 프로젝트에서는 summary cards와 chart key를 classification metrics 중심으로 바꾼다.

- Top-1 Accuracy
- Top-5 Accuracy
- Validation Loss
- Training Loss

Training management 정렬도 classification project에서는 accuracy 기반 정렬을 제공한다.

## Inference 설계

Classification inference는 image 또는 folder 입력을 받는다. 출력은 bounding box가 아니라 이미지별 class ranking이다.

MVP 저장 구조는 기존 `InferenceRun`과 `InferencePrediction`을 재사용한다.

- `prediction_json`: top class, confidence, top-k ranking 저장
- `class_names`: 모델 class 이름 저장
- `max_confidence`: top class confidence 저장
- `output_image_path`: classification에는 시각화 이미지가 필수는 아니므로 원본 이미지 경로 또는 생성된 summary image 경로를 저장한다.

프론트는 Classification 프로젝트에서 prediction image overlay 대신 top class와 confidence list를 보여준다.

## 에러 처리

- Detection dataset을 classification project에 등록하면 class folder 구조가 아니라는 오류를 보여준다.
- Classification dataset을 detection project에 등록하면 `images/labels` 또는 `data.yaml` 누락 오류를 보여준다.
- custom model path가 존재하지 않거나 Ultralytics가 로드하지 못하면 training job을 failed로 기록하고 stdout log를 유지한다.
- `l/x` 모델에서 메모리 부족이 발생하면 job은 failed가 되며 로그와 오류 메시지를 보여준다.

## 테스트 계획

백엔드 테스트:

- classification dataset validation: valid class folder, empty class, single class, unsupported file
- classification split 생성: train/val/test 비율과 class별 파일 복사
- YOLO classify command 생성: family/size/custom model path
- training worker: classification run이 `classify train`을 호출하고 metrics summary를 저장
- API smoke: classification project 생성, dataset 등록, split 생성, training run 생성

프론트 테스트:

- classification project에서 모델 그룹이 YOLO26/11/v8 전체 사이즈를 표시
- detection project에서는 기존 detection 모델 UI 유지
- classification result page에서 top1/top5/loss labels 표시
- API client type이 classification task를 포함

## 향후 확장

YOLO Classification MVP 이후 다음 순서로 확장한다.

1. ResNet: `resnet18`, `resnet50`
2. EfficientNet: `efficientnet_b0`, `efficientnet_b2`
3. MobileNet: `mobilenet_v3_small`, `mobilenet_v3_large`

이때는 `trainer`를 `ultralytics`와 `torchvision`으로 분리하고, PyTorch training loop, checkpoint format, augmentation 설정, metrics 수집을 별도 abstraction으로 만든다.
