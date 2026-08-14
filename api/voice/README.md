# Maintenance Voice Bot

This directory contains the implementation of the Maintenance Voice Bot using Vapi.ai.

## Files

- `maintenance-bot.js` - Main Vapi.ai webhook handler
- `vapi-config.js` - Vapi.ai configuration helper and testing utilities
- `maintenance-logic.js` - Shared maintenance logic (reused from text bot)

## Setup

### 1. Environment Variables

Add these to your Vercel environment variables:

```
VAPI_API_KEY=your_vapi_private_api_key
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
VAPI_VOICE_ID=your_11labs_voice_id (optional, has default)
VAPI_SERVER_URL=https://your-domain.com/api/voice/maintenance-bot (optional, auto-detected)
VAPI_WEBHOOK_SECRET=your_webhook_secret (optional but recommended for security)
TESTER_PHONE_NUMBER=+1234567890 (optional, for testing mode - routes all calls to this number)
```

### 2. Vapi.ai Configuration

1. Sign up for Vapi.ai account
2. Get your Private API Key (for `VAPI_API_KEY`)
3. Purchase/configure a phone number in Vapi.ai dashboard
4. Get the Phone Number ID (for `VAPI_PHONE_NUMBER_ID`)
5. Configure webhook URL in Vapi.ai dashboard:
   - Webhook URL: `https://your-domain.com/api/voice/maintenance-bot`
   - Events: Enable all events (status-update, function-call, end-of-call, etc.)
   - **Webhook Secret (Recommended)**: Set a secret in Vapi.ai dashboard (under Organization Settings or Phone Number Settings)
     - Generate a strong random string (e.g., use `openssl rand -hex 32`)
     - Set the same value in Vercel as `VAPI_WEBHOOK_SECRET`
     - This enables HMAC signature verification for webhook security
     - **Note**: If `VAPI_WEBHOOK_SECRET` is not set, webhook verification is skipped (not recommended for production)

### 3. Testing Mode

**TESTER_PHONE_NUMBER**: Set this environment variable to route all calls (tenant, vendor, etc.) to your test number. This allows you to:
- Test tenant calls by calling the bot
- Test vendor calls by having the bot call you
- Test all scenarios without using real phone numbers


## How It Works

### Call Flow

1. **Tenant calls** → Vapi.ai routes to `/api/voice/maintenance-bot`
2. **Call Start** → Bot identifies tenant by phone number, gets unit info
3. **Conversation** → Bot uses GPT-4 to have natural conversation
4. **Function Calls** → Bot calls functions (assess_urgency, find_vendors, create_request, call_vendor)
5. **Vendor Calls** → For emergencies, bot can call vendors directly
6. **Call End** → Transcript saved to `chatbot_conversations` table

### Functions Available

- `assess_urgency` - Assesses urgency level (life_threatening, emergency, urgent, routine)
- `find_emergency_vendors` - Finds approved emergency vendors
- `find_routine_vendors` - Finds vendors for routine issues
- `create_maintenance_request` - Creates maintenance request in database
- `call_vendor` - Makes outbound call to vendor to schedule appointment

### Shared Logic

The voice bot reuses the same logic as the text bot (`maintenance-chat.js`):
- Urgency assessment
- Vendor matching (AI-based semantic matching)
- Maintenance request creation
- Emergency handling

## Integration with Text Bot

Both bots share:
- Same urgency assessment logic
- Same vendor matching algorithm
- Same maintenance request creation
- Same chatbot lessons (when implemented)
- Same conversation storage (`chatbot_conversations` table)

## Cost Estimate

- ~$0.30-0.60 per phone call (3-5 minutes average)
- Uses GPT-4 for conversation
- Uses 11labs for voice synthesis
- Vapi.ai handles phone infrastructure

## Next Steps

1. Configure Vapi.ai account and phone number
2. Set environment variables in Vercel
3. Test with `TESTER_PHONE_NUMBER` set
4. Configure webhook in Vapi.ai dashboard
5. Test end-to-end call flow
6. Deploy and monitor

