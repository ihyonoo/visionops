from collections.abc import Generator

import httpx
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import NotificationChannel, NotificationDelivery
from app.schemas import NotificationSettingUpdate
from app.services.notifications import (
    NotificationEvent,
    masked_channel_secret,
    mask_secret,
    redact_secret,
    send_test_notification,
    send_work_notification,
    validate_channel_payload,
)


@pytest.fixture
def db() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_mask_secret_preserves_prefix_and_hides_tail():
    masked = mask_secret("https://hooks.slack.com/services/SECRET")

    assert masked.startswith("https://")
    assert "SECRET" not in masked
    assert masked.endswith("****")


def test_mask_secret_hides_entire_short_secret():
    masked = mask_secret("SECRET")

    assert masked is not None
    assert "SECRET" not in masked
    assert set(masked) == {"•"}


def test_masked_channel_secret_hides_short_telegram_token_and_chat_id():
    masked = masked_channel_secret(
        "telegram",
        {
            "bot_token": "SECRET",
            "chat_id": "CHAT",
        },
    )

    assert masked is not None
    assert "SECRET" not in masked
    assert "CHAT" not in masked


def test_masked_channel_secret_hides_long_telegram_token_prefix():
    token = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    masked = masked_channel_secret(
        "telegram",
        {
            "bot_token": token,
            "chat_id": "123456789",
        },
    )

    assert masked is not None
    assert token[:8] not in masked
    assert token not in masked
    assert set(masked) == {"•"}


def test_redact_secret_removes_webhook_and_token():
    message = (
        "failed https://hooks.slack.com/services/SECRET and "
        "https://api.telegram.org/botTOKEN/sendMessage"
    )

    redacted = redact_secret(message, ["https://hooks.slack.com/services/SECRET", "TOKEN"])

    assert "SECRET" not in redacted
    assert "TOKEN" not in redacted
    assert "[redacted]" in redacted


def test_validate_channel_payload_rejects_invalid_discord_webhooks():
    invalid_values = [
        "http://discord.com/api/webhooks/123/SECRET",
        "https://example.com/api/webhooks/123/SECRET",
    ]

    for webhook_url in invalid_values:
        payload = NotificationSettingUpdate(enabled=True, webhook_url=webhook_url)
        with pytest.raises(ValueError) as exc_info:
            validate_channel_payload("discord", payload)
        assert webhook_url not in str(exc_info.value)
        assert "Discord webhook URL" in str(exc_info.value)


def test_validate_channel_payload_accepts_provider_webhooks():
    slack_config = validate_channel_payload(
        "slack",
        NotificationSettingUpdate(
            enabled=True,
            webhook_url="https://hooks.slack.com/services/T000/B000/SECRET",
        ),
    )
    gov_slack_config = validate_channel_payload(
        "slack",
        NotificationSettingUpdate(
            enabled=True,
            webhook_url="https://hooks.slack-gov.com/services/T000/B000/SECRET",
        ),
    )
    slack_workflow_config = validate_channel_payload(
        "slack",
        NotificationSettingUpdate(
            enabled=True,
            webhook_url="https://hooks.slack.com/triggers/T000/B000/SECRET",
        ),
    )
    discord_config = validate_channel_payload(
        "discord",
        NotificationSettingUpdate(
            enabled=True,
            webhook_url="https://discord.com/api/webhooks/123/SECRET",
        ),
    )
    legacy_discord_config = validate_channel_payload(
        "discord",
        NotificationSettingUpdate(
            enabled=True,
            webhook_url="https://discordapp.com/api/webhooks/123/SECRET",
        ),
    )

    assert slack_config["webhook_url"].startswith("https://hooks.slack.com/services/")
    assert gov_slack_config["webhook_url"].startswith("https://hooks.slack-gov.com/services/")
    assert slack_workflow_config["webhook_url"].startswith("https://hooks.slack.com/triggers/")
    assert discord_config["webhook_url"].startswith("https://discord.com/api/webhooks/")
    assert legacy_discord_config["webhook_url"].startswith(
        "https://discordapp.com/api/webhooks/"
    )


def test_send_work_notification_skips_disabled_event(db, monkeypatch):
    channel = NotificationChannel(
        id="ntf_slack",
        channel="slack",
        enabled=1,
        events={
            "training_completed": False,
            "training_failed": True,
            "inference_completed": True,
            "inference_failed": True,
        },
        config={"webhook_url": "https://hooks.slack.com/services/SECRET"},
    )
    db.add(channel)
    db.commit()

    def fail_post(*args, **kwargs):
        raise AssertionError("disabled events should not send")

    monkeypatch.setattr("app.services.notifications.httpx.post", fail_post)

    results = send_work_notification(
        db,
        NotificationEvent(
            event_type="training_completed",
            target_type="training_run",
            target_id="run-1",
            text="Training completed",
        ),
    )

    assert results == []
    assert db.scalars(select(NotificationDelivery)).all() == []


def test_send_work_notification_records_failure(db, monkeypatch):
    webhook_url = "https://hooks.slack.com/services/SECRET"
    channel = NotificationChannel(
        id="ntf_slack",
        channel="slack",
        enabled=1,
        events={
            "training_completed": True,
            "training_failed": True,
            "inference_completed": True,
            "inference_failed": True,
        },
        config={"webhook_url": webhook_url},
    )
    db.add(channel)
    db.commit()

    def timeout_post(*args, **kwargs):
        raise httpx.TimeoutException(f"timeout posting to {webhook_url}")

    monkeypatch.setattr("app.services.notifications.httpx.post", timeout_post)

    results = send_work_notification(
        db,
        NotificationEvent(
            event_type="training_failed",
            target_type="training_run",
            target_id="run-2",
            text="Training failed",
        ),
    )

    db.refresh(channel)
    delivery = db.scalar(select(NotificationDelivery))
    assert len(results) == 1
    assert results[0].status == "failed"
    assert channel.last_status == "failed"
    assert channel.last_error is not None
    assert "SECRET" not in channel.last_error
    assert delivery is not None
    assert delivery.status == "failed"
    assert delivery.error_message is not None
    assert "SECRET" not in delivery.error_message


def test_send_work_notification_rejects_invalid_stored_webhook_without_posting(
    db, monkeypatch
):
    raw_url = "http://127.0.0.1:9/internal"
    channel = NotificationChannel(
        id="ntf_slack",
        channel="slack",
        enabled=1,
        events={
            "training_completed": True,
            "training_failed": True,
            "inference_completed": True,
            "inference_failed": True,
        },
        config={"webhook_url": raw_url},
    )
    db.add(channel)
    db.commit()

    def fail_post(*args, **kwargs):
        raise AssertionError("invalid stored webhook should not be sent")

    monkeypatch.setattr("app.services.notifications.httpx.post", fail_post)

    results = send_work_notification(
        db,
        NotificationEvent(
            event_type="training_completed",
            target_type="training_run",
            target_id="run-invalid",
            text="Training completed",
        ),
    )

    db.refresh(channel)
    delivery = db.scalar(select(NotificationDelivery))
    assert len(results) == 1
    assert results[0].status == "failed"
    assert channel.last_status == "failed"
    assert channel.last_error is not None
    assert raw_url not in channel.last_error
    assert "Slack webhook URL" in channel.last_error
    assert delivery is not None
    assert delivery.status == "failed"
    assert delivery.error_message is not None
    assert raw_url not in delivery.error_message


def test_send_test_notification_rejects_invalid_stored_webhook_without_posting(
    db, monkeypatch
):
    raw_url = "http://127.0.0.1:9/internal"
    channel = NotificationChannel(
        id="ntf_slack",
        channel="slack",
        enabled=1,
        events={
            "training_completed": True,
            "training_failed": True,
            "inference_completed": True,
            "inference_failed": True,
        },
        config={"webhook_url": raw_url},
    )
    db.add(channel)
    db.commit()

    def fail_post(*args, **kwargs):
        raise AssertionError("invalid stored webhook should not be sent")

    monkeypatch.setattr("app.services.notifications.httpx.post", fail_post)

    result = send_test_notification(db, "slack", channel.config, channel)

    db.refresh(channel)
    delivery = db.scalar(select(NotificationDelivery))
    assert result.status == "failed"
    assert channel.last_status == "failed"
    assert channel.last_error is not None
    assert raw_url not in channel.last_error
    assert delivery is not None
    assert delivery.status == "failed"
    assert delivery.error_message is not None
    assert raw_url not in delivery.error_message


def test_send_work_notification_posts_slack_payload(db, monkeypatch):
    channel = NotificationChannel(
        id="ntf_slack",
        channel="slack",
        enabled=1,
        events={
            "training_completed": True,
            "training_failed": True,
            "inference_completed": True,
            "inference_failed": True,
        },
        config={"webhook_url": "https://hooks.slack.com/services/SECRET"},
    )
    db.add(channel)
    db.commit()
    calls = []

    class Response:
        def raise_for_status(self):
            return None

    def capture_post(url, json, timeout):
        calls.append({"url": url, "json": json, "timeout": timeout})
        return Response()

    monkeypatch.setattr("app.services.notifications.httpx.post", capture_post)

    results = send_work_notification(
        db,
        NotificationEvent(
            event_type="training_completed",
            target_type="training_run",
            target_id="run-3",
            text="Training completed",
        ),
    )

    db.refresh(channel)
    delivery = db.scalar(select(NotificationDelivery))
    assert len(results) == 1
    assert results[0].status == "sent"
    assert calls == [
        {
            "url": "https://hooks.slack.com/services/SECRET",
            "json": {"text": "Training completed"},
            "timeout": 10,
        }
    ]
    assert channel.last_status == "sent"
    assert channel.last_sent_at is not None
    assert delivery is not None
    assert delivery.status == "sent"
