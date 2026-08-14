# Voice Bot Vendor Calling - How It Works

## Overview

The maintenance voice bot can call vendors directly to schedule appointments. This document explains how it works, answers common questions, and describes the implementation.

## Current Implementation

### How Vendor Calls Work

1. **During Tenant Call**: When a tenant calls the maintenance bot and reports an emergency or urgent issue:
   - The bot assesses urgency
   - Finds appropriate emergency vendors
   - Creates a maintenance request
   - **The AI can decide to call a vendor immediately** by invoking the `call_vendor` function

2. **Vendor Call Process**:
   - The bot makes a **separate outbound call** to the vendor (does NOT keep tenant on the line)
   - Uses Vapi.ai's API to initiate the call
   - The vendor receives a call from the bot
   - Bot explains the maintenance issue and schedules an appointment
   - Call is logged and tracked

### Current Flow

```
Tenant Calls Bot
    ↓
Bot Assesses Urgency
    ↓
Bot Finds Emergency Vendors
    ↓
Bot Creates Maintenance Request
    ↓
Bot Decides: "Should I call vendor now?"
    ↓
If Yes → Bot Makes Outbound Call to Vendor (separate call)
    ↓
Vendor Receives Call, Schedules Appointment
    ↓
Tenant Call Ends (tenant is NOT kept on line during vendor call)
```

## Answering Your Questions

### Q: How would the bot make a call to a vendor?

**A:** The bot uses Vapi.ai's API to make outbound calls. When the AI decides to call a vendor (via the `call_vendor` function), it:
1. Gets vendor phone number from database
2. Routes to tester number if `TESTER_PHONE_NUMBER` is set (for testing)
3. Makes API call to Vapi.ai: `POST https://api.vapi.ai/call`
4. Vapi.ai initiates the phone call to the vendor
5. Bot has a conversation with vendor to schedule appointment

**Code Location**: `api/voice/maintenance-bot.js` → `callVendor()` function (line 2419)

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

**A:** **Currently NO** - Vendor calls are triggered **during the conversation** when the AI decides to call. However, we **should add** a server-side process for:

1. **Urgent requests created outside voice bot** (text bot, admin interface)
2. **Automatic vendor calling** for emergency requests
3. **Scheduled follow-ups** for urgent requests without vendor contact

**Implementation**: We can add a Vercel Cron Job or webhook that:
- Monitors `maintenance_requests` table for new urgent/emergency requests
- Checks if vendor hasn't been contacted yet
- Automatically calls vendor to schedule

### Q: Otherwise, what would trigger the call to the vendor?

**A:** Currently, the **AI decides during the conversation** based on:
- Urgency level (emergency/urgent)
- Whether vendor was found
- Whether tenant wants immediate scheduling
- Context of the conversation

The AI has access to the `call_vendor` function and can invoke it when appropriate.

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

**Code Location**: `api/voice/vapi-config.js` → `routePhoneNumber()` function

## Implementation Details

### Function Definition

The `call_vendor` function is defined in `api/voice/vapi-config.js`:

```javascript
{
  name: 'call_vendor',
  description: 'Call a vendor directly to schedule an appointment. Use this for emergency or urgent situations when immediate vendor contact is needed.',
  parameters: {
    vendorId: number,
    vendorPhone: string,
    maintenanceRequestId: number
  }
}
```

### Function Handler

The handler is in `api/voice/maintenance-bot.js`:

```javascript
async function callVendor(vendorId, vendorPhone, maintenanceRequestId, callId, supabase) {
  // Routes to tester if TESTER_PHONE_NUMBER is set
  const actualPhone = routePhoneNumber(vendorPhone);
  
  // Gets vendor and request details
  // Makes Vapi.ai API call
  // Returns call ID and status
}
```

### Vendor Call System Prompt

When calling a vendor, the bot uses this system prompt:

```
You are calling a vendor to schedule a maintenance appointment.

Maintenance Request Details:
- Issue: [description]
- Priority: [priority]
- Unit: [unit_number]
- Property Type: [property_type]

Vendor Information:
- Company: [company_name]
- Description: [description]

Your goal is to:
1. Introduce yourself as calling from the property management company
2. Explain the maintenance issue briefly
3. Ask if they can schedule a service appointment
4. Get a preferred date/time if possible
5. Confirm contact information
6. Thank them and end the call politely
```

## Recommended Enhancements

### 1. Automatic Vendor Calling for Urgent Requests

Add a server-side process (Vercel Cron Job) that:
- Runs every 5-10 minutes
- Finds urgent/emergency requests without vendor contact
- Automatically calls the assigned vendor
- Updates request status

**Implementation**: Create `api/cron/call-vendors.js`

### 2. Tenant Notification of Appointments

**IMPLEMENTED**: When an appointment is scheduled:
1. Bot calls vendor and schedules appointment
2. Appointment is saved to `client_appointments` table
3. Tenant is notified according to their `user_notification_preferences`:
   - Email notification
   - SMS notification
   - Phone call notification
   - In-app notification
4. Notification includes appointment details (date, time, vendor, issue)

**Integration**: Uses the notification preferences system to send appointment confirmations via the tenant's preferred channel.

### 3. Vendor Call Scheduling

Allow vendors to:
- Set preferred call times
- Set availability windows
- Opt-in/opt-out of automated calls

### 4. Appointment Tracking and Management

**IMPLEMENTED**: The `client_appointments` table tracks:
- Scheduled appointment times
- Appointment status (scheduled, completed, cancelled, no_show, etc.)
- Appointment outcomes and results
- Whether the appointment resolved the maintenance issue
- Automatic maintenance request closure when `resolved_issue = true`

**See**: `docs/APPOINTMENTS_TABLE_DESIGN.md` for full schema and integration details.

## Environment Variables

Required for vendor calling:

```env
VAPI_API_KEY=your_vapi_private_api_key
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
VAPI_VOICE_ID=your_11labs_voice_id (optional)
TESTER_PHONE_NUMBER=+1234567890 (optional, for testing)
```

## Cost Considerations

- **Vendor Calls**: ~$0.30-0.60 per call (3-5 minutes average)
- **Tenant Calls**: ~$0.30-0.60 per call
- **Total for Emergency Flow**: ~$0.60-1.20 (tenant call + vendor call)

## Security

- All calls are logged in `chatbot_conversations` table
- Vendor phone numbers are validated
- Tester routing prevents accidental calls to real vendors during testing
- Webhook signature verification for Vapi.ai webhooks

## Next Steps

1. ✅ **Current**: Vendor calling works during voice bot conversations
2. 🔄 **Recommended**: Add automatic vendor calling for urgent requests created outside voice bot
3. 🔄 **Future**: Implement call-back feature for tenant confirmation
4. 🔄 **Future**: Add vendor preferences and scheduling

