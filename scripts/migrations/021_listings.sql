-- Vacancy listings for syndication export (roadmap E5).
-- Opt-in: a vacant unit is not advertised until listed is true.
CREATE TABLE IF NOT EXISTS listings (
  listing_id SERIAL PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
  listed BOOLEAN NOT NULL DEFAULT false,
  asking_rent DECIMAL(10,2),
  available_on DATE,
  description TEXT,
  updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT listings_asking_rent_positive CHECK (
    asking_rent IS NULL OR asking_rent > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_listings_unit ON listings (unit_id);
CREATE INDEX IF NOT EXISTS idx_listings_pmc_listed ON listings (pmc_id, listed);

COMMENT ON TABLE listings IS
  'Opt-in vacancy marketing. Vacant units are not advertised until listed is true.';

-- Permissive anon/authenticated policies match 000 / 019: the SPA uses the anon
-- key; role checks stay in the app. API writes use the service role and bypass RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'listings'
  ) THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "Allow anon reads on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow anon reads on listings" ON public.listings FOR SELECT TO anon USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Allow authenticated reads on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow authenticated reads on listings" ON public.listings FOR SELECT TO authenticated USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Allow anon inserts on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow anon inserts on listings" ON public.listings FOR INSERT TO anon WITH CHECK (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Allow authenticated inserts on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow authenticated inserts on listings" ON public.listings FOR INSERT TO authenticated WITH CHECK (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Allow anon updates on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow anon updates on listings" ON public.listings FOR UPDATE TO anon USING (true) WITH CHECK (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Allow authenticated updates on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow authenticated updates on listings" ON public.listings FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Allow anon deletes on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow anon deletes on listings" ON public.listings FOR DELETE TO anon USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS "Allow authenticated deletes on listings" ON public.listings';
  EXECUTE 'CREATE POLICY "Allow authenticated deletes on listings" ON public.listings FOR DELETE TO authenticated USING (true)';
END $$;
