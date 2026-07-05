from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import NotificationChannel, NotificationDelivery
from app.schemas import (
    NotificationSettingRead,
    NotificationSettingUpdate,
    NotificationTestRead,
    NotificationTestRequest,
)
from app.services.notifications import (
    CHANNELS,
    notification_setting_to_read,
    send_test_notification,
    update_channel_config,
    validate_channel_payload,
)

router = APIRouter(prefix="/api/notification-settings", tags=["notification-settings"])


def _require_channel(channel: str) -> None:
    if channel not in CHANNELS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification channel not found",
        )


def _get_setting(db: Session, channel: str) -> NotificationChannel | None:
    return db.scalar(select(NotificationChannel).where(NotificationChannel.channel == channel))


@router.get("", response_model=list[NotificationSettingRead])
def list_notification_settings(
    db: Annotated[Session, Depends(get_db)],
) -> list[NotificationSettingRead]:
    settings = {
        setting.channel: setting
        for setting in db.scalars(select(NotificationChannel).where(NotificationChannel.channel.in_(CHANNELS)))
    }
    return [notification_setting_to_read(channel, settings.get(channel)) for channel in CHANNELS]


@router.put("/{channel}", response_model=NotificationSettingRead)
def update_notification_setting(
    channel: str,
    payload: NotificationSettingUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> NotificationSettingRead:
    _require_channel(channel)
    setting = _get_setting(db, channel)
    try:
        updated = update_channel_config(db, channel, payload, setting)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return notification_setting_to_read(channel, updated)


@router.delete("/{channel}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification_setting(
    channel: str,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    _require_channel(channel)
    setting = _get_setting(db, channel)
    if setting is not None:
        db.execute(
            update(NotificationDelivery)
            .where(NotificationDelivery.channel_id == setting.id)
            .values(channel_id=None)
        )
    db.execute(delete(NotificationChannel).where(NotificationChannel.channel == channel))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{channel}/test", response_model=NotificationTestRead)
def test_notification_setting(
    channel: str,
    payload: NotificationTestRequest,
    db: Annotated[Session, Depends(get_db)],
) -> NotificationTestRead:
    _require_channel(channel)
    setting = _get_setting(db, channel)
    stored_config = setting.config if setting is not None else {}
    try:
        config = validate_channel_payload(channel, payload, stored_config)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    result = send_test_notification(db, channel, config, setting)
    return NotificationTestRead(channel=channel, status=result.status, message=result.message)
