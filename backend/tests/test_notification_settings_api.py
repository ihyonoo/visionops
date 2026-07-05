def test_notification_settings_initial_state(client):
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


def test_update_slack_setting_masks_secret(client):
    response = client.put(
        "/api/notification-settings/slack",
        json={
            "enabled": True,
            "webhook_url": "https://hooks.slack.com/services/SECRET",
            "events": {
                "training_completed": True,
                "training_failed": False,
                "inference_completed": True,
                "inference_failed": True,
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["channel"] == "slack"
    assert body["enabled"] is True
    assert body["events"]["training_failed"] is False
    assert body["has_secret"] is True
    assert body["masked_secret"].startswith("https://")
    assert "SECRET" not in body["masked_secret"]

    unchanged_secret_response = client.put(
        "/api/notification-settings/slack",
        json={"enabled": True, "webhook_url": ""},
    )

    assert unchanged_secret_response.status_code == 200
    assert unchanged_secret_response.json()["masked_secret"] == body["masked_secret"]


def test_update_rejects_wrong_channel_secret(client):
    slack_response = client.put(
        "/api/notification-settings/slack",
        json={"enabled": True, "bot_token": "SECRET", "chat_id": "123"},
    )
    telegram_response = client.put(
        "/api/notification-settings/telegram",
        json={
            "enabled": True,
            "webhook_url": "https://example.test/webhook/SECRET",
        },
    )

    assert slack_response.status_code == 400
    assert "webhook URL" in slack_response.json()["detail"]
    assert telegram_response.status_code == 400
    assert "Telegram bot token" in telegram_response.json()["detail"]
    assert "chat id" in telegram_response.json()["detail"]


def test_delete_notification_setting_resets_to_default(client):
    create_response = client.put(
        "/api/notification-settings/discord",
        json={
            "enabled": True,
            "webhook_url": "https://discord.com/api/webhooks/SECRET",
        },
    )

    assert create_response.status_code == 200
    assert client.delete("/api/notification-settings/discord").status_code == 204

    response = client.get("/api/notification-settings")
    discord = next(setting for setting in response.json() if setting["channel"] == "discord")
    assert discord["enabled"] is False
    assert discord["has_secret"] is False
    assert discord["masked_secret"] is None
