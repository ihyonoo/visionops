import { useQuery } from "@tanstack/react-query";
import { Radio, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiGet } from "../api/client";
import type { TrainingLog } from "../api/types";
import { useLanguage } from "../i18n/LanguageProvider";

type LogViewerProps = {
  projectId: string;
  runId: string;
  status: string | null | undefined;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

function buildStreamUrl(projectId: string, runId: string, offset: number | null): string {
  const base = API_BASE.replace(/\/$/, "");
  const url = new URL(`${base}/api/projects/${projectId}/training-runs/${runId}/logs/stream`);
  if (offset !== null) {
    url.searchParams.set("offset", String(offset));
  }
  return url.toString();
}

function shouldStream(status: string | null | undefined): boolean {
  const normalizedStatus = status?.trim().toLowerCase();
  return normalizedStatus === "running" || normalizedStatus === "queued" || normalizedStatus === "pending";
}

function linesFromEventData(data: string): string[] {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed && typeof parsed === "object" && "lines" in parsed) {
      const lines = (parsed as { lines?: unknown }).lines;
      return Array.isArray(lines) ? lines.map(String) : [];
    }
    if (parsed && typeof parsed === "object" && "line" in parsed) {
      return [String((parsed as { line: unknown }).line)];
    }
  } catch {
    // Plain text events are expected from simple SSE endpoints.
  }
  return data ? [data] : [];
}

function appendLogLines(currentLines: string[], incomingLines: string[]): string[] {
  return [...currentLines, ...incomingLines].slice(-600);
}

function mergeTailWithCurrent(tailLines: string[], currentLines: string[]): string[] {
  if (tailLines.length === 0) return currentLines.slice(-600);
  if (currentLines.length === 0) return tailLines.slice(-600);

  let overlap = 0;
  const maxOverlap = Math.min(tailLines.length, currentLines.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const tailSuffix = tailLines.slice(tailLines.length - size);
    const currentPrefix = currentLines.slice(0, size);
    if (tailSuffix.every((line, index) => line === currentPrefix[index])) {
      overlap = size;
      break;
    }
  }

  return [...tailLines, ...currentLines.slice(overlap)].slice(-600);
}

export function LogViewer({ projectId, runId, status }: LogViewerProps) {
  const { t } = useLanguage();
  const [lines, setLines] = useState<string[]>([]);
  const [streamState, setStreamState] = useState<"idle" | "connected" | "unavailable">("idle");
  const preRef = useRef<HTMLPreElement | null>(null);

  const logsQuery = useQuery({
    queryFn: () =>
      apiGet<TrainingLog>(`/api/projects/${projectId}/training-runs/${runId}/logs?tail=200`),
    queryKey: ["projects", projectId, "training-runs", runId, "logs", "tail"],
  });

  useEffect(() => {
    setLines([]);
  }, [projectId, runId]);

  useEffect(() => {
    if (!logsQuery.data) return;
    setLines((currentLines) => mergeTailWithCurrent(logsQuery.data.lines, currentLines));
  }, [logsQuery.data]);

  useEffect(() => {
    if (!shouldStream(status)) {
      setStreamState("idle");
      return;
    }
    if (logsQuery.isLoading) {
      setStreamState("idle");
      return;
    }
    if (typeof EventSource === "undefined") {
      setStreamState("unavailable");
      return;
    }

    const offset =
      typeof logsQuery.data?.offset === "number" && Number.isFinite(logsQuery.data.offset)
        ? logsQuery.data.offset
        : null;
    const source = new EventSource(buildStreamUrl(projectId, runId, offset));
    setStreamState("connected");

    source.onmessage = (event) => {
      const incomingLines = linesFromEventData(event.data);
      if (incomingLines.length === 0) return;
      setLines((currentLines) => appendLogLines(currentLines, incomingLines));
    };

    source.onerror = () => {
      setStreamState("unavailable");
      source.close();
    };

    return () => source.close();
  }, [logsQuery.data?.offset, logsQuery.isLoading, projectId, runId, status]);

  useEffect(() => {
    const element = preRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [lines]);

  const streamLabel = useMemo(() => {
    if (!shouldStream(status)) return t("log.saved");
    if (streamState === "connected") return t("log.connected");
    if (streamState === "unavailable") return t("log.unavailable");
    return t("log.ready");
  }, [status, streamState, t]);

  return (
    <div className="log-viewer">
      <div className="log-viewer__toolbar">
        <span>
          <i className="log-viewer__window-controls" aria-hidden="true">
            <b />
            <b />
            <b />
          </i>
          <Terminal aria-hidden="true" size={16} />
          {t("log.title")}
        </span>
        <small data-state={streamState}>
          <Radio aria-hidden="true" size={14} />
          {streamLabel}
        </small>
      </div>

      {logsQuery.isError ? (
        <div className="notice notice--warning" role="alert">
          {t("log.tailError")}
        </div>
      ) : null}

      {lines.length > 0 ? (
        <pre aria-live="polite" className="log-viewer__body" ref={preRef}>
          {lines.join("\n")}
        </pre>
      ) : (
        <div className="empty-state empty-state--compact">
          <p>{logsQuery.isLoading ? t("log.loading") : t("log.empty")}</p>
        </div>
      )}
    </div>
  );
}
