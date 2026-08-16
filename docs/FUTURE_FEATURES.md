# Future Features — Parking Lot

Status vocabulary matches `ROADMAP.md`: **shipped** · **partial** · **planned** · **idea** · **out of scope** (for now).

This document holds **ideas and design notes** that are not yet committed roadmap builds. Prefer promoting at most a few items into `ROADMAP.md` Planned when we are ready to execute.

---

## Documents & templates (parked 2026-08-14)

**Context:** Template import + field-position measurement are useful but fragile today. Re-running import often yields a slightly different field set (mostly right; some missing or mistyped). Positions are often right but rarely all correct. Editing fields requires learning JSON. We are pausing further template/doc-creation hardening to focus on the Metro Landmark migration; revisit after cutover (or as a Phase E build).

### Observed fragilities

1. **Non-deterministic schema extraction** — Vision/LLM import does not guarantee a stable field inventory or consistent names/types across runs.
2. **Precomputed positions drift** — Geometric + vision measurement is heuristic; mid-line blanks, next-line underscores, and multi-sentence clauses remain easy to misplace.
3. **Expert-only correction path** — Template JSON is editable, but that is not a product UX.

### Direction ideas

#### a) Compute field positions at document generation time (not only at import)

**Idea:** Stop treating import-time positions as the single source of truth. Detect/place blanks when generating a filled PDF (or refresh positions then), using the template PDF + current field list.

**Assessment:** Agree this removes a major class of “stale wrong coordinates.” Caveats:

- Generation latency and cost go up if every fill re-runs full geometry/vision.
- Better pattern: **import stores schema + optional hint positions**; **generate re-measures or refines** (geometry first, vision only for unresolved fields), optionally caching a signed “position revision” on the template when the user accepts placements.
- Still needs a correct field *list*; on-the-fly placement does not fix missing/wrong field definitions.

**Status:** idea (strong candidate after migration)

#### b) DocuSign-style interactive placement UI

**Idea:** Auto-detect/identify fields as a starting point; let the user drag, resize, rename, change type, add/remove fields on the page image before saving the template (or before generating a one-off document).

**Assessment:** Agree — this is the durable product answer to fragile auto-layout. Auto-detect becomes “draft,” human confirmation becomes “truth.” Complements (a): generation can use user-approved positions; optional on-the-fly detect only for new blanks.

Priority relative to (a): **UI confirmation > pure on-the-fly** for operator trust. On-the-fly alone still ships wrong placements silently.

**Status:** idea (highest leverage for template reliability)

#### c) Prompt-guided re-import / “find the missing fields”

**Idea:** After import finds fields `a, b, c, f, h`, offer a prompt box: e.g. “Those are correct, but I also see `d`, `e`, and `g` — find them.” Re-run extraction/measurement with an explicit completeness contract.

**Assessment:** Agree as a **power-user correction loop**, especially before a full visual editor exists. Implementation sketch:

- Pass known field inventory + user hints into the measure/extract prompt (“must locate these paths; do not invent extras unless asked”).
- Diff previous vs new schema; show add/change list for approval.
- Pair with (b) so the user can click the page when the model still misses a blank.

Risks: prompt injection into schema shape; still non-deterministic without approval UI.

**Status:** idea (good interim; best as layer on top of (b))

#### d) App-wide natural-language commands

**Idea:** A global AI prompt: “Evict tenant Joe!”, “Schedule a plumber for Unit 12”, “List tenants overdue on rent.”

**Assessment:** Valuable long-term operator UX; **not** a substitute for fixing template placement. Needs:

- Tool/router layer over existing APIs (compliance workflows, maintenance, reports)
- AuthZ (never trust NL to escalate role)
- Confirmation for irreversible actions (eviction, delete, notices)
- Audit log of prompt → tools → result

Overlaps existing voice/maintenance-bot direction. Treat as **Phase E+** after Metro Landmark public cutover and auth hardening (roadmap E7), not as part of migration.

**Status:** idea (post-migration / Phase E+)

### Suggested sequencing (when we un-pin this)

1. **Visual placement editor (b)** — make auto-detect a draft the user can fix.  
2. **Prompt-guided completion (c)** — speed up “missing fields” without hand-editing JSON.  
3. **Generation-time refine (a)** — use approved schema; re-detect only unresolved or stale positions; cache when user saves.  
4. **NL command palette (d)** — after auth hardening and stable tool APIs.

---

## Subsidy / low-income program tracking (2026-08-15)

**Status:** planned (roadmap **E11**) — not built. We do not currently store subsidy on leases, units, or tenants. The E1 calculator accepts an optional `subsidized` flag for RCW 59.18.140(3)(b) (30-day rent-increase notice on income-based subsidized tenancies), but nothing in the data model sets that flag.

**Why two attachment points**

1. **Lease (subsidized tenant / household)** — This tenancy’s rent is set or paid in part by a subsidy (voucher, project-based, income-based). Ties to the lease, not the person forever: a tenant can move from a subsidized lease to a market lease.
2. **Unit (reserved for low-income occupancy)** — The unit itself is set aside (set-aside, income-restricted, project-based). The reservation can exist while vacant and can outlive any one lease.

A reserved unit may be vacant; a subsidized lease may sit in a unit that is not itself reserved (e.g. tenant-based voucher). Track both.

**What to record (both levels)**

- **Fact of subsidizing / restriction** — boolean (or equivalent) that this lease or unit is in a subsidy / income-restricted program.
- **Jurisdiction** — which government or housing authority the program sits under (may differ from the property’s WA/Seattle *compliance* pack).
- **Program** — named program (Section 8 HCV, SHA project-based, LIHTC set-aside, rural USDA, local levy, etc.), not a free-text blob as the only field.

Suggested shape when we build it: a small program catalog (jurisdiction + program id/name) plus optional FKs or rows on `leases` and `units`. Do not invent `is_subsidized` without program/jurisdiction — the 30-day notice path is specifically *income-based subsidized* tenancies, which is a program fact, not a vibe.

**Consumers later**

- Rent-increase calculator (E1 hook already exists).
- Screening / first-qualified-applicant and other pack rules that treat subsidized housing differently.
- Listings and vacancy (E5) so reserved units are not marketed as unrestricted.

---

## Notice service automation (parked 2026-08-16)

**Context:** Rent-increase (and eviction) workflows now generate the PDF first, then offer Print / Email and **Record Service** or **Service Later**. Unserved notices stay in Active Workflows, the Compliance Dashboard, and the manager task list.

**Not built (idea):**

1. **In-app emailed PDF** — SendGrid (or similar) with the notice attached, delivery log, and a service method of `email` when the operator confirms send. Today Email opens the user’s mail client; they must attach the downloaded PDF.
2. **Electronic certified mail** — Place a certified-mail order from the notice (USPS or a mail vendor), store tracking on the workflow, and prompt to record service when delivered.
3. **Process-server / servicing-company order** — Send the generated notice to a third-party server, then ingest affidavit / proof of service back into Documents.

Do not block day-to-day notice workflows on these. Legal service rules still depend on the lease and jurisdiction; automation must not imply that email or a vendor order is always valid service.

**Status:** idea (post-migration)

---

## How to use this file

- Add dated sections for new parking-lot themes.
- When promoting an item to active work, add it to `ROADMAP.md` Planned (or the Metro Landmark Phase E table) and link back here.
- Do not block OSS migration on these ideas.
