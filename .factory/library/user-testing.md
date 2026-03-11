# User Testing

Testing surface: tools, URLs, setup steps, isolation notes, known quirks.

**What belongs here:** How to manually verify the application works, testing tools, surfaces.

---

## Testing Surface

This is a library (not a web app). The testing surface is command-line:

### TypeScript Compilation
```bash
npx tsc --noEmit   # Type-check only, no output
npx tsc             # Full compilation with emit
```

### Test Suites
```bash
npm run test-node:unit         # 1107+ unit tests
npm run test-node:integration  # Integration tests (spawns child processes)
npm run test-node:reporters    # Reporter tests
npm run test-node:interfaces   # Interface tests (BDD, TDD, QUnit, exports)
npm run test-smoke             # Quick smoke test
npm run test-node              # Full test suite (all of the above + coverage)
```

### Build
```bash
npm run build    # Rollup browser bundle -> mocha.js
```

### Lint
```bash
npm run lint:code   # ESLint
```

### CLI Verification
```bash
node bin/mocha.js --help              # Should display help
node bin/mocha.js test/smoke/smoke.spec.js  # Should run smoke test
```

### Package Verification
```bash
npm pack --dry-run   # Verify package contents
```

## Baseline (Pre-Migration)
- Unit tests: 1107 passing, 3 pending
- All lint, typecheck, build pass cleanly
- Pre-existing environment-specific failures exist in `npm run test-node:integration` / `npm run test-node` on Node 25 (documented in mission AGENTS guidance)

## Known Quirks
- Tests use `unexpected` (not chai) as assertion library
- Integration tests spawn `bin/mocha` as child processes - resilient to source restructuring
- `rewiremock` used for module mocking in node-unit tests - paths must match compiled output
- The project type is `"commonjs"` in package.json; ESM uses `.mjs` extension
- On clean checkouts, run `npm run compile` before `npm run lint:code`; eslint-plugin-n resolves runtime `require()` paths that point to compiled `lib/*.js` outputs.
- Known environment caveat: full integration suite has pre-existing Node 25 failures; prioritize milestone-mapped assertions and treat those failures as non-blocking unless a mission explicitly says otherwise.

## Flow Validator Guidance: CLI/Terminal Surface

- Use only your assigned namespace for temporary files (example: `/tmp/mocha-user-testing-<namespace>`).
- Do not modify source files or commit history; validation is command-driven and read-only against project sources.
- Avoid shared mutable setup outside your namespace. If you must emit build artifacts, do it only in the repository `lib/` output path expected by the project.
- For this milestone, no real user accounts are required. Treat assigned `Account` values as isolation labels only.
- Prefer deterministic commands from `.factory/services.yaml` (`typecheck`, `compile`, `lint`, `test-unit`, `build`) and record exact outputs/exit codes.
- Known environment caveat: full integration suite has pre-existing Node 25 failures; prioritize the assertions explicitly mapped for the current milestone.
