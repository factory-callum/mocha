---
name: infra-worker
description: Sets up TypeScript build infrastructure, tooling, and configuration changes
---

# Infrastructure Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve build pipeline changes: tsconfig.json, ESLint config, package.json scripts, .gitignore, Rollup config, and small pilot file migrations that validate the infrastructure.

## Work Procedure

1. **Read the feature description carefully.** Understand exactly what configuration changes and pilot migrations are required.

2. **Investigate current state.** Read the files you need to modify (tsconfig.json, eslint.config.js, package.json, .gitignore, rollup.config.mjs) to understand the current configuration.

3. **Plan changes.** Before making any edits, plan the full set of changes needed. Consider:
   - How tsconfig.json needs to change (strict, emit, sourceMap, declaration, module resolution)
   - What new npm packages need to be installed (e.g., typescript-eslint)
   - How ESLint flat config needs to be updated for .ts files
   - What .gitignore entries are needed for compiled output
   - How package.json scripts need to change

4. **Write tests first (if applicable).** For pilot file migrations, write a small verification script or test that validates the compilation pipeline works.

5. **Implement changes incrementally.** Make one category of change at a time:
   a. Install any new packages needed (`npm install --save-dev <package>`)
   b. Update tsconfig.json
   c. Update .gitignore
   d. Update package.json scripts
   e. Update ESLint config
   f. Migrate pilot files (git mv to rename, then add types)

6. **Verify after each major change:**
   - `npx tsc --noEmit` (or `npx tsc` if emit is configured) — must exit 0
   - `npm run test-node:unit` — all tests must pass
   - `npm run lint:code` — must pass
   - `npm run build` — must produce mocha.js

7. **For pilot file migrations:**
   - Use `git mv lib/file.js lib/file.ts` to preserve git history
   - Add proper TypeScript type annotations (parameter types, return types, interfaces)
   - Do NOT just rename without adding types — the point is to validate strict TS works
   - Ensure the compiled .js output is functionally equivalent to the original

8. **Run full verification suite:**
   - `npx tsc --noEmit` → exit 0
   - `npm run test-node:unit` → all passing
   - `npm run lint:code` → exit 0
   - `npm run build` → exit 0

9. **Commit with a clear message** describing all infrastructure changes made.

## Example Handoff

```json
{
  "salientSummary": "Set up TypeScript compilation pipeline: updated tsconfig.json with strict:true and emit, configured ESLint for .ts via typescript-eslint, added compile script to package.json, updated .gitignore. Migrated 3 pilot files (pending.ts, context.ts, hook.ts) with full strict types. All 1107 unit tests pass, build succeeds, lint clean.",
  "whatWasImplemented": "TypeScript build infrastructure: tsconfig.json updated (strict:true, declaration, sourceMap, emit to lib/), .gitignore excludes compiled output, ESLint flat config extended with typescript-eslint parser and rules, package.json has new 'compile' script. Three pilot files migrated from .js to .ts with explicit type annotations on all parameters, return types, and class properties.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npx tsc --noEmit", "exitCode": 0, "observation": "Zero type errors across entire codebase including pilot .ts files" },
      { "command": "npm run test-node:unit", "exitCode": 0, "observation": "1107 passing, 3 pending — identical to baseline" },
      { "command": "npm run lint:code", "exitCode": 0, "observation": "ESLint passes on both .js and .ts files" },
      { "command": "npm run build", "exitCode": 0, "observation": "Rollup produces mocha.js bundle successfully" },
      { "command": "git status", "exitCode": 0, "observation": "Only .ts source files tracked; compiled .js ignored by git" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A required npm package fails to install
- ESLint TypeScript integration has breaking incompatibilities with the existing flat config
- tsconfig changes cause widespread compilation errors in untouched .js files
- The rollup build breaks in a way that isn't straightforward to fix
- Test failures that are clearly not related to your changes (pre-existing issues)
