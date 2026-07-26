/**
 * Static lane: executable proof of the three boundary dimensions.
 *
 * Each violation case is a small TypeScript configuration that adds one
 * offending file to an otherwise clean project and must fail to compile.
 * The clean project graph must compile. Together these tests make the
 * boundary configuration executable rather than conventional.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const tscEntry = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));

type TscResult = {
  exitCode: number;
  output: string;
};

function runTsc(config: string, mode: "build" | "project"): TscResult {
  const args =
    mode === "build"
      ? ["--build", config, "--force", "--pretty", "false"]
      : ["--project", config, "--pretty", "false"];

  try {
    const output = execFileSync(process.execPath, [tscEntry, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, output };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

type ViolationCase = {
  title: string;
  config: string;
  mode: "build" | "project";
  pattern: RegExp;
};

const violationCases: ViolationCase[] = [
  {
    title: "a DOM global in core fails typecheck",
    config: "test/static/cases/dom-in-core/tsconfig.json",
    mode: "project",
    pattern: /Cannot find name 'document'/,
  },
  {
    title: "an ambient global such as process in core fails typecheck",
    config: "test/static/cases/ambient-in-core/tsconfig.json",
    mode: "project",
    pattern: /Cannot find name 'process'/,
  },
  {
    title: "core importing from browser fails typecheck",
    config: "test/static/cases/core-imports-browser/tsconfig.json",
    mode: "build",
    pattern: /error TS\d+/,
  },
  {
    title: "adapter importing from browser fails typecheck",
    config: "test/static/cases/adapter-imports-browser/tsconfig.json",
    mode: "build",
    pattern: /error TS\d+/,
  },
  {
    title: "a node: builtin import under src/ fails typecheck",
    config: "test/static/cases/node-builtin-in-browser/tsconfig.json",
    mode: "project",
    pattern: /Cannot find module 'node:fs'/,
  },
];

for (const violation of violationCases) {
  test(
    violation.title,
    () => {
      const result = runTsc(violation.config, violation.mode);
      expect(result.output).toMatch(violation.pattern);
      expect(result.exitCode).not.toBe(0);
    },
    120_000,
  );
}

test("browser importing from core succeeds across the reference graph", () => {
  const result = runTsc("tsconfig.json", "build");
  expect(result.output).toBe("");
  expect(result.exitCode).toBe(0);
}, 120_000);
