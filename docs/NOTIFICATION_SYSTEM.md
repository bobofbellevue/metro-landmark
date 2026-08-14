# Notification Preferences System

## Overview

The notification preferences system allows users to manage how they receive notifications across different categories (maintenance, lease, payment, general) and notification types (email, SMS, push).

## Features

1. **Global Preferences**: Enable/disable notification types globally (email, SMS, push)
2. **Category-Specific Preferences**: Configure preferences per category (maintenance, lease, payment, general)
3. **Frequency Control**: Choose between immediate, daily digest, or weekly digest delivery
4. **Test Notifications**: Send test notifications to verify preferences
5. **Notification History**: Track all sent notifications with read/unread status

## Database Schema

### user_notification_preferences

Stores user notification preferences with:
- Global toggles for email, SMS, and push
- Per-category toggles and frequency settings
- Automatic defaults for new users

### notification_history

Tracks all notifications sent:
- Notification type, category, subject, message
- Delivery status (sent, delivered, failed, bounced)
- Read/unread status
- Metadata for additional context

## API Endpoints

### GET /api/notifications/preferences
Get user's notification preferences. Creates default preferences if none exist.

**Headers:**
- `x-user-id`: User ID

**Response:**
```json
{
  "success": true,
  "preferences": {
    "preference_id": 1,
    "user_id": 123,
    "email_enabled": true,
    "sms_enabled": false,
    "push_enabled": false,
    "maintenance_email": true,
    "maintenance_sms": false,
    "maintenance_push": false,
    "maintenance_frequency": "immediate",
    ...
  }
}
```

### PUT /api/notifications/preferences
Update user's notification preferences.

**Headers:**
- `x-user-id`: User ID

**Body:**
```json
{
  "email_enabled": true,
  "maintenance_email": true,
  "maintenance_frequency": "daily_digest",
  ...
}
```

### POST /api/notifications/test
Send a test notification.

**Headers:**
- `x-user-id`: User ID

**Body:**
```json
{
  "notification_type": "email",
  "category": "maintenance"
}
```

### GET /api/notifications/history
Get notification history with optional filters.

**Headers:**
- `x-user-id`: User ID

**Query Params:**
- `limit`: Number of results (default: 50)
- `offset`: Pagination offset (default: 0)
- `category`: Filter by category
- `notification_type`: Filter by type
- `read`: Filter by read status (true/false)
- `start_date`: ISO date string
- `end_date`: ISO date string

### PUT /api/notifications/mark-read
Mark notifications as read/unread.

**Headers:**
- `x-user-id`: User ID

**Body:**
```json
{
  "notification_id": 123,  // Optional: if not provided, marks all as read
  "read": true
}
```

## Notification Service

The notification service (`api/utils/notification-service.js`) handles:

1. **sendNotification()**: Sends notifications based on user preferences
   - Checks global and category-specific preferences
   - Respects frequency settings (immediate vs digest)
   - Records notifications in history

2. **processDigestNotifications()**: Processes queued digest notifications
   - Aggregates notifications by user, category, and type
   - Sends digest emails
   - Updates notification status

## Cron Jobs

### Daily Digest
- **Schedule**: Every day at 8 AM (`0 8 * * *`)
- **Endpoint**: `/api/cron/process-digest-notifications?frequency=daily_digest`

### Weekly Digest
- **Schedule**: Every Monday at 8 AM (`0 8 * * 1`)
- **Endpoint**: `/api/cron/process-digest-notifications?frequency=weekly_digest`

**Security**: Both cron jobs require `CRON_SECRET` or `VERCEL_CRON_SECRET` environment variable.

## Usage in Code

### Sending a Notification

```javascript
import { sendNotification } from '../utils/notification-service.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(supabaseUrl, supabaseKey);

const result = await sendNotification({
  userId: 123,
  notificationType: 'email',
  category: 'maintenance',
  subject: 'Maintenance Request Created',
  message: 'A new maintenance request has been created for your unit.',
  metadata: { request_id: 456 }
}, supabase);

if (result.success) {
  console.log('Notification sent:', result.notificationId);
} else {
  console.error('Failed to send:', result.error);
}
```

## UI Component

The `NotificationPreferences` component provides:
- Global notification type toggles
- Category-specific preferences
- Frequency selection dropdowns
- Test notification buttons
- Save functionality

Located in `src/components/NotificationPreferences.jsx` and integrated into the Settings page.

## Email Service

✅ **Fully Implemented** - Uses SendGrid for email delivery via `@sendgrid/mail` package.

Configure with:
- `SENDGRID_API_KEY`: SendGrid API key (required)
- `FROM_EMAIL` or `SENDGRID_FROM_EMAIL`: Sender email address
- `FROM_NAME` or `SENDGRID_FROM_NAME`: Sender name

Features:
- Automatic retry logic (up to 3 retries with exponential backoff)
- HTML and plain text email support
- Professional email templates
- Error handling and logging

If SendGrid is not configured, notifications are logged to console (development mode).

## SMS Service

✅ **Fully Implemented** - Uses Twilio for SMS delivery.

Configure with:
- `TWILIO_ACCOUNT_SID`: Twilio Account SID (required)
- `TWILIO_AUTH_TOKEN`: Twilio Auth Token (required)
- `FROM_PHONE` or `TWILIO_PHONE_NUMBER`: Twilio phone number (required)

Features:
- Automatic phone number normalization to E.164 format
- Automatic retry logic (up to 3 retries)
- Phone number lookup from user's contact_methods
- Error handling and logging

If Twilio is not configured, SMS notifications are logged to console (development mode).

## Push Notifications

⚠️ **Not Yet Implemented** - Push notifications are stubbed out. To implement:

1. Implement Web Push API with service worker
2. Request notification permissions from users
3. Store push subscription tokens
4. Send push notifications via service worker

## Migration

Run the migration to create the notification tables:

```bash
npm run db:migrate
```

Or manually run:
```sql
-- See scripts/migrations/2025-01-XX-notification-preferences-system.sql
```

## Default Preferences

New users automatically get:
- Email enabled globally
- SMS and push disabled globally
- All categories enabled for email
- Immediate delivery for all categories

## Notification Templates

✅ **Fully Implemented** - Professional templates available in `api/utils/notification-templates.js`:

- `generateMaintenanceNotification()` - Maintenance request notifications
- `generateLeaseRenewalNotification()` - Lease renewal reminders
- `generatePaymentReminderNotification()` - Payment reminders
- `generateAppointmentConfirmationNotification()` - Appointment confirmations
- `generateGeneralNotification()` - General notifications
- `generateDigestNotification()` - Digest notifications

All templates include:
- HTML email templates with responsive design
- SMS text templates (concise format)
- Category-specific styling and colors
- Action buttons/links when applicable

## Future Enhancements

1. ✅ ~~SMS integration with Twilio~~ - **Completed**
2. ⚠️ Web Push API implementation - **Pending**
3. Notification center UI component
4. ✅ ~~Notification templates~~ - **Completed**
5. ✅ ~~Rich email templates~~ - **Completed**
6. ✅ ~~Delivery retry logic~~ - **Completed**
7. Notification analytics and reporting
8. Email/SMS delivery webhooks for status updates

