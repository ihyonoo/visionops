# VisionOps

VisionOps는 로컬 우선 Computer Vision Ops 웹 플랫폼입니다.

현재 MVP는 YOLO Object Detection workflow를 대상으로 합니다.

## 지원 task

- Object Detection: YOLO detection dataset(`images/`, `labels/`, `data.yaml`) 기반 학습/추론
- Image Classification: class folder dataset(`train/class_name/*.jpg` 또는 `class_name/*.jpg`) 기반 YOLO classification 학습/추론

Classification MVP는 YOLO26, YOLO11, YOLOv8의 `n/s/m/l/x` classification 모델과 custom `.pt` 경로를 지원합니다.

## 개발 실행

루트 디렉터리에서 다음 명령을 실행하면 백엔드 API, 작업 worker, 프론트엔드가 함께 켜집니다.

```bash
npm run dev
```

이 명령은 기본적으로 루트 `.venv/bin/python`을 사용합니다. 다른 Python을 써야 하면 `VISIONOPS_PYTHON=/path/to/python npm run dev`처럼 지정할 수 있습니다.
