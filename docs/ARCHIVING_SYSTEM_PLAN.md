# Universal Database Archiving System

## Overview

Implement a comprehensive soft-deletion archiving system that applies to all entities in the system. This preserves historical data for audit purposes while allowing entities to be removed from active management. Hard deletion remains available for error correction and testing.

## Requirements

1. **Universal Archiving**: Any entity can be archived (sold, removed from management, fired, left voluntarily)
2. **History Preservation**: Maintain complete audit trail of past actions and relationships
3. **Hard Delete Option**: Allow permanent deletion for error correction and testing
4. **Cascade Archiving**: Archive related entities when parent is archived
5. **Restoration**: Ability to restore archived entities if needed

## Database Schema Changes

### 1. Add Archiving Columns to All Major Tables

Add archiving columns to all tables that represent entities that can be removed:

```sql
-- Standard archiving columns to add to each table
ALTER TABLE pm_companies ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE pm_companies ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE pm_companies ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE pm_companies ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE landlords ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE units ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE units ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE units ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE units ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE applicants ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE applicants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE applicants ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE applicants ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE leases ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS archived_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE leases ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- Add indexes for efficient archiving queries
CREATE INDEX IF NOT EXISTS idx_pm_companies_archived ON pm_companies(is_archived, archived_at);
CREATE INDEX IF NOT EXISTS idx_users_archived ON users(is_archived, archived_at);
CREATE INDEX IF NOT EXISTS idx_landlords_archived ON landlords(is_archived, archived_at);
CREATE INDEX IF NOT EXISTS idx_properties_archived ON properties(is_archived, archived_at);
CREATE INDEX IF NOT EXISTS idx_units_archived ON units(is_archived, archived_at);
CREATE INDEX IF NOT EXISTS idx_applicants_archived ON applicants(is_archived, archived_at);
CREATE INDEX IF NOT EXISTS idx_vendors_archived ON vendors(is_archived, archived_at);
CREATE INDEX IF NOT EXISTS idx_leases_archived ON leases(is_archived, archived_at);
```

### 2. Create Generic Archive Function

Create a universal archive function that works for any table:

```sql
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
    v_has_children BOOLEAN := false;
BEGIN
    -- Validate table name to prevent SQL injection
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;
                           'maintenance_requests', 'templates') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
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
        p_table_name || '_id',
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
            WHERE landlord_id = p_entity_id
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
            WHERE landlord_id IN (
                SELECT landlord_id FROM landlords WHERE user_id = p_entity_id
            )
            AND is_archived = false;
        END IF;
    END IF;
END;
$$;
```

### 3. Create Generic Restore Function

```sql
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
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates') THEN
                           'maintenance_requests', 'templates') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
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
        p_table_name || '_id',
        p_entity_id
    );
    
    EXECUTE v_sql;
END;
$$;
```

### 4. Create Hard Delete Function (for errors/testing)

```sql
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
BEGIN
    -- Validate table name
    IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                           'clients', 'vendors', 'leases', 'client_applications', 
                           'lease_clients', 'maintenance_requests', 'templates') THEN
                           'maintenance_requests', 'templates') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Check for relationships (unless force is true)
    IF NOT p_force THEN
        -- Check if entity has relationships that would be lost
        -- This is a simplified check - you may want to add more specific checks
        IF p_table_name = 'landlords' THEN
            SELECT EXISTS(SELECT 1 FROM properties WHERE landlord_id = p_entity_id)
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
        p_table_name || '_id',
        p_entity_id
    );
    
    EXECUTE v_sql;
END;
$$;
```

### 5. Convenience Functions for Specific Entities

Create wrapper functions for common operations:

```sql
-- Landlord archiving
CREATE OR REPLACE FUNCTION archive_landlord(
    p_landlord_id INTEGER,
    p_archived_by_user_id INTEGER,
    p_archive_reason TEXT DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM archive_entity('landlords', p_landlord_id, p_archived_by_user_id, p_archive_reason, p_cascade);
END;
$$;

-- Property archiving
CREATE OR REPLACE FUNCTION archive_property(
    p_property_id INTEGER,
    p_archived_by_user_id INTEGER,
    p_archive_reason TEXT DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM archive_entity('properties', p_property_id, p_archived_by_user_id, p_archive_reason, p_cascade);
END;
$$;

-- User archiving
CREATE OR REPLACE FUNCTION archive_user(
    p_user_id INTEGER,
    p_archived_by_user_id INTEGER,
    p_archive_reason TEXT DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM archive_entity('users', p_user_id, p_archived_by_user_id, p_archive_reason, p_cascade);
END;
$$;

-- Similar functions for other entities...
```

## Application Code Updates

### 1. Query Modifications

Update all queries to exclude archived items by default:

```javascript
// Example: Fetch active landlords
const { data } = await supabase
  .from('landlords')
  .select('*')
  .eq('is_archived', false);

// Example: Fetch all landlords including archived
const { data } = await supabase
  .from('landlords')
  .select('*')
  .order('is_archived', { ascending: true })
  .order('landlord_id', { ascending: true });
```

### 2. API Endpoints

Create API endpoints for archiving operations:

```javascript
// POST /api/archive/:entityType/:entityId
// Body: { archived_by_user_id, archive_reason, cascade }
// Example: POST /api/archive/landlords/123

// POST /api/restore/:entityType/:entityId
// Body: { restored_by_user_id }
// Example: POST /api/restore/landlords/123

// DELETE /api/hard-delete/:entityType/:entityId
// Body: { deleted_by_user_id, force }
// Example: DELETE /api/hard-delete/landlords/123?force=true
```

### 3. UI Components

1. **Archive Button**: Add to all entity management pages
   - Landlords, Properties, Units, Tenants, Applicants, Vendors, Leases, etc.

2. **Archive Dialog**: 
   - Reason input (required)
   - Cascade option checkbox
   - Confirmation message

3. **Show Archived Filter**: 
   - Toggle to show/hide archived items
   - Separate view for archived items
   - Archive date and reason display

4. **Restore Functionality**:
   - Restore button in archived items view
   - Confirmation dialog

5. **Hard Delete** (Admin only):
   - Hard delete button (only for admins)
   - Force option for entities with relationships
   - Strong warning about permanent deletion

## Access Control

1. **Archive Permissions**:
   - Global admins: Can archive any entity
   - PM managers: Can archive entities within their company
   - Landlords: Can archive their own properties/units
   - Others: No archive permission

2. **Restore Permissions**:
   - Same as archive permissions

3. **Hard Delete Permissions**:
   - Global admins only
   - Require explicit confirmation
   - Log all hard deletes for audit

## Audit Trail

Maintain complete audit trail:

1. **Archive Records**: Track who archived what, when, and why
2. **Restore Records**: Track restoration actions
3. **Hard Delete Records**: Log all permanent deletions
4. **Relationship Preservation**: Maintain foreign key relationships even when archived

## Migration Strategy

1. **Phase 1**: Add archiving columns to all tables
2. **Phase 2**: Create archive/restore/hard-delete functions
3. **Phase 3**: Update application queries to exclude archived items
4. **Phase 4**: Add UI components for archiving
5. **Phase 5**: Update existing delete functions to use archiving

## Testing Considerations

1. **Test Archiving**: Verify entities are marked as archived
2. **Test Cascade**: Verify related entities are archived
3. **Test Queries**: Verify archived items are excluded from normal queries
4. **Test Restoration**: Verify entities can be restored
5. **Test Hard Delete**: Verify hard delete works and respects relationships
6. **Test Permissions**: Verify access control works correctly

## Reference

- `scripts/DATABASE_CONSTRAINTS.md` - Existing constraint documentation
- `scripts/db-util-server.js` - Existing archive function stubs (lines 1416-1441)

