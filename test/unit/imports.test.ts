import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vite-plus/test";

import { spawnOutput } from "./spawn-output.ts";

/**
 * Package-import boundary tests.
 *
 * The compiler cannot refuse an import whose module specifier resolves, so
 * the rule that nothing under src/ imports a package is carried by the Oxlint
 * no-restricted-imports pattern in oxlint.json. A rule the linter silently
 * ignores reads as enforcement during review and provides none, so these
 * tests run the linter with the project configuration against violating and
 * compliant fixtures and fail when the configured rule stops firing. Each
 * case builds a minimal workspace in a temporary directory so the working
 * tree stays untouched.
 */

const projectRoot = resolve(import.meta.dirname, "../..");
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const oxlintBin = join(projectRoot, "node_modules", ".bin", `oxlint${binSuffix}`);

type LintResult = {
  status: number | null;
  output: string;
};

function createLintWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "css-console-imports-"));

  cpSync(join(projectRoot, "oxlint.json"), join(workspace, "oxlint.json"));
  mkdirSync(join(workspace, "src", "core"), { recursive: true });
  mkdirSync(join(workspace, "src", "browser"), { recursive: true });
  mkdirSync(join(workspace, "scripts"), { recursive: true });

  return workspace;
}

function lintWorkspace(workspace: string): LintResult {
  // A finite timeout keeps a hung linter from blocking the suite, because
  // the synchronous spawn prevents the test runner's own timeout from firing.
  const result = spawnSync(oxlintBin, ["-c", "oxlint.json", "."], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 30_000,
  });

  return {
    status: result.status,
    output: spawnOutput(result),
  };
}

type LintCase = {
  name: string;
  file: string;
  contents: string;
  fires: boolean;
};

const cases: readonly LintCase[] = [
  {
    name: "a package import under src/ fails the lint rule",
    file: "src/core/package-violation.ts",
    contents: 'import cssTree from "css-tree";\n\nexport const boundaryViolation = cssTree;\n',
    fires: true,
  },
  {
    name: "the postcss import passes the lint rule under src/core",
    file: "src/core/parser-allowed.ts",
    contents: 'import postcss from "postcss";\n\nexport const parser = postcss;\n',
    fires: false,
  },
  {
    name: "the postcss import fails the lint rule outside src/core",
    file: "src/browser/parser-violation.ts",
    contents: 'import postcss from "postcss";\n\nexport const boundaryViolation = postcss;\n',
    fires: true,
  },
  {
    name: "a scoped package import under src/ fails the lint rule",
    file: "src/core/scoped-package-violation.ts",
    contents: 'import { x } from "@scope/package";\n\nexport const boundaryViolation = x;\n',
    fires: true,
  },
  {
    name: "a node: builtin import under src/ fails the lint rule",
    file: "src/core/builtin-violation.ts",
    contents: 'import { join } from "node:path";\n\nexport const boundaryViolation = join;\n',
    fires: true,
  },
  {
    name: "a relative import under src/ passes the lint rule",
    file: "src/core/relative-allowed.ts",
    contents: 'import "./sibling.js";\n\nexport {};\n',
    fires: false,
  },
  {
    name: "a deep relative import under src/ passes the lint rule",
    file: "src/core/deep-relative-allowed.ts",
    contents: 'import "../core/sibling.js";\n\nexport {};\n',
    fires: false,
  },
  {
    name: "a package import outside src/ is exempt",
    file: "scripts/exempt.ts",
    contents: 'import { join } from "node:path";\n\nexport const exempt = join;\n',
    fires: false,
  },
];

for (const lintCase of cases) {
  test(lintCase.name, { timeout: 30_000 }, () => {
    const workspace = createLintWorkspace();

    try {
      writeFileSync(join(workspace, lintCase.file), lintCase.contents);

      const { status, output } = lintWorkspace(workspace);

      if (lintCase.fires) {
        expect(status, output).not.toBe(0);
        expect(output).toMatch(/no-restricted-imports/);
      } else {
        expect(status, output).toBe(0);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}
