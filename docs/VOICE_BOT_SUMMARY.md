# Maintenance Voice Bot - Complete Summary

## Current Status ✅

The maintenance voice bot **already has** the following capabilities:

1. ✅ **Can call vendors directly** to schedule appointments
2. ✅ **Handles emergencies** when tenants need immediate help
3. ✅ **Testing mode** routes all calls to tester number
4. ✅ **Tester can take any role** (vendor, tenant, etc.)

## How Vendor Calling Works

### During Tenant Call (Current Implementation)

When a tenant calls the maintenance bot:

1. **Tenant reports issue** → Bot assesses urgency
2. **Bot finds emergency vendors** → Matches issue to approved vendors
3. **Bot creates maintenance request** → Saves to database
4. **AI decides to call vendor** → Invokes `call_vendor` function
5. **Bot makes separate outbound call** → Calls vendor using Vapi.ai API
6. **Vendor receives call** → Bot schedules appointment
7. **Tenant call ends** → (Tenant is NOT kept on line during vendor call)

**Key Point**: The bot makes a **separate outbound call** to the vendor. The tenant call ends normally, and then the bot calls the vendor separately.

### Automatic Vendor Calling (New - Server-Side Process)

**NEW**: We've added a server-side cron job that automatically calls vendors for urgent requests:

1. **Cron job runs every 10 minutes**
2. **Finds urgent/emergency requests** without vendor contact
3. **Automatically calls assigned vendor** to schedule
4. **Updates request status** with call information

This handles cases where:
- Request was created via text bot (not voice)
- Request was created by admin
- AI didn't call vendor during tenant conversation

**Setup**: See `docs/CRON_JOB_SETUP.md`

## Answering Your Questions

### Q: How would the bot make a call to a vendor?

**A:** The bot uses Vapi.ai's API to make outbound calls. When the AI decides to call a vendor (via the `call_vendor` function), it:

1. Gets vendor phone number from database
2. Routes to tester number if `TESTER_PHONE_NUMBER` is set (for testing)
3. Makes API call to Vapi.ai: `POST https://api.vapi.ai/call`
4. Vapi.ai initiates the phone call to the vendor
5. Bot has a conversation with vendor to schedule appointment

**Code**: `api/voice/maintenance-bot.js` → `callVendor()` function

### Q: Would it keep the tenant on the line, call the vendor, and confirm all around?

**A:** **Currently NO** - The bot makes a **separate outbound call** to the vendor. The tenant call ends normally, and then the bot calls the vendor separately.

**Why?**
- Vapi.ai doesn't natively support 3-way calls or call transfers
- Keeping tenant on hold would increase call costs
- Separate calls allow better tracking and logging

**Future Enhancement**: We could implement a "call back" feature where:
1. Bot tells tenant: "I'll call the vendor now and then call you back to confirm"
2. Bot calls vendor, schedules appointment
3. Bot calls tenant back to confirm details

### Q: Would we need a server-side process to read maintenance requests and make outbound calls?

**A:** **YES - Now Implemented!** 

We've added a server-side cron job (`api/cron/call-vendors.js`) that:
- Runs every 10 minutes
- Finds urgent/emergency requests without vendor contact
- Automatically calls the assigned vendor
- Updates request status

This ensures vendors are called even when:
- Request was created via text bot
- Request was created by admin
- AI didn't call vendor during conversation

**Setup**: See `docs/CRON_JOB_SETUP.md`

### Q: Otherwise, what would trigger the call to the vendor?

**A:** There are now **TWO triggers**:

1. **During Conversation** (Original): The AI decides during the tenant call based on:
   - Urgency level (emergency/urgent)
   - Whether vendor was found
   - Whether tenant wants immediate scheduling
   - Context of the conversation

2. **Automatic Cron Job** (New): Server-side process that:
   - Runs every 10 minutes
   - Finds urgent requests without vendor contact
   - Automatically calls assigned vendors

## Testing Mode

### Tester Phone Number Routing

All calls (tenant, vendor, etc.) are routed to the tester number when `TESTER_PHONE_NUMBER` is set:

```env
TESTER_PHONE_NUMBER=+1234567890
```

**How it works**:
- When bot needs to call a vendor, `routePhoneNumber()` intercepts the vendor's phone number
- Replaces it with the tester number
- Tester receives the call and can play the role of vendor
- Same for tenant calls - all calls go to tester

**Code**: `api/voice/vapi-config.js` → `routePhoneNumber()` function

**Benefits**:
- Test all scenarios without using real phone numbers
- Play multiple roles (tenant, vendor, etc.)
- No risk of calling real vendors during testing

## Files Created/Modified

### New Files

1. **`docs/VOICE_BOT_VENDOR_CALLING.md`** - Detailed explanation of vendor calling
2. **`docs/CRON_JOB_SETUP.md`** - Setup guide for automatic vendor calling
3. **`api/cron/call-vendors.js`** - Server-side cron job for automatic vendor calling
4. **`docs/VOICE_BOT_SUMMARY.md`** - This file (summary)

### Modified Files

1. **`vercel.json`** - Added cron job configuration

## Implementation Details

### Vendor Call Function

**Location**: `api/voice/maintenance-bot.js` → `callVendor()` function

**Parameters**:
- `vendorId` - Vendor ID from database
- `vendorPhone` - Vendor phone number
- `maintenanceRequestId` - Maintenance request ID

**Process**:
1. Routes to tester if `TESTER_PHONE_NUMBER` is set
2. Gets vendor and request details from database
3. Makes Vapi.ai API call
4. Returns call ID and status

### Automatic Vendor Calling Cron Job

**Location**: `api/cron/call-vendors.js`

**Schedule**: Every 10 minutes (configurable)

**Process**:
1. Finds urgent/emergency requests without vendor contact
2. Gets vendor contact information
3. Routes to tester if `TESTER_PHONE_NUMBER` is set
4. Makes Vapi.ai API call
5. Updates request with call information

## Environment Variables

Required:

```env
# Vapi.ai
VAPI_API_KEY=your_vapi_private_api_key
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
VAPI_VOICE_ID=your_11labs_voice_id (optional)

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SECRET_KEY=your_supabase_secret_key

# Testing (optional)
TESTER_PHONE_NUMBER=+1234567890

# Cron Job Security (optional but recommended)
CRON_SECRET=your_random_secret_string
```

## Cost Considerations

- **Tenant Calls**: ~$0.30-0.60 per call (3-5 minutes average)
- **Vendor Calls**: ~$0.30-0.60 per call (3-5 minutes average)
- **Total for Emergency Flow**: ~$0.60-1.20 (tenant call + vendor call)

**Monthly Estimate** (assuming 10 urgent requests/day):
- 10 requests/day × 30 days = 300 calls/month
- 300 calls × $0.45 average = ~$135/month

## Next Steps

1. ✅ **Current**: Vendor calling works during voice bot conversations
2. ✅ **New**: Automatic vendor calling for urgent requests (cron job)
3. ✅ **Planned**: `client_appointments` table for tracking appointments
4. ✅ **Planned**: Tenant notification of appointments via notification preferences
5. ✅ **Planned**: Automatic maintenance request closure when appointment resolves issue
6. 🔄 **Future**: Add vendor preferences and scheduling
7. 🔄 **Future**: Appointment reminder notifications

## Appointments System (Planned)

### Overview

The `client_appointments` table tracks scheduled appointments between tenants and vendors for maintenance requests.

### Key Features

1. **Appointment Tracking**:
   - Scheduled date/time
   - Actual date/time (if different)
   - Status (scheduled, completed, cancelled, no_show, rescheduled, in_progress)
   - Appointment results and notes

2. **Tenant Notifications**:
   - Tenants receive appointment notifications via their preferred channel
   - Uses `user_notification_preferences` system
   - Notifications include: date, time, vendor, issue description

3. **Automatic Request Closure**:
   - When appointment `status = 'completed'` AND `resolved_issue = true`
   - Maintenance request automatically closes
   - `status` → 'Completed'
   - `completed_at` timestamp set

4. **Multiple Appointments**:
   - A maintenance request can have multiple appointments
   - Each tracked separately (assessment, repair, follow-up)

### Integration Points

- **Voice Bot**: Creates appointments when scheduling with vendors
- **Cron Job**: Creates appointments when automatically calling vendors
- **Admin Interface**: Manual appointment creation and management
- **Notification System**: Sends appointment confirmations to tenants

**See**: `docs/APPOINTMENTS_TABLE_DESIGN.md` for schema details
**See**: `docs/APPOINTMENTS_IMPLEMENTATION_PROMPT.md` for implementation guide

## Documentation

- **Detailed Vendor Calling**: `docs/VOICE_BOT_VENDOR_CALLING.md`
- **Cron Job Setup**: `docs/CRON_JOB_SETUP.md`
- **Appointments Table Design**: `docs/APPOINTMENTS_TABLE_DESIGN.md`
- **Appointments Implementation**: `docs/APPOINTMENTS_IMPLEMENTATION_PROMPT.md`
- **Voice Bot README**: `api/voice/README.md`
- **AI Maintenance Bot Plan**: `docs/AI_MAINTENANCE_BOT_PLAN.md`

## Support

For questions or issues:
1. Check the documentation files above
2. Review Vercel logs for errors
3. Test with `TESTER_PHONE_NUMBER` set
4. Verify environment variables are set correctly

