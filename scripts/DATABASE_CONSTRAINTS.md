# Database Constraints Implementation

This document describes the database constraints implemented to prevent orphaned records and ensure data integrity.

## Overview

The application now includes comprehensive database-level constraints that prevent orphaned records and enforce data integrity rules. These constraints work at the database level, ensuring data consistency regardless of how the data is accessed.

## Implemented Constraints

### High Priority (Implemented)

#### 1. Properties Table CASCADE Constraint
```sql
ALTER TABLE properties 
ADD CONSTRAINT properties_landlord_id_fkey 
FOREIGN KEY (landlord_id) 
REFERENCES landlords(landlord_id) ON DELETE CASCADE;
```
- **Purpose**: Ensures properties are automatically deleted when their landlord is deleted
- **Benefit**: Prevents orphaned properties

#### 2. Addressable Type Check Constraint
```sql
ALTER TABLE addresses 
ADD CONSTRAINT chk_addressable_type 
CHECK (addressable_type IN ('property', 'landlord', 'pm_company', 'user'));
```
- **Purpose**: Ensures only valid addressable types are used
- **Benefit**: Prevents invalid data in addressable_type field

#### 3. Property Deletion Stored Procedure
```sql
CREATE OR REPLACE FUNCTION delete_property_with_cleanup(p_property_id INTEGER)
RETURNS VOID 
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    -- Delete addresses first
    DELETE FROM addresses 
    WHERE addressable_id = p_property_id 
    AND addressable_type = 'property';
    
    -- Delete units (cascade will handle unit-related records)
    DELETE FROM units WHERE property_id = p_property_id;
    
    -- Delete property
    DELETE FROM properties WHERE property_id = p_property_id;
END;
$$;
```
- **Purpose**: Safely deletes property and all related records
- **Benefit**: Ensures complete cleanup in correct order

### Medium Priority (Implemented)

#### 1. Addresses Table Foreign Key Constraints
```sql
-- For properties
ALTER TABLE addresses 
ADD CONSTRAINT fk_addresses_property 
FOREIGN KEY (addressable_id) REFERENCES properties(property_id) ON DELETE CASCADE
WHERE addressable_type = 'property';

-- For landlords
ALTER TABLE addresses 
ADD CONSTRAINT fk_addresses_landlord
FOREIGN KEY (addressable_id) REFERENCES landlords(landlord_id) ON DELETE CASCADE
WHERE addressable_type = 'landlord';

-- For pm_companies
ALTER TABLE addresses 
ADD CONSTRAINT fk_addresses_pm_company
FOREIGN KEY (addressable_id) REFERENCES pm_companies(pmc_id) ON DELETE CASCADE
WHERE addressable_type = 'pm_company';

-- For users
ALTER TABLE addresses 
ADD CONSTRAINT fk_addresses_user
FOREIGN KEY (addressable_id) REFERENCES users(user_id) ON DELETE CASCADE
WHERE addressable_type = 'user';
```
- **Purpose**: Ensures addresses reference valid parent records
- **Benefit**: Prevents orphaned address records

#### 2. Cleanup Triggers
```sql
CREATE OR REPLACE FUNCTION cleanup_addresses()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    DELETE FROM addresses 
    WHERE addressable_id = OLD.property_id 
    AND addressable_type = 'property';
    RETURN OLD;
END;
$$;

CREATE TRIGGER cleanup_property_addresses
    BEFORE DELETE ON properties
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_addresses();
```
- **Purpose**: Automatically cleans up addresses when properties are deleted
- **Benefit**: Double protection against orphaned records

## Landlord Deletion Protection

### Prevention of Landlord Deletion with Properties
```sql
CREATE OR REPLACE FUNCTION check_landlord_properties()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    property_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO property_count
    FROM properties 
    WHERE landlord_id = OLD.landlord_id;
    
    IF property_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete landlord with ID % because they own % properties. Please archive instead of deleting.', OLD.landlord_id, property_count;
    END IF;
    
    RETURN OLD;
END;
$$;

CREATE TRIGGER prevent_landlord_deletion_with_properties
    BEFORE DELETE ON landlords
    FOR EACH ROW
    EXECUTE FUNCTION check_landlord_properties();
```
- **Purpose**: Prevents deletion of landlords who own properties
- **Benefit**: Protects data integrity and prepares for archiving system

### Safe Landlord Deletion Function
```sql
CREATE OR REPLACE FUNCTION delete_landlord_with_properties(p_landlord_id INTEGER)
RETURNS VOID 
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    property_count INTEGER;
BEGIN
    -- Check if landlord has properties
    SELECT COUNT(*) INTO property_count
    FROM properties 
    WHERE landlord_id = p_landlord_id;
    
    IF property_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete landlord with ID % because they own % properties. Use archive_landlord() function instead.', p_landlord_id, property_count;
    END IF;
    
    -- Delete landlord (cascade will handle related records)
    DELETE FROM landlords WHERE landlord_id = p_landlord_id;
END;
$$;
```
- **Purpose**: Provides safe deletion with property checking
- **Benefit**: Clear error messages and protection

## Archive Functions (Future Implementation)

### Landlord Archiving
```sql
CREATE OR REPLACE FUNCTION archive_landlord(p_landlord_id INTEGER)
RETURNS VOID 
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    -- TODO: Implement archiving logic
    -- For now, just prevent deletion
    RAISE EXCEPTION 'Archiving not yet implemented. Cannot delete landlord with properties.';
END;
$$;
```

### Property Archiving
```sql
CREATE OR REPLACE FUNCTION archive_property(p_property_id INTEGER)
RETURNS VOID 
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    -- TODO: Implement archiving logic
    -- For now, use regular deletion
    PERFORM delete_property_with_cleanup(p_property_id);
END;
$$;
```

## Running the Migration

### Prerequisites
- Node.js environment
- Supabase project with service role key
- Environment variables configured

### Steps
1. Ensure environment variables are set:
   ```bash
   VITE_SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

2. Run the migration:
   ```bash
   node scripts/run-constraints-migration.js
   ```

### Verification
After running the migration, verify constraints are in place:
```sql
-- Check foreign key constraints
SELECT conname, contype, confrelid::regclass, confdeltype 
FROM pg_constraint 
WHERE conrelid = 'properties'::regclass;

-- Check check constraints
SELECT conname, consrc 
FROM pg_constraint 
WHERE conrelid = 'addresses'::regclass AND contype = 'c';

-- Check functions
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname LIKE '%delete%' OR proname LIKE '%archive%';
```

## Benefits

### Data Integrity
- **No Orphaned Records**: Database constraints prevent orphaned records
- **Referential Integrity**: Foreign keys ensure valid relationships
- **Data Consistency**: Check constraints ensure valid data

### Performance
- **Database-Level Cleanup**: More efficient than application-level cleanup
- **Atomic Operations**: Database handles cleanup in transactions
- **Optimized Queries**: Database optimizes constraint checking

### Reliability
- **Always Enforced**: Constraints work regardless of access method
- **Error Prevention**: Clear error messages for invalid operations
- **Audit Trail**: Database logs constraint violations

### Future-Proofing
- **Archive Ready**: Foundation for archiving system
- **Scalable**: Database constraints scale with data
- **Maintainable**: Centralized constraint management

## Error Handling

### Common Error Messages
- **Landlord Deletion**: "Cannot delete landlord with ID X because they own Y properties. Please archive instead of deleting."
- **Invalid Address Type**: "Check constraint violation: addressable_type must be one of: property, landlord, pm_company, user"
- **Orphaned Records**: Foreign key constraint violations will show specific relationship issues

### Application Handling
The application now uses stored procedures for deletions, which provide:
- Clear error messages
- Automatic cleanup
- Transaction safety
- Consistent behavior

## Monitoring

### Constraint Violations
Monitor the database logs for constraint violations:
```sql
-- Check recent constraint violations
SELECT * FROM pg_stat_user_tables WHERE schemaname = 'public';
```

### Data Integrity Checks
Regular integrity checks can be performed:
```sql
-- Check for orphaned addresses
SELECT * FROM addresses a 
LEFT JOIN properties p ON a.addressable_id = p.property_id AND a.addressable_type = 'property'
WHERE p.property_id IS NULL AND a.addressable_type = 'property';
```

## Future Enhancements

### Archiving System
- Implement soft deletion with archive flags
- Create archive tables for historical data
- Add archive date and reason tracking
- Implement archive restoration functions

### Audit Logging
- Add audit triggers for all modifications
- Track who made changes and when
- Create audit trail reports
- Implement change notifications

### Data Validation
- Add more comprehensive check constraints
- Implement business rule validation
- Create data quality monitoring
- Add automated data cleanup jobs
