import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vite-plus/test";

/**
 * Boundary enforcement tests for the compiler-enforced dimensions.
 *
 * The compiler enforces the global and import-direction boundaries, and the
 * builtin half of the package boundary; the package half is lint-enforced and
 * proven in imports.test.ts. These tests prove each compiler-enforced boundary
 * by compiling a deliberately violating file and asserting that the build
 * fails with the expected diagnostic. Each
 * case copies the source tree and the base configuration into a temporary
 * directory, injects one violation, runs `tsc --build` against the affected
 * project, and cleans up. The copies keep the working tree untouched and keep
 * the cases independent of one another.
 */

const projectRoot = resolve(import.meta.dirname, "../..");
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tscBin = join(projectRoot, "node_modules", ".bin", `tsc${binSuffix}`);

type BuildResult = {
  status: number | null;
  output: string;
};

function createWorkspaceCopy(): string {
  const workspace = mkdtempSync(join(tmpdir(), "css-console-boundary-"));

  cpSync(join(projectRoot, "tsconfig.base.json"), join(workspace, "tsconfig.base.json"));
  cpSync(join(projectRoot, "src"), join(workspace, "src"), { recursive: true });

  // The compiler resolves the module format of each file from the nearest
  // package.json, so the copy needs one that matches the real project.
  writeFileSync(join(workspace, "package.json"), '{ "type": "module" }\n');

  return workspace;
}

function buildProject(workspace: string, projectPath: string): BuildResult {
  const result = spawnSync(tscBin, ["--build", "--force", "--pretty", "false", projectPath], {
    cwd: workspace,
    encoding: "utf8",
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

type ViolationCase = {
  name: string;
  file: string;
  contents: string;
  project: string;
  expected: RegExp;
};

const violations: readonly ViolationCase[] = [
  {
    name: "a DOM global in core fails to typecheck",
    file: "src/core/dom-violation.ts",
    contents: "export const boundaryViolation = document.body;\n",
    project: "src/core",
    expected: /Cannot find name 'document'/,
  },
  {
    name: "an ambient Node global in core fails to typecheck",
    file: "src/core/ambient-violation.ts",
    contents: "export const boundaryViolation = process.cwd;\n",
    project: "src/core",
    expected: /Cannot find name 'process'/,
  },
  {
    name: "core importing from browser fails to typecheck",
    file: "src/core/import-direction-violation.ts",
    contents: 'import "../browser/scanner/index.ts";\n\nexport {};\n',
    project: "src/core",
    expected:
      /TS6307: File '[^']*browser[/\\]scanner[/\\]index\.ts' is not listed within the file list of project/,
  },
  {
    name: "adapter importing from browser fails to typecheck",
    file: "src/adapter/import-direction-violation.ts",
    contents: 'import "../browser/scanner/index.ts";\n\nexport {};\n',
    project: "src/adapter",
    expected:
      /TS6307: File '[^']*browser[/\\]scanner[/\\]index\.ts' is not listed within the file list of project/,
  },
  {
    name: "a node: builtin import in core fails to typecheck",
    file: "src/core/node-builtin-violation.ts",
    contents: 'import { join } from "node:path";\n\nexport const boundaryViolation = join;\n',
    project: "src/core",
    expected: /Cannot find name 'node:path'/,
  },
  {
    name: "a node: builtin import in browser fails to typecheck",
    file: "src/browser/node-builtin-violation.ts",
    contents:
      'import { readFileSync } from "node:fs";\n\nexport const boundaryViolation = readFileSync;\n',
    project: "src/browser",
    expected: /Cannot find name 'node:fs'/,
  },
  {
    name: "a node: builtin import in adapter fails to typecheck",
    file: "src/adapter/node-builtin-violation.ts",
    contents:
      'import { readFileSync } from "node:fs";\n\nexport const boundaryViolation = readFileSync;\n',
    project: "src/adapter",
    expected: /Cannot find name 'node:fs'/,
  },
];

for (const violation of violations) {
  test(violation.name, { timeout: 60_000 }, () => {
    const workspace = createWorkspaceCopy();

    try {
      writeFileSync(join(workspace, violation.file), violation.contents);

      const { status, output } = buildProject(workspace, violation.project);

      expect(status).not.toBe(0);
      expect(output).toMatch(violation.expected);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}

test("the unmodified source tree typechecks", { timeout: 60_000 }, () => {
  const workspace = createWorkspaceCopy();

  try {
    const core = buildProject(workspace, "src/core");
    const browser = buildProject(workspace, "src/browser");
    const adapter = buildProject(workspace, "src/adapter");

    expect(core.status, core.output).toBe(0);
    expect(browser.status, browser.output).toBe(0);
    expect(adapter.status, adapter.output).toBe(0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("browser importing from core succeeds", { timeout: 60_000 }, () => {
  const workspace = createWorkspaceCopy();

  try {
    writeFileSync(
      join(workspace, "src/browser/import-direction-allowed.ts"),
      'import "../core/records/index.ts";\n\nexport {};\n',
    );

    const { status, output } = buildProject(workspace, "src/browser");

    expect(status, output).toBe(0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
