-- Allow Notice templates (rent increase, eviction, etc.) alongside Application/Lease.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'templates'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%template_type%'
  ) THEN
    ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_template_type_check;
  END IF;
END $$;

ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_template_type_check;

ALTER TABLE templates
  ADD CONSTRAINT templates_template_type_check
  CHECK (template_type IN ('Application', 'Lease', 'Notice'));
