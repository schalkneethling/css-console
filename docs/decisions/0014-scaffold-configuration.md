# Scaffold configuration

Status: accepted
Date: 2026-07-25
Issue: CSSC-002

## Context

CSSC-002 asked for several foundation decisions to be recorded rather than deferred: the runtime floor behind `lib: ["ES2025"]`, where tests live, how Vitest projects are configured, and how package scripts avoid collisions with Vite+ default commands.

## Decisions

**The floor behind `lib: ["ES2025"]` is Node 24 and 2025-era browser baselines.** Node 24 is the development runtime. `Set` methods such as `union()` and `difference()` shipped across engines by early 2024, and iterator helpers shipped in Safari 18.4 in March 2025, the last engine to deliver them. The floor is comfortable headroom rather than a tight fit, and it is revisited together with the `lib` setting, never separately.

**Tests live under `test/`, not colocated.** Core pins `types: []`, so a test compiled as part of core would lose the runner's globals. The test project carries `types: ["node"]` and references every source project, because tests and build scripts are exempt from the no-Node rule.

**Vitest uses a `projects` array in the `test` block of `vite.config.ts`.** Vitest 4 removed the workspace file, and Vite+ recommends the `test` block over a separate `vitest.config.ts`. The plan's directory sketch names `vitest.config.ts`; the `test` block is the same configuration in the Vite+ location. The browser provider uses the Vitest 4.1 factory form, `playwright()` from `@vitest/browser-playwright`, because the string form was removed.

**Script names avoid Vite+ collisions where possible.** `typecheck`, `gate`, and `spike:parser` are collision-free. The merge gate is `pnpm gate` (test, typecheck, lint, build, check in that order), named `gate` because `check` collides with the `vp check` builtin. The `build` script stays named `build` because it is the natural name, and the collision with the `vp build` builtin is noted in the README beside the command; use `vp run build` or `pnpm build`.

**The facade gets its own composite project.** The plan's sketch shows project configurations for core, browser, and adapter but none covering `src/index.ts`. A facade project at `src/tsconfig.json`, referencing all three, keeps the public entry inside the typechecked graph.

**`vp pack` reads `tsconfig.build.json`.** Declaration generation needs a configuration with compiler options, and the root solution file intentionally carries none.

## Consequences

The static lane proves all three boundary dimensions executably, with mutation evidence recorded in the scaffold commit. If the pack wrapper learns to read project references natively, `tsconfig.build.json` can retire.
