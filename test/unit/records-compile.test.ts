import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vite-plus/test";

import { spawnOutput } from "./spawn-output.ts";

/**
 * Core record construction tests.
 *
 * The core project compiles with the ES2025 library only and with no ambient
 * types, so the record contracts must not reference the DOM. This suite proves
 * that by copying the source tree into a temporary workspace, writing a fixture
 * into src/core that imports the record types through a relative import and
 * constructs a fully populated ValueRecord and FunctionRecord over a plain
 * string target, and asserting that `tsc --build src/core` exits zero. A green
 * build proves both that the records are constructible without the DOM and that
 * the types themselves compile without the DOM library. The copy keeps the
 * working tree untouched.
 */

const projectRoot = resolve(import.meta.dirname, "../..");
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tscBin = join(projectRoot, "node_modules", ".bin", `tsc${binSuffix}`);

type BuildResult = {
  status: number | null;
  output: string;
};

function createWorkspaceCopy(): string {
  const workspace = mkdtempSync(join(tmpdir(), "css-console-records-"));

  cpSync(join(projectRoot, "tsconfig.base.json"), join(workspace, "tsconfig.base.json"));
  cpSync(join(projectRoot, "src"), join(workspace, "src"), { recursive: true });

  // The compiler resolves the module format of each file from the nearest
  // package.json, so the copy needs one that matches the real project.
  writeFileSync(join(workspace, "package.json"), '{ "type": "module" }\n');

  return workspace;
}

function buildProject(workspace: string, projectPath: string): BuildResult {
  // A finite timeout keeps a hung compiler from blocking the suite, because
  // the synchronous spawn prevents the test runner's own timeout from firing.
  const result = spawnSync(tscBin, ["--build", "--force", "--pretty", "false", projectPath], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 60_000,
  });

  return {
    status: result.status,
    output: spawnOutput(result),
  };
}

const fixture = `import type {
  FunctionRecord,
  ProbeValue,
  ValueRecord,
} from "./records/index.ts";

const guard = { contested: false, reasons: [] as const };

const location = {
  url: "styles.css",
  start: { line: 1, column: 1 },
  end: { line: 1, column: 12 },
};

const probeValue: ProbeValue = {
  name: "color",
  authored: "var(--brand)",
  resolved: "rgb(0, 0, 0)",
  guard,
};

export const valueRecord: ValueRecord<string> = {
  kind: "value",
  probeId: "probe-1",
  logLevel: "log",
  label: "brand color",
  selector: ".card",
  target: "the-target",
  pseudo: null,
  source: location,
  values: [probeValue],
  timestamp: 0,
};

export const functionRecord: FunctionRecord<string> = {
  kind: "function",
  probeId: "probe-2",
  logLevel: "log",
  label: "space scale",
  functionName: "--space",
  definition: location,
  callSite: {
    property: "padding",
    arguments: ["4"],
    soleContribution: true,
    selector: ".card",
    source: location,
  },
  target: "the-target",
  pseudo: null,
  resolved: "16px",
  guard,
  timestamp: 0,
};
`;

test("the core records are constructible without the DOM library", { timeout: 60_000 }, () => {
  const workspace = createWorkspaceCopy();

  try {
    writeFileSync(join(workspace, "src/core/records-construction.ts"), fixture);

    const { status, output } = buildProject(workspace, "src/core");

    expect(status, output).toBe(0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
