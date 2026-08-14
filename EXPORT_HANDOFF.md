# Metro Landmark export handoff

Generated: 2026-08-14T06:59:22.828Z
Source: Salish Landmark (private) → clean snapshot (no `.git` history)
Output: `C:\tmp\metro-landmark-export`

## What this folder is

A **directory snapshot** ready for:

```bash
cd C:\tmp\metro-landmark-export
git init
git add .
git commit -m "Initial public commit — Metro Landmark"
# Create empty public repo metro-landmark on your GitHub, then:
git branch -M main
git remote add origin git@github.com:<YOU>/metro-landmark.git
git push -u origin main
```

Then verify a **fresh clone** boots (Workstream 4.3) and archive Salish Landmark (4.4).

## Export stats

- Files copied: 321
- Paths denied: 34
- Package name set to: `metro-landmark`

## Denied categories (see private `docs/EXPORT_DENY_LIST.md` in Salish)

Secrets/env dumps, PII samples, internal transition docs, agent prompts,
Michigan/out-of-jurisdiction samples, `node_modules`, `.git`, IDE scaffolding.

## After push (Bob)

1. Create public GitHub repo **`metro-landmark`** (empty, no README if pushing existing tree).
2. Push this snapshot as the initial commit (commands above).
3. Clone to a clean directory: `git clone … && cd metro-landmark && npm install`.
4. Copy `.db-environments.example.json` → `.db-environments.json`, fill keys, `npm run env:select`, `npm run dev:full`.
5. When satisfied, **Archive** the Salish Landmark GitHub repo.

## Note

This handoff file is written only into the export output (not required in the public tree long-term; delete before commit if you prefer a pristine root).
