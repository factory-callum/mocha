---
name: migration-worker
description: Migrates JavaScript source files to TypeScript with strict type annotations
---

# Migration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve migrating batches of `.js` files to `.ts` with full strict TypeScript type annotations. The build infrastructure (tsconfig, ESLint, etc.) is already set up.

## Work Procedure

1. **Read the feature description carefully.** Identify the exact list of files to migrate and any specific type requirements mentioned.

2. **Understand dependencies.** Read each file to understand:
   - What it imports (from within lib/ and from node_modules)
   - What it exports (classes, functions, constants, types)
   - What types already exist in `lib/types.d.ts` that you can reference
   - How other already-migrated `.ts` files define types you can import

3. **Plan types before coding.** For each file:
   - Identify interfaces/types needed for parameters, return values, class properties
   - Check if types already exist in `lib/types.d.ts` or other `.ts` files
   - Plan new interfaces/types that capture the domain accurately
   - Avoid `any` — use specific types, union types, or `unknown` with type guards
   - For callback parameters, type them with proper function signatures
   - For EventEmitter events, type the event names and payloads

4. **Migrate files one at a time in dependency order.** For each file:
   a. `git mv lib/path/file.js lib/path/file.ts` to preserve git history
   b. Add type annotations to all:
      - Function parameters and return types
      - Class properties (including private ones used by tests via bracket notation)
      - Variable declarations where inference isn't sufficient
      - Module-level constants
   c. Replace JSDoc `@type`/`@typedef`/`@param` with native TypeScript types
   d. Add `import type` for type-only imports where appropriate
   e. Run `npx tsc --noEmit` after each file to catch errors immediately

5. **Handle common patterns in this codebase:**
   - **Prototype assignments after class**: Some files assign to prototype after class definition. Convert these to class methods/properties.
   - **Factory functions**: `Suite.create()`, constructors called without `new` — type the overloads properly.
   - **EventEmitter subclasses**: Runner, Suite extend EventEmitter. Type event names as string literals where possible.
   - **Dual exports pattern**: `exports = module.exports = Class` — use `export =` or standard `module.exports`.
   - **Dynamic property access**: Tests access private properties like `suite._timeout` — use bracket notation types or keep properties accessible.
   - **Callback hell**: Many methods use Node-style callbacks `(err, result)` — type these properly.

6. **IMPORTANT: Do NOT break test access patterns.** Tests remain JavaScript and access:
   - Public methods and properties normally
   - Some private properties via bracket notation (`obj._prop`) or direct access
   - Module mocking via `rewiremock` with path strings like `../../lib/module`
   - Keep class properties that tests access as public or use index signatures

7. **Verify after each file or small batch (2-3 files):**
   - `npx tsc --noEmit` → exit 0
   - `npm run test-node:unit` → all passing (1107+)

8. **After all files in the feature are migrated, run full verification:**
   - `npx tsc --noEmit` → exit 0
   - `npm run test-node:unit` → all passing
   - `npm run lint:code` → exit 0
   - `npm run build` → exit 0 (if feature includes files used by browser bundle)

9. **Commit with a clear message** listing which files were migrated.

## Type Quality Standards

- **No pervasive `any`**: Each `any` must be justified. Prefer `unknown` with type guards, specific types, or generics.
- **Explicit function signatures**: All function parameters must have types. All exported functions must have explicit return types.
- **Class properties typed**: All class properties must be declared with types in the class body.
- **Proper union types**: Use `string | null` not `any`. Use discriminated unions where appropriate.
- **Interface over type alias**: Prefer `interface` for object shapes (extensible). Use `type` for unions, intersections, mapped types.
- **Preserve JSDoc descriptions**: Keep JSDoc `@description` and `@example` comments, but remove `@type`/`@param`/`@returns` that are now expressed in TypeScript syntax.

## Example Handoff

```json
{
  "salientSummary": "Migrated 5 core domain files to TypeScript: runnable.ts, test.ts, stats-collector.ts, suite.ts, and hook (already done). Added interfaces for RunableOptions, TestOptions, SuiteOptions. All 1107 unit tests pass, tsc clean, lint clean.",
  "whatWasImplemented": "Renamed runnable.js->runnable.ts, test.js->test.ts, stats-collector.js->stats-collector.ts, suite.js->suite.ts using git mv. Added full strict type annotations: 4 new interfaces (RunnableOptions, TestOptions, SuiteOptions, StatsCollector), typed all method parameters and return values, replaced JSDoc @type annotations with native TS. Used union types for callback signatures (e.g., Done = (err?: Error) => void). Kept _-prefixed properties accessible for test compatibility.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npx tsc --noEmit", "exitCode": 0, "observation": "Zero type errors" },
      { "command": "npm run test-node:unit", "exitCode": 0, "observation": "1107 passing, 3 pending" },
      { "command": "npm run lint:code", "exitCode": 0, "observation": "Clean lint on all .ts files" },
      { "command": "npm run build", "exitCode": 0, "observation": "Browser bundle builds successfully" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": [
    {
      "severity": "low",
      "description": "Runner.prototype.grep uses RegExp but some callers pass string — added overload signature",
      "suggestedFix": "Consider updating callers to always pass RegExp"
    }
  ]
}
```

## When to Return to Orchestrator

- Type errors in files you didn't migrate (pre-existing issues surfaced by strict mode)
- Test failures that aren't caused by your migration (pre-existing)
- Circular dependency issues between modules that require architectural changes
- A file requires types from a module that hasn't been migrated yet and you can't create adequate temporary types
- The feature scope is too large to complete in a single session (more than ~10 files or ~3000 lines)
