# Audit Logging Update Required

## Overview

To ensure all database operations are properly audited, all direct Supabase `.update()`, `.insert()`, and `.delete()` calls need to be replaced with the audit helper functions from `src/lib/auditHelpers.js`.

## Migration Status

✅ **Completed:**
- Migration `010_add_contacts_audit_trigger.sql` adds audit triggers for:
  - `contacts` table
  - `addresses` table  
  - `contact_methods` table
- Updated `LandlordManagement.jsx` to use audit helpers for all operations

## Files That Need Updates

The following files contain direct Supabase calls that should be updated to use audit helpers:

### High Priority (Frequently Used Entities)

1. **src/pages/PropertiesPage.jsx**
   - Property updates (line ~1766)
   - Address updates/inserts (lines ~1795-1812)

2. **src/pages/TenantsPage.jsx**
   - Client/tenant updates
   - Contact method updates
   - Address updates

3. **src/components/UserManagement.jsx**
   - User updates
   - Contact updates

4. **src/pages/LeasesPage.jsx**
   - Lease updates
   - Related entity updates

5. **src/pages/applicant/ApplicantProfile.jsx**
   - Applicant/client updates
   - Contact method updates

6. **src/pages/tenant/TenantProfile.jsx**
   - Tenant profile updates
   - Contact updates

### Medium Priority

7. **src/pages/VendorsPage.jsx**
   - Vendor updates
   - Contact/address updates

8. **src/components/PMCompanyManagement.jsx**
   - Already partially updated, verify all operations use audit helpers

9. **src/pages/UnitsPage.jsx** (if exists)
   - Unit updates

10. **src/pages/MaintenanceRequestsPage.jsx** (if exists)
    - Maintenance request updates

## How to Update

### Before (Direct Supabase Call):
```javascript
const { error } = await supabase
    .from('properties')
    .update({ property_name: name })
    .eq('property_id', propertyId);
```

### After (Using Audit Helper):
```javascript
import { updateWithAudit } from '../lib/auditHelpers.js';

const { error } = await updateWithAudit(
    'properties',
    { property_name: name },
    'property_id',
    propertyId,
    user.user_id
);
```

### For Inserts:
```javascript
// Before
const { error } = await supabase
    .from('addresses')
    .insert([{ addressable_id: id, ...data }]);

// After
import { insertWithAudit } from '../lib/auditHelpers.js';

const { error } = await insertWithAudit(
    'addresses',
    [{ addressable_id: id, ...data }],
    user.user_id
);
```

### For Deletes:
```javascript
// Before
const { error } = await supabase
    .from('contact_methods')
    .delete()
    .eq('contact_method_id', methodId);

// After
import { deleteWithAudit } from '../lib/auditHelpers.js';

const { error } = await deleteWithAudit(
    'contact_methods',
    'contact_method_id',
    methodId,
    user.user_id
);
```

## Important Notes

1. **Always pass `user.user_id`** as the last parameter to audit helper functions
2. **For updates**, the column parameter should be the primary key column name
3. **For inserts**, pass an array even for single records
4. **The audit helpers use RPC functions** that set the session variable `app.current_user_id` before the operation, which the database triggers use to capture the user

## Tables with Audit Triggers

The following tables have audit triggers installed:
- pm_companies
- users
- landlords
- properties
- units
- clients
- vendors
- leases
- maintenance_requests
- templates
- client_applications
- documents
- compliance_workflows
- compliance_policies
- legal_notices
- client_units
- contacts (added in migration 02)
- addresses (added in migration 02)
- contact_methods (added in migration 02)

## Testing

After updating code to use audit helpers:
1. Make a change to an entity
2. Navigate to Admin > Audit Logs
3. Verify the change appears with the correct user_id
4. Check that all changed fields are captured

## Next Steps

1. Run migration `010_add_contacts_audit_trigger.sql` to add triggers for contacts, addresses, and contact_methods
2. Systematically update each file listed above
3. Test each update to ensure audit logs are created
4. Consider adding automated tests to verify audit logging

