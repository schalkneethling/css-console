// CSSC-002 spike: annotation extraction with PostCSS.
// Reports how comments are represented for the four annotation positions,
// with emphasis on the final declaration without a semicolon.
import { readFileSync } from "node:fs";
import postcss from "postcss";

const css = readFileSync(new URL("./fixture.css", import.meta.url), "utf8");
const root = postcss.parse(css);

function position(node) {
  const start = node.source?.start;
  const end = node.source?.end;
  return `line ${start?.line ?? "?"}, column ${start?.column ?? "?"} to line ${end?.line ?? "?"}, column ${end?.column ?? "?"}`;
}

console.log("== PostCSS: every node ==");
root.walk((node) => {
  const detail =
    node.type === "comment"
      ? JSON.stringify(node.text)
      : node.type === "decl"
        ? `${node.prop}: ${node.value}`
        : node.type === "rule"
          ? node.selector
          : "";
  console.log(`${node.type} | ${position(node)} | ${detail}`);
});

console.log("\n== PostCSS: decisive case, final declaration without semicolon ==");
root.walkRules(".note", (rule) => {
  console.log(`rule child nodes: ${rule.nodes.map((node) => node.type).join(", ")}`);
  rule.each((node) => {
    if (node.type === "decl") {
      console.log(`decl raws: ${JSON.stringify(node.raws)}`);
    }
    if (node.type === "comment") {
      console.log(`comment node emitted: ${JSON.stringify(node.text)} at ${position(node)}`);
    }
  });
  console.log(`rule raws: ${JSON.stringify(rule.raws)}`);
});

console.log("\n== PostCSS: supplementary @function parse ==");
const functionCss = `@function --space(--multiplier) {\n  result: calc(var(--multiplier) * 0.25rem);\n}`;
try {
  const functionRoot = postcss.parse(functionCss);
  functionRoot.walkAtRules((atRule) => {
    console.log(
      `at-rule parsed: name=${JSON.stringify(atRule.name)}, params=${JSON.stringify(atRule.params)}, children=${atRule.nodes?.map((node) => node.type).join(", ") ?? "none"}`,
    );
  });
} catch (error) {
  console.log(`@function parse failed: ${error.message}`);
}
