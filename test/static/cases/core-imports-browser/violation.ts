// Boundary violation fixture: core must not import from browser, because
// core references nothing in the project graph.
import type { BrowserPlaceholder } from "../../../../src/browser/index";

export const violation: BrowserPlaceholder | null = null;
