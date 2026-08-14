-- Migration: Add document_data column to leases table
-- This column stores JSONB data for lease document form fields

-- Add document_data column to leases table if it doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'leases') THEN
        -- Check if column already exists
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'leases' 
            AND column_name = 'document_data'
        ) THEN
            ALTER TABLE leases 
                ADD COLUMN document_data JSONB DEFAULT '{}'::jsonb;
            
            -- Add comment for documentation
            COMMENT ON COLUMN leases.document_data IS 'Stores JSONB data for lease document form fields filled in the Fill Lease modal';
        END IF;
    END IF;
END $$;
