-- Payment receipt date (distinct from due_date and paid_at), re-apply 018
-- ledger columns for databases that only ran 017, and enable RLS on tables
-- added after 000 so Table Editor is not UNRESTRICTED.
--
-- Permissive anon/authenticated policies match 000: the SPA uses the anon
-- key; role checks stay in the app. API writes use the service role and
-- bypass RLS.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE payments ALTER COLUMN kind TYPE VARCHAR(64);
ALTER TABLE payments ALTER COLUMN method TYPE VARCHAR(64);
ALTER TABLE payments ALTER COLUMN period_label TYPE VARCHAR(80);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_end DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_date DATE;

COMMENT ON COLUMN payments.receipt_date IS
  'Calendar date money was received. Distinct from due_date and from paid_at (when the row was marked paid).';

CREATE INDEX IF NOT EXISTS idx_payments_period ON payments (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payments_document ON payments (document_id);
CREATE INDEX IF NOT EXISTS idx_payments_receipt_date ON payments (receipt_date);

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

DO $$
DECLARE
  table_name TEXT;
  tables_to_policy TEXT[] := ARRAY['payments', 'payment_catalog', 'phone_resources'];
BEGIN
  FOREACH table_name IN ARRAY tables_to_policy
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = table_name
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true);',
      'Allow anon reads on ' || table_name, table_name,
      'Allow anon reads on ' || table_name, table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);',
      'Allow authenticated reads on ' || table_name, table_name,
      'Allow authenticated reads on ' || table_name, table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK (true);',
      'Allow anon inserts on ' || table_name, table_name,
      'Allow anon inserts on ' || table_name, table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true);',
      'Allow authenticated inserts on ' || table_name, table_name,
      'Allow authenticated inserts on ' || table_name, table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR UPDATE TO anon USING (true) WITH CHECK (true);',
      'Allow anon updates on ' || table_name, table_name,
      'Allow anon updates on ' || table_name, table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true);',
      'Allow authenticated updates on ' || table_name, table_name,
      'Allow authenticated updates on ' || table_name, table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR DELETE TO anon USING (true);',
      'Allow anon deletes on ' || table_name, table_name,
      'Allow anon deletes on ' || table_name, table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I; CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true);',
      'Allow authenticated deletes on ' || table_name, table_name,
      'Allow authenticated deletes on ' || table_name, table_name
    );
  END LOOP;
END $$;
