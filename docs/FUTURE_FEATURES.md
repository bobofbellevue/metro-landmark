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

**Portable voucher vs income-based rent (why program type matters)**

RCW 59.18.720(2) skips the statutory rent-increase *form* only when the rental agreement is a subsidized tenancy whose **rent amount is based on the tenant’s income** (or similar household-specific circumstances). It then says that does **not** include:

- **Portable tenant-based vouchers** (and similar portable assistance through a housing authority) — typical **Section 8 Housing Choice Voucher / HCV**. The subsidy follows the *household*. The landlord still has a contract rent; the housing authority pays part of it. That tenancy still uses the RCW 59.18.720 form and the ordinary notice/cap path unless another exemption applies.
- Affordable units whose **maximum** rent is AMI-capped but the tenant’s base rent does **not** change when income changes.

So “the tenant has a voucher” is not the same as “this is an income-based subsidized tenancy.” E11 must store program type, not a single subsidized checkbox. Portable voucher → lease-level subsidy, often in a market unit. Income-based / project-based formula rent → may unlock the 30-day notice path and skip the 720 form.

**Consumers later**

- Rent-increase calculator (E1 hook already exists).
- Screening / first-qualified-applicant and other pack rules that treat subsidized housing differently.
- Listings and vacancy (E5) so reserved units are not marketed as unrestricted.

---

## Notice service automation (parked 2026-08-16)

**Context:** Rent-increase (and eviction) workflows now generate the PDF first, then offer Print / Email and **Record Service** or **Service Later**. Unserved notices stay in Active Workflows, the Compliance Dashboard, and the manager task list.

**Not built (idea):**

1. **In-app emailed PDF** — SendGrid (or similar) with the notice attached, delivery log, and a service method of `email` when the operator confirms send. Today the service step offers **Email notice in mail app** (`mailto:`), **Open Gmail in browser**, and **Copy notice email text**; the operator still attaches the downloaded PDF.
2. **Electronic certified mail** — Place a certified-mail order from the notice (USPS or a mail vendor), store tracking on the workflow, and prompt to record service when delivered.
3. **Process-server / servicing-company order** — Send the generated notice to a third-party server, then ingest affidavit / proof of service back into Documents.

Do not block day-to-day notice workflows on these. Legal service rules still depend on the lease and jurisdiction; automation must not imply that email or a vendor order is always valid service.

**Status:** idea (post-migration)

---

## Rent-increase completeness — Seattle, cities, forms, exemptions (2026-08-16)

**Context:** Seattle’s [Housing Cost Increases](https://www.seattle.gov/rentinginseattle/housing-providers/managing-the-rental-relationship/housing-cost-increases) page and RHAWA’s city-specific notice list show that statewide RCW 59.18 is not enough. City overlays stack on the state form, service rules, and cap. Packs are already **state parent + city child** (`washington_state` → `seattle`). That shape is right; the inventory of cities and of Seattle-only rules is not.

**Shipped in this pass (pack math + worksheet honesty)**

- Seattle **180-day** housing-cost notice (SMC 7.24.030 as amended; seattle.gov since 2021-11-09), with **day of service excluded** from the 180-day count.
- Pack-driven **service methods**, including first class mail, posting **and** first class mail, and Other.
- Official form URLs on packs (RCW 59.18.720, Commerce HB 1217 Landlord Resource Center, Seattle housing-cost page).
- Template-less PDF labeled **RENT INCREASE NOTICE WORKSHEET**, with tenant-facing figures and required local language on page 1 and the full disclaimer / official URLs on page 2.
- Commerce **2027** statewide cap of 10% stored on the WA pack.

**Do not copy RHAWA PDFs.** Those forms are copyrighted and paywalled. The WA pack **favors RHAWA** as the recommended association: tell operators to join and **import** current city-specific templates themselves. There is no in-app picker for a competing association; a different favorite means a source-code fork or custom pack. Use RHAWA’s *city list* as a catalog of jurisdictions to research from **official** sources (RCW, Commerce, city pages, municipal code). The regulation scanner must not fetch member-only forms.

### Gaps vs Seattle.gov (not encoded)

| Rule | Status |
| --- | --- |
| No increase in first 12 months | Pack + calculator warning. Does not hard-block Generate. |
| 90-day WA / 180-day Seattle notice | Encoded. Subsidized income-based path still 30 days (E11 not wired). |
| No increase mid-fixed-term; only at MTM or renewal | Not enforced. |
| Housing costs include parking, storage, other periodic fees | We only store `monthly_rent_amount`. |
| 5% max difference between MTM rent and lease rent | Not encoded. |
| Increase must start on a rental-period boundary | Not encoded. |
| EDRA at ≥10% in 12 months (attach EDRA notice; possible 3 months assistance) | Not encoded. |
| RRIO inspection defects can hold the increase | Not encoded. |
| Cap exemptions (new construction ≤12 years, PHA/nonprofit, owner-occupied share/SFR/2–4 plex) | No exemption field. Overlaps RCW 59.18.710 and Seattle’s list. |
| Dual service as two recorded acts with two proofs | One compound method (`posting_and_first_class_mail`) only. |
| Statutory fillable template of RCW 59.18.720 + Seattle addendum | Worksheet + links only. |

### City packs beyond Seattle

RHAWA currently publishes separate rent-increase notices for **Bellingham, Federal Way, Olympia, Seattle, Tacoma**, plus a WA State default. Tacoma also requires extra city forms. Kirkland / Kenmore / Shoreline / Auburn (and others) appear in secondary roundups with different notice-day tiers. Add a city pack when we have official citations and an operator who needs it — not from the RHAWA PDF.

**Shipped (E6 first slice):** Tacoma 180-day (TMC 1.95.060), Bellingham 120-day (BMC 6.12.020), Olympia 90/120/180 percent tiers (OMC 5.82.030), Federal Way statewide 90-day rent notice plus FWRC 20.05 renewal offer. Calculator applies `noticeTiers`. City fillable forms are linked, not copied. Not encoded: Olympia trailing 12-month 7% stacking, Tacoma relocation payment amounts, Kirkland/Kenmore/Shoreline/Auburn.

### Regulation “scan” button (idea)

Store `sourceUrls` on each pack (now). A later Admin action can fetch those public pages, diff against the last snapshot, and flag “Commerce published a new cap” or “Seattle page changed.” Do **not** fetch RHAWA member forms. A human still edits the pack; the scanner is a reminder, not an auto-lawyer.

### Suggested now vs later

**Now (this pass):** Seattle 180-day + exclude service day; pack service methods; official-form referrals on the worksheet; 2027 cap.

**Next when an operator hits it:** exemption flag on property/unit (shared with E11 subsidy facts); statutory RCW 59.18.720 system template + Seattle required-language addendum; EDRA attachment when increase ≥10%; block Generate on first-12-months / mid-lease if we choose to be strict.

**Later:** remaining cities when official citations exist; housing-cost line items; rental-period snap; MTM vs lease 5% parity; dual-service two-proof UI; Admin-editable method lists; regulation scan from `sourceUrls`; manufactured-home lot form (Commerce has a second notice).

**Status:** partial (Seattle 180-day shipped; Tacoma/Bellingham/Olympia/Federal Way packs shipped; remainder idea / planned with E11)

---

## Remaining Compliance Center stubs (2026-08-17)

**Status:** planned (roadmap **E13–E17**).

An older pass left catalog tiles with `getWorkflowSteps` shells and a last step that says “generate …” without generating anything. That was not a deliberate hold (unlike E11 subsidy). The bar for finishing them is the same as Rent Increase / Lease Termination / Tenant Screening: real pickers (no typed internal IDs), pack math, a document or recorded outcome. Do **not** copy RHAWA forms. Pack numbers are reference math, not legal advice.

| Catalog tile | Roadmap | First useful slice |
| --- | --- | --- |
| Move-In Process | E13 | Condition report / checklist PDF from the selected lease; store in Documents. |
| Move-Out Process | E13 | Inspection + damage line items that can feed deposit deductions. |
| Security Deposit Return | E13 | Itemized deductions, 30-day clock from termination/vacation (RCW 59.18.280; same in Seattle pack), statement PDF. `security_deposits` / `deposit_deductions` tables exist and are unused. Do not reuse the rent-increase notice-period widget — this is a deadline *after* move-out. |
| Collections Process | E14 | Amount owed + notice type; 3-day pay-or-vacate can hand off to Eviction generate-then-serve. |
| Lease Violation Notices | E15 | Violation type, pack cure/notice days, generate-then-serve worksheet. |
| Habitability Issues | E16 | Issue record + timeline; optional link to an existing maintenance request. |
| Entry Notices | E17 | Two-day written notice, one-day showing, emergency exception (RCW 59.18.150 already in the pack). |

Suggested order when executing: **E17** (smallest pack hook), then **E13** (deposit is what operators will miss), then E15 / E14, then E16.

---

## How to use this file

- Add dated sections for new parking-lot themes.
- When promoting an item to active work, add it to `ROADMAP.md` Planned (or the Metro Landmark Phase E table) and link back here.
- Do not block OSS migration on these ideas.
