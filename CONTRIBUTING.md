# Contributing to Metro Landmark

Thanks for your interest in improving Metro Landmark.

## Before you start

- Read the [README](./README.md) for stack and quickstart.
- Read the [Code of Conduct](./CODE_OF_CONDUCT.md).
- Do **not** commit secrets (`.env*`, `.db-environments.json`, service keys) or documents containing real personal data.

## Development setup

1. Use Node.js 22.x.
2. `npm install`
3. Copy `.db-environments.example.json` to `.db-environments.json` and add your Supabase credentials.
4. Run `npm run env:select` to choose an environment and write `.env.local` for the Vite client (Supabase keys are rewritten; other `VITE_*` overrides you add are preserved).
5. `npm run dev` (UI) or `npm run dev:full` (UI + local API).

Full production/Vercel setup: [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md).

## Checks before opening a PR

```bash
npm run lint
npm test
```

If you add or change integration tests under `tests/integration/`, they must import the safety harness and call `requireProdTestOptIn()` (`npm run check:test-safety` enforces this).

## Pull requests

- Keep PRs focused and reviewable.
- Describe what changed and how you verified it.
- Match existing React patterns (functional components, shared UI in `src/components/ui.jsx`, config under `src/config/` and `src/jurisdictions/`).
- Avoid drive-by refactors of very large page/component files.

## Jurisdiction and compliance changes

- Put statute and municipal code citations and notice-period values in jurisdiction **packs** (`src/jurisdictions/packs/`), not hard-coded city-name branches in the UI.
- Label pack-specific or lightly tested behavior honestly (experimental / pack-dependent).
- Add or extend unit tests for calculator logic when you change notice math.
