-- Phone number resources + IVR purposes (roadmap E3).
-- pmc_id NULL = deploy-wide default. One active row per (pmc, purpose).
CREATE TABLE IF NOT EXISTS phone_resources (
  phone_resource_id SERIAL PRIMARY KEY,
  pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE CASCADE,
  purpose VARCHAR(50) NOT NULL,
  e164 VARCHAR(32) NOT NULL,
  vapi_phone_number_id VARCHAR(64),
  label VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT phone_resources_purpose_check CHECK (
    purpose IN ('tenant_maintenance', 'vendor_dispatch', 'marketing', 'appointments')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_resources_pmc_purpose
  ON phone_resources (pmc_id, purpose)
  WHERE is_active = true AND pmc_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_resources_system_purpose
  ON phone_resources (purpose)
  WHERE is_active = true AND pmc_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_phone_resources_pmc
  ON phone_resources (pmc_id)
  WHERE pmc_id IS NOT NULL;
