import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, HelpCircle, Loader2, Save, Send, Trash2 } from "lucide-react";
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

function replaceCachedSetting(
  settings: NotificationSetting[] | undefined,
  nextSetting: NotificationSetting,
): NotificationSetting[] {
  const currentSettings = normalizeSettings(settings);
  return channels.map(({ channel }) =>
    channel === nextSetting.channel
      ? nextSetting
      : currentSettings.find((setting) => setting.channel === channel) ?? defaultSetting(channel),
  );
}

function apiErrorDetail(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return error.message.replace(/^API request failed \(\d+\):\s*/u, "");
}

type NotificationHelpContent = {
  docsUrl: string;
  introKey: string;
  stepKeys: string[];
  tipKey: string;
};

const notificationHelp: Record<NotificationChannelName, NotificationHelpContent> = {
  discord: {
    docsUrl: "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
    introKey: "notificationSettings.help.discord.intro",
    stepKeys: [
      "notificationSettings.help.discord.step1",
      "notificationSettings.help.discord.step2",
      "notificationSettings.help.discord.step3",
    ],
    tipKey: "notificationSettings.help.discord.tip",
  },
  slack: {
    docsUrl: "https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks",
    introKey: "notificationSettings.help.slack.intro",
    stepKeys: [
      "notificationSettings.help.slack.step1",
      "notificationSettings.help.slack.step2",
      "notificationSettings.help.slack.step3",
    ],
    tipKey: "notificationSettings.help.slack.tip",
  },
  telegram: {
    docsUrl: "https://core.telegram.org/bots/tutorial",
    introKey: "notificationSettings.help.telegram.intro",
    stepKeys: [
      "notificationSettings.help.telegram.step1",
      "notificationSettings.help.telegram.step2",
      "notificationSettings.help.telegram.step3",
    ],
    tipKey: "notificationSettings.help.telegram.tip",
  },
};

function NotificationSetupHelp({
  channel,
  title,
}: {
  channel: NotificationChannelName;
  title: string;
}) {
  const { t } = useLanguage();
  const content = notificationHelp[channel];

  return (
    <details className="notification-help">
      <summary>
        <HelpCircle aria-hidden="true" size={15} />
        <span>{t("notificationSettings.helpTitle", { channel: title })}</span>
      </summary>
      <div className="notification-help__body">
        <p>{t(content.introKey)}</p>
        <ol>
          {content.stepKeys.map((stepKey) => (
            <li key={stepKey}>{t(stepKey)}</li>
          ))}
        </ol>
        <p className="notification-help__tip">{t(content.tipKey)}</p>
        <a href={content.docsUrl} rel="noreferrer" target="_blank">
          <span>{t("notificationSettings.officialDocs")}</span>
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      </div>
    </details>
  );
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
  const [webhookUrlChanged, setWebhookUrlChanged] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [saveBeforeTestVisible, setSaveBeforeTestVisible] = useState(false);

  useEffect(() => {
    if (isDirty) return;
    setEnabled(setting.enabled);
    setEvents(setting.events);
    setWebhookUrl(setting.masked_secret ?? "");
    setWebhookUrlChanged(false);
    setBotToken("");
    setChatId("");
  }, [isDirty, setting]);

  function resetSecretDrafts(nextSetting = setting) {
    setWebhookUrl(nextSetting.masked_secret ?? "");
    setWebhookUrlChanged(false);
    setBotToken("");
    setChatId("");
  }

  const saveSetting = useMutation({
    mutationFn: (body: NotificationSettingUpdate) =>
      apiPut<NotificationSetting>(`/api/notification-settings/${setting.channel}`, body),
    onSuccess: (updatedSetting) => {
      queryClient.setQueryData<NotificationSetting[]>(["notification-settings"], (currentSettings) =>
        replaceCachedSetting(currentSettings, updatedSetting),
      );
      resetSecretDrafts(updatedSetting);
      setIsDirty(false);
      setSaveBeforeTestVisible(false);
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
      queryClient.setQueryData<NotificationSetting[]>(["notification-settings"], (currentSettings) =>
        replaceCachedSetting(currentSettings, defaultSetting(setting.channel)),
      );
      setEnabled(false);
      setEvents({ ...defaultEvents });
      resetSecretDrafts();
      setIsDirty(false);
      setSaveBeforeTestVisible(false);
      queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    },
  });

  const isPending = saveSetting.isPending || testSetting.isPending || deleteSetting.isPending;

  function setEventEnabled(key: keyof NotificationEvents, checked: boolean) {
    setIsDirty(true);
    setSaveBeforeTestVisible(false);
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
      if (webhookUrlChanged && trimmedWebhookUrl) body.webhook_url = trimmedWebhookUrl;
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

  function handleTest() {
    if (testSetting.isPending) return;
    if (isDirty || !setting.has_secret) {
      setSaveBeforeTestVisible(true);
      return;
    }
    setSaveBeforeTestVisible(false);
    testSetting.mutate();
  }

  return (
    <article className="notification-card">
      <form onSubmit={handleSubmit}>
        <div className="panel__header">
          <div>
            <h2>{title}</h2>
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
                setSaveBeforeTestVisible(false);
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
                    setSaveBeforeTestVisible(false);
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
                    setSaveBeforeTestVisible(false);
                    setChatId(event.target.value);
                  }}
                  type="text"
                  value={chatId}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                <span>{t("notificationSettings.webhookUrl")}</span>
                <input
                  aria-label={`${title} Webhook URL`}
                  autoComplete="off"
                  onChange={(event) => {
                    setIsDirty(true);
                    setSaveBeforeTestVisible(false);
                    setWebhookUrlChanged(true);
                    setWebhookUrl(event.target.value);
                  }}
                  placeholder={setting.has_secret ? t("notificationSettings.storedWebhook") : ""}
                  type="text"
                  value={webhookUrl}
                />
              </label>
              <span aria-hidden="true" className="notification-card__webhook-spacer" />
            </>
          )}

          <NotificationSetupHelp channel={setting.channel} title={title} />

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
            {apiErrorDetail(saveSetting.error) ? <small>{apiErrorDetail(saveSetting.error)}</small> : null}
          </div>
        ) : null}
        {saveBeforeTestVisible ? (
          <div className="notice notice--warning" role="alert">
            {t("notificationSettings.saveBeforeTest")}
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
            <Save aria-hidden="true" size={16} />
            <span>{t("notificationSettings.saveChannel", { channel: title })}</span>
          </button>
          <button
            disabled={deleteSetting.isPending}
            onClick={() => deleteSetting.mutate()}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
            <span>{t("notificationSettings.deleteChannel", { channel: title })}</span>
          </button>
          <button
            disabled={testSetting.isPending}
            onClick={handleTest}
            type="button"
          >
            <Send aria-hidden="true" size={16} />
            <span>{t("notificationSettings.testChannel", { channel: title })}</span>
          </button>
        </div>
      </form>
    </article>
  );
}

export function NotificationSettingsPage({ onBack }: { onBack?: () => void }) {
  const { t } = useLanguage();
  const settingsQuery = useQuery({
    queryFn: () => apiGet<NotificationSetting[]>("/api/notification-settings"),
    queryKey: ["notification-settings"],
  });
  const settings = normalizeSettings(settingsQuery.data);
  const hasSettings = settingsQuery.data !== undefined;

  return (
    <div className="settings-page">
      <section aria-labelledby="notification-settings-title" className="settings-page__header">
        <div>
          <h2 id="notification-settings-title">{t("notificationSettings.title")}</h2>
          <p>{t("notificationSettings.description")}</p>
        </div>
        <div className="settings-page__actions">
          {settingsQuery.isFetching ? <Loader2 aria-hidden="true" className="spin" size={18} /> : null}
          {onBack ? (
            <button className="secondary-button" onClick={onBack} type="button">
              <ArrowLeft aria-hidden="true" size={16} />
              <span>{t("common.back")}</span>
            </button>
          ) : null}
        </div>
      </section>

      {settingsQuery.isLoading && !hasSettings ? (
        <div className="empty-state">
          <Loader2 aria-hidden="true" className="spin" size={22} />
          <p>{t("notificationSettings.loading")}</p>
        </div>
      ) : null}

      {settingsQuery.isError && !hasSettings ? (
        <div className="notice notice--danger" role="alert">
          {t("notificationSettings.loadError")}
        </div>
      ) : null}

      {hasSettings ? (
        <section aria-label={t("notificationSettings.nav")} className="notification-settings-grid">
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
        </section>
      ) : null}
    </div>
  );
}
