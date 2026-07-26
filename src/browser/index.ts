/**
 * Placeholder for the browser module graph. This module also serves the
 * static lane: importing core across the project reference is the
 * positive boundary case.
 */
import type { CorePlaceholder } from "../core/index";

export type BrowserPlaceholder = {
  readonly core: CorePlaceholder;
  readonly phase: "phase-0";
};
