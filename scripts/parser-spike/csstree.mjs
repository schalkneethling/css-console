// CSSC-002 spike: annotation extraction with css-tree.
// Reports how comments are represented for the four annotation positions,
// with emphasis on the final declaration without a semicolon.
import { readFileSync } from "node:fs";
import { parse, walk } from "css-tree";

const css = readFileSync(new URL("./fixture.css", import.meta.url), "utf8");

const comments = [];
const ast = parse(css, {
  positions: true,
  onComment(value, location) {
    comments.push({ value, location });
  },
});

console.log("== css-tree: comments via onComment callback ==");
for (const comment of comments) {
  console.log(
    `comment | line ${comment.location.start.line}, column ${comment.location.start.column} | ${JSON.stringify(comment.value)}`,
  );
}

console.log("\n== css-tree: node walk (rules, declarations, raw nodes) ==");
walk(ast, (node) => {
  if (node.type === "Rule") {
    console.log(`Rule | selector source line ${node.loc.start.line}`);
  }
  if (node.type === "Declaration") {
    console.log(
      `Declaration | line ${node.loc.start.line}, column ${node.loc.start.column} | ${node.property}`,
    );
  }
  if (node.type === "Raw") {
    console.log(`Raw | line ${node.loc.start.line} | ${JSON.stringify(node.value)}`);
  }
});

console.log("\n== css-tree: decisive case, final declaration without semicolon ==");
walk(ast, (node) => {
  if (node.type === "Rule") {
    const children = node.block.children.toArray();
    const types = children.map((child) => child.type).join(", ");
    console.log(`rule at line ${node.loc.start.line} block children: ${types}`);
    for (const child of children) {
      if (child.type === "Declaration") {
        console.log(
          `  declaration ${child.property} value type: ${child.value.type}, value: ${JSON.stringify(child.value.type === "Raw" ? child.value.value : "(structured)")}`,
        );
      }
    }
  }
});

console.log("\n== css-tree: supplementary @function parse ==");
const functionCss = `@function --space(--multiplier) {\n  result: calc(var(--multiplier) * 0.25rem);\n}`;
try {
  const functionAst = parse(functionCss, { positions: true });
  walk(functionAst, (node) => {
    if (node.type === "Atrule") {
      console.log(
        `at-rule parsed: name=${JSON.stringify(node.name)}, prelude type=${node.prelude?.type ?? "none"}, block children=${
          node.block
            ? node.block.children
                .toArray()
                .map((child) => child.type)
                .join(", ")
            : "none"
        }`,
      );
    }
  });
} catch (error) {
  console.log(`@function parse failed: ${error.message}`);
}
