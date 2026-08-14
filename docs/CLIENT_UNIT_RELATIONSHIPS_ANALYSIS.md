# Client-Unit Relationships Analysis

## Current Schema Overview

### Tables Involved

1. **`clients`** - Unified table for applicants/tenants
   - `client_id` (PK)
   - `user_id` (FK to users, UNIQUE)
   - `pmc_id` (FK to pm_companies) - **TO BE REMOVED**
   - `lifecycle_stage` ('prospect', 'applicant', 'tenant')
   - Other fields...

2. **`client_applications`** (viewed as `application_units`)
   - `application_id` (PK)
   - `client_id` (FK to clients)
   - `unit_id` (FK to units)
   - `pmc_id` (FK to pm_companies) - **OK, stays on application**
   - `property_id` (FK to properties)
   - `status` ('pending', 'approved', 'rejected', 'dropped')
   - `UNIQUE(client_id, unit_id)`

3. **`lease_clients`**
   - `lease_client_id` (PK)
   - `lease_id` (FK to leases)
   - `client_id` (FK to clients)
   - `occupancy_status` ('active', 'vacated')
   - `UNIQUE(lease_id, client_id)`

4. **`leases`**
   - `lease_id` (PK)
   - `unit_id` (FK to units)
   - `pmc_id` (FK to pm_companies) - **OK, stays on lease**
   - `status` ('active', 'future', 'expired', 'terminated')

5. **`units`**
   - `unit_id` (PK)
   - `property_id` (FK to properties)

6. **`properties`**
   - `property_id` (PK)
   - `pmc_id` (FK to pm_companies) - **OK, property belongs to PMC**

## Current Client → Unit Relationships

### Path 1: Through Applications
```
clients → client_applications (application_units) → units
```
- Used when: Client applies for a unit
- Status tracked: `client_applications.status` ('pending', 'approved', etc.)
- **Limitation**: Only shows units they've applied for

### Path 2: Through Leases
```
clients → lease_clients → leases → units
```
- Used when: Client has a lease
- Status tracked: `lease_clients.occupancy_status` ('active', 'vacated')
- **Limitation**: Only shows units with active leases

## Problems Identified

### Problem 1: Missing Direct Client-Unit Assignment
**Scenario**: Admin creates tenant directly on Tenants page and assigns unit (no application, no lease)
- **Current**: No way to link client to unit
- **Needed**: Direct assignment mechanism

**Options:**
1. Create a `client_units` junction table for direct assignments
2. Create a "placeholder" application with `status = 'approved'` and no lease
3. Create a "placeholder" lease with minimal data

### Problem 2: TenantsPage Only Shows Leased Units
**Current Code**: TenantsPage only queries `lease_clients` to find units
- **Missing**: Units from approved applications without leases
- **Result**: Tenant with approved application but no lease doesn't show unit

**Fix Needed**: Query both:
- `lease_clients` → `leases` → `units` (for leased units)
- `client_applications` WHERE `status = 'approved'` → `units` (for approved applications)

### Problem 3: clients.pmc_id Should Be Removed
**Current**: `clients.pmc_id` directly links client to PMC
**Correct**: Client's PMC relationship should be indirect:
- Through `client_applications.pmc_id` (which unit they applied for)
- Through `leases.pmc_id` (which lease they have)
- Through `units` → `properties` → `pmc_id` (which property/unit they occupy)

**Code Using clients.pmc_id:**
- `src/pages/ApplicantsPage.jsx` (line 243, 1422)
- `src/pages/TenantsPage.jsx` (line 211)
- Compatibility views (`tenants`, `applicants` views)

## Recommended Schema Changes

### 1. Remove `clients.pmc_id`
- Drop column from `clients` table
- Update compatibility views to remove `pmc_id`
- Update all code references

### 2. Add Direct Client-Unit Assignment (if needed)
**Option A**: Create `client_units` table
```sql
CREATE TABLE client_units (
  client_unit_id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  assignment_type VARCHAR(50) DEFAULT 'direct', -- 'direct', 'application', 'lease'
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  vacated_at TIMESTAMP,
  is_archived BOOLEAN DEFAULT false,
  UNIQUE(client_id, unit_id)
);
```

**Option B**: Use approved applications as the source of truth
- When assigning unit directly, create an approved application
- TenantsPage queries approved applications for units

**Option C**: Use leases as the source of truth
- When assigning unit directly, create a minimal lease
- TenantsPage queries leases for units

### 3. Fix TenantsPage Unit Display
Query both:
1. Active leases: `lease_clients` WHERE `occupancy_status = 'active'` → `leases` → `units`
2. Approved applications: `client_applications` WHERE `status = 'approved'` → `units`

## Questions for User

1. **Direct Unit Assignment**: When creating a tenant directly and assigning a unit (no application, no lease), should we:
   - Create a minimal approved application?
   - Create a minimal lease?
   - Create a new `client_units` table?

2. **PMC Relationship**: After removing `clients.pmc_id`, how should we determine a client's PMC?
   - From their current unit's property's PMC?
   - From their active lease's PMC?
   - From their most recent application's PMC?

3. **Unit Display Priority**: If a tenant has both an approved application AND a lease for different units, which should be shown?
   - The leased unit (lease takes precedence)?
   - The approved application unit?
   - Both?

