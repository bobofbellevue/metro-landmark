-- Per-org chrome theme (roadmap E2).
-- Login stays deploy env brand; after login the PMC primary color restyles
-- indigo tokens. Optional logoUrl overrides the sidebar logo only.
ALTER TABLE pm_companies ADD COLUMN IF NOT EXISTS theme JSONB;
