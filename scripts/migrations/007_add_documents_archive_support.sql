-- Add archive support for documents (soft delete) and allow archive_entity RPC.

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents') THEN
        ALTER TABLE documents
            ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS archive_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_documents_archived ON documents(is_archived, archived_at);

        -- Backfill rows that predate the column (or had a nullable column without default).
        UPDATE documents
        SET is_archived = false
        WHERE is_archived IS NULL;
    END IF;
END $$;

-- Extend archive_entity to support documents (idempotent replace).
CREATE OR REPLACE FUNCTION archive_entity(
    p_table_name TEXT,
    p_entity_id INTEGER,
    p_archived_by_user_id INTEGER,
    p_archive_reason TEXT DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_sql TEXT;
    v_id_column TEXT;
BEGIN
    CASE p_table_name
        WHEN 'pm_companies' THEN v_id_column := 'pmc_id';
        WHEN 'users' THEN v_id_column := 'user_id';
        WHEN 'landlords' THEN v_id_column := 'landlord_id';
        WHEN 'properties' THEN v_id_column := 'property_id';
        WHEN 'units' THEN v_id_column := 'unit_id';
        WHEN 'clients' THEN v_id_column := 'client_id';
        WHEN 'applicants' THEN v_id_column := 'applicant_id';
        WHEN 'vendors' THEN v_id_column := 'vendor_id';
        WHEN 'leases' THEN v_id_column := 'lease_id';
        WHEN 'maintenance_requests' THEN v_id_column := 'request_id';
        WHEN 'templates' THEN v_id_column := 'template_id';
        WHEN 'application_units' THEN v_id_column := 'application_id';
        WHEN 'documents' THEN v_id_column := 'document_id';
        ELSE RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END CASE;

    v_sql := format('
        UPDATE %I
        SET is_archived = true,
            archived_at = CURRENT_TIMESTAMP,
            archived_by_user_id = %s,
            archive_reason = %L
        WHERE %I = %s
        AND COALESCE(is_archived, false) = false',
        p_table_name,
        CASE WHEN p_archived_by_user_id IS NULL THEN 'NULL' ELSE p_archived_by_user_id::text END,
        COALESCE(p_archive_reason, 'No reason provided'),
        v_id_column,
        p_entity_id
    );

    EXECUTE v_sql;
END;
$$;
