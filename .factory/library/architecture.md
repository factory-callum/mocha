# Architecture

Architectural decisions, patterns discovered, and conventions.

**What belongs here:** Coding patterns, module organization, class hierarchies, design decisions.

---

## Module Organization
- `lib/` - All source code (now TypeScript `.ts` source emitted to `.js` for runtime)
- `lib/cli/` - CLI argument parsing and command handling (14 files)
- `lib/reporters/` - Output reporters: spec, dot, json, nyan, etc. (16 files)
- `lib/interfaces/` - Test DSL interfaces: BDD, TDD, QUnit, exports (6 files)
- `lib/nodejs/` - Node.js-specific runtime: worker pool, ESM utils, serializer (7 files)
- `lib/browser/` - Browser-specific support utilities and template (`highlight-tags.ts`, `parse-query.ts`, `template.html`)
- `lib/` root - Core domain: Mocha, Runner, Suite, Runnable, Test, Hook, Context, errors, utils

## Class Hierarchy
- `Runnable` - Base class (`lib/runnable.ts` source; emitted `lib/runnable.js`)
  - `Test` extends Runnable (`lib/test.ts`)
  - `Hook` extends Runnable (`lib/hook.ts`)
- `Suite` - Test suite container (`lib/suite.ts`)
- `Runner` extends EventEmitter - Test execution engine (`lib/runner.ts`)
- `Mocha` - Main entry point class (`lib/mocha.ts`)
- `Context` - Test context (`this` in tests) (`lib/context.ts`)

## Code Patterns
- CommonJS modules (`require`/`module.exports`)
- Hybrid class + prototype pattern (ES6 class syntax with some prototype assignments)
- Heavy use of JSDoc comments for documentation
- EventEmitter pattern for Runner, Suite
- Factory functions (e.g., `Suite.create()`, `Test()` without new)
- Error classes with constants in error-constants.js

## Build Pipeline
- TypeScript compilation emits runtime JS in-place: `npx tsc` compiles `lib/**/*.ts` -> `lib/**/*.js`
- Rollup bundles `browser-entry.js` -> `mocha.js` (UMD) for browser use
- Tests and CLI entrypoints consume compiled `lib/**/*.js` output

## TypeScript Browser Typing Pattern
- Global TypeScript config does not include DOM libs.
- Browser-only source files should use a per-file DOM lib reference when needed, e.g. `/// <reference lib="dom" />` (used by `lib/reporters/html.ts`).

## Node Runtime Typing Notes
- `workerpool` helper types are not all exported from the package root; runtime modules may need local structural types for callbacks/options instead of importing non-exported internals.

## Testing
- Mocha tests itself (dogfooding)
- `unexpected` assertion library (NOT chai)
- `sinon` for mocking
- `rewiremock` for module mocking (in node-unit tests)
- Integration tests spawn `bin/mocha` as child processes
- Test fixtures must remain as .js files
