-- payments.document_id may already exist without a foreign key (db-util
-- ADD COLUMN and 019 ADD COLUMN IF NOT EXISTS do not attach REFERENCES
-- when the column is already there). Orphaned-records discovery follows
-- real FKs, so add the constraint when missing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payments'
      AND column_name = 'document_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%document_id%'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE SET NULL;
  END IF;
END $$;
