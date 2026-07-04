import { useLanguage } from "../i18n/LanguageProvider";

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_LABELS: Record<string, { labelKey: string; tone: StatusTone }> = {
  completed: { labelKey: "status.completed", tone: "success" },
  failed: { labelKey: "status.failed", tone: "danger" },
  invalid: { labelKey: "status.invalid", tone: "danger" },
  pending: { labelKey: "status.pending", tone: "warning" },
  queued: { labelKey: "status.queued", tone: "warning" },
  ready: { labelKey: "status.ready", tone: "success" },
  running: { labelKey: "status.running", tone: "info" },
  skipped: { labelKey: "status.skipped", tone: "neutral" },
  unknown: { labelKey: "status.unknown", tone: "neutral" },
  valid: { labelKey: "status.valid", tone: "success" },
};

type StatusBadgeProps = {
  status: string | null | undefined;
  label?: string;
};

function humanizeStatus(status: string): string {
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ label, status }: StatusBadgeProps) {
  const { t } = useLanguage();
  const normalizedStatus = status?.trim().toLowerCase() || "unknown";
  const config = STATUS_LABELS[normalizedStatus] ?? {
    labelKey: "",
    tone: "neutral" as StatusTone,
  };
  const resolvedLabel = config.labelKey ? t(config.labelKey) : humanizeStatus(normalizedStatus);

  return (
    <span className="status-badge" data-tone={config.tone}>
      {label ?? resolvedLabel}
    </span>
  );
}
