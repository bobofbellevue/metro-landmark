-- Migration: Add Archive Support for Tenants, Contacts, and Addresses
-- Run this on your test database

-- Add archive columns to tenants
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants') THEN
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archive_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_tenants_archived ON tenants(is_archived, archived_at);
    END IF;
END $$;

-- Add archive columns to contacts
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contacts') THEN
        ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
        ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
        ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
        ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archive_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_contacts_archived ON contacts(is_archived, archived_at);
    END IF;
END $$;

-- Add archive columns to addresses
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'addresses') THEN
        ALTER TABLE addresses ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
        ALTER TABLE addresses ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
        ALTER TABLE addresses ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
        ALTER TABLE addresses ADD COLUMN IF NOT EXISTS archive_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_addresses_archived ON addresses(is_archived, archived_at);
    END IF;
END $$;

-- Update archive_entity function with tenant support
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
    -- Validate table name to prevent SQL injection
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'applicants', 'vendors', 'leases', 'application_units', 
                           'maintenance_requests', 'templates', 'tenants', 'contacts', 'addresses') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Determine the ID column name (handle singular/plural inconsistencies)
    IF p_table_name = 'tenants' THEN
        v_id_column := 'tenant_id';
    ELSIF p_table_name = 'contacts' THEN
        v_id_column := 'contact_id';
    ELSIF p_table_name = 'addresses' THEN
        v_id_column := 'address_id';
    ELSE
        v_id_column := p_table_name || '_id';
    END IF;

    -- Set archiving fields
    v_sql := format('
        UPDATE %I 
        SET is_archived = true,
            archived_at = CURRENT_TIMESTAMP,
            archived_by_user_id = %s,
            archive_reason = %L
        WHERE %I = %s
        AND is_archived = false',
        p_table_name,
        p_archived_by_user_id,
        COALESCE(p_archive_reason, 'No reason provided'),
        v_id_column,
        p_entity_id
    );
    
    EXECUTE v_sql;

    -- Cascade archiving for related entities
    IF p_cascade THEN
        -- Archive related entities based on table type
        IF p_table_name = 'landlords' THEN
            -- Archive all properties owned by this landlord
            UPDATE properties 
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: landlord %s archived', p_entity_id)
            WHERE building_owner_landlord_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'properties' THEN
            -- Archive all units in this property
            UPDATE units
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: property %s archived', p_entity_id)
            WHERE property_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'units' THEN
            -- Archive all leases for this unit
            UPDATE leases
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: unit %s archived', p_entity_id)
            WHERE unit_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'pm_companies' THEN
            -- Archive all users, landlords, and properties associated with this company
            UPDATE users
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: PM company %s archived', p_entity_id)
            WHERE pmc_id = p_entity_id
            AND is_archived = false;
            
        ELSIF p_table_name = 'users' THEN
            -- Check if user is a landlord and archive their properties
            UPDATE properties
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: user %s archived', p_entity_id)
            WHERE building_owner_landlord_id IN (
                SELECT landlord_id FROM landlords WHERE user_id = p_entity_id
            )
            AND is_archived = false;
            
        ELSIF p_table_name = 'tenants' THEN
            -- Clean up polymorphic contacts and addresses
            -- Contacts use contactable_type = 'tenant'
            DELETE FROM contacts 
            WHERE contactable_id = p_entity_id 
            AND contactable_type = 'tenant';
            
            -- Addresses use addressable_type = 'user' (since tenants are users)
            DELETE FROM addresses 
            WHERE addressable_id = p_entity_id 
            AND addressable_type = 'user';
        END IF;
    END IF;
END;
$$;

-- Update restore_entity function
CREATE OR REPLACE FUNCTION restore_entity(
    p_table_name TEXT,
    p_entity_id INTEGER,
    p_restored_by_user_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_sql TEXT;
    v_id_column TEXT;
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'applicants', 'vendors', 'leases', 'application_units', 
                           'maintenance_requests', 'templates', 'tenants', 'contacts', 'addresses') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Determine the ID column name (handle singular/plural inconsistencies)
    IF p_table_name = 'tenants' THEN
        v_id_column := 'tenant_id';
    ELSIF p_table_name = 'contacts' THEN
        v_id_column := 'contact_id';
    ELSIF p_table_name = 'addresses' THEN
        v_id_column := 'address_id';
    ELSE
        v_id_column := p_table_name || '_id';
    END IF;

    -- Restore entity
    v_sql := format('
        UPDATE %I 
        SET is_archived = false,
            archived_at = NULL,
            archived_by_user_id = NULL,
            archive_reason = NULL
        WHERE %I = %s
        AND is_archived = true',
        p_table_name,
        v_id_column,
        p_entity_id
    );
    
    EXECUTE v_sql;
END;
$$;

-- Update hard_delete_entity function
CREATE OR REPLACE FUNCTION hard_delete_entity(
    p_table_name TEXT,
    p_entity_id INTEGER,
    p_deleted_by_user_id INTEGER,
    p_force BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_sql TEXT;
    v_has_relationships BOOLEAN := false;
    v_id_column TEXT;
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'applicants', 'vendors', 'leases', 'application_units', 
                           'maintenance_requests', 'templates', 'tenants', 'contacts', 'addresses') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Determine the ID column name (handle singular/plural inconsistencies)
    IF p_table_name = 'tenants' THEN
        v_id_column := 'tenant_id';
    ELSIF p_table_name = 'contacts' THEN
        v_id_column := 'contact_id';
    ELSIF p_table_name = 'addresses' THEN
        v_id_column := 'address_id';
    ELSE
        v_id_column := p_table_name || '_id';
    END IF;

    -- Check for relationships (unless force is true)
    IF NOT p_force THEN
        -- Check if entity has relationships that would be lost
        IF p_table_name = 'landlords' THEN
            SELECT EXISTS(SELECT 1 FROM properties WHERE building_owner_landlord_id = p_entity_id)
            INTO v_has_relationships;
        ELSIF p_table_name = 'properties' THEN
            SELECT EXISTS(SELECT 1 FROM units WHERE property_id = p_entity_id)
            INTO v_has_relationships;
        ELSIF p_table_name = 'units' THEN
            SELECT EXISTS(SELECT 1 FROM leases WHERE unit_id = p_entity_id)
            INTO v_has_relationships;
        END IF;

        IF v_has_relationships THEN
            RAISE EXCEPTION 'Cannot hard delete % with ID % because it has related records. Archive instead, or use force=true to override.', 
                p_table_name, p_entity_id;
        END IF;
    END IF;

    -- Perform hard delete
    v_sql := format('DELETE FROM %I WHERE %I = %s', 
        p_table_name,
        v_id_column,
        p_entity_id
    );
    
    EXECUTE v_sql;
END;
$$;

-- Create archive_tenant convenience function
CREATE OR REPLACE FUNCTION archive_tenant(
    p_tenant_id INTEGER,
    p_archived_by_user_id INTEGER,
    p_archive_reason TEXT DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM archive_entity('tenants', p_tenant_id, p_archived_by_user_id, p_archive_reason, p_cascade);
END;
$$;
