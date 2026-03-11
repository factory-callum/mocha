# Architecture

Architectural decisions, patterns discovered, and conventions.

**What belongs here:** Coding patterns, module organization, class hierarchies, design decisions.

---

## Module Organization
- `lib/` - All source code (being migrated from .js to .ts)
- `lib/cli/` - CLI argument parsing and command handling (14 files)
- `lib/reporters/` - Output reporters: spec, dot, json, nyan, etc. (16 files)
- `lib/interfaces/` - Test DSL interfaces: BDD, TDD, QUnit, exports (6 files)
- `lib/nodejs/` - Node.js-specific runtime: worker pool, ESM utils, serializer (7 files)
- `lib/browser/` - Browser-specific: progress bar, growl notifications (2 JS + 1 HTML)
- `lib/` root - Core domain: Mocha, Runner, Suite, Runnable, Test, Hook, Context, errors, utils

## Class Hierarchy
- `Runnable` - Base class (lib/runnable.js)
  - `Test` extends Runnable (lib/test.js)
  - `Hook` extends Runnable (lib/hook.js)
- `Suite` - Test suite container (lib/suite.js)
- `Runner` extends EventEmitter - Test execution engine (lib/runner.js)
- `Mocha` - Main entry point class (lib/mocha.js)
- `Context` - Test context (`this` in tests) (lib/context.js)

## Code Patterns
- CommonJS modules (`require`/`module.exports`)
- Hybrid class + prototype pattern (ES6 class syntax with some prototype assignments)
- Heavy use of JSDoc comments for documentation
- EventEmitter pattern for Runner, Suite
- Factory functions (e.g., `Suite.create()`, `Test()` without new)
- Error classes with constants in error-constants.js

## Build Pipeline
- Rollup bundles `browser-entry.js` -> `mocha.js` (UMD) for browser use
- No compilation step currently (tsconfig is noEmit check-only)
- After migration: tsc compiles .ts -> .js in-place, then Rollup bundles for browser

## Testing
- Mocha tests itself (dogfooding)
- `unexpected` assertion library (NOT chai)
- `sinon` for mocking
- `rewiremock` for module mocking (in node-unit tests)
- Integration tests spawn `bin/mocha` as child processes
- Test fixtures must remain as .js files
