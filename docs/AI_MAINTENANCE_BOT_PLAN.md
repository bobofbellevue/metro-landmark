# AI Maintenance Bot Implementation Plan

## Executive Summary

We're implementing an AI-powered maintenance request system that will handle tenant maintenance issues through intelligent conversation. The system will assess urgency, route emergencies appropriately, and schedule non-emergency repairs automatically.

## Two-Phase Approach

### Phase 1: Text Chat Bot (Starting Now - 2-3 weeks)
**What it does:**
- Tenants chat with an AI assistant through the tenant portal
- Bot asks questions to understand the maintenance issue
- Bot determines if it's an emergency or routine repair
- Bot automatically finds appropriate vendors and schedules service
- Bot provides clear instructions (e.g., "Call 911" for life-threatening situations)

**Benefits:**
- Available 24/7
- Handles routine requests instantly
- Reduces staff workload
- Lower cost per interaction (~$0.05-0.10 per conversation)

**Cost:** Approximately $5-10 per 100 conversations per month

### Phase 2: Voice Phone Bot (Next - 3-4 weeks after Phase 1)
**What it does:**
- Tenants can call a phone number and speak with the AI
- Same intelligent decision-making as text bot
- Can actually call vendors to schedule appointments
- Better for emergencies when tenants need immediate help

**Benefits:**
- More natural for urgent situations
- Can handle vendor scheduling calls automatically
- Appeals to tenants who prefer phone communication

**Cost:** Approximately $0.30-0.60 per phone call (3-5 minutes average)

## How It Works

### Decision Flow:
1. **Tenant reports issue** → Bot assesses the situation
2. **Life-threatening?** → Bot instructs tenant to call 911
3. **Emergency (fire, flood, no heat)?** → Bot finds approved emergency vendor and connects them
4. **Routine repair?** → Bot schedules service automatically

### Smart Features:
- Matches maintenance issues to appropriate vendors using keywords
- Checks which vendors are approved for emergency service
- Verifies vendor availability and hours
- Creates maintenance requests in our system automatically
- Can call vendors directly to schedule (Phase 2)

## Technology Choices

**Text Bot:** OpenAI GPT-4 (industry-leading AI, same technology behind ChatGPT)
**Voice Bot:** Vapi.ai (specialized voice AI platform designed for phone conversations)

Both platforms are:
- Reliable and battle-tested
- Secure and compliant
- Easy to integrate with our existing system

## Cost Estimate

**Monthly costs (assuming 500 text conversations + 50 phone calls):**
- Text bot: ~$25-50/month
- Voice bot: ~$15-30/month
- **Total: ~$40-80/month**

This replaces significant staff time spent on:
- Answering maintenance calls
- Assessing urgency
- Finding appropriate vendors
- Scheduling appointments

## Timeline

- **Week 1-2:** Text chat bot development and testing
- **Week 3:** Text bot launch and tenant training
- **Week 4-6:** Voice bot development
- **Week 7:** Voice bot launch

## Next Steps

1. Approve Phase 1 (text bot) implementation
2. Review and approve this approach
3. We'll begin development immediately

---

*This system will significantly improve tenant satisfaction while reducing operational costs and staff workload.*

