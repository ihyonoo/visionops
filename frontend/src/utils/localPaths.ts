import { apiPost } from "../api/client";

export type LocalPathOpenResult = {
  requested_path: string;
  opened_path: string;
};

export function isManagedVisionOpsPath(path: string | null | undefined): path is string {
  if (!path) return false;
  const normalizedPath = path.replace(/\\/gu, "/");
  return /(?:^|\/)vision_ops_data\/projects\/[a-f0-9]{24,}(?:\/|$)/iu.test(normalizedPath);
}

export async function openLocalPath(path: string): Promise<LocalPathOpenResult> {
  return apiPost<LocalPathOpenResult>("/api/local-files/open", { path });
}

export async function copyLocalPath(path: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }
  await navigator.clipboard.writeText(path);
}
