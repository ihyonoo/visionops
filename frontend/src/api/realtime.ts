export const ACTIVE_WORK_REFETCH_MS = 1500;

type WorkStatusRecord = {
  status: string;
};

export function isActiveWorkStatus(status: string | null | undefined): boolean {
  const normalizedStatus = status?.trim().toLowerCase();
  return (
    normalizedStatus === "queued" ||
    normalizedStatus === "pending" ||
    normalizedStatus === "running" ||
    normalizedStatus === "cancel_requested"
  );
}

export function isTerminalWorkStatus(status: string | null | undefined): boolean {
  const normalizedStatus = status?.trim().toLowerCase();
  return normalizedStatus === "completed" || normalizedStatus === "failed";
}

export function workRunsRefetchInterval(
  runs: WorkStatusRecord[] | null | undefined,
): typeof ACTIVE_WORK_REFETCH_MS | false {
  return runs?.some((run) => isActiveWorkStatus(run.status)) ? ACTIVE_WORK_REFETCH_MS : false;
}

export function workRunsQueryRefetchInterval<T extends WorkStatusRecord>(query: {
  state: { data?: T[] };
}): typeof ACTIVE_WORK_REFETCH_MS | false {
  return workRunsRefetchInterval(query.state.data);
}

export function shouldRefetchPredictionResults(
  run: WorkStatusRecord | null | undefined,
): typeof ACTIVE_WORK_REFETCH_MS | false {
  return isActiveWorkStatus(run?.status) ? ACTIVE_WORK_REFETCH_MS : false;
}
