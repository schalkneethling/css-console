import type { SpawnSyncReturns } from "node:child_process";

/**
 * Joins every populated channel of a synchronous spawn result into one
 * string, so a failing assertion shows stdout, stderr, the spawn error, and
 * the terminating signal together instead of an empty string.
 */
export function spawnOutput(result: SpawnSyncReturns<string>): string {
  return [
    result.stdout ?? "",
    result.stderr ?? "",
    result.error?.message ?? "",
    result.signal ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
