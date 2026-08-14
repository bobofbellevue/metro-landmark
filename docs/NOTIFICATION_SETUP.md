# Notification System Setup Guide

This guide explains how to set up and configure the notification system for email and SMS sending.

## Environment Variables

Add the following environment variables to your `.env` file or Vercel project settings:

### Email Service (SendGrid)

```bash
# SendGrid API Key (required for email notifications)
SENDGRID_API_KEY=your-sendgrid-api-key

# Sender email and name (optional, defaults provided)
FROM_EMAIL=noreply@yourdomain.com
FROM_NAME=Your App Name

# Alternative SendGrid-specific variables
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=Your App Name
```

**Getting a SendGrid API Key:**
1. Sign up at [SendGrid](https://sendgrid.com/)
2. Go to Settings > API Keys
3. Create a new API key with "Mail Send" permissions
4. Copy the API key and add it to your environment variables

### SMS Service (Twilio) - Optional

```bash
# Twilio Account SID and Auth Token (required for SMS notifications)
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token

# Twilio phone number (required for SMS sending)
FROM_PHONE=+1234567890
TWILIO_PHONE_NUMBER=+1234567890
```

**Getting Twilio Credentials:**
1. Sign up at [Twilio](https://www.twilio.com/)
2. Get your Account SID and Auth Token from the Twilio Console
3. Purchase a phone number from Twilio
4. Add all credentials to your environment variables

### Cron Jobs

```bash
# Optional: Secret for securing cron job endpoints
CRON_SECRET=your-random-secret
VERCEL_CRON_SECRET=your-random-secret
```

## Vercel Cron Configuration

The notification system uses Vercel Cron Jobs to process digest notifications. The configuration is already set up in `vercel.json`:

- **Daily Digest**: Runs every day at 8 AM UTC (`0 8 * * *`)
- **Weekly Digest**: Runs every Monday at 8 AM UTC (`0 8 * * 1`)

The cron jobs automatically call:
- `/api/cron/process-digest-notifications?frequency=daily_digest`
- `/api/cron/process-digest-notifications?frequency=weekly_digest`

## How It Works

### Immediate Notifications

When a notification is created with `frequency: 'immediate'`:
1. System checks user preferences
2. If email is enabled: Sends email via SendGrid
3. If SMS is enabled: Sends SMS via Twilio
4. Records delivery status in `notification_history` table

### Digest Notifications

When a notification is created with `frequency: 'daily_digest'` or `'weekly_digest'`:
1. Notification is queued in `notification_history` with `delivery_status: 'queued'`
2. Cron job processes queued notifications at scheduled times
3. Notifications are grouped by user, category, and notification type
4. Aggregated digest is sent via email/SMS
5. Original notifications are marked as `delivery_status: 'sent'`

## Notification Templates

The system includes pre-built templates for:

- **Maintenance Requests**: `generateMaintenanceNotification()`
- **Lease Renewals**: `generateLeaseRenewalNotification()`
- **Payment Reminders**: `generatePaymentReminderNotification()`
- **Appointment Confirmations**: `generateAppointmentConfirmationNotification()`
- **General Notifications**: `generateGeneralNotification()`
- **Digest Notifications**: `generateDigestNotification()`

## Usage Examples

### Sending an Email Notification

```javascript
import { sendNotification } from './api/utils/notification-service.js';

const result = await sendNotification({
  userId: 123,
  notificationType: 'email',
  category: 'maintenance',
  subject: 'Maintenance Request Received',
  message: 'Your maintenance request has been received and is being processed.',
  metadata: { requestId: 456 }
}, supabase);
```

### Sending Both Email and SMS

```javascript
const result = await sendNotification({
  userId: 123,
  notificationType: ['email', 'sms'], // Send to both channels
  category: 'payment',
  subject: 'Payment Due',
  message: 'Your payment of $500 is due on 2024-01-15.',
  metadata: { amount: 500, dueDate: '2024-01-15' }
}, supabase);
```

### Using Notification Templates

```javascript
import { generateMaintenanceNotification } from './api/utils/notification-templates.js';

const template = generateMaintenanceNotification({
  requestId: 'MR-123',
  title: 'Leaky Faucet',
  description: 'Kitchen sink faucet is leaking',
  priority: 'medium',
  userName: 'John Doe',
  propertyAddress: '123 Main St, Apt 4',
  actionUrl: 'https://app.example.com/maintenance/123'
});

const result = await sendNotification({
  userId: 123,
  notificationType: 'email',
  category: 'maintenance',
  subject: template.subject,
  message: template.message,
  html: template.emailHtml,
  text: template.smsText,
  actionUrl: 'https://app.example.com/maintenance/123',
  actionText: 'View Request'
}, supabase);
```

## Error Handling

The system includes automatic retry logic:
- **Email**: Retries up to 3 times with exponential backoff
- **SMS**: Retries up to 3 times with exponential backoff
- Failed sends are logged in `notification_history` with error messages
- If SMS fails, the system will still attempt to send email (if enabled)

## Testing

### Test Email Sending

1. Ensure `SENDGRID_API_KEY` is set
2. Use the test notification endpoint: `POST /api/notifications/test`
3. Check SendGrid dashboard for delivery status

### Test SMS Sending

1. Ensure Twilio credentials are set
2. Ensure user has a phone number in `contact_methods` table
3. Use the test notification endpoint
4. Check Twilio dashboard for delivery status

### Test Digest Processing

1. Create notifications with `frequency: 'daily_digest'`
2. Manually trigger the cron job: `GET /api/cron/process-digest-notifications?frequency=daily_digest`
3. Check `notification_history` table for updated statuses

## Troubleshooting

### Emails Not Sending

1. Verify `SENDGRID_API_KEY` is set correctly
2. Check SendGrid dashboard for API errors
3. Verify sender email is verified in SendGrid
4. Check `notification_history` table for error messages

### SMS Not Sending

1. Verify Twilio credentials are set correctly
2. Check that user has a phone number in `contact_methods` table
3. Verify phone number is in E.164 format (+1XXXXXXXXXX)
4. Check Twilio dashboard for errors
5. Verify Twilio phone number is active

### Digest Not Processing

1. Verify cron jobs are configured in Vercel
2. Check Vercel function logs for errors
3. Verify `notification_history` has queued notifications
4. Check that metadata contains correct `digest` value

## Security Notes

- Never commit API keys to version control
- Use environment variables for all sensitive credentials
- Rotate API keys regularly
- Monitor SendGrid and Twilio dashboards for unusual activity
- Use cron secrets to protect cron endpoints (optional but recommended)

