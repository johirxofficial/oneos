import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { HostMetrics, VmStatus } from "./types";

/**
 * Starts the guest. `force` bypasses the free-memory precondition; the caller
 * only sets it after the operator explicitly confirms the warning.
 */
export async function startVm(install?: boolean, force = false): Promise<VmStatus> {
  return api.vmStart(install, force);
}

/** True when a start failure was the host-memory precondition. */
export function isMemoryBlocked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /free host memory/i.test(message);
}

export function useVmStatus(intervalMs = 2500) {
  const [status, setStatus] = useState<VmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.vmStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(t);
  }, [refresh, intervalMs]);

  return { status, error, refresh, setStatus };
}

export function useHostMetrics(intervalMs = 2500) {
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const m = await api.hostMetrics();
        if (alive) setMetrics(m);
      } catch {
        /* transient */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), intervalMs);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [intervalMs]);

  return metrics;
}
