# Audit Logging System Implementation

## Overview

A comprehensive audit logging system has been implemented to track all data modifications across the application. This system records who made changes, when, and what changed, providing a complete audit trail for compliance and security purposes.

## Implementation Status

✅ **Completed**

## Components Implemented

### 1. Database Schema

The `audit_logs` table already exists in the database with the following structure:

- `audit_id` (SERIAL PRIMARY KEY)
- `table_name` (VARCHAR(100) NOT NULL)
- `record_id` (INTEGER NOT NULL)
- `action` (VARCHAR(20) - INSERT, UPDATE, DELETE)
- `user_id` (INTEGER REFERENCES users)
- `old_values` (JSONB) - Previous values (for UPDATE/DELETE)
- `new_values` (JSONB) - New values (for INSERT/UPDATE)
- `changed_fields` (TEXT[]) - Which fields changed
- `ip_address` (INET) - IP address of the user making the change
- `user_agent` (TEXT) - User agent string
- `created_at` (TIMESTAMP) - When the change occurred

**Indexes:**
- `idx_audit_logs_table_record` on (table_name, record_id)
- `idx_audit_logs_user` on (user_id)
- `idx_audit_logs_created_at` on (created_at)
- `idx_audit_logs_action` on (action)
- `idx_audit_logs_old_values` GIN index on (old_values)
- `idx_audit_logs_new_values` GIN index on (new_values)

### 2. Audit Triggers

**Migration File:** `scripts/migrations/2025-12-XX-add-audit-triggers.sql`

This migration:
- Updates the `audit_trigger_function()` to support IP address and user agent capture
- Creates a `mask_sensitive_data()` function to mask sensitive information
- Creates audit triggers on all major tables:
  - `pm_companies`
  - `users`
  - `landlords`
  - `properties`
  - `units`
  - `clients`
  - `vendors`
  - `leases`
  - `maintenance_requests`
  - `client_applications`
  - `documents`
  - `compliance_workflows` (if exists)
  - `compliance_policies` (if exists)
  - `legal_notices` (if exists)
  - `client_units` (if exists)

**Sensitive Data Masking:**
The system automatically masks sensitive fields including:
- Passwords (password, password_hash, password_hash_salt)
- Social Security Numbers (ssn, social_security_number)
- Credit card information
- Bank account information

Masked values are stored as `***MASKED***` in the audit logs.

### 3. API Endpoints

**`/api/audit-logs/list`** - List and filter audit logs
- Supports filtering by: table_name, record_id, user_id, action, date range, search
- Returns paginated results
- Enriches logs with user information (email, role)
- Admin-only access

**`/api/audit-logs/export`** - Export audit logs
- Supports CSV and JSON formats
- Applies same filters as list endpoint
- Admin-only access
- Maximum 10,000 records per export

### 4. Admin Interface

**Component:** `src/components/AuditLogs.jsx`

Features:
- Filter by table, action, user, record ID, date range
- Search in changed fields
- View before/after comparisons (via old_values/new_values)
- Export to CSV or JSON
- Pagination with "Load More" functionality
- Real-time filtering

**Integration:** Added to `AdminPage` as a new tab (admin-only)

## Security

1. **Access Control:** Only users with `admin` role (global_admin, company_admin) can view audit logs
2. **Sensitive Data Protection:** Automatic masking of passwords, SSNs, and financial data
3. **Immutable Logs:** Audit logs are append-only (no UPDATE or DELETE operations on audit_logs table)

## Usage

### Viewing Audit Logs

1. Navigate to **Admin** page
2. Click on **Audit Logs** tab
3. Use filters to narrow down results
4. Click on any log entry to see details

### Exporting Audit Logs

1. Apply desired filters
2. Click **Export CSV** or **Export JSON**
3. File will download with current filter settings

### Setting User Context for Database Operations

To capture user ID, IP address, and user agent in audit logs, you need to set PostgreSQL session variables before making database changes:

```sql
SET app.current_user_id = '123';
SET app.current_user_ip = '192.168.1.1';
SET app.current_user_agent = 'Mozilla/5.0...';
```

**Note:** When using Supabase client directly, these session variables are not automatically set. To fully capture IP/user agent, you would need to:

1. Use raw SQL connections for critical operations, OR
2. Modify API endpoints to set these variables before Supabase operations, OR
3. Use Supabase RLS policies or database functions that set these variables

Currently, the `user_id` will be captured if set via session variables, but IP address and user agent may not be captured for all operations.

## Performance Considerations

1. **Indexing:** All relevant columns are indexed for fast queries
2. **Pagination:** List endpoint supports pagination (default 100, max 1000)
3. **Export Limits:** Export is limited to 10,000 records to prevent timeouts
4. **GIN Indexes:** JSONB columns use GIN indexes for efficient JSON queries

## Future Enhancements

1. **IP/User Agent Capture:** Implement middleware or wrapper functions to automatically set session variables for all database operations
2. **Real-time Notifications:** Add Supabase Realtime subscriptions for critical changes
3. **Retention Policy:** Implement automatic archiving of old audit logs (e.g., archive logs older than 1 year)
4. **Partitioning:** Consider table partitioning by date for very large audit log tables
5. **Change Notifications:** Email notifications for critical changes (configurable rules)
6. **Advanced Search:** Full-text search across old_values and new_values JSONB fields
7. **Before/After Comparison UI:** Visual diff view for changes

## Migration Instructions

To apply the audit triggers:

1. Run the migration file:
   ```bash
   psql -d your_database -f scripts/migrations/2025-12-XX-add-audit-triggers.sql
   ```

   OR use the database utility:
   ```bash
   node scripts/db-util-server.js
   ```

2. Verify triggers are created:
   ```sql
   SELECT trigger_name, event_object_table 
   FROM information_schema.triggers 
   WHERE trigger_name LIKE 'audit_trigger%';
   ```

## Testing

To test the audit logging system:

1. Make a change to any audited table (e.g., update a user record)
2. Navigate to Admin > Audit Logs
3. Verify the change appears in the audit log
4. Check that sensitive data is masked (if applicable)
5. Test filtering and export functionality

## Troubleshooting

**Issue:** Audit logs not appearing
- Check that triggers are installed: `SELECT * FROM information_schema.triggers WHERE trigger_name LIKE 'audit_trigger%';`
- Verify `audit_logs` table exists
- Check database connection and permissions

**Issue:** IP address/user agent not captured
- These require session variables to be set before database operations
- Currently only captured if explicitly set via `SET app.current_user_ip` and `SET app.current_user_agent`

**Issue:** Sensitive data not masked
- Verify `mask_sensitive_data()` function exists
- Check that field names match the sensitive keys list in the function

## Related Files

- `scripts/migrations/2025-12-XX-add-audit-triggers.sql` - Migration file
- `scripts/db-util-server.js` - Database utility (contains audit function)
- `api/audit-logs/list.js` - List endpoint
- `api/audit-logs/export.js` - Export endpoint
- `src/components/AuditLogs.jsx` - Admin interface component
- `src/pages/AdminPage.jsx` - Admin page (includes audit logs tab)

