type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  completed: { label: "완료", tone: "success" },
  failed: { label: "실패", tone: "danger" },
  invalid: { label: "유효하지 않음", tone: "danger" },
  pending: { label: "대기", tone: "warning" },
  queued: { label: "대기열", tone: "warning" },
  ready: { label: "준비됨", tone: "success" },
  running: { label: "실행 중", tone: "info" },
  skipped: { label: "건너뜀", tone: "neutral" },
  unknown: { label: "알 수 없음", tone: "neutral" },
  valid: { label: "유효", tone: "success" },
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
  const normalizedStatus = status?.trim().toLowerCase() || "unknown";
  const config = STATUS_LABELS[normalizedStatus] ?? {
    label: humanizeStatus(normalizedStatus),
    tone: "neutral" as StatusTone,
  };

  return (
    <span className="status-badge" data-tone={config.tone}>
      {label ?? config.label}
    </span>
  );
}
