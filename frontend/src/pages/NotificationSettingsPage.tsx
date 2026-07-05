import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2, Send, Trash2 } from "lucide-react";
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

const channels: Array<{ channel: NotificationChannelName; title: string }> = [
  { channel: "slack", title: "Slack" },
  { channel: "discord", title: "Discord" },
  { channel: "telegram", title: "Telegram" },
];

const eventOptions: Array<{ key: keyof NotificationEvents; labelKey: string }> = [
  { key: "training_completed", labelKey: "notificationSettings.event.trainingCompleted" },
  { key: "training_failed", labelKey: "notificationSettings.event.trainingFailed" },
  { key: "inference_completed", labelKey: "notificationSettings.event.inferenceCompleted" },
  { key: "inference_failed", labelKey: "notificationSettings.event.inferenceFailed" },
];

const defaultEvents: NotificationEvents = {
  inference_completed: false,
  inference_failed: false,
  training_completed: false,
  training_failed: false,
};

function defaultSetting(channel: NotificationChannelName): NotificationSetting {
  return {
    channel,
    enabled: false,
    events: { ...defaultEvents },
    has_secret: false,
    last_error: null,
    last_sent_at: null,
    last_status: null,
    masked_secret: null,
  };
}

function normalizeSettings(settings: NotificationSetting[] | undefined): NotificationSetting[] {
  return channels.map(({ channel }) => {
    return settings?.find((setting) => setting.channel === channel) ?? defaultSetting(channel);
  });
}

type NotificationChannelCardProps = {
  setting: NotificationSetting;
  title: string;
};

function NotificationChannelCard({ setting, title }: NotificationChannelCardProps) {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState(setting.enabled);
  const [events, setEvents] = useState<NotificationEvents>(setting.events);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (isDirty) return;
    setEnabled(setting.enabled);
    setEvents(setting.events);
    setWebhookUrl("");
    setBotToken("");
    setChatId("");
  }, [isDirty, setting]);

  function resetSecretDrafts() {
    setWebhookUrl("");
    setBotToken("");
    setChatId("");
  }

  const saveSetting = useMutation({
    mutationFn: (body: NotificationSettingUpdate) =>
      apiPut<NotificationSetting>(`/api/notification-settings/${setting.channel}`, body),
    onSuccess: () => {
      resetSecretDrafts();
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    },
  });

  const testSetting = useMutation({
    mutationFn: () =>
      apiPost<NotificationTestResult>(`/api/notification-settings/${setting.channel}/test`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    },
  });

  const deleteSetting = useMutation({
    mutationFn: () => apiDelete(`/api/notification-settings/${setting.channel}`),
    onSuccess: () => {
      setEnabled(false);
      setEvents({ ...defaultEvents });
      resetSecretDrafts();
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    },
  });

  const isPending = saveSetting.isPending || testSetting.isPending || deleteSetting.isPending;

  function setEventEnabled(key: keyof NotificationEvents, checked: boolean) {
    setIsDirty(true);
    setEvents((currentEvents) => ({
      ...currentEvents,
      [key]: checked,
    }));
  }

  function buildUpdate(): NotificationSettingUpdate {
    const body: NotificationSettingUpdate = {
      enabled,
      events,
    };
    const trimmedWebhookUrl = webhookUrl.trim();
    const trimmedBotToken = botToken.trim();
    const trimmedChatId = chatId.trim();

    if (setting.channel === "slack" || setting.channel === "discord") {
      if (trimmedWebhookUrl) body.webhook_url = trimmedWebhookUrl;
      return body;
    }

    if (trimmedBotToken) body.bot_token = trimmedBotToken;
    if (trimmedChatId) body.chat_id = trimmedChatId;
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveSetting.isPending) return;
    saveSetting.mutate(buildUpdate());
  }

  return (
    <article className="panel notification-settings-card">
      <form onSubmit={handleSubmit}>
        <div className="panel__header">
          <div>
            <h2>{title}</h2>
            {setting.masked_secret ? <p>{setting.masked_secret}</p> : null}
          </div>
          {isPending ? <Loader2 aria-hidden="true" className="spin" size={18} /> : null}
        </div>

        <div className="form-grid">
          <label className="checkbox-row">
            <input
              aria-label={t("notificationSettings.enableLabel", { channel: title })}
              checked={enabled}
              onChange={(event) => {
                setIsDirty(true);
                setEnabled(event.target.checked);
              }}
              type="checkbox"
            />
            <span>{t("notificationSettings.enabled")}</span>
          </label>

          {setting.channel === "telegram" ? (
            <>
              <label>
                <span>{t("notificationSettings.botToken")}</span>
                <input
                  aria-label="Telegram Bot Token"
                  autoComplete="off"
                  onChange={(event) => {
                    setIsDirty(true);
                    setBotToken(event.target.value);
                  }}
                  placeholder={setting.has_secret ? t("notificationSettings.storedToken") : ""}
                  type="password"
                  value={botToken}
                />
              </label>
              <label>
                <span>{t("notificationSettings.chatId")}</span>
                <input
                  aria-label="Telegram Chat ID"
                  onChange={(event) => {
                    setIsDirty(true);
                    setChatId(event.target.value);
                  }}
                  type="text"
                  value={chatId}
                />
              </label>
            </>
          ) : (
            <label>
              <span>{t("notificationSettings.webhookUrl")}</span>
              <input
                aria-label={`${title} Webhook URL`}
                autoComplete="off"
                onChange={(event) => {
                  setIsDirty(true);
                  setWebhookUrl(event.target.value);
                }}
                placeholder={setting.has_secret ? t("notificationSettings.storedWebhook") : ""}
                type="password"
                value={webhookUrl}
              />
            </label>
          )}

          <fieldset>
            <legend>{t("notificationSettings.events")}</legend>
            {eventOptions.map((option) => (
              <label className="checkbox-row" key={option.key}>
                <input
                  aria-label={`${title} ${option.key}`}
                  checked={events[option.key]}
                  onChange={(event) => setEventEnabled(option.key, event.target.checked)}
                  type="checkbox"
                />
                <span>{t(option.labelKey)}</span>
              </label>
            ))}
          </fieldset>
        </div>

        {setting.last_status === "failed" && setting.last_error ? (
          <div className="notice notice--danger" role="alert">
            {setting.last_error}
          </div>
        ) : null}
        {saveSetting.isError ? (
          <div className="notice notice--danger" role="alert">
            {t("notificationSettings.saveError")}
          </div>
        ) : null}
        {testSetting.isError ? (
          <div className="notice notice--danger" role="alert">
            {t("notificationSettings.testError")}
          </div>
        ) : null}
        {deleteSetting.isError ? (
          <div className="notice notice--danger" role="alert">
            {t("notificationSettings.deleteError")}
          </div>
        ) : null}

        <div className="button-row">
          <button className="primary-button" disabled={saveSetting.isPending} type="submit">
            <Bell aria-hidden="true" size={16} />
            <span>{t("notificationSettings.saveChannel", { channel: title })}</span>
          </button>
          <button
            disabled={testSetting.isPending}
            onClick={() => testSetting.mutate()}
            type="button"
          >
            <Send aria-hidden="true" size={16} />
            <span>{t("notificationSettings.testChannel", { channel: title })}</span>
          </button>
          <button
            disabled={deleteSetting.isPending}
            onClick={() => deleteSetting.mutate()}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
            <span>{t("notificationSettings.deleteChannel", { channel: title })}</span>
          </button>
        </div>
      </form>
    </article>
  );
}

export function NotificationSettingsPage() {
  const { t } = useLanguage();
  const settingsQuery = useQuery({
    queryFn: () => apiGet<NotificationSetting[]>("/api/notification-settings"),
    queryKey: ["notification-settings"],
  });
  const settings = normalizeSettings(settingsQuery.data);

  return (
    <div className="page-stack">
      <section className="content-grid">
        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <h2>{t("notificationSettings.title")}</h2>
              <p>{t("notificationSettings.description")}</p>
            </div>
            {settingsQuery.isFetching ? <Loader2 aria-hidden="true" className="spin" size={18} /> : null}
          </div>

          {settingsQuery.isLoading ? (
            <div className="empty-state">
              <Loader2 aria-hidden="true" className="spin" size={22} />
              <p>{t("notificationSettings.loading")}</p>
            </div>
          ) : null}

          {settingsQuery.isError ? (
            <div className="notice notice--danger" role="alert">
              {t("notificationSettings.loadError")}
            </div>
          ) : null}

          {!settingsQuery.isLoading && !settingsQuery.isError ? (
            <div className="project-card-grid">
              {settings.map((setting) => {
                const channel = channels.find((item) => item.channel === setting.channel);
                return (
                  <NotificationChannelCard
                    key={setting.channel}
                    setting={setting}
                    title={channel?.title ?? setting.channel}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
