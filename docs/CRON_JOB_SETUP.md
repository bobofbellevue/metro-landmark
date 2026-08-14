# Automatic Vendor Calling Cron Job Setup

## Overview

The automatic vendor calling cron job (`api/cron/call-vendors.js`) runs periodically to:
- Find urgent/emergency maintenance requests without vendor contact
- Automatically call the assigned vendor to schedule appointments
- Update request status with call information

## Setup Options

### Option 1: Vercel Cron Jobs (Recommended - Requires Pro Plan)

If you have a Vercel Pro plan, cron jobs are configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/call-vendors",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

**Schedule Format**: `*/10 * * * *` means "every 10 minutes"

**Other Schedule Examples**:
- `*/5 * * * *` - Every 5 minutes
- `0 * * * *` - Every hour
- `0 */2 * * *` - Every 2 hours
- `0 9 * * *` - Daily at 9 AM

**Environment Variable**: Set `CRON_SECRET` or `VERCEL_CRON_SECRET` in Vercel environment variables for security.

### Option 2: External Cron Service (Free Alternative)

If you don't have Vercel Pro, use an external cron service:

#### Using cron-job.org (Free)

1. Sign up at https://cron-job.org
2. Create a new cron job:
   - **URL**: `https://your-domain.com/api/cron/call-vendors`
   - **Schedule**: Every 10 minutes
   - **Request Method**: GET or POST
   - **Request Headers**: 
     ```
     Authorization: Bearer YOUR_CRON_SECRET
     ```
3. Set `CRON_SECRET` in Vercel environment variables
4. Use the same secret in cron-job.org request headers

#### Using GitHub Actions (Free)

Create `.github/workflows/call-vendors.yml`:

```yaml
name: Call Vendors Cron Job

on:
  schedule:
    - cron: '*/10 * * * *'  # Every 10 minutes
  workflow_dispatch:  # Allow manual trigger

jobs:
  call-vendors:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Cron Job
        run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://your-domain.com/api/cron/call-vendors
```

**Setup**:
1. Add `CRON_SECRET` to GitHub Secrets
2. Update the URL to your Vercel deployment URL

#### Using EasyCron (Free Tier Available)

1. Sign up at https://www.easycron.com
2. Create a new cron job:
   - **URL**: `https://your-domain.com/api/cron/call-vendors`
   - **Method**: POST
   - **Headers**: `Authorization: Bearer YOUR_CRON_SECRET`
   - **Schedule**: Every 10 minutes

### Option 3: Manual Trigger (For Testing)

You can manually trigger the cron job for testing:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-domain.com/api/cron/call-vendors
```

Or use a tool like Postman or Insomnia.

## Environment Variables

Required environment variables:

```env
# Required
VAPI_API_KEY=your_vapi_private_api_key
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SECRET_KEY=your_supabase_secret_key

# Optional (for security)
CRON_SECRET=your_random_secret_string
# OR
VERCEL_CRON_SECRET=your_random_secret_string

# Optional (for testing)
TESTER_PHONE_NUMBER=+1234567890
```

**Generate CRON_SECRET**:
```bash
openssl rand -hex 32
```

PowerShell alternative:
```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

### Add `CRON_SECRET` in Vercel

1. Go to Project **Settings** → **Environment Variables**.
2. Add variable name: `CRON_SECRET`.
3. Paste the generated value.
4. Scope it to **Production**.
5. Redeploy production so the new variable is available.

Notes:
- The cron handlers accept either `CRON_SECRET` or `VERCEL_CRON_SECRET`.
- Use one source of truth (recommended: `CRON_SECRET`).

### Verify cron auth is working

Use the cron page **Run** button or test manually:

```bash
curl -X POST "https://<your-domain>/api/cron/close-resolved-requests" \
  -H "Authorization: Bearer <your-cron-secret>"
```

If the secret is missing or incorrect, the endpoint should return `401 Unauthorized`.

## How It Works

1. **Cron Job Runs** (every 10 minutes by default)
2. **Finds Urgent Requests**:
   - Priority: "Urgent" or "High"
   - Status: "New" or "In Progress"
   - Has assigned vendor
   - Created in last 24 hours
   - No vendor call made yet
3. **For Each Request**:
   - Gets vendor contact information
   - Routes to tester number if `TESTER_PHONE_NUMBER` is set
   - Makes Vapi.ai API call to vendor
   - Updates request with call information
4. **Returns Results**: JSON with processed requests and outcomes

## Request Selection Criteria

The cron job processes requests that meet ALL of these criteria:

- ✅ Priority is "Urgent" or "High"
- ✅ Status is "New" or "In Progress"
- ✅ Has `assigned_vendor_id` (not null)
- ✅ Created within last 24 hours
- ✅ No previous automatic vendor call (checked via `admin_notes`)
- ✅ Vendor has phone number in database

## Call Tracking

The cron job tracks calls by adding notes to `admin_notes`:

```
Vendor called automatically on 2025-01-15T10:30:00Z. Call ID: call_abc123. Call initiated to +1234567890
```

This prevents duplicate calls for the same request.

## Testing

### Test with Tester Phone Number

Set `TESTER_PHONE_NUMBER` to route all vendor calls to your test number:

```env
TESTER_PHONE_NUMBER=+1234567890
```

All vendor calls will go to this number, allowing you to:
- Test the full flow without calling real vendors
- Play the role of vendor during testing
- Verify call quality and conversation flow

### Manual Testing

1. Create a test maintenance request:
   - Priority: "Urgent" or "High"
   - Status: "New"
   - Assign a vendor with a phone number
2. Manually trigger the cron job:
   ```bash
   curl -X POST \
     -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://your-domain.com/api/cron/call-vendors
   ```
3. Check the response for success/failure
4. Verify the request's `admin_notes` was updated

## Monitoring

### Logs

Check Vercel logs for:
- `[Call Vendors Cron]` - All cron job logs
- Success/failure messages
- Error details

### Response Format

The cron job returns:

```json
{
  "success": true,
  "processed": 2,
  "results": [
    {
      "request_id": 123,
      "vendor_id": 456,
      "success": true,
      "callId": "call_abc123"
    },
    {
      "request_id": 124,
      "vendor_id": 457,
      "success": false,
      "error": "No phone number found"
    }
  ]
}
```

## Rate Limiting

The cron job includes a 2-second delay between calls to avoid:
- Vapi.ai rate limiting
- Overwhelming vendors with calls
- Database connection issues

## Cost Considerations

- **Vapi.ai Calls**: ~$0.30-0.60 per call
- **OpenAI API**: Minimal (for system prompts)
- **Database Queries**: Negligible

**Estimated Monthly Cost**: 
- 10 urgent requests/day × 30 days = 300 calls/month
- 300 calls × $0.45 average = ~$135/month

## Security

1. **Authentication**: Cron job requires `CRON_SECRET` in Authorization header
2. **Webhook Verification**: Vapi.ai webhooks are verified (separate from cron)
3. **Phone Number Routing**: Tester routing prevents accidental calls during testing
4. **Rate Limiting**: Built-in delays prevent abuse

## Troubleshooting

### Cron Job Not Running

1. Check Vercel deployment logs
2. Verify cron schedule in `vercel.json`
3. Check if Vercel Pro plan is required
4. Try manual trigger to test endpoint

### No Calls Being Made

1. Check if requests meet criteria (priority, status, vendor assigned)
2. Verify vendor has phone number in database
3. Check `TESTER_PHONE_NUMBER` is set if testing
4. Review logs for specific errors

### Calls Failing

1. Verify `VAPI_API_KEY` is set correctly
2. Check `VAPI_PHONE_NUMBER_ID` is valid
3. Review Vapi.ai API error messages in logs
4. Check vendor phone numbers are valid format

## Future Enhancements

1. **Vendor Preferences**: Allow vendors to set preferred call times
2. **Call Scheduling**: Schedule calls during business hours only
3. **Retry Logic**: Retry failed calls after delay
4. **Call Outcomes**: Track and store appointment details
5. **Notifications**: Notify admins when calls fail

