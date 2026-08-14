# Metro Landmark

Open-source property management platform for multi-landlord / multi-PMC operations.

**Default jurisdiction pack:** Washington State + City of Seattle.  
**License:** MIT — Copyright © Robert T. Kelly. See [LICENSE](./LICENSE).

Washington’s Salish Landmark Property Management is the reference operator context that shaped this codebase (branding, locale defaults, and the WA/Seattle jurisdiction pack).

## Features

- Properties, units, landlords, PMCs, tenants, applicants, and leases
- Maintenance requests (web, plus optional voice/chat assistants when configured)
- Documents, templates, and compliance workflows
- Configurable brand, locale, jurisdiction packs, and voice/maintenance phone

### Compliance disclaimer

Compliance calculators and workflows are **jurisdiction-pack dependent**. The shipped pack encodes Washington State and City of Seattle landlord–tenant notice periods and related statute/code citations used by the reference deployment. Treat support for other jurisdictions as **experimental** until additional packs and tests exist. This software is not a substitute for legal counsel.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, Tailwind CSS v4 |
| API | Vercel serverless functions in `api/`, plus a local Express wrapper (`dev-server.js`) |
| Database | Supabase (PostgreSQL) |
| Runtime | Node.js 22.x |

Schema migrations live under `scripts/migrations/`.

## Quickstart

### Prerequisites

- Node.js 22.x
- A Supabase project
- Never commit secrets (`.env*`, `.db-environments.json`, service keys)

### 1. Install

```bash
npm install
```

### 2. Configure a database environment

1. Copy [`.db-environments.example.json`](./.db-environments.example.json) to `.db-environments.json` (gitignored).
2. Fill in your Supabase URL, publishable key, and service role key.
3. Run the environment selector:

```bash
npm run env:select
```

`env:select` reads `.db-environments.json`, lets you pick which named environment to use, and writes Supabase keys into `.env.local`. `npm run dev` runs this selector automatically when needed. Brand overrides you add to `.env.local` (for example `VITE_LOGO`) are preserved across rewrites; restart the Vite dev server after changing them.

For a full Vercel deploy (all server env vars, optional email/SMS/voice): see [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md).

Useful client overrides (also documented in the deployment guide):

| Variable | Purpose |
|----------|---------|
| `VITE_PRODUCT_NAME` | Product display name (derives heading, sidebar lines, auth storage key) |
| `VITE_LOGO` | JSON logo asset: `{"logo":[{"path":"/brand/..."},{"alt":"..."}]}` (`alt` optional) |
| `VITE_BACKGROUND` | JSON background asset: `{"background":[{"path":"/brand/..."},{"alt":"..."}]}` (`alt` optional) |
| `VITE_TENANT_MAINTENANCE_PHONE` | Tenant “Call Voice Bot” number (E.164) |

### 3. Run locally

```bash
npm run dev          # Vite UI on port 5173
npm run dev:api      # Local API on port 3000
npm run dev:full     # UI + API together
```

### 4. Verify

```bash
npm run lint
npm test
```

Integration tests under `tests/integration/` need database credentials and the safety harness (`npm run check:test-safety`).

## Configuration modules

| Concern | Module |
|---------|--------|
| Brand | `src/config/brand.js`, `src/config/brand-derive.js`, `api/utils/brand.js` |
| Locale / currency display | `src/config/locale.js` |
| Jurisdiction packs (WA + Seattle) | `src/jurisdictions/` |
| Voice / maintenance phone | `src/config/phones.js`, `api/utils/phones.js` |

## Try Metro Landmark

There is no anonymous public demo (see [SECURITY.md](./SECURITY.md) for why). Options for exploring the product:

- Watch a walkthrough video when linked from this README or Discussions
- Email the maintainer for an invite-only **read-only** account on the reference installation

## Roadmap

See [ROADMAP.md](./ROADMAP.md).

## Community

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md) — private vulnerability reporting

## Maintainer

Robert T. Kelly — consulting and adaptation for operators who need additional jurisdiction packs, branding, or production hardening.
