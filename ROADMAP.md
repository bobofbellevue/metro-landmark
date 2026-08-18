# Metro Landmark Roadmap

Status vocabulary: **shipped** · **partial** · **planned** · **out of scope** (for now).

This list is intentionally short. Finish or cut items before expanding it.

## Shipped

| Item | Notes |
|------|--------|
| Core PMS ops | Properties, units, leases, tenants, applicants, landlords, PMCs, maintenance |
| Config seams | Brand, locale display, WA/Seattle jurisdiction packs, shared VAPI/maintenance phone |
| Operator hygiene | Example DB env file, documented secrets handling, no silent hardcoded client Supabase fallbacks |
| E1 WA/Seattle pack + calculator tests | 2025/2026 RCW 59.18 notice math, Seattle **180-day** housing-cost overlay (SMC 7.24.030), statute citations, pack-driven calculator coverage. The 30-day subsidized rent-increase path is encoded in the pack only — we do not yet track subsidy on leases or units (E11). |
| E2 Per-org themes | After login, a PM company’s primary color restyles the existing indigo chrome; optional logo URL overrides the sidebar mark. Login and `VITE_PRODUCT_NAME` stay deploy-wide. Settings → Company appearance (company/global admin with a `pmc_id`). |
| E3 Phone number resources + IVR purposes | `phone_resources` rows assign DIDs (and optional Vapi UUIDs) to tenant maintenance, vendor dispatch, marketing, and appointments. Company/global admins edit under **Admin → Phone numbers**. Tenant “Call Voice Bot” and outbound vendor calls resolve PMC then deploy/env fallback. Marketing/appointments do not inherit the maintenance DID. |

## Partial

| Item | Notes |
|------|--------|
| Compliance Center | Rent Increase, Lease Renewal, Eviction, Lease Termination, and Tenant Screening are operator-ready. Remaining catalog tiles are leftover stubs (E13–E17). |
| Documents | Staff registry + type catalog exist; contextual panels incomplete across landlord/maintenance/portals |
| Voice / chat maintenance | Works with Vapi/OpenAI when configured; numbers can be assigned per purpose (E3), with a shared env DID as fallback |
| Auth | Login exists; API authorization is not hardened for hostile multi-tenant internet deploy (E7) |

## Planned

| Priority | Item | Notes |
|----------|------|--------|
| E4 | Payments | e.g. Stripe — rent, deposits, fees |
| E5 | Listing syndication | Export vacancies to major channels |
| E6 | Additional city packs | Tacoma, Bellingham, Federal Way, Olympia (and others) as **child packs of WA**, only when official citations exist and an operator needs them. Do not copy RHAWA PDFs. Design: [`docs/FUTURE_FEATURES.md`](docs/FUTURE_FEATURES.md#rent-increase-completeness--seattle-cities-forms-exemptions-2026-08-16) |
| E7 | Auth hardening | Verified sessions/tokens; stop trusting client role headers; tighten RLS/CORS |
| E8 | Contextual documents for landlords & maintenance | Mount `DocumentManagement` on landlord property/lease/maintenance views (bids, work authorizations, etc.) |
| E9 | Audience-aware document lists in portals | Tenant / landlord / vendor portals show only related docs (catalog audiences + FK scoping) |
| E10 | Expand template kinds | Template types beyond Application / Lease as new packs and notice/maintenance templates land |
| E11 | Subsidy / low-income program tracking | Record *that* a tenancy or unit is subsidized, plus **jurisdiction** and **program**. Lease-level (subsidized tenant) and unit-level (reserved for low-income occupancy) are distinct. Unblocks the RCW 59.18.140(3)(b) 30-day rent-increase path. Design notes: [`docs/FUTURE_FEATURES.md`](docs/FUTURE_FEATURES.md#subsidy--low-income-program-tracking-2026-08-15) |
| E12 | Rent-increase exemptions + statutory form template | Property/unit exemption flags (RCW 59.18.710 / Seattle list), fillable RCW 59.18.720 notice + Seattle helpline addendum. Worksheet+links shipped; serving the worksheet as the notice is not compliant. [`docs/FUTURE_FEATURES.md`](docs/FUTURE_FEATURES.md#rent-increase-completeness--seattle-cities-forms-exemptions-2026-08-16) |
| E13 | Move-in, move-out, and security deposit return | Replace leftover stubs. Move-out inspection should feed itemized deposit deductions. Pack clock is **30 days after termination and vacation** (RCW 59.18.280) in WA and Seattle — not a notice-before-effective-date widget. Generate an itemized statement PDF into Documents. [`docs/FUTURE_FEATURES.md`](docs/FUTURE_FEATURES.md#remaining-compliance-center-stubs-2026-08-17) |
| E14 | Collections process | Replace leftover stub. Late-rent / pay-or-vacate path should reuse Eviction generate-then-serve where the notice type already exists; keep FDCPA and pack citations in view. Do not copy RHAWA forms. |
| E15 | Lease violation notices | Replace leftover stub. Pick lease, violation type, cure period from pack/eviction notice days where they apply, generate-then-serve a worksheet. |
| E16 | Habitability | Replace leftover stub. Record issue, pack repair timeline if encoded, link to maintenance where a work order exists. Document outcome; not a legal opinion. |
| E17 | Entry notices | Replace leftover stub. Pack already has two-day written notice and one-day showing (RCW 59.18.150). Generate/record notice with emergency exception. |

## Out of scope (near term)

- Full commercial PMS feature parity
- Exhaustive frontend snapshot test armies
- Multi-state legal engines without real pack implementations
- Claiming multi-jurisdiction legal accuracy without packs and tests

## Maintainer note

Consulting and adaptation for custom packs, branding, or production hardening: Robert T. Kelly.

## Parking lot

Longer design notes and deferred ideas: [`docs/FUTURE_FEATURES.md`](docs/FUTURE_FEATURES.md) — parked template/doc-creation reliability, E11 subsidy tracking, notice-service automation, rent-increase city/form/exemption completeness, and remaining Compliance Center stubs (E13–E17).

