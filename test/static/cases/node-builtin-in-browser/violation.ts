// Boundary violation fixture: nothing under src/ may import a Node
// package or a node: builtin. Browser and adapter pin types to an empty
// array, so this import must fail to resolve.
import { readFileSync } from "node:fs";

export const violation = typeof readFileSync;
