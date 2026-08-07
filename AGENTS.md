<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Verify behavior against sources, not from memory

Any claim about how a dependency, a browser, or a specification behaves must be
checked against the actual source before it is relied on, written into a
comment, or used to justify a design. Recalled behavior is a hypothesis. This
applies to code being written and to code being reviewed.

`@MEDIA` reached review as a bug of exactly this kind: the at-rule tier lookup
assumed PostCSS normalized at-rule names, nobody checked, and both the
implementation and its tests encoded the same wrong assumption. The reviewer
that caught it read `node_modules/postcss/lib/parser.js` at the pinned version
and found the line that assigns `node.name`.

## How to verify

Prefer the source that is actually installed, because that is the one running:

- Read the dependency in `node_modules` rather than recalling its behavior. The
  pinned version is what ships, and a changelog entry is not evidence about the
  version in the lockfile.
- Read the upstream source at the pinned tag when `node_modules` is unavailable
  or the question is about a version other than the installed one.
- Run the input through the real code when the question is behavioral. A failing
  assertion is stronger evidence than a careful reading of the implementation,
  and it leaves a regression test behind.
- Cite the specification for CSS semantics, and add a test that pins the
  behavior to the project. At-rule names being ASCII case-insensitive is a
  specification fact; that this code honors it is a test.

## What to report

State what was checked and what it showed, not only the conclusion. A summary
that says a lookup is case-insensitive is an assertion; one that names the file
read and the line found is evidence a reviewer can check. When something could
not be verified, say so and name the assumption being made instead of presenting
it as settled.
