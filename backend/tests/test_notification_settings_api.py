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
