# Database Migration Instructions

## Overview

This directory contains database migrations for Metro Landmark.

**Naming:** `NNN_description.sql` with a three-digit prefix (`000`–`999`) so
lexicographic order matches run order. `db:migrate` only executes files that
match that pattern.

Schema changes are idempotent (`IF NOT EXISTS` / `IF EXISTS`) and safe to re-run.

## Running Migrations

### Using NPM Scripts

```bash
# Run migrations on local database
npm run db:migrate

# Run migrations on Supabase
npm run db:migrate:supabase
```

### Using Direct Commands

```bash
# Run migrations
node scripts/db-util.js migrate [environment]

# Available environments:
# - local (default)
# - supabase_dev
# - supabase_prod
```

### Using Supabase SQL Editor

1. Open **Supabase Dashboard** → Your Project
2. Click **SQL Editor** (left sidebar)
3. Open the file: `scripts/migrations/000_comprehensive_schema_migration.sql`
4. Copy the entire contents
5. Paste into SQL Editor
6. Click **Run**

**Expected Result:** "Success. No rows returned"

## Migration File

### `000_comprehensive_schema_migration.sql`

This is the **single comprehensive migration script** that includes all schema changes:

- **Archive System**: Universal archiving columns and functions for all entities
- **Clients System**: Unified clients table replacing separate tenants/applicants tables
- **Property Structure**: Manager assignments, landlord relationships
- **Document Storage**: Document management with polymorphic associations and signatures
- **Compliance Center**: Workflows, policies, rules, and property inspections
- **Notifications**: User notification preferences and history
- **Voice Calls**: Support for incomplete chatbot conversations
- **Audit Triggers**: Comprehensive audit logging for all major tables

The migration is **idempotent** - it can be run multiple times safely. All changes use `IF NOT EXISTS`, `IF EXISTS`, and similar checks to prevent errors on re-runs.

## Migration Sections

1. **Cleanup**: Drops legacy tables and views
2. **Archive System**: Adds archiving columns and functions
3. **Clients System**: Creates unified clients, applications, and relationships
4. **Property Structure**: Updates property and landlord relationships
5. **Leases and Templates**: Adds template support and fixes constraints
6. **Maintenance Requests**: Allows nullable fields for incomplete requests
7. **Document Storage**: Adds document management system
8. **Compliance Center**: Adds compliance workflows, policies, and inspections
9. **Notifications**: Adds notification preferences and history
10. **Voice Calls**: Adds support for incomplete chatbot conversations
11. **Archive Functions**: Creates archive, restore, and hard delete functions
12. **Audit Triggers**: Sets up audit logging for all major tables

## Verifying the Migration

### Check Archive Columns

```sql
SELECT 
    table_name, 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE column_name LIKE '%archive%' 
AND table_schema = 'public'
ORDER BY table_name, column_name;
```

You should see `is_archived`, `archived_at`, `archived_by_user_id`, and `archive_reason` columns for each major table.

### Check Archive Functions

```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name LIKE '%archive%'
ORDER BY routine_name;
```

You should see:
- `archive_entity`
- `archive_landlord`
- `archive_property`
- `archive_user`
- `archive_applicant` (maps to clients)
- `archive_vendor`
- `archive_lease`
- `archive_unit`
- `restore_entity`
- `hard_delete_entity`

### Check New Tables

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'clients',
    'client_applications',
    'client_units',
    'lease_clients',
    'document_signatures',
    'compliance_workflows',
    'compliance_policies',
    'compliance_rules',
    'property_inspections',
    'user_notification_preferences',
    'notification_history'
)
ORDER BY table_name;
```

### Check Audit Triggers

```sql
SELECT 
    trigger_name,
    event_object_table
FROM information_schema.triggers
WHERE trigger_name LIKE 'audit_trigger%'
ORDER BY event_object_table;
```

## Testing Archive Functions

Test with a safe entity (create a test record first if needed):

```sql
-- Create a test vendor
INSERT INTO vendors (vendor_name, email)
VALUES ('Test Vendor', 'test@example.com')
RETURNING vendor_id;

-- Archive it (replace 999 with the actual vendor_id from above)
SELECT archive_vendor(999, 1, 'Testing archive system', false);

-- Verify it's archived
SELECT vendor_id, vendor_name, is_archived, archived_at, archive_reason
FROM vendors
WHERE vendor_id = 999;

-- Restore it
SELECT restore_entity('vendors', 999, 1);

-- Verify it's restored
SELECT vendor_id, vendor_name, is_archived, archived_at, archive_reason
FROM vendors
WHERE vendor_id = 999;

-- Clean up test data
DELETE FROM vendors WHERE vendor_id = 999;
```

## What Changed

### Database Tables
- All major entity tables now have archive columns
- Unified `clients` table replaces separate `tenants` and `applicants` tables
- New `client_units` table for direct client-unit relationships
- New compliance, document, and notification tables

### Indexes
- Added for efficient archive queries
- Added for JSONB field queries (GIN indexes)
- Added for date-based queries

### Functions
- Archive, restore, and hard delete functions created
- Convenience wrapper functions for each entity type

### Triggers
- Audit triggers on all major tables
- Updated_at triggers for timestamp management

## Legacy Migration Files

The incremental files in this directory (`001_` onward) are kept for existing
databases. New installs get the same objects from `000_comprehensive_schema_migration.sql`
plus later numbered files. `db:migrate` runs every `NNN_*.sql` file in order.

## Next Steps

After running the migration:

1. Update all entity queries to filter `is_archived = false` by default
2. Replace Delete modals with the new ArchiveModal component
3. Add "Show Archived" toggle filters to entity pages
4. Add restore functionality for archived items
5. Update code to use `clients` table instead of `tenants`/`applicants` views

## Troubleshooting

### Migration Already Run

If you see errors about objects already existing, this is normal. The migration is idempotent and will skip existing objects.

### Missing Tables

If you see errors about missing tables, ensure you've run the initial database setup (`npm run db:init`) before running migrations.

### Foreign Key Errors

If you see foreign key constraint errors, check that referenced tables exist and have the correct structure. The migration should handle this automatically, but if issues persist, check the order of operations in the migration script.
