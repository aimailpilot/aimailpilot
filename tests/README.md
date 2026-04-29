# Tests

Vitest-based unit tests covering pure-function logic extracted from
`server/services/` and `server/routes.ts`. No DB, no network — tests
run in isolation in <5 seconds.

## Run

```bash
npm test           # run once and exit (CI-friendly)
npm run test:watch # watch mode for local development
```

## Structure

- `tests/unit/` — pure-function unit tests
- One test file per module under `server/lib/` or per exported helper
- Test files import from real production modules — no duplication

## What's covered

| Test file | Production module | Catches regressions of |
|---|---|---|
| `bounded-collections.test.ts` | `server/lib/bounded-collections.ts` | Auth-cache memory leak (loggedInUsers, authCache 10k caps) |
| `job-aging.test.ts` | `server/lib/job-aging.ts` | Stale-job zombies (the 8h Lead Intel job that wouldn't die) |
| `type-coercion.test.ts` | `server/lib/type-coercion.ts` | "invalid input syntax for type integer: 'true'" on campaign update |
| `reply-classifier.test.ts` | `server/services/reply-classifier.ts` | GitHub/Jenkins emails being mis-classified as 'positive' (11k false positives) |

## What's NOT covered (still needs manual verification)

- Browser UI behavior (would need Playwright)
- Live OAuth flows (requires real Google/Microsoft tokens)
- Actual email send paths (would dispatch real emails)
- Production DB queries with real data (`/api/admin/health` covers this)

## Adding a test

1. If the logic isn't already in `server/lib/`, extract it there as a pure function
2. Update its original call site to import from the new module
3. Add a `tests/unit/<name>.test.ts` covering the matrix
4. Run `npm test` — all must pass before commit

## Production safety

- Vitest is in `devDependencies` only — never bundled into `dist/index.js`
- `npm run build` (used by Azure deploy) does NOT run tests
- Tests run in Node-only environment (no DOM, no network)
- Test files cannot import from `dist/` or run any deploy-side code
