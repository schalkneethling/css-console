// Boundary violation fixture: adapter must not import from browser,
// because adapter references only core in the project graph.
import type { BrowserPlaceholder } from "../../../../src/browser/index";

export const violation: BrowserPlaceholder | null = null;
