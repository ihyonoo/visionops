# Notification Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slack, Discord, Telegram으로 학습/추론 완료와 실패 알림을 보낼 수 있는 앱 전체 공통 알림 설정을 만든다.

**Architecture:** 백엔드가 알림 설정과 전송 이력을 SQLite에 저장하고, worker가 학습/추론 terminal 상태를 커밋한 뒤 알림 서비스를 호출한다. 프론트엔드는 전역 설정 화면에서 채널별 연결 정보, 이벤트 토글, 테스트 알림을 관리한다.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, SQLite JSON columns, httpx, React, TypeScript, TanStack Query, Vitest, pytest

---

## 파일 구조

- Create: `backend/app/api/routes/notification_settings.py`
  - 알림 설정 조회/저장/삭제/테스트 API를 담당한다.
- Create: `backend/app/services/notifications.py`
  - 이벤트 메시지 생성, secret 마스킹, HTTP adapter, 전송 이력 기록을 담당한다.
- Create: `backend/tests/test_notification_settings_api.py`
  - 설정 API와 secret 비노출 동작을 검증한다.
- Create: `backend/tests/test_notification_service.py`
  - 채널별 payload, 이벤트 필터링, 실패 기록을 검증한다.
- Modify: `backend/pyproject.toml`
  - `httpx`를 runtime dependency로 승격한다.
- Modify: `backend/app/main.py`
  - 새 notification settings router를 등록한다.
- Modify: `backend/app/models.py`
  - `NotificationChannel`, `NotificationDelivery` 모델을 추가한다.
- Modify: `backend/app/schemas.py`
  - 알림 설정 API request/response schema를 추가한다.
- Modify: `backend/app/db.py`
  - 기존 SQLite DB에 새 테이블이 생성되도록 startup 호환성을 유지한다. `Base.metadata.create_all`이 새 테이블을 생성하므로 ALTER는 기존 테이블 컬럼 변경이 생길 때만 추가한다.
- Modify: `backend/app/worker.py`
  - 학습/추론 성공/실패 상태 커밋 이후 알림 서비스를 호출한다.
- Create: `frontend/src/pages/NotificationSettingsPage.tsx`
  - 전역 알림 설정 화면을 담당한다.
- Create: `frontend/tests/notification-settings-ui.test.tsx`
  - 알림 설정 화면의 렌더링과 API payload를 검증한다.
- Modify: `frontend/src/api/types.ts`
  - 알림 설정 타입을 추가한다.
- Modify: `frontend/src/App.tsx`
  - `settings` section 라우팅과 화면 전환을 추가한다.
- Modify: `frontend/src/components/Layout.tsx`
  - 설정 진입점을 추가한다.
- Modify: `frontend/src/i18n/LanguageProvider.tsx`
  - 한국어/영어 알림 설정 문구를 추가한다.
- Modify: `frontend/src/styles.css`
  - 설정 화면의 기존 디자인 톤에 맞는 스타일을 추가한다.

## Task 1: 백엔드 모델과 스키마 추가

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_notification_settings_api.py`

- [ ] **Step 1: runtime dependency에 `httpx` 추가**

`backend/pyproject.toml`의 `[project].dependencies`에 `httpx`를 추가한다.

```toml
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.30.0",
  "sqlalchemy>=2.0.30",
  "pydantic>=2.8.0",
  "pydantic-settings>=2.4.0",
  "python-multipart>=0.0.9",
  "pyyaml>=6.0.0",
  "pillow>=10.4.0",
  "pandas>=2.2.0",
  "httpx>=0.27.0",
]
```

- [ ] **Step 2: API 테스트 파일을 만들고 모델이 아직 없어서 실패하는 테스트 작성**

Create `backend/tests/test_notification_settings_api.py`.

```python
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_notification_settings_initial_state() -> None:
    response = client.get("/api/notification-settings")

    assert response.status_code == 200
    assert response.json() == [
        {
            "channel": "slack",
            "enabled": False,
            "events": {
                "training_completed": True,
                "training_failed": True,
                "inference_completed": True,
                "inference_failed": True,
            },
            "has_secret": False,
            "masked_secret": None,
            "last_status": "unknown",
            "last_error": None,
            "last_sent_at": None,
        },
        {
            "channel": "discord",
            "enabled": False,
            "events": {
                "training_completed": True,
                "training_failed": True,
                "inference_completed": True,
                "inference_failed": True,
            },
            "has_secret": False,
            "masked_secret": None,
            "last_status": "unknown",
            "last_error": None,
            "last_sent_at": None,
        },
        {
            "channel": "telegram",
            "enabled": False,
            "events": {
                "training_completed": True,
                "training_failed": True,
                "inference_completed": True,
                "inference_failed": True,
            },
            "has_secret": False,
            "masked_secret": None,
            "last_status": "unknown",
            "last_error": None,
            "last_sent_at": None,
        },
    ]
```

- [ ] **Step 3: 실패 확인**

Run:

```bash
cd backend && pytest tests/test_notification_settings_api.py::test_notification_settings_initial_state -q
```

Expected: `404 Not Found` 또는 route 미등록으로 FAIL.

- [ ] **Step 4: SQLAlchemy 모델 추가**

`backend/app/models.py`에 다음 모델을 추가한다.

```python
class NotificationChannel(TimestampMixin, Base):
    __tablename__ = "notification_channels"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    channel: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    enabled: Mapped[bool] = mapped_column(Integer, default=0, nullable=False)
    events: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    last_status: Mapped[str] = mapped_column(String, default="unknown", nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationDelivery(TimestampMixin, Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    channel_id: Mapped[str | None] = mapped_column(ForeignKey("notification_channels.id"), nullable=True)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    target_type: Mapped[str] = mapped_column(String, nullable=False)
    target_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
```

`enabled`는 SQLite 호환성을 위해 `Integer`를 사용하고 Python 코드에서는 `bool(channel.enabled)`로 읽는다.

- [ ] **Step 5: Pydantic schema 추가**

`backend/app/schemas.py`에 다음 schema를 추가한다.

```python
NotificationChannelName = Literal["slack", "discord", "telegram"]
NotificationEventName = Literal[
    "training_completed",
    "training_failed",
    "inference_completed",
    "inference_failed",
]


class NotificationEvents(BaseModel):
    training_completed: bool = True
    training_failed: bool = True
    inference_completed: bool = True
    inference_failed: bool = True


class NotificationSettingUpdate(BaseModel):
    enabled: bool = False
    events: NotificationEvents = Field(default_factory=NotificationEvents)
    webhook_url: str | None = None
    bot_token: str | None = None
    chat_id: str | None = None


class NotificationSettingRead(BaseModel):
    channel: NotificationChannelName
    enabled: bool
    events: NotificationEvents
    has_secret: bool
    masked_secret: str | None
    last_status: str
    last_error: str | None
    last_sent_at: datetime | None


class NotificationTestRequest(BaseModel):
    webhook_url: str | None = None
    bot_token: str | None = None
    chat_id: str | None = None


class NotificationTestRead(BaseModel):
    channel: NotificationChannelName
    status: Literal["sent", "failed"]
    message: str
```

- [ ] **Step 6: 테스트 실행**

Run:

```bash
cd backend && pytest tests/test_notification_settings_api.py::test_notification_settings_initial_state -q
```

Expected: 아직 route가 없으므로 FAIL.

- [ ] **Step 7: 커밋**

```bash
git add backend/pyproject.toml backend/app/models.py backend/app/schemas.py backend/tests/test_notification_settings_api.py
git commit -m "feat: add notification settings models"
```

## Task 2: 알림 설정 API 구현

**Files:**
- Create: `backend/app/api/routes/notification_settings.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_notification_settings_api.py`

- [ ] **Step 1: 설정 저장/마스킹 테스트 추가**

`backend/tests/test_notification_settings_api.py`에 다음 테스트를 추가한다.

```python
def test_update_slack_setting_masks_secret() -> None:
    response = client.put(
        "/api/notification-settings/slack",
        json={
            "enabled": True,
            "events": {
                "training_completed": True,
                "training_failed": False,
                "inference_completed": True,
                "inference_failed": False,
            },
            "webhook_url": "https://hooks.slack.com/services/T000/B000/SECRET",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["channel"] == "slack"
    assert payload["enabled"] is True
    assert payload["events"]["training_failed"] is False
    assert payload["has_secret"] is True
    assert "SECRET" not in payload["masked_secret"]
    assert payload["masked_secret"].startswith("https://hooks.slack.com/")


def test_update_rejects_wrong_channel_secret() -> None:
    response = client.put(
        "/api/notification-settings/telegram",
        json={
            "enabled": True,
            "events": {
                "training_completed": True,
                "training_failed": True,
                "inference_completed": True,
                "inference_failed": True,
            },
            "webhook_url": "https://example.com/webhook",
        },
    )

    assert response.status_code == 400
    assert "bot token" in response.json()["detail"].lower()
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
cd backend && pytest tests/test_notification_settings_api.py -q
```

Expected: route 미등록으로 FAIL.

- [ ] **Step 3: 알림 설정 route 구현**

Create `backend/app/api/routes/notification_settings.py`.

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import NotificationChannel
from app.schemas import (
    NotificationEvents,
    NotificationSettingRead,
    NotificationSettingUpdate,
    NotificationTestRead,
    NotificationTestRequest,
)
from app.services.ids import new_id
from app.services.notifications import (
    CHANNELS,
    default_events,
    masked_channel_secret,
    notification_setting_to_read,
    send_test_notification,
    update_channel_config,
)

router = APIRouter(prefix="/api/notification-settings", tags=["notification-settings"])


def _require_supported_channel(channel: str) -> str:
    if channel not in CHANNELS:
        raise HTTPException(status_code=404, detail="지원하지 않는 알림 채널입니다.")
    return channel


def _get_channel(db: Session, channel: str) -> NotificationChannel | None:
    return db.scalar(select(NotificationChannel).where(NotificationChannel.channel == channel))


@router.get("", response_model=list[NotificationSettingRead])
def list_notification_settings(
    db: Annotated[Session, Depends(get_db)],
) -> list[NotificationSettingRead]:
    rows = {
        row.channel: row
        for row in db.scalars(select(NotificationChannel)).all()
    }
    return [
        notification_setting_to_read(rows.get(channel), channel)
        for channel in CHANNELS
    ]


@router.put("/{channel}", response_model=NotificationSettingRead)
def update_notification_setting(
    channel: str,
    payload: NotificationSettingUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> NotificationSettingRead:
    channel = _require_supported_channel(channel)
    row = _get_channel(db, channel)
    if row is None:
        row = NotificationChannel(
            id=new_id("ntc"),
            channel=channel,
            events=default_events(),
            config={},
        )
        db.add(row)

    try:
        row.config = update_channel_config(channel, row.config or {}, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row.enabled = 1 if payload.enabled else 0
    row.events = payload.events.model_dump()
    db.commit()
    db.refresh(row)
    return notification_setting_to_read(row, channel)


@router.delete("/{channel}", status_code=204)
def delete_notification_setting(
    channel: str,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    channel = _require_supported_channel(channel)
    row = _get_channel(db, channel)
    if row is None:
        return
    db.delete(row)
    db.commit()


@router.post("/{channel}/test", response_model=NotificationTestRead)
def test_notification_setting(
    channel: str,
    payload: NotificationTestRequest,
    db: Annotated[Session, Depends(get_db)],
) -> NotificationTestRead:
    channel = _require_supported_channel(channel)
    result = send_test_notification(db, channel, payload)
    return NotificationTestRead(channel=channel, status=result.status, message=result.message)
```

- [ ] **Step 4: `app.main`에 router 등록**

`backend/app/main.py` import와 include를 수정한다.

```python
from app.api.routes import datasets, inference, notification_settings, projects, runtime, splits, training
```

```python
app.include_router(notification_settings.router)
```

- [ ] **Step 5: 테스트 실행**

Run:

```bash
cd backend && pytest tests/test_notification_settings_api.py -q
```

Expected: `app.services.notifications` 미구현으로 FAIL.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/api/routes/notification_settings.py backend/app/main.py backend/tests/test_notification_settings_api.py
git commit -m "feat: add notification settings api"
```

## Task 3: 알림 서비스와 채널 adapter 구현

**Files:**
- Create: `backend/app/services/notifications.py`
- Test: `backend/tests/test_notification_service.py`
- Test: `backend/tests/test_notification_settings_api.py`

- [ ] **Step 1: 서비스 테스트 작성**

Create `backend/tests/test_notification_service.py`.

```python
from collections.abc import Generator
from datetime import datetime, timezone

import httpx
import pytest

from app.db import SessionLocal
from app.models import NotificationChannel
from app.services.ids import new_id
from app.services.notifications import (
    NotificationEvent,
    default_events,
    mask_secret,
    redact_secret,
    send_work_notification,
)


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_mask_secret_preserves_prefix_and_hides_tail() -> None:
    masked = mask_secret("https://hooks.slack.com/services/T000/B000/SECRET")

    assert masked.startswith("https://hooks.slack.com/")
    assert "SECRET" not in masked
    assert masked.endswith("CRET") is False


def test_redact_secret_removes_webhook_and_token() -> None:
    message = redact_secret(
        "failed https://discord.com/api/webhooks/123/SECRET bot123:ABCDEF"
    )

    assert "SECRET" not in message
    assert "bot123:ABCDEF" not in message
    assert "[redacted]" in message


def test_send_work_notification_skips_disabled_event(db) -> None:
    channel = NotificationChannel(
        id=new_id("ntc"),
        channel="slack",
        enabled=1,
        events={
            **default_events(),
            "training_completed": False,
        },
        config={"webhook_url": "https://hooks.slack.com/services/T000/B000/SECRET"},
    )
    db.add(channel)
    db.commit()

    sent = send_work_notification(
        db,
        NotificationEvent(
            event_type="training_completed",
            target_type="training",
            target_id="run_1",
            project_name="Demo",
            run_name="Train A",
            status="completed",
            occurred_at=datetime.now(timezone.utc),
            summary={"best_map50": 0.91},
        ),
    )

    assert sent == []


def test_send_work_notification_records_failure(db, monkeypatch: pytest.MonkeyPatch) -> None:
    channel = NotificationChannel(
        id=new_id("ntc"),
        channel="discord",
        enabled=1,
        events=default_events(),
        config={"webhook_url": "https://discord.com/api/webhooks/123/SECRET"},
    )
    db.add(channel)
    db.commit()

    def raise_timeout(*args, **kwargs):
        raise httpx.TimeoutException("timeout https://discord.com/api/webhooks/123/SECRET")

    monkeypatch.setattr("app.services.notifications.httpx.post", raise_timeout)

    sent = send_work_notification(
        db,
        NotificationEvent(
            event_type="training_failed",
            target_type="training",
            target_id="run_2",
            project_name="Demo",
            run_name="Train B",
            status="failed",
            occurred_at=datetime.now(timezone.utc),
            summary={},
        ),
    )

    assert sent == []
    db.refresh(channel)
    assert channel.last_status == "failed"
    assert channel.last_error is not None
    assert "SECRET" not in channel.last_error
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
cd backend && pytest tests/test_notification_service.py -q
```

Expected: `app.services.notifications` 미구현으로 FAIL.

- [ ] **Step 3: 알림 서비스 구현**

Create `backend/app/services/notifications.py`.

```python
from dataclasses import dataclass
from datetime import datetime, timezone
import re
from typing import Literal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import NotificationChannel, NotificationDelivery
from app.schemas import NotificationSettingRead, NotificationSettingUpdate, NotificationTestRequest
from app.services.ids import new_id

CHANNELS = ("slack", "discord", "telegram")
EVENTS = ("training_completed", "training_failed", "inference_completed", "inference_failed")

NotificationEventType = Literal[
    "training_completed",
    "training_failed",
    "inference_completed",
    "inference_failed",
]


@dataclass(frozen=True)
class NotificationEvent:
    event_type: NotificationEventType
    target_type: Literal["training", "inference"]
    target_id: str
    project_name: str
    run_name: str
    status: str
    occurred_at: datetime
    summary: dict


@dataclass(frozen=True)
class NotificationResult:
    channel: str
    status: Literal["sent", "failed"]
    message: str


def default_events() -> dict[str, bool]:
    return {event: True for event in EVENTS}


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith("https://hooks.slack.com/"):
        return "https://hooks.slack.com/" + "•" * 10
    if value.startswith("https://discord.com/api/webhooks/"):
        return "https://discord.com/api/webhooks/" + "•" * 10
    if len(value) <= 6:
        return "•" * len(value)
    return f"{value[:3]}{'•' * 8}{value[-3:]}"


def redact_secret(message: str) -> str:
    redacted = re.sub(r"https://hooks\.slack\.com/\S+", "[redacted]", message)
    redacted = re.sub(r"https://discord(?:app)?\.com/api/webhooks/\S+", "[redacted]", redacted)
    redacted = re.sub(r"\bbot[0-9A-Za-z:_-]+", "[redacted]", redacted)
    redacted = re.sub(r"\b[0-9]{6,}:[0-9A-Za-z_-]{20,}\b", "[redacted]", redacted)
    return redacted


def _secret_for_channel(channel: str, config: dict) -> str | None:
    if channel in {"slack", "discord"}:
        return config.get("webhook_url")
    if channel == "telegram":
        token = config.get("bot_token")
        chat_id = config.get("chat_id")
        if token and chat_id:
            return f"{token}:{chat_id}"
        return token or chat_id
    return None


def masked_channel_secret(channel: str, config: dict | None) -> str | None:
    return mask_secret(_secret_for_channel(channel, config or {}))


def notification_setting_to_read(
    row: NotificationChannel | None,
    channel: str,
) -> NotificationSettingRead:
    events = row.events if row is not None and row.events else default_events()
    config = row.config if row is not None and row.config else {}
    return NotificationSettingRead(
        channel=channel,
        enabled=bool(row.enabled) if row is not None else False,
        events=events,
        has_secret=bool(_secret_for_channel(channel, config)),
        masked_secret=masked_channel_secret(channel, config),
        last_status=row.last_status if row is not None else "unknown",
        last_error=row.last_error if row is not None else None,
        last_sent_at=row.last_sent_at if row is not None else None,
    )


def update_channel_config(
    channel: str,
    current: dict,
    payload: NotificationSettingUpdate,
) -> dict:
    next_config = dict(current)
    if channel in {"slack", "discord"}:
        if payload.bot_token or payload.chat_id:
            raise ValueError("Slack과 Discord는 webhook URL만 사용합니다.")
        if payload.webhook_url:
            next_config["webhook_url"] = payload.webhook_url.strip()
        if payload.enabled and not next_config.get("webhook_url"):
            raise ValueError("Webhook URL이 필요합니다.")
        return next_config

    if channel == "telegram":
        if payload.webhook_url:
            raise ValueError("Telegram은 bot token과 chat id가 필요합니다.")
        if payload.bot_token:
            next_config["bot_token"] = payload.bot_token.strip()
        if payload.chat_id:
            next_config["chat_id"] = payload.chat_id.strip()
        if payload.enabled and (not next_config.get("bot_token") or not next_config.get("chat_id")):
            raise ValueError("Telegram bot token과 chat id가 필요합니다.")
        return next_config

    raise ValueError("지원하지 않는 알림 채널입니다.")


def _message_for_event(event: NotificationEvent) -> str:
    title = {
        "training_completed": "VisionOps 학습 완료",
        "training_failed": "VisionOps 학습 실패",
        "inference_completed": "VisionOps 추론 완료",
        "inference_failed": "VisionOps 추론 실패",
    }[event.event_type]
    lines = [
        f"{title}",
        f"프로젝트: {event.project_name}",
        f"실행: {event.run_name}",
        f"상태: {event.status}",
        f"시각: {event.occurred_at.isoformat()}",
    ]
    if event.summary:
        summary_text = ", ".join(f"{key}={value}" for key, value in sorted(event.summary.items()))
        lines.append(f"요약: {summary_text}")
    return "\n".join(lines)


def _post_slack(config: dict, text: str) -> None:
    httpx.post(config["webhook_url"], json={"text": text}, timeout=10).raise_for_status()


def _post_discord(config: dict, text: str) -> None:
    httpx.post(config["webhook_url"], json={"content": text}, timeout=10).raise_for_status()


def _post_telegram(config: dict, text: str) -> None:
    url = f"https://api.telegram.org/bot{config['bot_token']}/sendMessage"
    httpx.post(url, json={"chat_id": config["chat_id"], "text": text}, timeout=10).raise_for_status()


def _dispatch(channel: str, config: dict, text: str) -> None:
    if channel == "slack":
        _post_slack(config, text)
        return
    if channel == "discord":
        _post_discord(config, text)
        return
    if channel == "telegram":
        _post_telegram(config, text)
        return
    raise ValueError("지원하지 않는 알림 채널입니다.")


def _record_delivery(
    db: Session,
    channel: NotificationChannel | None,
    channel_name: str,
    event: NotificationEvent,
    status: str,
    error_message: str | None = None,
) -> None:
    db.add(
        NotificationDelivery(
            id=new_id("ntd"),
            channel_id=channel.id if channel is not None else None,
            channel=channel_name,
            event_type=event.event_type,
            target_type=event.target_type,
            target_id=event.target_id,
            status=status,
            error_message=error_message,
        )
    )
    if channel is not None:
        channel.last_status = status
        channel.last_error = error_message
        if status == "sent":
            channel.last_sent_at = datetime.now(timezone.utc)


def send_work_notification(db: Session, event: NotificationEvent) -> list[NotificationResult]:
    rows = db.scalars(select(NotificationChannel).where(NotificationChannel.enabled == 1)).all()
    results: list[NotificationResult] = []
    text = _message_for_event(event)

    for row in rows:
        if not bool((row.events or default_events()).get(event.event_type, False)):
            continue
        try:
            _dispatch(row.channel, row.config or {}, text)
        except Exception as exc:
            message = redact_secret(str(exc) or "알림 전송에 실패했습니다.")
            _record_delivery(db, row, row.channel, event, "failed", message)
            continue
        _record_delivery(db, row, row.channel, event, "sent")
        results.append(NotificationResult(channel=row.channel, status="sent", message="알림을 보냈습니다."))

    db.commit()
    return results


def send_test_notification(
    db: Session,
    channel: str,
    payload: NotificationTestRequest,
) -> NotificationResult:
    row = db.scalar(select(NotificationChannel).where(NotificationChannel.channel == channel))
    config = row.config if row is not None and row.config else {}
    override = {
        key: value
        for key, value in payload.model_dump().items()
        if value
    }
    config = {**config, **override}
    event = NotificationEvent(
        event_type="training_completed",
        target_type="training",
        target_id="test",
        project_name="VisionOps",
        run_name="테스트 알림",
        status="completed",
        occurred_at=datetime.now(timezone.utc),
        summary={},
    )
    try:
        _dispatch(channel, config, _message_for_event(event))
    except Exception as exc:
        message = redact_secret(str(exc) or "테스트 알림 전송에 실패했습니다.")
        _record_delivery(db, row, channel, event, "failed", message)
        db.commit()
        return NotificationResult(channel=channel, status="failed", message=message)
    _record_delivery(db, row, channel, event, "sent")
    db.commit()
    return NotificationResult(channel=channel, status="sent", message="테스트 알림을 보냈습니다.")
```

- [ ] **Step 4: route 테스트와 service 테스트 실행**

Run:

```bash
cd backend && pytest tests/test_notification_settings_api.py tests/test_notification_service.py -q
```

Expected: PASS. The API response schema reads `enabled=bool(row.enabled)`, so SQLite integer storage returns JSON booleans.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/notifications.py backend/tests/test_notification_service.py backend/tests/test_notification_settings_api.py
git commit -m "feat: send notifications to chat channels"
```

## Task 4: worker 완료/실패 이벤트 연동

**Files:**
- Modify: `backend/app/worker.py`
- Test: `backend/tests/test_jobs.py` 또는 새 `backend/tests/test_worker_notifications.py`

- [ ] **Step 1: worker 알림 호출 테스트 작성**

Create `backend/tests/test_worker_notifications.py`.

```python
from collections.abc import Generator
from datetime import datetime, timezone

import pytest

from app.db import SessionLocal
from app.models import InferenceRun, Job, Project, TrainingRun
from app.services.ids import new_id
from app.worker import notify_inference_finished, notify_training_finished


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_notify_training_finished_uses_project_and_run(db, monkeypatch) -> None:
    project = Project(id=new_id("prj"), name="Demo", slug="demo", description="", task_type="detection")
    run = TrainingRun(
        id=new_id("trn"),
        project_id=project.id,
        dataset_id="dataset",
        split_id="split",
        name="Train A",
        model_name="yolov8n.pt",
        status="completed",
        config={},
        metrics_summary={"best_map50": 0.9},
        finished_at=datetime.now(timezone.utc),
    )
    db.add_all([project, run])
    db.commit()
    captured = []

    def capture(db, event):
        captured.append(event)
        return []

    monkeypatch.setattr("app.worker.send_work_notification", capture)

    notify_training_finished(db, run, "training_completed")

    assert captured[0].project_name == "Demo"
    assert captured[0].run_name == "Train A"
    assert captured[0].summary == {"best_map50": 0.9}


def test_notify_inference_finished_uses_prediction_count(db, monkeypatch) -> None:
    project = Project(id=new_id("prj"), name="Demo", slug="demo", description="", task_type="detection")
    run = InferenceRun(
        id=new_id("inf"),
        project_id=project.id,
        model_artifact_id="artifact",
        name="Predict A",
        input_type="image",
        input_path="/tmp/image.jpg",
        status="completed",
        config={},
        prediction_count=7,
        finished_at=datetime.now(timezone.utc),
    )
    db.add_all([project, run])
    db.commit()
    captured = []

    def capture(db, event):
        captured.append(event)
        return []

    monkeypatch.setattr("app.worker.send_work_notification", capture)

    notify_inference_finished(db, run, "inference_completed")

    assert captured[0].project_name == "Demo"
    assert captured[0].run_name == "Predict A"
    assert captured[0].summary == {"prediction_count": 7}
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
cd backend && pytest tests/test_worker_notifications.py -q
```

Expected: `notify_training_finished` 미구현으로 FAIL.

- [ ] **Step 3: worker helper 추가**

`backend/app/worker.py` import에 추가한다.

```python
from app.models import InferenceRun, Job, ModelArtifact, Project, TrainingRun
from app.services.notifications import NotificationEvent, send_work_notification
```

`backend/app/worker.py`에 helper를 추가한다.

```python
def _project_name(db: Session, project_id: str) -> str:
    project = db.get(Project, project_id)
    return project.name if project is not None else project_id


def notify_training_finished(db: Session, run: TrainingRun, event_type: str) -> None:
    send_work_notification(
        db,
        NotificationEvent(
            event_type=event_type,
            target_type="training",
            target_id=run.id,
            project_name=_project_name(db, run.project_id),
            run_name=run.name,
            status=run.status,
            occurred_at=run.finished_at or datetime.now(timezone.utc),
            summary=run.metrics_summary or {},
        ),
    )


def notify_inference_finished(db: Session, run: InferenceRun, event_type: str) -> None:
    send_work_notification(
        db,
        NotificationEvent(
            event_type=event_type,
            target_type="inference",
            target_id=run.id,
            project_name=_project_name(db, run.project_id),
            run_name=run.name,
            status=run.status,
            occurred_at=run.finished_at or datetime.now(timezone.utc),
            summary={"prediction_count": run.prediction_count},
        ),
    )
```

- [ ] **Step 4: 성공/실패 커밋 직후 helper 호출**

`handle_training_job`에서 `run.status = "completed"`로 커밋한 뒤:

```python
        db.commit()
        notify_training_finished(db, run, "training_completed")
```

학습 실패 branch마다 `db.commit()` 직후 다음을 호출한다.

```python
        notify_training_finished(db, run, "training_failed")
        return
```

`handle_inference_job`에서 추론 성공 커밋 직후:

```python
        db.commit()
        notify_inference_finished(db, run, "inference_completed")
```

추론 실패 branch마다 `db.commit()` 직후 다음을 호출한다.

```python
        notify_inference_finished(db, run, "inference_failed")
        return
```

알림 함수 내부에서 예외를 삼키거나, helper 호출부를 `try/except Exception`으로 감싸서 알림 실패가 worker를 죽이지 않게 한다. 권장 구현은 helper 내부를 다음처럼 감싸는 방식이다.

```python
def _send_notification_safely(db: Session, event: NotificationEvent) -> None:
    try:
        send_work_notification(db, event)
    except Exception:
        db.rollback()
```

그리고 `notify_training_finished`, `notify_inference_finished`는 `send_work_notification` 대신 `_send_notification_safely`를 호출한다.

- [ ] **Step 5: 테스트 실행**

Run:

```bash
cd backend && pytest tests/test_worker_notifications.py tests/test_jobs.py -q
```

Expected: PASS.

- [ ] **Step 6: 전체 백엔드 테스트 실행**

Run:

```bash
cd backend && pytest -q
```

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add backend/app/worker.py backend/tests/test_worker_notifications.py
git commit -m "feat: notify when work finishes"
```

## Task 5: 프론트엔드 타입과 설정 페이지 추가

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/pages/NotificationSettingsPage.tsx`
- Create: `frontend/tests/notification-settings-ui.test.tsx`

- [ ] **Step 1: UI 테스트 작성**

Add these devDependencies to `frontend/package.json`, then run `cd frontend && npm install` so `frontend/package-lock.json` is updated.

```json
"@testing-library/jest-dom": "^6.4.8",
"@testing-library/react": "^16.0.0"
```

Create `frontend/tests/notification-settings-ui.test.tsx`.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "../src/i18n/LanguageProvider";
import { NotificationSettingsPage } from "../src/pages/NotificationSettingsPage";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <NotificationSettingsPage />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe("NotificationSettingsPage", () => {
  it("renders supported channels and saves a slack webhook", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/notification-settings") && !init) {
        return Response.json([
          {
            channel: "slack",
            enabled: false,
            events: {
              training_completed: true,
              training_failed: true,
              inference_completed: true,
              inference_failed: true,
            },
            has_secret: false,
            masked_secret: null,
            last_status: "unknown",
            last_error: null,
            last_sent_at: null,
          },
          {
            channel: "discord",
            enabled: false,
            events: {
              training_completed: true,
              training_failed: true,
              inference_completed: true,
              inference_failed: true,
            },
            has_secret: false,
            masked_secret: null,
            last_status: "unknown",
            last_error: null,
            last_sent_at: null,
          },
          {
            channel: "telegram",
            enabled: false,
            events: {
              training_completed: true,
              training_failed: true,
              inference_completed: true,
              inference_failed: true,
            },
            has_secret: false,
            masked_secret: null,
            last_status: "unknown",
            last_error: null,
            last_sent_at: null,
          },
        ]);
      }
      if (url.endsWith("/api/notification-settings/slack")) {
        expect(init?.method).toBe("PUT");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          enabled: true,
          webhook_url: "https://hooks.slack.com/services/T/B/SECRET",
        });
        return Response.json({
          channel: "slack",
          enabled: true,
          events: {
            training_completed: true,
            training_failed: true,
            inference_completed: true,
            inference_failed: true,
          },
          has_secret: true,
          masked_secret: "https://hooks.slack.com/••••••••••",
          last_status: "unknown",
          last_error: null,
          last_sent_at: null,
        });
      }
      return new Response("not found", { status: 404 });
    });

    renderPage();

    expect(await screen.findByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("Discord")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Slack 활성화"));
    fireEvent.change(screen.getByLabelText("Slack Webhook URL"), {
      target: { value: "https://hooks.slack.com/services/T/B/SECRET" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Slack 저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/slack"), expect.anything()));
    fetchMock.mockRestore();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
cd frontend && npm test -- notification-settings-ui.test.tsx
```

Expected: page 미구현 또는 testing-library 미설치로 FAIL.

- [ ] **Step 3: 타입 추가**

`frontend/src/api/types.ts`에 추가한다.

```ts
export type NotificationChannelName = "slack" | "discord" | "telegram";

export type NotificationEvents = {
  training_completed: boolean;
  training_failed: boolean;
  inference_completed: boolean;
  inference_failed: boolean;
};

export type NotificationSetting = {
  channel: NotificationChannelName;
  enabled: boolean;
  events: NotificationEvents;
  has_secret: boolean;
  masked_secret: string | null;
  last_status: "unknown" | "sent" | "failed" | string;
  last_error: string | null;
  last_sent_at: Timestamp | null;
};

export type NotificationSettingUpdate = {
  enabled: boolean;
  events: NotificationEvents;
  webhook_url?: string;
  bot_token?: string;
  chat_id?: string;
};

export type NotificationTestResult = {
  channel: NotificationChannelName;
  status: "sent" | "failed";
  message: string;
};
```

- [ ] **Step 4: 설정 페이지 구현**

Create `frontend/src/pages/NotificationSettingsPage.tsx`.

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";

import { apiDelete, apiGet, apiPost, apiPut } from "../api/client";
import type {
  NotificationChannelName,
  NotificationEvents,
  NotificationSetting,
  NotificationSettingUpdate,
  NotificationTestResult,
} from "../api/types";
import { useLanguage } from "../i18n/LanguageProvider";

const channels: NotificationChannelName[] = ["slack", "discord", "telegram"];

const defaultEvents: NotificationEvents = {
  training_completed: true,
  training_failed: true,
  inference_completed: true,
  inference_failed: true,
};

type Draft = {
  enabled: boolean;
  events: NotificationEvents;
  webhook_url: string;
  bot_token: string;
  chat_id: string;
};

function draftFromSetting(setting: NotificationSetting | undefined): Draft {
  return {
    enabled: setting?.enabled ?? false,
    events: setting?.events ?? defaultEvents,
    webhook_url: "",
    bot_token: "",
    chat_id: "",
  };
}

function channelTitle(channel: NotificationChannelName): string {
  if (channel === "slack") return "Slack";
  if (channel === "discord") return "Discord";
  return "Telegram";
}

export function NotificationSettingsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryFn: () => apiGet<NotificationSetting[]>("/api/notification-settings"),
    queryKey: ["notification-settings"],
  });
  const [drafts, setDrafts] = useState<Record<NotificationChannelName, Draft>>({
    slack: draftFromSetting(undefined),
    discord: draftFromSetting(undefined),
    telegram: draftFromSetting(undefined),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setDrafts({
      slack: draftFromSetting(settingsQuery.data.find((setting) => setting.channel === "slack")),
      discord: draftFromSetting(settingsQuery.data.find((setting) => setting.channel === "discord")),
      telegram: draftFromSetting(settingsQuery.data.find((setting) => setting.channel === "telegram")),
    });
  }, [settingsQuery.data]);

  const saveSetting = useMutation({
    mutationFn: ({ channel, body }: { channel: NotificationChannelName; body: NotificationSettingUpdate }) =>
      apiPut<NotificationSetting>(`/api/notification-settings/${channel}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-settings"] }),
  });
  const testSetting = useMutation({
    mutationFn: (channel: NotificationChannelName) =>
      apiPost<NotificationTestResult>(`/api/notification-settings/${channel}/test`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-settings"] }),
  });
  const deleteSetting = useMutation({
    mutationFn: (channel: NotificationChannelName) => apiDelete(`/api/notification-settings/${channel}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-settings"] }),
  });

  function updateDraft(channel: NotificationChannelName, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [channel]: { ...current[channel], ...patch },
    }));
  }

  function updateEvent(channel: NotificationChannelName, event: keyof NotificationEvents, value: boolean) {
    updateDraft(channel, {
      events: {
        ...drafts[channel].events,
        [event]: value,
      },
    });
  }

  function submit(channel: NotificationChannelName, event: FormEvent) {
    event.preventDefault();
    const draft = drafts[channel];
    const body: NotificationSettingUpdate = {
      enabled: draft.enabled,
      events: draft.events,
    };
    if (channel === "telegram") {
      if (draft.bot_token.trim()) body.bot_token = draft.bot_token.trim();
      if (draft.chat_id.trim()) body.chat_id = draft.chat_id.trim();
    } else if (draft.webhook_url.trim()) {
      body.webhook_url = draft.webhook_url.trim();
    }
    saveSetting.mutate({ channel, body });
  }

  return (
    <main className="settings-page" aria-labelledby="notification-settings-title">
      <header className="page-heading">
        <h1 id="notification-settings-title">{t("notifications.title")}</h1>
        <p>{t("notifications.description")}</p>
      </header>
      <div className="notification-settings-grid">
        {channels.map((channel) => {
          const title = channelTitle(channel);
          const setting = settingsQuery.data?.find((candidate) => candidate.channel === channel);
          const draft = drafts[channel];
          return (
            <form className="notification-card" key={channel} onSubmit={(event) => submit(channel, event)}>
              <header>
                <h2>{title}</h2>
                <label>
                  <input
                    aria-label={`${title} 활성화`}
                    checked={draft.enabled}
                    onChange={(event) => updateDraft(channel, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  {t("notifications.enabled")}
                </label>
              </header>

              {channel === "telegram" ? (
                <>
                  <label>
                    Telegram Bot Token
                    <input
                      aria-label="Telegram Bot Token"
                      onChange={(event) => updateDraft(channel, { bot_token: event.target.value })}
                      placeholder={setting?.has_secret ? setting.masked_secret ?? "" : ""}
                      type="password"
                      value={draft.bot_token}
                    />
                  </label>
                  <label>
                    Telegram Chat ID
                    <input
                      aria-label="Telegram Chat ID"
                      onChange={(event) => updateDraft(channel, { chat_id: event.target.value })}
                      placeholder={setting?.has_secret ? t("notifications.saved") : ""}
                      value={draft.chat_id}
                    />
                  </label>
                </>
              ) : (
                <label>
                  {title} Webhook URL
                  <input
                    aria-label={`${title} Webhook URL`}
                    onChange={(event) => updateDraft(channel, { webhook_url: event.target.value })}
                    placeholder={setting?.masked_secret ?? ""}
                    type="password"
                    value={draft.webhook_url}
                  />
                </label>
              )}

              <fieldset>
                <legend>{t("notifications.events")}</legend>
                {(["training_completed", "training_failed", "inference_completed", "inference_failed"] as const).map(
                  (eventName) => (
                    <label key={eventName}>
                      <input
                        checked={draft.events[eventName]}
                        onChange={(event) => updateEvent(channel, eventName, event.target.checked)}
                        type="checkbox"
                      />
                      {t(`notifications.event.${eventName}`)}
                    </label>
                  ),
                )}
              </fieldset>

              {setting?.last_status === "failed" && setting.last_error ? (
                <p className="form-error">{setting.last_error}</p>
              ) : null}

              <footer>
                <button className="primary-button" type="submit">
                  {title} {t("common.save")}
                </button>
                <button onClick={() => testSetting.mutate(channel)} type="button">
                  {t("notifications.test")}
                </button>
                <button onClick={() => deleteSetting.mutate(channel)} type="button">
                  {t("common.delete")}
                </button>
              </footer>
            </form>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: `apiPut` helper 추가**

`frontend/src/api/client.ts`에 이미 `apiPatch`가 있으므로 `apiPut`을 추가한다.

```ts
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const requestBody = body instanceof FormData ? body : JSON.stringify(body);
  return apiRequest<T>(path, {
    body: requestBody,
    method: "PUT",
  });
}
```

- [ ] **Step 6: 테스트 실행**

Run:

```bash
cd frontend && npm test -- notification-settings-ui.test.tsx
```

Expected: PASS after installing any missing testing-library packages.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/api/client.ts frontend/src/api/types.ts frontend/src/pages/NotificationSettingsPage.tsx frontend/tests/notification-settings-ui.test.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat: add notification settings page"
```

## Task 6: 전역 설정 라우팅, 문구, 스타일 연결

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/i18n/LanguageProvider.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/tests/i18n-source.test.js`
- Test: `frontend/tests/styles-source.test.js`
- Test: `frontend/tests/projects-ui.test.tsx`

- [ ] **Step 1: App routing 테스트 보강**

기존 `frontend/tests/projects-ui.test.tsx`에서 라우팅 테스트가 있으면 `/settings/notifications`를 추가한다. 없다면 source-level test를 추가한다.

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("settings route source", () => {
  it("registers notification settings route", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    expect(appSource).toContain("settings-notifications");
    expect(appSource).toContain("/settings/notifications");
  });
});
```

- [ ] **Step 2: App section 추가**

`frontend/src/App.tsx`에 `settings-notifications` section을 추가한다.

```ts
type AppHistoryState =
  | { projectId: null; section: "projects" | DetailTab | "training-management" | "settings-notifications"; trainingRunId?: null }
  | { projectId: string; section: DetailTab | "training-management"; trainingRunId?: string | null };
```

`appPath`에 section 처리 추가:

```ts
if (section === "settings-notifications") return "/settings/notifications";
```

`stateFromLocation`에 추가:

```ts
if (window.location.pathname === "/settings/notifications") {
  return { projectId: null, section: "settings-notifications" };
}
```

렌더링 branch에 추가:

```tsx
if (activeSection === "settings-notifications") {
  return <NotificationSettingsPage />;
}
```

`NotificationSettingsPage` import:

```ts
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";
```

- [ ] **Step 3: Layout 설정 진입점 추가**

`frontend/src/components/Layout.tsx` props에 callback을 추가한다.

```ts
onOpenNotificationSettings: () => void;
```

설정 버튼을 nav 또는 header 도구 영역에 추가한다.

```tsx
<button
  aria-label={t("notifications.title")}
  className="sidebar-action"
  onClick={onOpenNotificationSettings}
  type="button"
>
  <Bell aria-hidden="true" size={17} />
  <span>{t("notifications.nav")}</span>
</button>
```

`lucide-react` import에 `Bell`을 추가한다.

- [ ] **Step 4: App에서 Layout callback 연결**

`frontend/src/App.tsx`에 이동 함수를 추가한다.

```ts
function openNotificationSettings() {
  const nextState: AppHistoryState = { projectId: null, section: "settings-notifications" };
  window.history.pushState(nextState, "", appPath(null, "settings-notifications"));
  setSelectedProjectId(null);
  setActiveSection("settings-notifications");
}
```

`Layout` 사용부에 전달한다.

```tsx
onOpenNotificationSettings={openNotificationSettings}
```

- [ ] **Step 5: i18n 문구 추가**

`frontend/src/i18n/LanguageProvider.tsx`의 한국어/영어 dictionary에 추가한다.

```ts
"notifications.nav": "알림 설정",
"notifications.title": "알림 설정",
"notifications.description": "학습과 추론이 끝났을 때 Slack, Discord, Telegram으로 받을 알림을 관리합니다.",
"notifications.enabled": "활성화",
"notifications.saved": "저장됨",
"notifications.events": "알림 이벤트",
"notifications.test": "테스트 알림",
"notifications.event.training_completed": "학습 완료",
"notifications.event.training_failed": "학습 실패",
"notifications.event.inference_completed": "추론 완료",
"notifications.event.inference_failed": "추론 실패",
"common.save": "저장",
"common.delete": "삭제",
```

영어:

```ts
"notifications.nav": "Notifications",
"notifications.title": "Notification settings",
"notifications.description": "Manage Slack, Discord, and Telegram alerts for completed or failed training and inference runs.",
"notifications.enabled": "Enabled",
"notifications.saved": "Saved",
"notifications.events": "Events",
"notifications.test": "Send test",
"notifications.event.training_completed": "Training completed",
"notifications.event.training_failed": "Training failed",
"notifications.event.inference_completed": "Inference completed",
"notifications.event.inference_failed": "Inference failed",
"common.save": "Save",
"common.delete": "Delete",
```

Before editing the dictionary, run `rg -n "common\\.save|common\\.delete" frontend/src/i18n/LanguageProvider.tsx`. When either key already exists, keep the existing value and add only the missing notification keys.

- [ ] **Step 6: CSS 추가**

`frontend/src/styles.css`에 추가한다.

```css
.settings-page {
  display: grid;
  gap: 24px;
  padding: 24px;
}

.notification-settings-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.notification-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  gap: 16px;
  padding: 16px;
}

.notification-card header,
.notification-card footer {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
}

.notification-card fieldset {
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  padding: 12px;
}
```

- [ ] **Step 7: 프론트 테스트 실행**

Run:

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 8: 프론트 빌드 실행**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx frontend/src/i18n/LanguageProvider.tsx frontend/src/styles.css frontend/tests
git commit -m "feat: wire notification settings navigation"
```

## Task 7: 통합 검증과 마무리

**Files:**
- Modify only if verification reveals a bug.

- [ ] **Step 1: 전체 백엔드 테스트**

Run:

```bash
cd backend && pytest -q
```

Expected: PASS.

- [ ] **Step 2: 전체 프론트엔드 테스트**

Run:

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 3: 프론트엔드 빌드**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 4: dev script 테스트**

Run:

```bash
npm run test:dev-script
```

Expected: PASS.

- [ ] **Step 5: 수동 smoke test**

Run:

```bash
npm run dev
```

Expected:

- API: `http://127.0.0.1:8000/health` returns `{"status":"ok"}`
- Frontend: `http://127.0.0.1:5173` opens without console errors.
- `알림 설정` 화면에서 Slack, Discord, Telegram 카드가 보인다.
- 빈 설정에서 테스트 알림은 실패 메시지를 보여주고 앱은 계속 동작한다.
- webhook 값을 저장한 뒤 조회 응답에 원문 secret이 포함되지 않는다.

- [ ] **Step 6: 최종 diff 검토**

Run:

```bash
git diff --stat HEAD
git status --short
```

Expected: 현재 작업 범위의 변경만 남아 있다. 기존 사용자 WIP는 되돌리지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add backend frontend package.json scripts README.md .gitignore
git commit -m "feat: add chat notification integrations"
```

Only include files changed by this notification feature. Do not stage unrelated existing WIP files.

## 자체 검토

- Spec coverage: Slack, Discord, Telegram 설정/전송, 앱 전체 공통 설정, 학습/추론 완료/실패 분리, secret 마스킹, 전송 이력, 테스트 알림, 이메일 확장 여지는 Task 1-7에 포함된다.
- Placeholder scan: 계획에는 미완성 표식이나 빈 구현 지시가 없다.
- Type consistency: 백엔드 event key는 `training_completed`, `training_failed`, `inference_completed`, `inference_failed`로 통일한다. 프론트 타입, schema, DB JSON key도 같은 이름을 사용한다.
