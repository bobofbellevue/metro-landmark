-- Payments UX: date-range periods, proof-of-payment document, configurable
-- type/method catalog. Drops the four-kind / five-method CHECKs so companies
-- can add types (late fee, parking, …) without a schema change.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE payments ALTER COLUMN kind TYPE VARCHAR(64);
ALTER TABLE payments ALTER COLUMN method TYPE VARCHAR(64);
ALTER TABLE payments ALTER COLUMN period_label TYPE VARCHAR(80);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_end DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_period ON payments (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payments_document ON payments (document_id);

CREATE TABLE IF NOT EXISTS payment_catalog (
  payment_catalog_id SERIAL PRIMARY KEY,
  pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL,
  code VARCHAR(64) NOT NULL,
  label VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_catalog_category_check CHECK (category IN ('type', 'method'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_catalog_pmc_code
  ON payment_catalog (pmc_id, category, code)
  WHERE pmc_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_catalog_system_code
  ON payment_catalog (category, code)
  WHERE pmc_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_catalog_pmc
  ON payment_catalog (pmc_id)
  WHERE pmc_id IS NOT NULL;
