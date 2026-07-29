import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vite-plus/test";

/**
 * Declaration merging rejection tests.
 *
 * Every public contract is declared with `type` rather than `interface` so
 * that a consumer cannot reopen a published record through declaration
 * merging. This suite proves the rule by copying the source tree into a
 * temporary workspace, writing a fixture that augments the records module with
 * an interface that shares a published name, and asserting that
 * `tsc --build src/core` fails with a duplicate identifier diagnostic. An
 * interface can merge into another interface without complaint, so the
 * duplicate identifier error appears only because the published name is a type
 * alias, which is the property under test. The copy keeps the working tree
 * untouched and keeps the cases independent of one another.
 */

const projectRoot = resolve(import.meta.dirname, "../..");
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tscBin = join(projectRoot, "node_modules", ".bin", `tsc${binSuffix}`);

type BuildResult = {
  status: number | null;
  output: string;
};

function createWorkspaceCopy(): string {
  const workspace = mkdtempSync(join(tmpdir(), "css-console-merging-"));

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

type MergeCase = {
  name: string;
  file: string;
  contents: string;
};

const cases: readonly MergeCase[] = [
  {
    name: "reopening the value record with an interface is rejected",
    file: "src/core/merge-value-record.ts",
    contents:
      'declare module "./records/index.ts" {\n' +
      "  interface ValueRecord<TTarget> {\n" +
      "    injectedByConsumer: TTarget;\n" +
      "  }\n" +
      "}\n\n" +
      "export {};\n",
  },
  {
    name: "reopening the probe value with an interface is rejected",
    file: "src/core/merge-probe-value.ts",
    contents:
      'declare module "./records/index.ts" {\n' +
      "  interface ProbeValue {\n" +
      "    injectedByConsumer: number;\n" +
      "  }\n" +
      "}\n\n" +
      "export {};\n",
  },
];

for (const mergeCase of cases) {
  test(mergeCase.name, { timeout: 60_000 }, () => {
    const workspace = createWorkspaceCopy();

    try {
      writeFileSync(join(workspace, mergeCase.file), mergeCase.contents);

      const { status, output } = buildProject(workspace, "src/core");

      expect(status).not.toBe(0);
      expect(output).toMatch(/error TS2300|Duplicate identifier/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}
