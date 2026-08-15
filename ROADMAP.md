# Metro Landmark Roadmap

Status vocabulary: **shipped** · **partial** · **planned** · **out of scope** (for now).

This list is intentionally short. Finish or cut items before expanding it.

## Shipped

| Item | Notes |
|------|--------|
| Core PMS ops | Properties, units, leases, tenants, applicants, landlords, PMCs, maintenance |
| Config seams | Brand, locale display, WA/Seattle jurisdiction packs, shared VAPI/maintenance phone |
| Operator hygiene | Example DB env file, documented secrets handling, no silent hardcoded client Supabase fallbacks |
| E1 WA/Seattle pack + calculator tests | 2025/2026 RCW 59.18 notice math, statute citations, pack-driven calculator coverage |

## Partial

| Item | Notes |
|------|--------|
| Compliance Center | Workflows use pack notice math and citations; more workflow UI still needed |
| Documents | Staff registry + type catalog exist; contextual panels incomplete across landlord/maintenance/portals |
| Voice / chat maintenance | Works with Vapi/OpenAI when configured; single shared number model |
| Auth | Login exists; API authorization is not hardened for hostile multi-tenant internet deploy (E7) |

## Planned

| Priority | Item | Notes |
|----------|------|--------|
| E2 | Brand / white-label polish | Per-org themes beyond env overrides |
| E3 | Phone number resources + IVR purposes | Multi-number / purpose model |
| E4 | Payments | e.g. Stripe — rent, deposits, fees |
| E5 | Listing syndication | Export vacancies to major channels |
| E6 | Second jurisdiction pack | Only when a real operator needs it |
| E7 | Auth hardening | Verified sessions/tokens; stop trusting client role headers; tighten RLS/CORS |
| E8 | Contextual documents for landlords & maintenance | Mount `DocumentManagement` on landlord property/lease/maintenance views (bids, work authorizations, etc.) |
| E9 | Audience-aware document lists in portals | Tenant / landlord / vendor portals show only related docs (catalog audiences + FK scoping) |
| E10 | Expand template kinds | Template types beyond Application / Lease as new packs and notice/maintenance templates land |

## Out of scope (near term)

- Full commercial PMS feature parity
- Exhaustive frontend snapshot test armies
- Multi-state legal engines without real pack implementations
- Claiming multi-jurisdiction legal accuracy without packs and tests

## Maintainer note

Consulting and adaptation for custom packs, branding, or production hardening: Robert T. Kelly.

## Parking lot

Longer design notes and deferred ideas (not active Planned builds): [`docs/FUTURE_FEATURES.md`](docs/FUTURE_FEATURES.md) — includes parked template/doc-creation reliability directions (DocuSign-style placement, generation-time positions, prompt-guided re-import, NL commands).

