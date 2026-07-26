/**
 * Placeholder for the console adapter. The adapter references core and
 * must never import from browser; the static lane proves both
 * directions.
 */
import type { CorePlaceholder } from "../core/index";

export type AdapterPlaceholder = {
  readonly core: CorePlaceholder;
  readonly phase: "phase-0";
};
