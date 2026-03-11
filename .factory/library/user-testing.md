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
- No pre-existing failures

## Known Quirks
- Tests use `unexpected` (not chai) as assertion library
- Integration tests spawn `bin/mocha` as child processes - resilient to source restructuring
- `rewiremock` used for module mocking in node-unit tests - paths must match compiled output
- The project type is `"commonjs"` in package.json; ESM uses `.mjs` extension
