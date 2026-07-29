import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vite-plus/test";

/**
 * Structural lint rule tests.
 *
 * The ast-grep rules under rules/ enforce decisions the standard linter has
 * no rule for: no `interface` under src/, and a finite timeout on every
 * synchronous child process call. A rule the linter silently ignores reads
 * as enforcement during review and provides none, so these tests run
 * ast-grep with the project configuration against violating and compliant
 * fixtures and fail when a configured rule stops firing. Each case builds a
 * minimal workspace in a temporary directory so the working tree stays
 * untouched.
 */

const projectRoot = resolve(import.meta.dirname, "../..");
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const astGrepBin = join(projectRoot, "node_modules", ".bin", `ast-grep${binSuffix}`);

type ScanResult = {
  status: number | null;
  output: string;
};

function createScanWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "css-console-structural-"));

  cpSync(join(projectRoot, "sgconfig.yml"), join(workspace, "sgconfig.yml"));
  cpSync(join(projectRoot, "rules"), join(workspace, "rules"), { recursive: true });
  mkdirSync(join(workspace, "src", "core"), { recursive: true });
  mkdirSync(join(workspace, "test"), { recursive: true });

  return workspace;
}

function scanWorkspace(workspace: string): ScanResult {
  // A finite timeout keeps a hung scan from blocking the suite, because the
  // synchronous spawn prevents the test runner's own timeout from firing.
  const result = spawnSync(astGrepBin, ["scan"], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 30_000,
  });

  return {
    status: result.status,
    output: [
      result.stdout ?? "",
      result.stderr ?? "",
      result.error?.message ?? "",
      result.signal ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

type ScanCase = {
  name: string;
  file: string;
  contents: string;
  fires: string | null;
};

const cases: readonly ScanCase[] = [
  {
    name: "an interface under src/ fails the structural lint",
    file: "src/core/interface-violation.ts",
    contents: "export interface Violation {\n  field: string;\n}\n",
    fires: "no-interface-in-src",
  },
  {
    name: "a type alias under src/ passes the structural lint",
    file: "src/core/type-allowed.ts",
    contents: "export type Allowed = {\n  field: string;\n};\n",
    fires: null,
  },
  {
    name: "an interface outside src/ is exempt",
    file: "test/interface-exempt.ts",
    contents: "export interface Exempt {\n  field: string;\n}\n",
    fires: null,
  },
  {
    name: "a synchronous spawn without a timeout fails the structural lint",
    file: "test/spawn-violation.ts",
    contents:
      'import { spawnSync } from "node:child_process";\n\n' +
      'export const result = spawnSync("tsc", ["--build"], {\n' +
      '  encoding: "utf8",\n' +
      "});\n",
    fires: "sync-spawn-requires-timeout",
  },
  {
    name: "a synchronous spawn with a timeout passes the structural lint",
    file: "test/spawn-allowed.ts",
    contents:
      'import { spawnSync } from "node:child_process";\n\n' +
      'export const result = spawnSync("tsc", ["--build"], {\n' +
      '  encoding: "utf8",\n' +
      "  timeout: 60_000,\n" +
      "});\n",
    fires: null,
  },
];

for (const scanCase of cases) {
  test(scanCase.name, { timeout: 30_000 }, () => {
    const workspace = createScanWorkspace();

    try {
      writeFileSync(join(workspace, scanCase.file), scanCase.contents);

      const { status, output } = scanWorkspace(workspace);

      if (scanCase.fires === null) {
        expect(status, output).toBe(0);
      } else {
        expect(status, output).not.toBe(0);
        expect(output).toContain(scanCase.fires);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}

test("the working tree passes the structural lint", { timeout: 30_000 }, () => {
  // A finite timeout keeps a hung scan from blocking the suite, because the
  // synchronous spawn prevents the test runner's own timeout from firing.
  const result = spawnSync(astGrepBin, ["scan"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30_000,
  });

  expect(result.status, `${result.stdout ?? ""}\n${result.stderr ?? ""}`).toBe(0);
});
