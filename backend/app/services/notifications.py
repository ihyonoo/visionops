from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import NotificationChannel, NotificationDelivery
from app.schemas import NotificationEvents, NotificationSettingRead
from app.services.ids import new_id

CHANNELS = ("slack", "discord", "telegram")
EVENTS = (
    "training_completed",
    "training_failed",
    "inference_completed",
    "inference_failed",
)


@dataclass(frozen=True)
class NotificationEvent:
    event_type: str
    target_type: str
    target_id: str
    text: str


@dataclass(frozen=True)
class NotificationResult:
    channel: str
    status: str
    message: str


def default_events() -> dict[str, bool]:
    return {event: True for event in EVENTS}


def mask_secret(secret: str | None) -> str | None:
    if not secret:
        return None
    if len(secret) <= 8:
        return "••••••••"
    return f"{secret[:8]}****"


def redact_secret(message: str, secrets: list[str | None]) -> str:
    redacted = message
    for secret in secrets:
        if secret:
            redacted = redacted.replace(secret, "[redacted]")
    return redacted


def masked_channel_secret(channel: str, config: dict) -> str | None:
    if channel in {"slack", "discord"}:
        return mask_secret(config.get("webhook_url"))
    if channel == "telegram":
        return mask_secret(config.get("bot_token"))
    return None


def notification_setting_to_read(
    channel: str,
    setting: NotificationChannel | None = None,
) -> NotificationSettingRead:
    config = setting.config if setting is not None else {}
    events = default_events()
    if setting is not None:
        events.update(setting.events or {})
    masked_secret = masked_channel_secret(channel, config)
    return NotificationSettingRead(
        channel=channel,
        enabled=bool(setting.enabled) if setting is not None else False,
        events=NotificationEvents(**events),
        has_secret=masked_secret is not None,
        masked_secret=masked_secret,
        last_status=setting.last_status if setting is not None else "unknown",
        last_error=setting.last_error if setting is not None else None,
        last_sent_at=setting.last_sent_at if setting is not None else None,
    )


def _non_empty(value: str | None) -> bool:
    return value is not None and value.strip() != ""


def _validate_webhook_url(channel: str, webhook_url: str) -> None:
    parsed = urlparse(webhook_url)
    hostname = parsed.hostname or ""
    if channel == "slack":
        valid = (
            parsed.scheme == "https"
            and hostname == "hooks.slack.com"
            and parsed.path.startswith("/services/")
        )
        if not valid:
            raise ValueError("Slack webhook URL must be an HTTPS hooks.slack.com /services/ URL.")
    elif channel == "discord":
        valid = (
            parsed.scheme == "https"
            and hostname in {"discord.com", "discordapp.com"}
            and parsed.path.startswith("/api/webhooks/")
        )
        if not valid:
            raise ValueError(
                "Discord webhook URL must be an HTTPS discord.com or discordapp.com "
                "/api/webhooks/ URL."
            )


def _validate_channel_config(channel: str, config: dict) -> None:
    if channel in {"slack", "discord"} and _non_empty(config.get("webhook_url")):
        _validate_webhook_url(channel, config["webhook_url"])


def _provided_fields(payload: object) -> set[str]:
    fields = getattr(payload, "model_fields_set", None)
    if fields is None:
        return set()
    return set(fields)


def _config_with_updates(channel: str, stored_config: dict, payload: object) -> dict:
    config = dict(stored_config or {})
    if channel in {"slack", "discord"}:
        webhook_url = getattr(payload, "webhook_url", None)
        if _non_empty(webhook_url):
            config["webhook_url"] = webhook_url.strip()
            _validate_webhook_url(channel, config["webhook_url"])
        return config

    bot_token = getattr(payload, "bot_token", None)
    chat_id = getattr(payload, "chat_id", None)
    if _non_empty(bot_token):
        config["bot_token"] = bot_token.strip()
    if _non_empty(chat_id):
        config["chat_id"] = chat_id.strip()
    return config


def validate_channel_payload(channel: str, payload: object, stored_config: dict | None = None) -> dict:
    if channel in {"slack", "discord"}:
        if _non_empty(getattr(payload, "bot_token", None)) or _non_empty(
            getattr(payload, "chat_id", None)
        ):
            raise ValueError("This channel expects a webhook URL.")
    elif channel == "telegram":
        if _non_empty(getattr(payload, "webhook_url", None)):
            raise ValueError("Telegram expects a Telegram bot token and chat id.")
    else:
        raise ValueError("Unsupported notification channel.")

    config = _config_with_updates(channel, stored_config or {}, payload)
    _validate_channel_config(channel, config)
    enabled = bool(getattr(payload, "enabled", False))
    if enabled:
        if channel in {"slack", "discord"} and not _non_empty(config.get("webhook_url")):
            raise ValueError("This channel requires a webhook URL before it can be enabled.")
        if channel == "telegram" and (
            not _non_empty(config.get("bot_token")) or not _non_empty(config.get("chat_id"))
        ):
            raise ValueError(
                "Telegram requires a Telegram bot token and chat id before it can be enabled."
            )
    return config


def update_channel_config(
    db: Session,
    channel: str,
    payload: object,
    setting: NotificationChannel | None = None,
) -> NotificationChannel:
    setting = setting or db.scalar(select(NotificationChannel).where(NotificationChannel.channel == channel))
    config = validate_channel_payload(
        channel,
        payload,
        setting.config if setting is not None else {},
    )
    if setting is None:
        setting = NotificationChannel(
            id=new_id("ntf"),
            channel=channel,
            enabled=0,
            events=default_events(),
            config={},
        )

    setting.enabled = 1 if bool(getattr(payload, "enabled", False)) else 0
    if "events" in _provided_fields(payload):
        setting.events = getattr(payload, "events").model_dump()
    elif not setting.events:
        setting.events = default_events()
    setting.config = config
    db.add(setting)
    db.commit()
    db.refresh(setting)
    return setting


def _send_channel(channel: str, config: dict, text: str) -> None:
    if channel == "slack":
        response = httpx.post(config["webhook_url"], json={"text": text}, timeout=10)
    elif channel == "discord":
        response = httpx.post(config["webhook_url"], json={"content": text}, timeout=10)
    elif channel == "telegram":
        response = httpx.post(
            f"https://api.telegram.org/bot{config['bot_token']}/sendMessage",
            json={"chat_id": config["chat_id"], "text": text},
            timeout=10,
        )
    else:
        raise ValueError("Unsupported notification channel.")
    response.raise_for_status()


def _channel_secrets(setting: NotificationChannel, config: dict | None = None) -> list[str | None]:
    active_config = config or setting.config or {}
    return [
        active_config.get("webhook_url"),
        active_config.get("bot_token"),
    ]


def _record_delivery(
    db: Session,
    setting: NotificationChannel | None,
    channel: str,
    event: NotificationEvent,
    status: str,
    error_message: str | None = None,
) -> NotificationDelivery:
    delivery = NotificationDelivery(
        id=new_id("ndl"),
        channel_id=setting.id if setting is not None else None,
        channel=channel,
        event_type=event.event_type,
        target_type=event.target_type,
        target_id=event.target_id,
        status=status,
        error_message=error_message,
    )
    db.add(delivery)
    if setting is not None:
        setting.last_status = status
        if status == "sent":
            setting.last_error = None
            setting.last_sent_at = datetime.now(timezone.utc)
        else:
            setting.last_error = error_message
        db.add(setting)
    db.commit()
    return delivery


def _attempt_delivery(
    db: Session,
    setting: NotificationChannel | None,
    channel: str,
    config: dict,
    event: NotificationEvent,
) -> NotificationResult:
    try:
        _send_channel(channel, config, event.text)
    except Exception as exc:
        if setting is not None:
            secrets = _channel_secrets(setting, config)
        else:
            secrets = [config.get("webhook_url"), config.get("bot_token")]
        error_message = redact_secret(str(exc), secrets)
        _record_delivery(db, setting, channel, event, "failed", error_message)
        return NotificationResult(channel=channel, status="failed", message=error_message)

    _record_delivery(db, setting, channel, event, "sent")
    return NotificationResult(channel=channel, status="sent", message="sent")


def send_work_notification(db: Session, event: NotificationEvent) -> list[NotificationResult]:
    results: list[NotificationResult] = []
    settings = db.scalars(
        select(NotificationChannel)
        .where(NotificationChannel.enabled == 1)
        .order_by(NotificationChannel.channel)
    )
    for setting in settings:
        events = default_events()
        events.update(setting.events or {})
        if events.get(event.event_type) is False:
            continue
        results.append(_attempt_delivery(db, setting, setting.channel, setting.config or {}, event))
    return results


def send_test_notification(
    db: Session,
    channel: str,
    config: dict,
    setting: NotificationChannel | None = None,
) -> NotificationResult:
    _validate_channel_config(channel, config)
    event = NotificationEvent(
        event_type="test",
        target_type="notification_settings",
        target_id=channel,
        text="VisionOps test notification",
    )
    return _attempt_delivery(db, setting, channel, config, event)
