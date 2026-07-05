/// <reference types="vite/client" />

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function apiUrl(path: string): string {
  return buildUrl(path);
}

function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => formatErrorDetail(item))
      .filter(Boolean)
      .join(", ");
  }
  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }
  return null;
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const payload = (await response.clone().json()) as unknown;
    if (payload && typeof payload === "object" && "detail" in payload) {
      return formatErrorDetail(payload.detail) ?? fallback;
    }
  } catch {
    // Fall back to response text below.
  }

  const text = await response.text();
  return text || fallback;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(buildUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(`API request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const requestBody = body instanceof FormData ? body : JSON.stringify(body);
  return apiRequest<T>(path, {
    body: requestBody,
    method: "POST",
  });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const requestBody = body instanceof FormData ? body : JSON.stringify(body);
  return apiRequest<T>(path, {
    body: requestBody,
    method: "PATCH",
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const requestBody = body instanceof FormData ? body : JSON.stringify(body);
  return apiRequest<T>(path, {
    body: requestBody,
    method: "PUT",
  });
}

export async function apiDelete(path: string): Promise<void> {
  return apiRequest<void>(path, {
    method: "DELETE",
  });
}
