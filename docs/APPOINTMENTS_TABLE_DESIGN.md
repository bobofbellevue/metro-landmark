# Client Appointments Table Design

## Overview

The `client_appointments` table tracks scheduled appointments between tenants (clients) and vendors for maintenance requests. This enables:
- Tracking scheduled appointment times
- Recording appointment outcomes
- Automatically closing maintenance requests when issues are resolved
- Sending appointment notifications to tenants based on their preferences

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS client_appointments (
  appointment_id SERIAL PRIMARY KEY,
  
  -- Relationships
  client_id INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  maintenance_request_id INTEGER NOT NULL REFERENCES maintenance_requests(request_id) ON DELETE CASCADE,
  
  -- Scheduling
  scheduled_date_time TIMESTAMP NOT NULL,
  actual_date_time TIMESTAMP,  -- When appointment actually occurred (if different from scheduled)
  estimated_duration_minutes INTEGER,  -- Estimated appointment duration
  
  -- Status tracking
  status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled', 'in_progress')
  ),
  
  -- Outcome tracking
  result TEXT,  -- What happened during the appointment
  resolved_issue BOOLEAN DEFAULT false,  -- Did this appointment resolve the maintenance request?
  notes TEXT,  -- Additional notes about the appointment
  
  -- Vendor contact who will attend
  vendor_contact_id INTEGER REFERENCES contacts(contact_id) ON DELETE SET NULL,
  
  -- Audit trail
  created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,  -- Who scheduled it (bot, admin, etc.)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancelled_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  cancelled_reason TEXT,
  
  -- Archiving
  is_archived BOOLEAN DEFAULT false,
  archived_at TIMESTAMP,
  archived_by_user_id INTEGER REFERENCES users(user_id),
  archive_reason TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_client_appointments_client ON client_appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_client_appointments_vendor ON client_appointments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_client_appointments_request ON client_appointments(maintenance_request_id);
CREATE INDEX IF NOT EXISTS idx_client_appointments_status ON client_appointments(status);
CREATE INDEX IF NOT EXISTS idx_client_appointments_scheduled ON client_appointments(scheduled_date_time);
CREATE INDEX IF NOT EXISTS idx_client_appointments_archived ON client_appointments(is_archived, archived_at);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_client_appointments_request_status ON client_appointments(maintenance_request_id, status);
```

## Status Values

- **`scheduled`** - Appointment is scheduled but hasn't happened yet
- **`in_progress`** - Appointment is currently happening
- **`completed`** - Appointment was completed
- **`cancelled`** - Appointment was cancelled
- **`no_show`** - Vendor or tenant didn't show up
- **`rescheduled`** - Appointment was rescheduled (new appointment record should be created)

## Key Relationships

### With Maintenance Requests

- **One-to-Many**: A maintenance request can have multiple appointments (e.g., initial visit, follow-up, repair completion)
- **Auto-Close Logic**: When `resolved_issue = true` and `status = 'completed'`, the system should:
  1. Update maintenance request `status` to 'Completed'
  2. Set `completed_at` timestamp
  3. Optionally add note about which appointment resolved it

### With Clients

- **Many-to-One**: Multiple appointments can be scheduled for the same client
- **Notification**: When appointment is scheduled, notify client according to their `user_notification_preferences`

### With Vendors

- **Many-to-One**: Multiple appointments can be scheduled with the same vendor
- **Vendor Contact**: `vendor_contact_id` tracks which specific contact person will attend

## Integration Points

### 1. Voice Bot Vendor Calling

When the bot calls a vendor and schedules an appointment:

```javascript
// In callVendor() function or after vendor call completes
const appointment = await supabase
  .from('client_appointments')
  .insert({
    client_id: clientId,
    vendor_id: vendorId,
    maintenance_request_id: maintenanceRequestId,
    scheduled_date_time: scheduledDateTime,  // From conversation
    status: 'scheduled',
    created_by_user_id: null  // Bot-created
  });
```

### 2. Tenant Notification

After appointment is created, send notification according to tenant preferences:

```javascript
// Check user_notification_preferences for appointment notifications
// Send via preferred channel (email, SMS, phone call, etc.)
```

### 3. Appointment Completion

When appointment is marked as completed:

```javascript
// If resolved_issue = true
if (appointment.resolved_issue) {
  await supabase
    .from('maintenance_requests')
    .update({
      status: 'Completed',
      completed_at: new Date().toISOString(),
      admin_notes: `Resolved by appointment on ${appointment.actual_date_time}`
    })
    .eq('request_id', maintenanceRequestId);
}
```

### 4. Multiple Appointments

A maintenance request can have multiple appointments:
- Initial assessment appointment
- Repair appointment
- Follow-up inspection
- Final completion

All are tracked separately, allowing full history.

## Data Flow

```
1. Maintenance Request Created
   ↓
2. Vendor Called (by bot or cron job)
   ↓
3. Appointment Scheduled
   ↓
4. client_appointments record created
   ↓
5. Tenant Notified (via notification preferences)
   ↓
6. Appointment Occurs
   ↓
7. Status updated to 'completed'
   ↓
8. If resolved_issue = true:
   - Maintenance request status → 'Completed'
   - completed_at timestamp set
```

## Example Queries

### Get all appointments for a maintenance request

```sql
SELECT 
  a.*,
  c.first_name || ' ' || c.last_name as client_name,
  v.company_name as vendor_name
FROM client_appointments a
JOIN clients cl ON a.client_id = cl.client_id
JOIN contacts c ON c.contactable_id = cl.client_id AND c.contactable_type = 'tenant'
JOIN vendors v ON a.vendor_id = v.vendor_id
WHERE a.maintenance_request_id = $1
  AND a.is_archived = false
ORDER BY a.scheduled_date_time;
```

### Get upcoming appointments for a client

```sql
SELECT 
  a.*,
  mr.description as issue_description,
  mr.priority,
  v.company_name as vendor_name
FROM client_appointments a
JOIN maintenance_requests mr ON a.maintenance_request_id = mr.request_id
JOIN vendors v ON a.vendor_id = v.vendor_id
WHERE a.client_id = $1
  AND a.status = 'scheduled'
  AND a.scheduled_date_time >= NOW()
  AND a.is_archived = false
ORDER BY a.scheduled_date_time;
```

### Find appointments that should close maintenance requests

```sql
SELECT 
  a.*,
  mr.request_id,
  mr.status as request_status
FROM client_appointments a
JOIN maintenance_requests mr ON a.maintenance_request_id = mr.request_id
WHERE a.status = 'completed'
  AND a.resolved_issue = true
  AND mr.status != 'Completed'
  AND a.is_archived = false;
```

## Migration

Add this to your migration script or `db-util-server.js`:

```javascript
// In createTables() function
await sql`
  CREATE TABLE IF NOT EXISTS client_appointments (
    appointment_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
    maintenance_request_id INTEGER NOT NULL REFERENCES maintenance_requests(request_id) ON DELETE CASCADE,
    scheduled_date_time TIMESTAMP NOT NULL,
    actual_date_time TIMESTAMP,
    estimated_duration_minutes INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (
      status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled', 'in_progress')
    ),
    result TEXT,
    resolved_issue BOOLEAN DEFAULT false,
    notes TEXT,
    vendor_contact_id INTEGER REFERENCES contacts(contact_id) ON DELETE SET NULL,
    created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TIMESTAMP,
    cancelled_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    cancelled_reason TEXT,
    is_archived BOOLEAN DEFAULT false,
    archived_at TIMESTAMP,
    archived_by_user_id INTEGER REFERENCES users(user_id),
    archive_reason TEXT
  )
`;

// Create indexes
await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_client ON client_appointments(client_id)`;
await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_vendor ON client_appointments(vendor_id)`;
await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_request ON client_appointments(maintenance_request_id)`;
await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_status ON client_appointments(status)`;
await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_scheduled ON client_appointments(scheduled_date_time)`;
await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_archived ON client_appointments(is_archived, archived_at)`;
await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_request_status ON client_appointments(maintenance_request_id, status)`;
```

