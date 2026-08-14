import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import crypto from 'crypto';
import { getVapiConfig, isDebugMode, isGlobalAdminPhone, routePhoneNumber, getGlobalAdminPhones } from './vapi-config.js';
import {
  assessUrgency,
  findEmergencyVendors,
  findRoutineVendors,
  createMaintenanceRequest,
  getUserUnitInfo,
  getUserIdForUnit,
  findUnitByPropertyNameAndUnit,
  findUnitByAddress,
  findPropertiesByName,
  findUserByNameAndBirthdate,
  findResponsiblePersonByNameAndLocation,
  getResponsiblePersonPhone,
  getResponsiblePersonNamesForUnit
} from './maintenance-logic.js';

/**
 * Verify Vapi.ai webhook signature (HMAC)
 * Vapi.ai sends webhook requests with HMAC authentication configured as:
 * - Signature Header: x-signature
 * - Timestamp Header: x-timestamp
 * - Payload Format: {timestamp}.{body}
 * - Algorithm: SHA256
 * - Signature Encoding: Hex
 */
function verifyVapiSignature(req, secret) {
  if (!secret) {
    // If no secret is configured, skip verification (not recommended for production)
    console.warn('[Voice Bot] VAPI_WEBHOOK_SECRET not set - skipping signature verification');
    return true;
  }

  // Check for signature header (Vapi.ai uses 'x-signature' for HMAC authentication)
  const signature = req.headers['x-signature'] || 
                    req.headers['X-Signature'] ||
                    // Fallback to old header names for backward compatibility
                    req.headers['x-vapi-signature'] || 
                    req.headers['X-Vapi-Signature'] ||
                    req.headers['x-vapi-signature-256'] ||
                    req.headers['X-Vapi-Signature-256'];
  
  if (!signature) {
    // If secret is set but no signature header is present, log warning but allow request
    // This handles cases where Vapi.ai doesn't send signatures (test calls, unconfigured webhooks)
    console.warn('[Voice Bot] VAPI_WEBHOOK_SECRET is set but no signature header found. Allowing request but consider configuring webhook secret in Vapi.ai dashboard.');
    console.log('[Voice Bot] Available headers:', Object.keys(req.headers).filter(h => 
      h.toLowerCase().includes('signature') || 
      h.toLowerCase().includes('timestamp') || 
      h.toLowerCase().includes('vapi')
    ));
    return true; // Allow request if signature header is missing
  }

  try {
    // Get timestamp header (required for HMAC with timestamp)
    const timestamp = req.headers['x-timestamp'] || req.headers['X-Timestamp'];
    
    // Get raw body (Vercel serverless functions provide body as string or buffer)
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    
    // Vapi.ai HMAC format: {timestamp}.{body}
    // If timestamp is present, use the format; otherwise, just use body
    const payload = timestamp ? `${timestamp}.${body}` : body;
    
    // Calculate expected signature using SHA256
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    // Compare signatures (use constant-time comparison to prevent timing attacks)
    // Remove any prefixes (e.g., 'sha256=')
    const providedSignature = signature.replace(/^sha256=/, '').trim();
    
    // Ensure both signatures are the same length for timing-safe comparison
    if (expectedSignature.length !== providedSignature.length) {
      console.error('[Voice Bot] Signature length mismatch', {
        expected: expectedSignature.length,
        provided: providedSignature.length
      });
      return false;
    }
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(providedSignature)
    );
    
    if (!isValid) {
      console.error('[Voice Bot] Signature verification failed', {
        hasTimestamp: !!timestamp,
        payloadLength: payload.length
      });
    }
    
    return isValid;
  } catch (error) {
    console.error('[Voice Bot] Error verifying signature:', error);
    return false;
  }
}

export default async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vapi-signature, x-vapi-signature-256');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook signature if secret is configured
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (webhookSecret && !verifyVapiSignature(req, webhookSecret)) {
    console.error('[Voice Bot] Invalid webhook signature - request rejected');
    return res.status(401).json({ error: 'Unauthorized: Invalid webhook signature' });
  }

  // Check for required environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error: OpenAI API key is missing' });
  }

  if (!process.env.VAPI_API_KEY) {
    console.error('VAPI_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error: Vapi.ai API key is missing' });
  }

  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
    console.error('Supabase credentials are not set');
    return res.status(500).json({ 
      error: 'Server configuration error: Database credentials are missing' 
    });
  }

  // Initialize clients
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey
  );

  try {
    const event = req.body;

    // Vapi.ai webhook events can be at event.type or event.message.type
    const eventType = event.type || event.message?.type || 'unknown';
    
    // Check if this is a direct function call request (not a webhook event)
    // Vapi.ai may send function calls as direct POST requests to the server URL
    // Check for function call indicators in the request body
    const hasDirectFunctionCall = event.functionCall || 
                                  event.message?.functionCall ||
                                  (event.toolCalls && event.toolCalls.length > 0) ||
                                  (event.message?.toolCalls && event.message.toolCalls.length > 0) ||
                                  (event.message?.toolCallList && event.message.toolCallList.length > 0);
    
    // If we detect a function call but eventType is not 'function-call', treat it as a direct function call
    if (hasDirectFunctionCall && eventType !== 'function-call') {
      console.log('[Voice Bot] Direct function call request detected (not webhook event)', {
        eventType,
        hasFunctionCall: !!event.functionCall,
        hasMessageFunctionCall: !!event.message?.functionCall,
        hasToolCalls: !!event.toolCalls,
        hasMessageToolCalls: !!event.message?.toolCalls,
        hasMessageToolCallList: !!event.message?.toolCallList
      });
      return await handleFunctionCall(event, res, supabase, openai);
    }
    
    // Handle events - check both top-level and nested message structure
    switch (eventType) {
      case 'status-update':
        return handleStatusUpdate(event, res);
      
      case 'function-call':
        console.log('[Voice Bot] Function call event received');
        return await handleFunctionCall(event, res, supabase, openai);
      
      case 'end-of-call':
      case 'end-of-call-report':
        console.log('[Voice Bot] Received event: end-of-call-report');
        return handleEndOfCall(event, res, supabase);
      
      case 'hang':
        return handleHang(event, res);
      
      case 'transcript':
        return handleTranscript(event, res, supabase);
      
      case 'assistant-request':
        // This is the initial request for assistant configuration
        return handleCallStart(event, res, supabase, openai);
      
      case 'speech-update':
      case 'conversation-update':
        // Ignore speech-update and conversation-update events - these are frequent status updates
        // during the call and not useful for logging or processing
        // Return immediately without logging to reduce log noise
        // Note: These events are sent by Vapi.ai and cannot be disabled via assistant configuration.
        // Assistant hooks (https://docs.vapi.ai/assistants/assistant-hooks) can handle events but don't filter webhook subscriptions.
        // Webhook subscriptions may be configurable in the Vapi.ai dashboard (Phone Number or Account settings).
        // However, Vercel will still log POST 200 requests (these are HTTP infrastructure logs, not application logs)
        return res.status(200).json({ success: true });
      
      default:
        // For other events or initial call setup, return Vapi.ai configuration
        // Only log if it's not a filtered event type
        if (eventType !== 'unknown') {
          console.log('[Voice Bot] Received event:', eventType);
        }
        return handleCallStart(event, res, supabase, openai);
    }
  } catch (error) {
    console.error('[Voice Bot] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Normalize phone number to try multiple formats for matching
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  // Remove all non-digits
  const digitsOnly = phone.replace(/\D/g, '');
  // Remove leading 1 if present (US country code)
  const withoutCountryCode = digitsOnly.startsWith('1') && digitsOnly.length === 11 
    ? digitsOnly.substring(1) 
    : digitsOnly;
  return withoutCountryCode;
}

/**
 * Find user by phone number - tries multiple formats
 */
async function findUserByPhone(supabase, phoneNumber) {
  if (!phoneNumber) return null;

  const normalized = normalizePhoneNumber(phoneNumber);
  console.log('[Voice Bot] [PHONE_LOOKUP] Searching for phone:', { original: phoneNumber, normalized });

  // Try multiple phone number formats
  const formattedNormalized = normalized && normalized.length === 10 
    ? `${normalized.substring(0, 3)}-${normalized.substring(3, 6)}-${normalized.substring(6)}`
    : null;
  
  const searchFormats = [
    normalized, // Digits only (e.g., 2062316249)
    `+1${normalized}`, // E.164 with country code
    `1${normalized}`, // With country code, no +
    formattedNormalized, // Formatted with dashes (e.g., 425-985-6866)
    phoneNumber, // Original format as received
  ].filter(Boolean);
  
  console.log('[Voice Bot] [PHONE_LOOKUP] Will search with formats:', searchFormats);

  // Helper to add timeout to queries
  const withTimeout = (promise, ms = 1000) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), ms)
      )
    ]).catch(() => null);
  };

  // PRIORITY 1: Look for tenant/client matches first (contactable_type='client')
  // Note: Clients/tenants use contactable_type='client', not 'tenant'
  // Use a single query with IN condition for all formats to reduce query count
  try {
    // Use .in() for exact matches across all formats
    const tenantQuery = supabase
      .from('contact_methods')
      .select('contact_id, method_type, value, contacts!inner(contactable_id, contactable_type)')
      .eq('contacts.contactable_type', 'client')
      .in('value', searchFormats);
    
    console.log('[Voice Bot] [PHONE_LOOKUP] Executing client/tenant query with formats:', searchFormats);
    const tenantResult = await withTimeout(tenantQuery, 1500);
    
    console.log('[Voice Bot] [PHONE_LOOKUP] Tenant query result:', {
      hasData: !!tenantResult?.data,
      dataLength: tenantResult?.data?.length || 0,
      hasError: !!tenantResult?.error,
      error: tenantResult?.error?.message || null,
      sampleData: tenantResult?.data?.slice(0, 2).map(m => ({
        value: m.value,
        method_type: m.method_type,
        contactable_id: m.contacts?.contactable_id,
        contactable_type: m.contacts?.contactable_type
      })) || null
    });
    
    if (tenantResult?.data && tenantResult.data.length > 0) {
      const tenantMatches = tenantResult.data;
      
      if (tenantMatches.length > 1) {
        console.log('[Voice Bot] [PHONE_LOOKUP] Found multiple tenant matches:', {
          count: tenantMatches.length,
          matches: tenantMatches.map(m => ({
            client_id: m.contacts?.contactable_id,
            value: m.value
          }))
        });
      }
      
      // For client contacts, contactable_id is the user_id (not client_id)
      // So we can use it directly, but verify the user has a client record
      const userIds = tenantMatches.map(m => m.contacts.contactable_id);
      console.log('[Voice Bot] [PHONE_LOOKUP] Found client contacts with user IDs:', userIds);
      
      // Verify these users have client records
      const clientsQuery = supabase
        .from('clients')
        .select('client_id, user_id')
        .in('user_id', userIds);
      
      const clientsResult = await withTimeout(clientsQuery, 1000);
      
      console.log('[Voice Bot] [PHONE_LOOKUP] Clients query result:', {
        hasData: !!clientsResult?.data,
        dataLength: clientsResult?.data?.length || 0,
        hasError: !!clientsResult?.error,
        error: clientsResult?.error?.message || null,
        clients: clientsResult?.data || null
      });
      
      if (clientsResult?.data && clientsResult.data.length > 0) {
        const userIdsWithClients = new Set(clientsResult.data.map(c => c.user_id));
        const tenantMatch = tenantMatches.find(m => userIdsWithClients.has(m.contacts.contactable_id));
        
        if (tenantMatch) {
          const userId = tenantMatch.contacts.contactable_id; // contactable_id IS the user_id for client contacts
          console.log('[Voice Bot] [PHONE_LOOKUP_SUCCESS] Found tenant/client match:', { 
            method_type: tenantMatch.method_type,
            value: tenantMatch.value,
            user_id: userId,
            client_id: clientsResult.data.find(c => c.user_id === userId)?.client_id
          });
          return { contactable_id: userId, contactable_type: 'user' };
        }
      }
    }
  } catch (error) {
    console.log('[Voice Bot] [PHONE_LOOKUP] Error in tenant lookup:', error.message);
  }

  // PRIORITY 2: Fall back to direct user matches, but ONLY if they have a client/tenant record
  try {
    const userQuery = supabase
      .from('contact_methods')
      .select('contact_id, method_type, value, contacts!inner(contactable_id, contactable_type)')
      .eq('contacts.contactable_type', 'user')
      .in('value', searchFormats);
    
    console.log('[Voice Bot] [PHONE_LOOKUP] Executing user query with formats:', searchFormats);
    const userResult = await withTimeout(userQuery, 1500);
    
    console.log('[Voice Bot] [PHONE_LOOKUP] User query result:', {
      hasData: !!userResult?.data,
      dataLength: userResult?.data?.length || 0,
      hasError: !!userResult?.error,
      error: userResult?.error?.message || null,
      sampleData: userResult?.data?.slice(0, 2).map(m => ({
        value: m.value,
        method_type: m.method_type,
        contactable_id: m.contacts?.contactable_id,
        contactable_type: m.contacts?.contactable_type
      })) || null
    });
    
    if (userResult?.data && userResult.data.length > 0) {
      const userMatches = userResult.data;
      const userIds = userMatches.map(m => m.contacts.contactable_id);
      
      console.log('[Voice Bot] [PHONE_LOOKUP] Looking up clients for user IDs:', userIds);
      
      // Check which users have client/tenant records in one query
      const clientsQuery = supabase
        .from('clients')
        .select('user_id')
        .in('user_id', userIds);
      
      const clientsResult = await withTimeout(clientsQuery, 1000);
      
      console.log('[Voice Bot] [PHONE_LOOKUP] Clients query result (for users):', {
        hasData: !!clientsResult?.data,
        dataLength: clientsResult?.data?.length || 0,
        hasError: !!clientsResult?.error,
        error: clientsResult?.error?.message || null,
        clients: clientsResult?.data || null
      });
      
      if (clientsResult?.data && clientsResult.data.length > 0) {
        const userIdsWithClients = new Set(clientsResult.data.map(c => c.user_id));
        const userMatch = userMatches.find(m => userIdsWithClients.has(m.contacts.contactable_id));
        
        if (userMatch) {
          console.log('[Voice Bot] [PHONE_LOOKUP_SUCCESS] Found user match with tenant record:', { 
            method_type: userMatch.method_type,
            value: userMatch.value,
            user_id: userMatch.contacts.contactable_id
          });
          return userMatch.contacts;
        }
      }
    }
  } catch (error) {
    console.log('[Voice Bot] [PHONE_LOOKUP] Error in user lookup:', {
      message: error.message,
      stack: error.stack,
      error: error
    });
  }

  // Debug: Check if phone exists in database at all (any format, any type)
  try {
    const debugQuery = supabase
      .from('contact_methods')
      .select('method_type, value, contacts!inner(contactable_id, contactable_type)')
      .or(`value.eq.${normalized},value.eq.${formattedNormalized || ''},value.like.%${normalized.substring(normalized.length - 7)}%`)
      .limit(10);
    
    const debugResult = await withTimeout(debugQuery, 1000);
    
    console.log('[Voice Bot] [PHONE_LOOKUP_DEBUG] Any contact_methods with similar phone:', {
      hasData: !!debugResult?.data,
      dataLength: debugResult?.data?.length || 0,
      hasError: !!debugResult?.error,
      error: debugResult?.error?.message || null,
      matches: debugResult?.data?.map(m => ({
        value: m.value,
        method_type: m.method_type,
        contactable_id: m.contacts?.contactable_id,
        contactable_type: m.contacts?.contactable_type
      })) || null
    });
  } catch (debugError) {
    console.log('[Voice Bot] [PHONE_LOOKUP_DEBUG] Error in debug query:', debugError.message);
  }

  console.log('[Voice Bot] [PHONE_LOOKUP_FAILED] No user found for phone number after all attempts:', {
    original: phoneNumber,
    normalized,
    searchFormats
  });
  return null;
}

// Handle call start - return Vapi.ai assistant configuration
async function handleCallStart(event, res, supabase, openai) {
  try {
    // Extract caller phone number - Vapi.ai sends it in different fields depending on event structure
    // Check both top-level and nested message structure
    const callerPhone = event.message?.customer?.number ||
                       event.message?.call?.customer?.number ||
                       event.customer?.number ||
                       event.call?.customer?.number ||
                       event.from || 
                       event.phoneNumber || 
                       event.caller?.phoneNumber ||
                       event.call?.from;

    console.log('[Voice Bot] Call start event:', JSON.stringify(event, null, 2));
    console.log('[Voice Bot] Extracted caller phone:', callerPhone);

    // DEBUG_MODE: Check if caller is Global Admin
    if (isDebugMode()) {
      if (!callerPhone) {
        console.log('[DEBUG_MODE] No caller phone - rejecting call');
        return res.status(200).json({
          assistant: {
            model: {
              provider: 'openai',
              model: 'gpt-4',
              messages: [{
                role: 'system',
                content: 'You are Kate, a maintenance assistant. Debug mode is active. Only Global Admins may initiate calls.'
              }],
              temperature: 0.7
            },
            voice: {
              provider: '11labs',
              voiceId: process.env.VAPI_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
              // Voice settings to improve volume and consistency
              stability: 0.9,           // High stability for consistent, clear output (0-1)
              similarityBoost: 0.8,     // High similarity for clear voice matching (0-1)
              style: 0.0,              // Low style to prevent volume variations (0-1)
              useSpeakerBoost: true,   // Boost speaker clarity and volume
              speed: 1.0               // Normal speaking speed (0.7-1.2)
            },
            firstMessage: 'Debug mode is active. Only a Global Admin may initiate this call.'
          }
        });
      }
      
      const isAdmin = await isGlobalAdminPhone(supabase, callerPhone);
      if (!isAdmin) {
        console.log('[DEBUG_MODE] Caller is not a Global Admin - rejecting call');
        return res.status(200).json({
          assistant: {
            model: {
              provider: 'openai',
              model: 'gpt-4',
              messages: [{
                role: 'system',
                content: 'You are Kate, a maintenance assistant. Debug mode is active. Only Global Admins may initiate calls.'
              }],
              temperature: 0.7
            },
            voice: {
              provider: '11labs',
              voiceId: process.env.VAPI_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
              // Voice settings to improve volume and consistency
              stability: 0.9,           // High stability for consistent, clear output (0-1)
              similarityBoost: 0.8,     // High similarity for clear voice matching (0-1)
              style: 0.0,              // Low style to prevent volume variations (0-1)
              useSpeakerBoost: true,   // Boost speaker clarity and volume
              speed: 1.0               // Normal speaking speed (0.7-1.2)
            },
            firstMessage: 'Debug mode is active. Only a Global Admin may initiate this call.'
          }
        });
      }
      
      console.log('[DEBUG_MODE] Caller is a Global Admin - allowing call');
    }

    // If no phone number, still allow the call (might be a test call or different event type)
    let userId = null;
    let unitId = null;
    let propertyId = null;
    let userEmail = null;
    let unitDisplay = null;

    if (callerPhone) {
      // Find user by phone number with timeout to avoid blocking the response
      // Only do this once - don't duplicate the lookup
      console.log('[Voice Bot] [CALL_START] [PHONE_LOOKUP_START] Looking up user from phone number:', {
        callerPhone,
        callId: event.call?.id
      });
      try {
        const lookupPromise = findUserByPhone(supabase, callerPhone);
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 3000)); // 3 second timeout
        const contact = await Promise.race([lookupPromise, timeoutPromise]);
        
        if (contact) {
          // Handle both 'user' and 'tenant' contactable types
          if (contact.contactable_type === 'user') {
            userId = contact.contactable_id;
            console.log('[Voice Bot] [CALL_START] [PHONE_LOOKUP_SUCCESS] Found user ID from phone:', {
              userId,
              contactable_id: contact.contactable_id,
              contactable_type: contact.contactable_type,
              phoneUsed: callerPhone
            });
          } else if (contact.contactable_type === 'client') {
            // Get the user_id from the client record
            try {
              const clientPromise = supabase
                .from('clients')
                .select('user_id')
                .eq('client_id', contact.contactable_id)
                .maybeSingle();
              const clientTimeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), 2000));
              const { data: client, error: clientError } = await Promise.race([clientPromise, clientTimeoutPromise]);
              
              if (!clientError && client?.user_id) {
                userId = client.user_id;
                console.log('[Voice Bot] [CALL_START] [PHONE_LOOKUP_SUCCESS] Found user ID from tenant contact:', {
                  userId,
                  tenant_contactable_id: contact.contactable_id,
                  contactable_type: contact.contactable_type,
                  phoneUsed: callerPhone
                });
              } else {
                console.log('[Voice Bot] [CALL_START] [PHONE_LOOKUP_FAILED] Found tenant contact but no user_id in clients table:', {
                  phoneSearched: callerPhone,
                  tenant_contactable_id: contact.contactable_id,
                  clientError: clientError?.message
                });
              }
            } catch (clientLookupError) {
              console.warn('[Voice Bot] [CALL_START] Error looking up user_id from tenant contact:', clientLookupError.message);
            }
          }
          
          // If we found a userId, get user info and unit info
          if (userId) {
            // Get user info (with timeout)
            try {
              const userPromise = supabase
                .from('users')
                .select('email, role')
                .eq('user_id', userId)
                .single();
              const userTimeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), 2000));
              const { data: user, error: userError } = await Promise.race([userPromise, userTimeoutPromise]);
              
              if (!userError && user) {
                userEmail = user.email;
                console.log('[Voice Bot] [CALL_START] Found user:', { userId, email: userEmail });
                
                // Get user's active unit (with timeout)
                try {
                  const unitPromise = getUserUnitInfo(supabase, userId);
                  const unitTimeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 2000));
                  const unitInfo = await Promise.race([unitPromise, unitTimeoutPromise]);
                  if (unitInfo) {
                    unitId = unitInfo.unitId;
                    propertyId = unitInfo.propertyId;
                    unitDisplay = unitInfo.unitDisplay || null;
                    console.log('[Voice Bot] [CALL_START] Found unit:', { unitId, propertyId, unitDisplay });
                  } else {
                    console.log('[Voice Bot] [CALL_START] [WARNING] User found but no unit info:', { userId });
                  }
                } catch (unitError) {
                  console.warn('[Voice Bot] [CALL_START] Error getting unit info:', unitError.message);
                }
              }
            } catch (userError) {
              console.warn('[Voice Bot] [CALL_START] Error getting user info:', userError.message);
            }
          }
        } else {
          console.log('[Voice Bot] [CALL_START] [PHONE_LOOKUP_FAILED] No contact found:', {
            phoneSearched: callerPhone
          });
        }
      } catch (lookupError) {
        console.warn('[Voice Bot] [CALL_START] [PHONE_LOOKUP_ERROR] Error in user lookup:', {
          error: lookupError.message,
          phoneSearched: callerPhone
        });
        // Continue without user info - not critical for call to proceed
      }
    }

    // If user not found, that's okay - bot will ask for identification
    if (!userId) {
      console.log('[Voice Bot] [CALL_START] User not found by phone - call will proceed, bot will ask for identification if needed');
    } else {
      console.log('[Voice Bot] [CALL_START] [SUCCESS] Call initialized with user context:', {
        userId,
        unitId,
        propertyId,
        userEmail
      });
    }

    // Build system prompt (similar to text bot but adapted for voice)
    // Log unitDisplay before using it in system prompt to check for "#"
    console.log('[Voice Bot] [CALL_START] [SYSTEM_PROMPT_PREP]', {
      unitDisplay,
      hasHashInUnitDisplay: unitDisplay ? unitDisplay.includes('#') : false,
      unitId,
      propertyId,
      userId
    });
    
    const systemPrompt = `You are Kate, a helpful maintenance assistant for a property management company. You're speaking with a tenant over the phone.

Your role is to:
1. IDENTIFY THE CALLER FIRST - This is important! If the caller is not identified by phone number, you must identify them before proceeding.
2. Understand maintenance issues by asking clarifying questions BEFORE taking action
3. Assess urgency (life-threatening, emergency, urgent, or routine)
4. For life-threatening situations, instruct the tenant to call 911 immediately
5. For emergencies (immediate danger, active flooding, electrical sparking), find approved emergency vendors and provide their contact information or connect them directly
6. For urgent issues (needs attention soon but not immediately dangerous), ask clarifying questions to understand the full scope before creating a maintenance request
7. For routine issues, gather information through conversation and create maintenance requests
8. Be empathetic, clear, and professional
9. Speak naturally and conversationally - this is a phone call, not a text chat
10. Keep responses concise for phone conversation (2-3 sentences max per turn)
11. NEVER create a maintenance request without first understanding the full issue
12. BEFORE creating a maintenance request, you MUST explain what you will do and ask for the user's confirmation
13. After creating a maintenance request, ALWAYS provide a summary and next steps
14. PROVIDE CONTACT INFORMATION - If a verified tenant asks for the phone number of the person responsible for their property (property manager, company admin, or property owner), use get_responsible_person_phone. This is only available to verified tenants. If they specifically ask for the property owner's phone number, set return_owner_only to true.

CALLER IDENTIFICATION FLOW (follow this sequence exactly):
1. PHONE NUMBER IDENTIFICATION (automatic):
   - Check the Current context section above. If it shows "User ID: [number]" AND "Unit: [unit info]" (not "Not yet identified"), then the caller is ALREADY IDENTIFIED by phone number
   - If ALREADY IDENTIFIED: You have their tenant and unit info - SKIP ALL IDENTIFICATION STEPS (steps 2-5) and proceed directly to helping with their maintenance request
   - If NOT identified by phone number (Current context shows "Not yet identified"), continue to step 2

2. ASK IF CALLER IS RESPONSIBLE PERSON:
   - Ask: "Are you the person responsible for this property?"
   - If they answer YES, go to step 3
   - If they answer NO, go to step 4

3. IF CALLER IS RESPONSIBLE PERSON:
   - Ask for location first: "What's your property name or address?"
   - Use identify_caller_by_location with property_name, unit_number, or address
   - If match fails: The function will return the address it heard. Read it back to the caller: "I heard the address as [address]. Is that correct?" If they say no or correct it, use identify_caller_by_location again with the corrected information.
   - If location match succeeds: The function will return responsiblePersons array with names of responsible adults for that unit.
     * If there are multiple responsible persons, ask: "Whom am I speaking to?" to get their name.
     * If there is one responsible person, ask: "Am I speaking to [First Last]?" using the name from responsiblePersons.
     * After confirming the person, ask for their date of birth: "What's your date of birth?" for verification.
     * Accept dates in any format (e.g., "May 15th 1990", "5/15/1990", "05-15-1990", "September 1, 1989")
     * Use identify_caller_by_name_and_birthdate with first_name, last_name, date_of_birth
     * If they answer "No" to "Am I speaking to [name]?" or don't know the birth date, ask: "What's your name?" and proceed with collecting the damage report without verification. Do NOT give out any private information (such as about the owner) to an unverified stranger, but DO collect the damage report.
   - If location identification fails, ask for: "I'll need your first name, last name, and date of birth to verify your identity."
   - Accept dates in any format (e.g., "May 15th 1990", "5/15/1990", "05-15-1990")
   - Use identify_caller_by_name_and_birthdate with first_name, last_name, date_of_birth
   - If match fails: "Could you spell your last name for me? And what's your date of birth?"
   - Try again with spelled name
   - If still no match, ask for email as fallback, then proceed to maintenance request

4. IF CALLER IS NOT RESPONSIBLE PERSON (stranger):
   - Ask for responsible person's name: "What's the first and last name of the person responsible for the property?"
   - Ask for location: "What's the property name or address?"
   - Try property name first (partial matching, e.g., "Wuthering Heights" matches "Wuthering Heights Apartments")
   - If multiple properties match, ask for clarification: "Is that [property name] in [city, state]?"
   - If property has multiple units, ask: "What's the unit number?"
   - Use identify_responsible_person_by_name_and_location with first_name, last_name, property_name (or address), unit_number
   - If match fails: The function will return the address it heard. Read it back to the caller and ask if it's correct. If they say no or correct it, use identify_responsible_person_by_name_and_location again with the corrected information.
   - After finding responsible person, ask for caller info: "What's your name?" and "What's your relationship to [responsible person]?"
   - Store caller_name and caller_relationship for the maintenance request notes

5. IF ALL IDENTIFICATION FAILS:
   - Continue with the call and create an unassigned maintenance request
   - Include caller information (name, relationship, phone) in the request description
   - Inform caller: "I'll create an unassigned maintenance request. An administrator will review it and contact you."

IMPORTANT CONVERSATION RULES: 
- For urgent issues, you MUST ask AT LEAST 2-3 clarifying questions across multiple conversation turns before proposing to create a request
- Example questions for urgent issues: "How fast is the leak?", "Is water spreading?", "Can you turn off the water?", "Where exactly is the leak?", "How long has this been happening?", "Is it getting worse?"
- CRITICAL: Before calling create_maintenance_request, you MUST first explain what you will do (description, priority level) and ask "Would you like me to create this maintenance request?" or "Should I proceed with creating this request?"
- Only call create_maintenance_request after the user has explicitly confirmed (e.g., "yes", "go ahead", "please do", "confirm", "proceed")
- BEFORE creating a maintenance request, you MUST ask the tenant: "Do you have any dates and times you prefer or must avoid for scheduling the repair?" Collect their response about scheduling preferences BEFORE calling create_maintenance_request. The scheduling preferences will be included in the request when it is created.
- After creating a request, provide a clear summary: what was reported, what will happen next, and when they can expect follow-up
- Always end with an invitation for the user to ask questions or report additional issues
- Keep conversations open and engaging - don't abruptly end after creating a request

Current context:
${unitDisplay ? `- Unit: ${unitDisplay}` : unitId ? `- Unit ID: ${unitId} (unit details not available)` : '- Unit: Not yet identified - YOU MUST IDENTIFY THE CALLER'}
${userEmail ? `- Tenant: ${userEmail}` : '- Tenant: Not yet identified - YOU MUST IDENTIFY THE CALLER'}
${userId ? `- User ID: ${userId}` : '- User ID: Not yet identified - YOU MUST IDENTIFY THE CALLER'}
${unitId ? `- Unit ID (database): ${unitId} - The system will automatically use this when creating maintenance requests` : ''}
${propertyId ? `- Property ID (database): ${propertyId} - The system will automatically use this when creating maintenance requests` : ''}

IMPORTANT: When calling create_maintenance_request, DO NOT pass userId, unitId, or propertyId parameters. The system automatically looks up the correct values from the caller's phone number. If the caller was identified during the call, that information is already stored and will be used automatically.

${unitDisplay ? `IMPORTANT: When greeting the caller, refer to their unit as "${unitDisplay}" (not "Unit ${unitId}" or just the unit ID number). For example, if the unit is "Unit 2 at 2320 Maple St Deckerville MI House", greet them as "Hello, I see you're calling from ${unitDisplay}. How can I help you today?"` : ''}

${!userId ? 'IMPORTANT: The caller is not identified. You MUST identify them before creating a maintenance request. Start by asking for their property name and unit number, or their address.' : ''}

Always assess urgency first before taking action. If the situation is life-threatening (fire, gas leak, medical emergency), immediately tell the tenant to call 911.

Remember: You're speaking on the phone. Keep responses natural, concise, and conversational.`;

    // Get Vapi.ai configuration
    let vapiConfig;
    try {
      console.log('[Voice Bot] [CALL_START] [UNIT_DISPLAY_CHECK]', {
        unitDisplay,
        unitId,
        propertyId,
        userId,
        hasHashInUnitDisplay: unitDisplay ? unitDisplay.includes('#') : false,
        unitDisplayLength: unitDisplay ? unitDisplay.length : 0
      });
      
      vapiConfig = getVapiConfig({
        systemPrompt,
        userId,
        unitId,
        propertyId,
        userEmail,
        callerPhone: callerPhone || 'unknown',
        unitDisplay
      });

      console.log('[Voice Bot] Returning Vapi config:', {
        hasUserId: !!userId,
        hasUnitId: !!unitId,
        actualCallerPhone: callerPhone || 'unknown',
        hasModel: !!vapiConfig.model,
        hasVoice: !!vapiConfig.voice,
        hasFunctions: !!vapiConfig.model?.functions,
        functionCount: vapiConfig.model?.functions?.length || 0
      });

      // Validate required fields
      if (!vapiConfig.model) {
        throw new Error('Vapi config missing model');
      }
      if (!vapiConfig.voice) {
        throw new Error('Vapi config missing voice');
      }

      // Note: customData is NOT allowed in assistant request responses - Vapi.ai validation rejects it
      // Remove it if it exists
      if (vapiConfig.customData) {
        delete vapiConfig.customData;
      }
      // Also remove serverUrl if it exists - phone number already has server.url configured
      if (vapiConfig.serverUrl) {
        delete vapiConfig.serverUrl;
      }

      // Validate JSON structure without excessive logging
      try {
        JSON.stringify(vapiConfig); // This will throw if invalid
      } catch (jsonError) {
        console.error('[Voice Bot] JSON serialization error:', jsonError);
        throw new Error('Invalid JSON in response: ' + jsonError.message);
      }

      // Return the assistant configuration
      // Vapi.ai expects the assistant object wrapped in an "assistant" key
      // Set Content-Type header explicitly and ensure proper encoding
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json({ assistant: vapiConfig });
    } catch (configError) {
      console.error('[Voice Bot] Error creating Vapi config:', configError);
      throw configError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    console.error('[Voice Bot] Error in handleCallStart:', error);
    console.error('[Voice Bot] Error stack:', error.stack);
    // Return a basic config even on error so the call doesn't fail completely
    // Use getVapiConfig to ensure proper format
    try {
      const fallbackConfig = getVapiConfig({
        systemPrompt: 'You are a helpful maintenance assistant. The caller could not be identified automatically. Ask for their email or name to look them up.',
        userId: null,
        unitId: null,
        propertyId: null,
        userEmail: null,
        callerPhone: 'unknown'
      });
      return res.status(200).json({ assistant: fallbackConfig });
    } catch (fallbackError) {
      console.error('[Voice Bot] Error creating fallback config:', fallbackError);
      // Last resort - return minimal valid config wrapped in assistant key
      return res.status(200).json({
        assistant: {
          model: {
            provider: 'openai',
            model: 'gpt-4',
            messages: [{
              role: 'system',
              content: 'You are Kate, a helpful maintenance assistant. The caller could not be identified automatically. Ask for their email or name to look them up.'
            }],
            temperature: 0.7
          },
          voice: {
            provider: '11labs',
            voiceId: process.env.VAPI_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
            // Voice settings to improve volume and consistency
            stability: 0.9,           // High stability for consistent, clear output (0-1)
            similarityBoost: 0.8,     // High similarity for clear voice matching (0-1)
            style: 0.0,              // Low style to prevent volume variations (0-1)
            useSpeakerBoost: true,   // Boost speaker clarity and volume
            speed: 1.0               // Normal speaking speed (0.7-1.2)
          },
          firstMessage: 'Hello! This is your property management maintenance assistant. I\'m having trouble identifying your account. Could you please provide your email address or name?'
        }
      });
    }
  }
}

// Handle function calls from Vapi.ai (when AI wants to call our functions)
async function handleFunctionCall(event, res, supabase, openai) {
  const startTime = Date.now();
  try {
    console.log('[Voice Bot] [FUNCTION_CALL_HANDLER_START]', {
      timestamp: new Date().toISOString(),
      eventKeys: Object.keys(event),
      hasBody: !!event,
      bodyType: typeof event,
      requestMethod: res.req?.method,
      requestUrl: res.req?.url
    });
    
    // Check multiple possible event structures for function calls
    // Vapi.ai can send function calls in different formats depending on the event type
    let functionCall = null;
    let toolCallId = null;
    
    // Log full event structure for debugging (first 1000 chars to avoid huge logs)
    console.log('[Voice Bot] [EVENT_STRUCTURE]', {
      eventType: event.type || event.message?.type,
      hasFunctionCall: !!event.functionCall,
      hasMessageFunctionCall: !!event.message?.functionCall,
      hasToolCalls: !!event.toolCalls,
      hasMessageToolCalls: !!event.message?.toolCalls,
      hasMessageToolCallList: !!event.message?.toolCallList,
      eventSample: JSON.stringify(event).substring(0, 1000)
    });
    
    // Try different event structures - check toolCallList first (common format)
    if (event.message?.toolCallList && event.message.toolCallList.length > 0) {
      const toolCall = event.message.toolCallList[0];
      if (toolCall.function) {
        functionCall = toolCall.function;
        toolCallId = toolCall.id;
        console.log('[Voice Bot] [EXTRACTED_FROM_TOOLCALL_LIST]', { toolCallId, functionName: functionCall.name });
      }
    } else if (event.functionCall) {
      functionCall = event.functionCall;
      toolCallId = event.toolCallId;
      console.log('[Voice Bot] [EXTRACTED_FROM_FUNCTIONCALL]', { toolCallId, functionName: functionCall.name });
    } else if (event.message?.functionCall) {
      functionCall = event.message.functionCall;
      toolCallId = event.message?.toolCallId;
      console.log('[Voice Bot] [EXTRACTED_FROM_MESSAGE_FUNCTIONCALL]', { toolCallId, functionName: functionCall.name });
    } else if (event.toolCalls && event.toolCalls.length > 0) {
      const toolCall = event.toolCalls[0];
      if (toolCall.type === 'function' && toolCall.function) {
        functionCall = toolCall.function;
        toolCallId = toolCall.id;
        console.log('[Voice Bot] [EXTRACTED_FROM_TOOLCALLS]', { toolCallId, functionName: functionCall.name });
      }
    } else if (event.message?.toolCalls && event.message.toolCalls.length > 0) {
      const toolCall = event.message.toolCalls[0];
      if (toolCall.type === 'function' && toolCall.function) {
        functionCall = toolCall.function;
        toolCallId = toolCall.id;
        console.log('[Voice Bot] [EXTRACTED_FROM_MESSAGE_TOOLCALLS]', { toolCallId, functionName: functionCall.name });
      }
    }
    
    // Fallback: try to extract from nested structures
    if (!functionCall) {
      const nestedToolCalls = event.call?.transcript?.find(m => m.toolCalls)?.[0];
      if (nestedToolCalls?.function) {
        functionCall = nestedToolCalls.function;
        toolCallId = nestedToolCalls.id;
        console.log('[Voice Bot] [EXTRACTED_FROM_NESTED]', { toolCallId, functionName: functionCall.name });
      }
    }
    
    // Generate toolCallId if not found
    if (!toolCallId) {
      toolCallId = functionCall?.id || `call_${Date.now()}`;
      console.log('[Voice Bot] [GENERATED_TOOLCALL_ID]', { toolCallId, reason: 'not found in event' });
    }
    
    if (!functionCall) {
      console.error('[Voice Bot] [ERROR] Could not extract function call from event structure');
      console.error('[Voice Bot] [ERROR] Event keys:', Object.keys(event));
      console.error('[Voice Bot] [ERROR] Event message keys:', event.message ? Object.keys(event.message) : 'no message');
    }
    
    // Extract function name
    const functionName = functionCall?.name;
    
    // Parse function arguments - could be string or object
    let functionArgs = {};
    if (functionCall?.parameters) {
      functionArgs = functionCall.parameters;
    } else if (functionCall?.arguments) {
      try {
        functionArgs = typeof functionCall.arguments === 'string' 
          ? JSON.parse(functionCall.arguments) 
          : functionCall.arguments;
      } catch (e) {
        console.error('[Voice Bot] Error parsing function arguments:', e);
        functionArgs = {};
      }
    }
    
    // Validate function name
    if (!functionName) {
      console.error('[Voice Bot] No function name found in event. Event keys:', Object.keys(event));
      console.error('[Voice Bot] Event structure sample:', JSON.stringify({
        hasFunctionCall: !!event.functionCall,
        hasMessage: !!event.message,
        hasToolCalls: !!event.toolCalls,
        messageKeys: event.message ? Object.keys(event.message) : [],
        callKeys: event.call ? Object.keys(event.call) : []
      }, null, 2));
      
      return res.status(200).json({
        results: [{
          toolCallId: toolCallId || `call_${Date.now()}`,
          result: JSON.stringify({
            success: false,
            count: 0,
            error: 'Function name is required',
            message: 'Unable to process function call - function name not found in request.'
          })
        }]
      });
    }

    // Get context from event - check both top-level and nested structure
    const call = event.call || event.message?.call;
    // Check multiple sources for transcript/artifact
    // Prefer artifact messages as they contain complete function call results
    const artifactMessages = event.message?.artifact?.messages || event.artifact?.messages || [];
    const transcriptMessages = call?.transcript || event.message?.transcript || event.transcript || [];
    // Use artifact messages if available (more complete), otherwise use transcript
    const messages = artifactMessages.length > 0 ? artifactMessages : transcriptMessages;
    
    // Initialize context variables before using them
    let userId = call?.customData?.userId;
    let unitId = call?.customData?.unitId;
    let propertyId = call?.customData?.propertyId;
    
    // First pass: look for tool results in artifact messages (most reliable source of context)
    // These contain results from previous function calls that have already completed
    for (const msg of messages) {
      // Check for tool results - they can be in different formats
      if (msg.role === 'tool' || msg.role === 'tool_call_result') {
        try {
          let result = null;
          // Try different content formats
          if (msg.content) {
            result = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
          } else if (msg.result) {
            result = typeof msg.result === 'string' ? JSON.parse(msg.result) : msg.result;
          }
          
          if (result && result.success) {
            // Check if this is from an identification or maintenance request function
            const functionName = msg.name || msg.functionName;
            if (functionName?.includes('identify_caller') || functionName === 'create_maintenance_request') {
              if (result.userId && result.propertyId) {
                userId = result.userId;
                unitId = result.unitId || result.unit_id;
                propertyId = result.propertyId || result.property_id;
                console.log('[Voice Bot] [CONTEXT_FROM_ARTIFACT_TOOL_RESULT] Extracted context from artifact tool result:', {
                  userId,
                  unitId,
                  propertyId,
                  functionName: functionName
                });
                // Continue to find the most recent successful result
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
    
    // Second, try to extract context from the current event's toolCallList (previous calls in same batch)
    // This is more reliable than transcript which may not be available yet
    // Also check for tool results in the same batch (they may be in event.message.results or similar)
    if (event.message?.toolCallList && Array.isArray(event.message.toolCallList)) {
      for (const toolCallItem of event.message.toolCallList) {
        const functionName = toolCallItem.function?.name;
        if (functionName?.includes('identify_caller') || functionName === 'create_maintenance_request') {
          try {
            const args = typeof toolCallItem.function?.arguments === 'string'
              ? JSON.parse(toolCallItem.function.arguments)
              : toolCallItem.function?.arguments;
            // DO NOT extract context from create_maintenance_request function arguments
            // The AI may pass wrong values (like unit_number instead of unit_id)
            // Only extract from identification functions, not from create_maintenance_request
            if (args && args.userId && args.propertyId && functionName !== 'create_maintenance_request') {
              userId = args.userId;
              unitId = args.unitId || args.unit_id;
              propertyId = args.propertyId || args.property_id;
              console.log('[Voice Bot] [CONTEXT_FROM_TOOLCALL_LIST] Extracted context from toolCallList args:', {
                userId,
                unitId,
                propertyId,
                functionName: functionName
              });
            }
            
            // Also check for tool results in the same item (if Vapi includes them)
            if (toolCallItem.result) {
              try {
                const result = typeof toolCallItem.result === 'string'
                  ? JSON.parse(toolCallItem.result)
                  : toolCallItem.result;
                if (result && result.success && result.userId && result.propertyId) {
                  userId = result.userId;
                  unitId = result.unitId || result.unit_id;
                  propertyId = result.propertyId || result.property_id;
                  console.log('[Voice Bot] [CONTEXT_FROM_TOOLCALL_LIST] Extracted context from toolCallList result:', {
                    userId,
                    unitId,
                    propertyId,
                    functionName: functionName
                  });
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    // Also check event.message.results if it exists (Vapi might include results from previous calls in batch)
    if (event.message?.results && Array.isArray(event.message.results)) {
      for (const resultItem of event.message.results) {
        if (resultItem.result) {
          try {
            const result = typeof resultItem.result === 'string'
              ? JSON.parse(resultItem.result)
              : resultItem.result;
            if (result && result.success && result.userId && result.propertyId) {
              userId = result.userId;
              unitId = result.unitId || result.unit_id;
              propertyId = result.propertyId || result.property_id;
              console.log('[Voice Bot] [CONTEXT_FROM_MESSAGE_RESULTS] Extracted context from message results:', {
                userId,
                unitId,
                propertyId,
                toolCallId: resultItem.toolCallId
              });
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    // Extract context from previous function call results in the transcript
    // Look for successful identification results or maintenance request creation
    // Also check function arguments in case results aren't available yet
    for (const message of messages) {
      if (message.role === 'assistant' && message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          const functionName = toolCall.function?.name;
          // Check both identification functions and create_maintenance_request
          if (functionName?.includes('identify_caller') || functionName === 'create_maintenance_request') {
            // First, try to extract from function arguments (available immediately)
            try {
              const args = typeof toolCall.function?.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function?.arguments;
              // DO NOT extract context from create_maintenance_request function arguments
              // The AI may pass wrong values (like unit_number instead of unit_id)
              // Only extract from identification functions, not from create_maintenance_request
              if (args && args.userId && args.propertyId && functionName !== 'create_maintenance_request') {
                userId = args.userId;
                unitId = args.unitId || args.unit_id;
                propertyId = args.propertyId || args.property_id;
                console.log('[Voice Bot] [CONTEXT_FROM_ARGS] Extracted context from function arguments:', {
                  userId,
                  unitId,
                  propertyId,
                  functionName: functionName
                });
              }
            } catch (e) {
              // Ignore parse errors
            }
            
            // Then, look for the corresponding tool result (may be available later)
            // Check both 'tool' and 'tool_call_result' roles, and check both content and result fields
            const toolResult = messages.find(m => {
              const toolCallId = m.toolCallId || m.id;
              return (m.role === 'tool' || m.role === 'tool_call_result') && 
                     toolCallId === toolCall.id &&
                     (m.content || m.result);
            });
            if (toolResult) {
              try {
                let result = null;
                if (toolResult.content) {
                  result = typeof toolResult.content === 'string' 
                    ? JSON.parse(toolResult.content) 
                    : toolResult.content;
                } else if (toolResult.result) {
                  result = typeof toolResult.result === 'string'
                    ? JSON.parse(toolResult.result)
                    : toolResult.result;
                }
                // Both identification and create_maintenance_request return userId and propertyId
                if (result && result.success && result.userId && result.propertyId) {
                  userId = result.userId;
                  unitId = result.unitId || result.unit_id;
                  propertyId = result.propertyId || result.property_id;
                  console.log('[Voice Bot] [CONTEXT_FROM_TRANSCRIPT] Extracted context from previous function call result:', {
                    userId,
                    unitId,
                    propertyId,
                    functionName: functionName
                  });
                  // Continue to find the most recent successful result
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }
    }
    
    console.log('[Voice Bot] [FUNCTION_CALL_START]', {
      functionName,
      toolCallId,
      callId: call?.id,
      hasUserId: !!userId,
      hasUnitId: !!unitId,
      hasPropertyId: !!propertyId,
      userId: userId,
      unitId: unitId,
      propertyId: propertyId,
      callerPhone: call?.customer?.number || null,
      functionArgs: JSON.stringify(functionArgs),
      transcriptLength: messages.length,
      hasToolCallList: !!(event.message?.toolCallList && event.message.toolCallList.length > 0)
    });

    // Look up the user from the phone number if we don't already have context
    // Context can come from:
    // 1. Phone lookup at call start (for identified callers)
    // 2. Identification functions during the call (identify_caller_by_location, etc.)
    // For create_maintenance_request: Use existing context if available, otherwise try phone lookup
    // For other functions: Only do phone lookup if we don't have context yet
    const needsPhoneLookup = !userId && !unitId && !propertyId;
    if (call?.customer?.number && needsPhoneLookup) {
      const callerPhone = call.customer.number;
      console.log('[Voice Bot] [PHONE_LOOKUP_START] Looking up user from phone number for function call:', {
        callerPhone,
        functionName,
        toolCallId,
        callId: call?.id
      });
      
      const phoneToLookup = normalizePhoneNumber(callerPhone);
      const contact = await findUserByPhone(supabase, phoneToLookup);
      
      // Handle both 'user' and 'tenant' contactable types
      if (contact?.contactable_id) {
        if (contact.contactable_type === 'user') {
          userId = contact.contactable_id;
          console.log('[Voice Bot] [PHONE_LOOKUP_SUCCESS] Found user ID from phone lookup:', {
            userId,
            contactable_id: contact.contactable_id,
            contactable_type: contact.contactable_type,
            phoneUsed: phoneToLookup,
            functionName,
            toolCallId
          });
        } else if (contact.contactable_type === 'client') {
          // Get the user_id from the client record
          try {
            const { data: client, error: clientError } = await supabase
              .from('clients')
              .select('user_id')
              .eq('client_id', contact.contactable_id)
              .maybeSingle();
            
            if (!clientError && client?.user_id) {
              userId = client.user_id;
              console.log('[Voice Bot] [PHONE_LOOKUP_SUCCESS] Found user ID from tenant contact:', {
                userId,
                tenant_contactable_id: contact.contactable_id,
                contactable_type: contact.contactable_type,
                phoneUsed: phoneToLookup,
                functionName,
                toolCallId
              });
            } else {
              console.log('[Voice Bot] [PHONE_LOOKUP_FAILED] Found tenant contact but no user_id in clients table:', {
                phoneSearched: phoneToLookup,
                tenant_contactable_id: contact.contactable_id,
                clientError: clientError?.message,
                functionName,
                toolCallId
              });
            }
          } catch (clientLookupError) {
            console.warn('[Voice Bot] Error looking up user_id from tenant contact:', clientLookupError.message);
          }
        }
        
        // If we found a userId, get unit and property info
        if (userId) {
          // Get unit and property info
          const unitInfo = await getUserUnitInfo(supabase, userId);
          if (unitInfo) {
            unitId = unitInfo.unitId;
            propertyId = unitInfo.propertyId;
            console.log('[Voice Bot] [PHONE_LOOKUP_SUCCESS] Found unit and property from user:', {
              userId,
              unitId,
              propertyId,
              functionName,
              toolCallId
            });
          } else {
            console.log('[Voice Bot] [PHONE_LOOKUP_WARNING] User found but no unit info:', {
              userId,
              functionName,
              toolCallId
            });
          }
        }
      } else {
        console.log('[Voice Bot] [PHONE_LOOKUP_FAILED] No contact found for phone number:', {
          phoneSearched: phoneToLookup,
          originalPhone: callerPhone,
          functionName,
          toolCallId
        });
      }
    } else if (!call?.customer?.number) {
      console.log('[Voice Bot] [PHONE_LOOKUP_SKIPPED] No phone number in call object:', {
        hasCall: !!call,
        hasCustomer: !!call?.customer,
        hasNumber: !!call?.customer?.number,
        functionName,
        toolCallId
      });
    }

    // Extract call summary from transcript if not provided by AI
    // Use call_summary from functionArgs if provided, otherwise generate from transcript
    let callSummary = functionArgs.call_summary;
    if (!callSummary && messages && messages.length > 0) {
      // Extract conversation context from transcript to create a comprehensive summary
      // Include both user and assistant messages for full context
      const conversationText = messages
        .map(m => {
          // Handle different transcript formats
          if (typeof m === 'string') return m;
          const role = m.role ? m.role.toLowerCase() : null;
          const content = m.content || m.message || m.text || '';
          // Format as "Tenant: ..." or "Assistant: ..." for context
          if (role === 'user' || role === 'assistant') {
            return `${role === 'user' ? 'Tenant' : 'Assistant'}: ${content}`;
          }
          return content;
        })
        .filter(Boolean)
        .join(' ');
      
      if (conversationText) {
        callSummary = conversationText;
        console.log('[Voice Bot] Generated call summary from transcript (first 300 chars):', callSummary.substring(0, 300));
      }
    }

    let result = {};

    try {
      switch (functionName) {
        case 'assess_urgency':
          result = await assessUrgency(functionArgs, supabase, openai);
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] assess_urgency:', {
          toolCallId,
          success: result.success !== false,
          urgencyLevel: result.urgency_level,
          reasoning: result.reasoning?.substring(0, 200)
        });
        break;
      
      case 'find_emergency_vendors':
        result = await findEmergencyVendors(
          functionArgs.keywords || [],
          propertyId,
          unitId,
          userId,
          supabase,
          openai,
          true, // isVoiceCall = true
          callSummary
        );
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] find_emergency_vendors:', {
          toolCallId,
          success: result.success !== false,
          vendorCount: result.vendors?.length || 0,
          keywords: functionArgs.keywords,
          unitId,
          userId
        });
        break;
      
      case 'find_routine_vendors':
        result = await findRoutineVendors(
          functionArgs.keywords || [],
          propertyId,
          unitId,
          userId,
          supabase,
          openai,
          callSummary
        );
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] find_routine_vendors:', {
          toolCallId,
          success: result.success !== false,
          vendorCount: result.vendors?.length || 0,
          keywords: functionArgs.keywords,
          unitId,
          userId
        });
        break;
      
      case 'create_maintenance_request': {
        // The AI should NOT pass userId, unitId, or propertyId - we use context from:
        // 1. Phone lookup (if caller identified by phone at call start)
        // 2. Identification functions (if caller identified during call by address/name/birthdate)
        // 3. Unassigned request (if no identification found)
        // This prevents the AI from inferring wrong values (like using unit_number "201" instead of unit_id "3")
        const callerName = functionArgs.caller_name || null;
        const callerRelationship = functionArgs.caller_relationship || null;
        const callerPhone = call?.customer?.number || null;
        
        // Use context from phone lookup OR identification functions (whichever is available)
        // Context priority:
        // 1. Identification functions (most recent, from during the call)
        // 2. Phone lookup (from call start)
        // 3. None (unassigned request)
        let finalUnitId = unitId;
        let finalUserId = userId;
        let finalPropertyId = propertyId;
        
        console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT_START]', {
          contextFromPhoneLookup: { userId, unitId, propertyId },
          contextFromIdentification: 'will be checked',
          initialFinal: { userId: finalUserId, unitId: finalUnitId, propertyId: finalPropertyId }
        });
        
        // Validate the unitId exists in database (if we have one)
        if (finalUnitId) {
          const { data: unitCheck, error: unitCheckError } = await supabase
            .from('units')
            .select('unit_id, property_id')
            .eq('unit_id', finalUnitId)
            .maybeSingle();
          
          if (unitCheckError || !unitCheck) {
            console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT] Invalid unitId (not found in database):', {
              unitId: finalUnitId,
              error: unitCheckError?.message,
              source: 'context (phone lookup or identification function)'
            });
            finalUnitId = null;
            finalPropertyId = null;
          } else {
            // Unit is valid - update propertyId if not already set
            if (!finalPropertyId && unitCheck.property_id) {
              finalPropertyId = unitCheck.property_id;
            }
            
            // If we have a valid unitId but no userId, try to get userId from the unit
            if (!finalUserId) {
              console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT] No userId in context, attempting to get userId from unitId:', finalUnitId);
              try {
                const userIdFromUnit = await getUserIdForUnit(supabase, finalUnitId);
                if (userIdFromUnit) {
                  finalUserId = userIdFromUnit;
                  console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT] Successfully found userId from unit:', {
                    unitId: finalUnitId,
                    userId: finalUserId
                  });
                } else {
                  console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT] Valid unitId but getUserIdForUnit returned null for unit:', finalUnitId);
                }
              } catch (err) {
                console.error('[Voice Bot] [CREATE_REQUEST_CONTEXT] Error getting userId from unit:', {
                  unitId: finalUnitId,
                  error: err.message,
                  stack: err.stack
                });
              }
            } else {
              console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT] userId already available from context:', finalUserId);
            }
            
            console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT] Using validated unitId from context:', {
              unitId: finalUnitId,
              propertyId: finalPropertyId,
              userId: finalUserId,
              source: userId && unitId ? 'phone lookup or identification function' : 'looked up from unit'
            });
          }
        }
        
        // If no valid unitId, create unassigned request
        if (!finalUnitId) {
          console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT] No valid unitId found, creating unassigned request');
          finalUnitId = null;
          finalPropertyId = null;
          // Keep userId if available (even for unassigned requests)
        }
        
        console.log('[Voice Bot] [CREATE_REQUEST_CONTEXT]', {
          contextSource: userId && unitId ? 'phone lookup or identification function' : 'none (unassigned)',
          context: { userId, unitId, propertyId },
          final: { userId: finalUserId, unitId: finalUnitId, propertyId: finalPropertyId },
          note: 'AI-provided userId/unitId/propertyId are ignored - using context from phone lookup or identification functions'
        });
        
        console.log('[Voice Bot] [CREATE_REQUEST_CALLING] About to call createMaintenanceRequest with:', {
          finalUnitId,
          finalUserId,
          finalPropertyId,
          hasUnitId: !!finalUnitId,
          hasUserId: !!finalUserId,
          hasPropertyId: !!finalPropertyId,
          willBeUnassigned: !finalUnitId || !finalUserId
        });
        
        result = await createMaintenanceRequest(
          { 
            ...functionArgs, 
            caller_name: callerName,
            caller_relationship: callerRelationship,
            caller_phone: callerPhone
          },
          finalUnitId,
          finalUserId,
          supabase,
          openai,
          finalPropertyId,
          callSummary
        );
        
        console.log('[Voice Bot] [CREATE_REQUEST_RESULT] createMaintenanceRequest returned:', {
          success: result.success,
          request_id: result.request_id,
          is_unassigned: result.is_unassigned,
          hasTenantUserId: !!result.request_id ? 'will check database' : 'no request_id'
        });
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] create_maintenance_request:', { 
          toolCallId,
          success: result.success, 
          count: result.count, 
          request_id: result.request_id,
          is_unassigned: result.is_unassigned,
          priority: functionArgs.priority,
          unitId,
          userId,
          hasDescription: !!functionArgs.description
        });
        break;
      }
      
      case 'call_vendor':
        result = await callVendor(
          functionArgs.vendorId,
          functionArgs.vendorPhone,
          functionArgs.maintenanceRequestId,
          call?.id,
          supabase
        );
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] call_vendor:', {
          toolCallId,
          success: result.success !== false,
          vendorId: functionArgs.vendorId,
          maintenanceRequestId: functionArgs.maintenanceRequestId
        });
        break;
      
      case 'schedule_appointment':
        result = await scheduleAppointment(
          functionArgs.vendorId,
          functionArgs.maintenanceRequestId,
          functionArgs.scheduledDateTime,
          functionArgs.estimatedDurationMinutes,
          functionArgs.notes,
          supabase
        );
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] schedule_appointment:', {
          toolCallId,
          success: result.success !== false,
          vendorId: functionArgs.vendorId,
          maintenanceRequestId: functionArgs.maintenanceRequestId,
          appointmentId: result.appointmentId
        });
        break;
      
      case 'identify_caller_by_location': {
        result = await identifyCallerByLocation(functionArgs, supabase);
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] identify_caller_by_location:', {
          toolCallId,
          success: result.success,
          unitId: result.unitId,
          propertyId: result.propertyId,
          userId: result.userId,
          address: functionArgs.address,
          property_name: functionArgs.property_name,
          unit_number: functionArgs.unit_number,
          heardAddress: result.heardAddress,
          message: result.message
        });
        // Update context if identification successful
        if (result.success && result.unitId) {
          unitId = result.unitId;
          propertyId = result.propertyId;
          userId = result.userId;
          console.log('[Voice Bot] [CONTEXT_UPDATED] Caller identified by location:', { unitId, propertyId, userId });
        }
        break;
      }
      
      case 'identify_caller_by_info': {
        result = await identifyCallerByInfo(functionArgs, supabase);
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] identify_caller_by_info:', {
          toolCallId,
          success: result.success,
          unitId: result.unitId,
          propertyId: result.propertyId,
          userId: result.userId,
          responsible_person_phone: functionArgs.responsible_person_phone,
          message: result.message
        });
        // Update context if identification successful
        if (result.success && result.unitId) {
          unitId = result.unitId;
          propertyId = result.propertyId;
          userId = result.userId;
          console.log('[Voice Bot] [CONTEXT_UPDATED] Caller identified by info:', { unitId, propertyId, userId });
        }
        break;
      }
      
      case 'identify_caller_by_name_and_birthdate': {
        result = await identifyCallerByNameAndBirthdate(functionArgs, supabase);
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] identify_caller_by_name_and_birthdate:', {
          toolCallId,
          success: result.success,
          unitId: result.unitId,
          propertyId: result.propertyId,
          userId: result.userId,
          first_name: functionArgs.first_name,
          last_name: functionArgs.last_name,
          date_of_birth: functionArgs.date_of_birth,
          message: result.message,
          count: result.count
        });
        // Update context if identification successful
        if (result.success && result.unitId) {
          unitId = result.unitId;
          propertyId = result.propertyId;
          userId = result.userId;
          console.log('[Voice Bot] [CONTEXT_UPDATED] Caller identified by name and birthdate:', { unitId, propertyId, userId });
        }
        break;
      }
      
      case 'identify_responsible_person_by_name_and_location':
        result = await identifyResponsiblePersonByNameAndLocation(functionArgs, supabase);
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] identify_responsible_person_by_name_and_location:', {
          toolCallId,
          success: result.success,
          unitId: result.unitId,
          propertyId: result.propertyId,
          userId: result.userId,
          first_name: functionArgs.first_name,
          last_name: functionArgs.last_name,
          property_name: functionArgs.property_name,
          address: functionArgs.address,
          unit_number: functionArgs.unit_number,
          message: result.message
        });
        // Update context if identification successful
        if (result.success && result.unitId) {
          unitId = result.unitId;
          propertyId = result.propertyId;
          userId = result.userId;
          console.log('[Voice Bot] [CONTEXT_UPDATED] Responsible person identified:', { unitId, propertyId, userId });
        }
        break;
      
      case 'get_responsible_person_phone': {
        // Use validated context from earlier in conversation - don't re-validate
        // The userId and propertyId should already be available from the phone lookup done at call start
        // or from previous function calls in the same conversation
        const finalPropertyId = propertyId || functionArgs.propertyId;
        const finalUserId = userId || functionArgs.userId;
        
        // Only allow verified tenants to get phone numbers
        if (!finalUserId || !finalPropertyId) {
          result = {
            success: false,
            message: 'I need to verify your identity first before I can provide contact information. Please identify yourself using your name and date of birth, or your property information.'
          };
        } else {
          const returnOwnerOnly = functionArgs.return_owner_only === true || functionArgs.return_owner_only === 'true';
          const phoneInfo = await getResponsiblePersonPhone(supabase, finalPropertyId, returnOwnerOnly);
          
          if (phoneInfo) {
            result = {
              success: true,
              phone: phoneInfo.phone,
              name: phoneInfo.name,
              role: phoneInfo.role,
              type: phoneInfo.type,
              message: `The ${phoneInfo.type === 'property_owner' ? 'property owner' : phoneInfo.type === 'pm_manager' ? 'property manager' : phoneInfo.type === 'company_admin' ? 'company administrator' : 'global administrator'}'s phone number is ${phoneInfo.phone}. ${phoneInfo.name ? `Their name is ${phoneInfo.name}.` : ''}`
            };
          } else {
            result = {
              success: false,
              message: 'I couldn\'t find a contact phone number for the responsible person. Please contact your property management company directly.'
            };
          }
        }
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] get_responsible_person_phone:', {
          toolCallId,
          success: result.success,
          hasPhone: !!result.phone,
          propertyId: finalPropertyId,
          userId: finalUserId,
          returnOwnerOnly: functionArgs.return_owner_only,
          usedContext: { fromCall: !!propertyId, fromArgs: !!functionArgs.propertyId }
        });
        break;
      }
      
      case 'update_scheduling_preferences': {
        const { maintenanceRequestId, schedulingPreferences } = functionArgs;
        
        // Get current admin_notes
        const { data: request, error: requestError } = await supabase
          .from('maintenance_requests')
          .select('admin_notes')
          .eq('request_id', maintenanceRequestId)
          .single();
        
        if (requestError || !request) {
          result = {
            success: false,
            message: `Maintenance request ${maintenanceRequestId} not found.`
          };
        } else {
          // Append scheduling preferences to admin_notes
          const updatedNotes = request.admin_notes 
            ? `${request.admin_notes}\n\nScheduling Preferences: ${schedulingPreferences}`
            : `Scheduling Preferences: ${schedulingPreferences}`;
          
          const { error: updateError } = await supabase
            .from('maintenance_requests')
            .update({ admin_notes: updatedNotes })
            .eq('request_id', maintenanceRequestId);
          
          if (updateError) {
            result = {
              success: false,
              message: `Failed to update scheduling preferences: ${updateError.message}`
            };
          } else {
            result = {
              success: true,
              message: `I've noted your scheduling preferences: ${schedulingPreferences}. This will be shared with the vendor when scheduling the appointment.`
            };
          }
        }
        
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] update_scheduling_preferences:', {
          toolCallId,
          success: result.success,
          maintenanceRequestId,
          hasPreferences: !!schedulingPreferences
        });
        break;
      }
      
      case 'request_reschedule': {
        const { appointmentId, reason } = functionArgs;
        
        // Get appointment details
        const { data: appointment, error: appointmentError } = await supabase
          .from('client_appointments')
          .select(`
            appointment_id,
            vendor_id,
            maintenance_request_id,
            status,
            vendors!inner(company_name)
          `)
          .eq('appointment_id', appointmentId)
          .single();
        
        if (appointmentError || !appointment) {
          result = {
            success: false,
            message: `Appointment ${appointmentId} not found.`
          };
        } else if (appointment.status !== 'scheduled') {
          result = {
            success: false,
            message: `Cannot reschedule appointment with status "${appointment.status}". Only scheduled appointments can be rescheduled.`
          };
        } else {
          // Update appointment status to 'rescheduled'
          await supabase
            .from('client_appointments')
            .update({ 
              status: 'rescheduled',
              notes: reason ? `Rescheduling requested: ${reason}` : 'Rescheduling requested by tenant'
            })
            .eq('appointment_id', appointmentId);
          
          // Get vendor phone
          const { data: vendorContact } = await supabase
            .from('contacts')
            .select('contact_id')
            .eq('contactable_id', appointment.vendor_id)
            .eq('contactable_type', 'vendor')
            .limit(1)
            .maybeSingle();
          
          if (!vendorContact) {
            result = {
              success: false,
              message: 'Vendor contact information not found. Cannot make rescheduling call.'
            };
          } else {
            const { data: vendorMethods } = await supabase
              .from('contact_methods')
              .select('value, method_type')
              .eq('contact_id', vendorContact.contact_id)
              .in('method_type', ['Phone', 'phone', 'Cell', 'cell'])
              .limit(1)
              .maybeSingle();
            
            if (!vendorMethods) {
              result = {
                success: false,
                message: 'Vendor phone number not found. Cannot make rescheduling call.'
              };
            } else {
              // Call vendor to reschedule
              const callResult = await callVendor(
                appointment.vendor_id,
                vendorMethods.value,
                appointment.maintenance_request_id,
                call?.id,
                supabase
              );
              
              if (callResult.success) {
                result = {
                  success: true,
                  message: `I've requested a reschedule. The vendor will be called to find a new appointment time. ${reason ? `Reason: ${reason}` : ''}`
                };
              } else {
                result = {
                  success: false,
                  message: `Failed to call vendor for rescheduling: ${callResult.error || 'Unknown error'}`
                };
              }
            }
          }
        }
        
        console.log('[Voice Bot] [FUNCTION_CALL_SUCCESS] request_reschedule:', {
          toolCallId,
          success: result.success,
          appointmentId,
          reason
        });
        break;
      }
      
      default:
          result = { error: `Unknown function: ${functionName}` };
      }
    } catch (functionError) {
      console.error(`[Voice Bot] Error executing function ${functionName}:`, functionError);
      console.error('[Voice Bot] Function error stack:', functionError.stack);
      result = {
        success: false,
        count: 0,
        error: 'Function execution failed',
        message: functionError.message || 'An error occurred while processing your request.'
      };
    }

    // Ensure result is always a valid object with at least success and count fields
    if (!result || typeof result !== 'object') {
      console.error('[Voice Bot] [FUNCTION_CALL_ERROR] Invalid function result:', result);
      result = {
        success: false,
        count: 0,
        error: 'Invalid function result',
        message: 'An error occurred while processing your request.'
      };
    }

    // Log final function call result
    console.log('[Voice Bot] [FUNCTION_CALL_COMPLETE]', {
      functionName,
      toolCallId,
      success: result.success !== false,
      hasError: !!result.error,
      resultKeys: Object.keys(result),
      finalContext: {
        userId,
        unitId,
        propertyId
      }
    });
    
    // Ensure result has success field (for backward compatibility)
    if (result.success === undefined) {
      result.success = result.vendors?.length > 0 || result.request_id !== undefined || false;
    }
    
    // Ensure result has count field (for backward compatibility)
    if (result.count === undefined) {
      result.count = result.vendor_count || result.vendors?.length || (result.request_id ? 1 : 0);
    }
    
    // Vapi.ai expects the result in a specific format for Server URL mode
    // According to Vapi.ai docs, tool call results should be returned as:
    // { results: [{ toolCallId: "...", result: "..." }] }
    const response = {
      results: [
        {
          toolCallId: toolCallId,
          result: JSON.stringify(result)
        }
      ]
    };
    
    // Log detailed response information for debugging
    console.log('[Voice Bot] [RESPONSE_PREPARED]', {
      function: functionName,
      toolCallId: toolCallId,
      resultType: typeof result,
      resultKeys: Object.keys(result),
      resultSuccess: result.success,
      resultCount: result.count,
      resultError: result.error,
      responseStructure: {
        hasResults: !!response.results,
        resultsLength: response.results?.length,
        firstResultToolCallId: response.results?.[0]?.toolCallId,
        firstResultHasResult: !!response.results?.[0]?.result,
        firstResultResultLength: response.results?.[0]?.result?.length
      },
      resultStringified: JSON.stringify(result).substring(0, 200) // First 200 chars
    });
    
    // Log result summary (not full response to reduce log volume)
    console.log('[Voice Bot] Function result:', { 
      function: functionName, 
      success: result.success, 
      count: result.count,
      hasError: !!result.error 
    });
    
    // Set proper headers and return response
    res.setHeader('Content-Type', 'application/json');
    
    // Log the exact response we're sending
    const responseJson = JSON.stringify(response);
    console.log('[Voice Bot] [SENDING_RESPONSE]', {
      toolCallId: toolCallId,
      statusCode: 200,
      responseSize: responseJson.length,
      responsePreview: responseJson.substring(0, 500),
      fullResponse: response,
      willSend: true,
      timestamp: new Date().toISOString()
    });
    
    // Send response and ensure it's sent
    try {
      res.status(200).json(response);
      console.log('[Voice Bot] [RESPONSE_SENT]', {
        toolCallId: toolCallId,
        function: functionName,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime
      });
      return;
    } catch (sendError) {
      console.error('[Voice Bot] [ERROR_SENDING_RESPONSE]', {
        toolCallId: toolCallId,
        error: sendError.message,
        stack: sendError.stack
      });
      // Try to send error response
      try {
        res.status(500).json({
          results: [{
            toolCallId: toolCallId,
            result: JSON.stringify({
              success: false,
              error: 'Failed to send response',
              message: sendError.message
            })
          }]
        });
      } catch (e) {
        // Response already sent or connection closed
        console.error('[Voice Bot] [FATAL] Could not send error response:', e);
      }
      return;
    }
  } catch (error) {
    console.error('[Voice Bot] Error in handleFunctionCall:', error);
    console.error('[Voice Bot] Error stack:', error.stack);
    
    // Return error in the expected format
    // Try to get toolCallId from event if available
    const toolCallId = event.toolCallId || 
                      event.message?.toolCallId ||
                      event.toolCalls?.[0]?.id ||
                      `call_${Date.now()}`;
    
    return res.status(200).json({ 
      results: [
        {
          toolCallId: toolCallId,
          result: JSON.stringify({ 
            success: false,
            count: 0,
            error: 'Function execution failed',
            message: error.message || 'An unexpected error occurred'
          })
        }
      ]
    });
  }
}

// Handle end of call - save conversation transcript
async function handleEndOfCall(event, res, supabase) {
  try {
    // Check both top-level and nested message structure
    const call = event.call || event.message?.call;
    const message = event.message || event;
    
    const callId = call?.id;
    // Get transcript from multiple sources
    const transcript = call?.transcript || 
                      message?.artifact?.messages || 
                      event?.artifact?.messages || 
                      [];
    // Duration can be at call.duration, message.duration, or event.duration
    const duration = call?.duration || message?.duration || event.duration;
    const status = call?.status || message?.status;
    const endedReason = call?.endedReason || message?.endedReason;
    
    // Extract userId, unitId, and maintenanceRequestId from transcript/artifact
    // Look for successful identification results or maintenance request creation
    let userId = null;
    let unitId = null;
    let propertyId = null;
    let maintenanceRequestId = null;
    
    // Check artifact messages first (most reliable)
    const artifactMessages = message?.artifact?.messages || event?.artifact?.messages || [];
    
    // First pass: look for tool results (most reliable source of context)
    for (const msg of artifactMessages) {
      // Check for tool results - they can be in different formats
      if (msg.role === 'tool' || msg.role === 'tool_call_result') {
        try {
          let result = null;
          // Try different content formats
          if (msg.content) {
            result = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
          } else if (msg.result) {
            result = typeof msg.result === 'string' ? JSON.parse(msg.result) : msg.result;
          }
          
          if (result && result.success) {
            // Check if this is from an identification or maintenance request function
            const functionName = msg.name || msg.functionName;
            if (functionName?.includes('identify_caller') || functionName === 'create_maintenance_request') {
              if (result.userId && result.propertyId) {
                userId = result.userId;
                unitId = result.unitId || result.unit_id;
                propertyId = result.propertyId || result.property_id;
                if (result.request_id) {
                  maintenanceRequestId = result.request_id;
                }
                console.log('[Voice Bot] [END_OF_CALL_CONTEXT] Found context from tool result:', {
                  userId,
                  unitId,
                  propertyId,
                  maintenanceRequestId,
                  functionName
                });
              } else if (functionName === 'create_maintenance_request' && result.request_id) {
                // For create_maintenance_request, if we only have request_id, look up from database
                maintenanceRequestId = result.request_id;
                try {
                  const { data: request } = await supabase
                    .from('maintenance_requests')
                    .select('tenant_user_id, unit_id, units!inner(property_id)')
                    .eq('request_id', maintenanceRequestId)
                    .maybeSingle();
                  if (request) {
                    userId = request.tenant_user_id;
                    unitId = request.unit_id;
                    propertyId = request.units?.property_id;
                    console.log('[Voice Bot] [END_OF_CALL_CONTEXT] Looked up context from database (first pass):', {
                      userId,
                      unitId,
                      propertyId,
                      maintenanceRequestId
                    });
                  }
                } catch (dbError) {
                  console.warn('[Voice Bot] [END_OF_CALL_CONTEXT] Error looking up request from database (first pass):', dbError.message);
                }
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
    
    // Second pass: look for tool calls and match with results
    for (const msg of artifactMessages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          const functionName = toolCall.function?.name;
          if (functionName?.includes('identify_caller') || functionName === 'create_maintenance_request') {
            // Extract from function arguments (for create_maintenance_request which passes userId/propertyId)
            try {
              const args = typeof toolCall.function?.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function?.arguments;
              if (args && args.userId && args.propertyId) {
                userId = args.userId;
                unitId = args.unitId || args.unit_id;
                propertyId = args.propertyId || args.property_id;
                if (functionName === 'create_maintenance_request' && args.request_id) {
                  maintenanceRequestId = args.request_id;
                }
                console.log('[Voice Bot] [END_OF_CALL_CONTEXT] Found context from function arguments:', {
                  userId,
                  unitId,
                  propertyId,
                  maintenanceRequestId,
                  functionName
                });
              }
            } catch (e) {
              // Ignore parse errors
            }
            
            // Also check for tool results by toolCallId
            const toolResult = artifactMessages.find(m => {
              const toolCallId = m.toolCallId || m.id;
              return (m.role === 'tool' || m.role === 'tool_call_result') && 
                     toolCallId === toolCall.id &&
                     (m.content || m.result);
            });
            if (toolResult) {
              try {
                let result = null;
                if (toolResult.content) {
                  result = typeof toolResult.content === 'string' 
                    ? JSON.parse(toolResult.content) 
                    : toolResult.content;
                } else if (toolResult.result) {
                  result = typeof toolResult.result === 'string'
                    ? JSON.parse(toolResult.result)
                    : toolResult.result;
                }
                if (result && result.success) {
                  if (result.userId && result.propertyId) {
                    userId = result.userId;
                    unitId = result.unitId || result.unit_id;
                    propertyId = result.propertyId || result.property_id;
                  }
                  if (result.request_id) {
                    maintenanceRequestId = result.request_id;
                    // If we have a request_id but no userId/unitId, look up the request from database
                    if (!userId && maintenanceRequestId) {
                      try {
                        const { data: request } = await supabase
                          .from('maintenance_requests')
                          .select('tenant_user_id, unit_id, units!inner(property_id)')
                          .eq('request_id', maintenanceRequestId)
                          .maybeSingle();
                        if (request) {
                          userId = request.tenant_user_id;
                          unitId = request.unit_id;
                          propertyId = request.units?.property_id;
                          console.log('[Voice Bot] [END_OF_CALL_CONTEXT] Looked up context from database:', {
                            userId,
                            unitId,
                            propertyId,
                            maintenanceRequestId
                          });
                        }
                      } catch (dbError) {
                        console.warn('[Voice Bot] [END_OF_CALL_CONTEXT] Error looking up request from database:', dbError.message);
                      }
                    }
                  }
                  console.log('[Voice Bot] [END_OF_CALL_CONTEXT] Found context from matched tool result:', {
                    userId,
                    unitId,
                    propertyId,
                    maintenanceRequestId,
                    functionName,
                    toolCallId: toolCall.id
                  });
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }
    }
    
    // Fallback: check transcript if artifact not available
    if (!userId && transcript.length > 0 && Array.isArray(transcript)) {
      for (const msg of transcript) {
        if (msg.role === 'assistant' && msg.toolCalls) {
          for (const toolCall of msg.toolCalls) {
            const functionName = toolCall.function?.name;
            if (functionName?.includes('identify_caller') || functionName === 'create_maintenance_request') {
              try {
                const args = typeof toolCall.function?.arguments === 'string'
                  ? JSON.parse(toolCall.function.arguments)
                  : toolCall.function?.arguments;
                if (args && args.userId && args.propertyId) {
                  userId = args.userId;
                  unitId = args.unitId || args.unit_id;
                  propertyId = args.propertyId || args.property_id;
                  if (functionName === 'create_maintenance_request' && args.request_id) {
                    maintenanceRequestId = args.request_id;
                  }
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }
    }
    
    console.log('[Voice Bot] [END_OF_CALL_CONTEXT] Extracted context:', {
      userId,
      unitId,
      propertyId,
      maintenanceRequestId,
      transcriptLength: transcript.length,
      artifactMessagesLength: artifactMessages.length
    });

    // Log error information if present
    const artifact = message?.artifact || event?.artifact;
    const analysis = message?.analysis || event?.analysis;
    const error = message?.error || event?.error;
    const assistantRequestError = message?.assistantRequestError || event?.assistantRequestError;
    const assistantRequestResponse = message?.assistantRequestResponse || event?.assistantRequestResponse;

    // Log call summary and analysis (important for debugging tool calls)
    console.log('[Voice Bot] Call ended:', { 
      callId, 
      duration, 
      status, 
      endedReason 
    });
    
    // Always log call analysis if available - this shows what tool calls were made
    if (analysis) {
      console.log('[Voice Bot] Call analysis:', JSON.stringify(analysis, null, 2));
    }
    
    // Log error information if present
    if (error || assistantRequestError) {
      console.error('[Voice Bot] Call ended with errors:', { 
        callId, 
        endedReason,
        hasError: !!error,
        hasAssistantRequestError: !!assistantRequestError
      });
      if (error) console.error('[Voice Bot] Error details:', error.message || error);
      if (assistantRequestError) console.error('[Voice Bot] Assistant error:', assistantRequestError);
    }
    
    // Log artifact if it contains tool call information (for debugging)
    if (artifact && artifact.messages) {
      const toolCalls = artifact.messages.filter(m => m.toolCalls || m.role === 'tool_call_result');
      if (toolCalls.length > 0) {
        console.log('[Voice Bot] Tool calls made during call:', toolCalls.length);
        toolCalls.forEach((tc, idx) => {
          if (tc.toolCalls) {
            tc.toolCalls.forEach(call => {
              console.log(`[Voice Bot] Tool call ${idx + 1}:`, {
                function: call.function?.name,
                toolCallId: call.id,
                arguments: call.function?.arguments ? JSON.parse(call.function.arguments) : null
              });
            });
          }
          if (tc.role === 'tool_call_result') {
            console.log(`[Voice Bot] Tool call result ${idx + 1}:`, {
              name: tc.name,
              toolCallId: tc.toolCallId,
              result: tc.result?.substring(0, 200) // First 200 chars of result
            });
          }
        });
      }
    }

    // Save conversation to database - save even if user/unit not identified
    // This allows admins to review incomplete calls for potential emergencies
    const callerPhone = call?.customer?.number || event.customer?.number;
    const isIncomplete = !userId || !unitId;
    
    // Use artifact messages for transcript if available, otherwise use transcript array
    const transcriptToSave = artifactMessages.length > 0 ? artifactMessages : transcript;
    
    if (transcriptToSave.length > 0) {
      // Save all calls, including incomplete ones
      // After migration, user_id can be null and we use dedicated columns for call metadata
      const conversationData = {
        user_id: userId || null, // Can be null for incomplete calls after migration
        unit_id: unitId || null,
        transcript: JSON.stringify(transcriptToSave),
        maintenance_request_id: maintenanceRequestId || null,
        ended_at: new Date().toISOString(),
        // Voice call specific fields (added by migration)
        caller_phone: callerPhone || null,
        is_incomplete: isIncomplete,
        call_id: callId || null,
        duration: duration ? (typeof duration === 'number' ? duration : parseInt(duration)) : null,
        ended_reason: endedReason || null
      };
      
      const { error: saveError } = await supabase
        .from('chatbot_conversations')
        .insert([conversationData]);
      
      if (saveError) {
        console.error('[Voice Bot] Error saving conversation:', saveError);
        // If error is due to schema not being migrated yet, log helpful message
        if (saveError.message?.includes('null value in column "user_id"') || saveError.code === '23502') {
          console.error('[Voice Bot] Schema migration needed! Run: scripts/migrations/2025-12-03-allow-incomplete-voice-calls.sql');
        }
      } else {
        if (isIncomplete) {
          console.log('[Voice Bot] Saved incomplete call:', {
            callId,
            callerPhone,
            transcriptLength: transcriptToSave.length,
            conversationId: 'saved'
          });
        } else {
          console.log('[Voice Bot] Saved complete call:', {
            callId,
            userId,
            unitId,
            transcriptLength: transcriptToSave.length
          });
        }
      }
    } else {
      console.log('[Voice Bot] Not saving call - transcript is empty:', {
        callId,
        transcriptLength: transcript.length,
        artifactMessagesLength: artifactMessages.length
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[Voice Bot] Error in handleEndOfCall:', error);
    return res.status(500).json({ error: 'Error saving call data' });
  }
}

// Handle status updates
function handleStatusUpdate(event, res) {
  const message = event.message || event;
  const status = event.call?.status || message?.status;
  const endedReason = event.call?.endedReason || message?.endedReason;
  const error = message?.error || event?.error;
  
  console.log('[Voice Bot] Status update:', { 
    status, 
    endedReason,
    hasError: !!error
  });
  
  // Log error information if present in status update
  if (error) {
    console.error('[Voice Bot] Error in status update:', JSON.stringify(error, null, 2));
  }
  
  // Log full event if it contains error information
  if (message?.inboundPhoneCallDebuggingArtifacts) {
    console.log('[Voice Bot] Debugging artifacts in status update:', JSON.stringify(message.inboundPhoneCallDebuggingArtifacts, null, 2));
  }
  
  return res.json({ success: true });
}

// Handle hang
function handleHang(event, res) {
  console.log('[Voice Bot] Call hung up');
  return res.json({ success: true });
}

// Handle transcript updates
function handleTranscript(event, res, supabase) {
  // Transcript updates are handled in real-time by Vapi.ai
  // We can log them if needed
  console.log('[Voice Bot] Transcript update:', event.transcript?.slice(-50));
  return res.json({ success: true });
}

// Identify caller by location (property name + unit number or address)
async function identifyCallerByLocation(functionArgs, supabase) {
  try {
    const { property_name, unit_number, address } = functionArgs;
    
    let unitInfo = null;
    
    // Try property name + unit number first
    if (property_name && unit_number) {
      console.log('[Voice Bot] Attempting to identify by property name + unit:', { property_name, unit_number });
      unitInfo = await findUnitByPropertyNameAndUnit(supabase, property_name, unit_number);
    }
    
    // Try property name alone (might need clarification)
    if (!unitInfo && property_name && !address) {
      console.log('[Voice Bot] Attempting to identify by property name only:', property_name);
      const properties = await findPropertiesByName(supabase, property_name);
      if (properties.length === 1) {
        // Single match - try to find units
        const { data: units } = await supabase
          .from('units')
          .select('unit_id, property_id, unit_number')
          .eq('property_id', properties[0].property_id);
        if (units && units.length === 1) {
          const { data: activeLease } = await supabase
            .from('lease_clients')
            .select('user_id, leases!inner(unit_id, status)')
            .eq('leases.unit_id', units[0].unit_id)
            .eq('leases.status', 'active')
            .limit(1)
            .maybeSingle();
          if (activeLease) {
            unitInfo = {
              unitId: units[0].unit_id,
              propertyId: properties[0].property_id,
              userId: activeLease.user_id
            };
          }
        } else if (units && units.length > 1) {
        // Replace "#" in property name for proper pronunciation
        const propertyNameFormatted = properties[0].property_name.replace(/#/g, 'number ');
        return {
          success: false,
          needsUnitNumber: true,
          propertyName: properties[0].property_name,
          unitCount: units.length,
          message: `I found ${propertyNameFormatted}, but there are multiple units. What's your unit number?`
        };
        }
      } else if (properties.length > 1) {
        // Replace "#" in property names for proper pronunciation
        const propertyNameFormatted = property_name.replace(/#/g, 'number ');
        const firstPropertyNameFormatted = properties[0].property_name.replace(/#/g, 'number ');
        const firstPropertyAddressFormatted = properties[0].address ? properties[0].address.replace(/#/g, 'number ') : null;
        return {
          success: false,
          multipleProperties: properties,
          message: `I found multiple properties matching "${propertyNameFormatted}". Could you clarify which one? For example, is it ${firstPropertyNameFormatted}${firstPropertyAddressFormatted ? ' in ' + firstPropertyAddressFormatted : ''}?`
        };
      }
    }
    
    // If that didn't work, try address
    if (!unitInfo && address) {
      console.log('[Voice Bot] Attempting to identify by address:', address);
      unitInfo = await findUnitByAddress(supabase, address);
      
      // Check if multiple units found
      if (unitInfo && unitInfo.multipleUnits) {
        // Replace "#" in property name for proper pronunciation
        const propertyNameFormatted = unitInfo.propertyName.replace(/#/g, 'number ');
        return {
          success: false,
          needsUnitNumber: true,
          propertyName: unitInfo.propertyName,
          unitCount: unitInfo.units.length,
          message: `I found ${propertyNameFormatted}, but there are multiple units. What's your unit number?`
        };
      }
    }
    
    if (unitInfo && unitInfo.unitId) {
      // Get responsible person names for this unit
      const responsiblePersons = await getResponsiblePersonNamesForUnit(supabase, unitInfo.unitId);
      
      return {
        success: true,
        unitId: unitInfo.unitId,
        propertyId: unitInfo.propertyId,
        userId: unitInfo.userId,
        responsiblePersons: responsiblePersons, // Array of {first_name, last_name, middle_name}
        message: unitInfo.userId 
          ? 'I found your account. How can I help you with your maintenance request?'
          : 'I found the unit, but I couldn\'t find an active lease. Let me continue with your request.'
      };
    }
    
    // Build a readable address string from what we heard
    // Replace "#" with "number" for proper pronunciation (e.g., "#201" -> "number 201")
    // Expand directional abbreviations for proper speech (e.g., "NE" -> "Northeast")
    const addressParts = [];
    if (address) {
      let addressFormatted = address.replace(/#/g, 'number ');
      // Expand directionals: N, S, E, W, NE, NW, SE, SW
      addressFormatted = addressFormatted
        .replace(/\bNE\b/gi, 'Northeast')
        .replace(/\bNW\b/gi, 'Northwest')
        .replace(/\bSE\b/gi, 'Southeast')
        .replace(/\bSW\b/gi, 'Southwest')
        .replace(/\bN\b/gi, 'North')
        .replace(/\bS\b/gi, 'South')
        .replace(/\bE\b/gi, 'East')
        .replace(/\bW\b/gi, 'West');
      addressParts.push(addressFormatted);
    }
    if (property_name) {
      let propertyFormatted = property_name
        .replace(/#/g, 'number ') // Replace "#" with "number" for proper pronunciation
        .replace(/\bNE\b/gi, 'Northeast')
        .replace(/\bNW\b/gi, 'Northwest')
        .replace(/\bSE\b/gi, 'Southeast')
        .replace(/\bSW\b/gi, 'Southwest')
        .replace(/\bN\b/gi, 'North')
        .replace(/\bS\b/gi, 'South')
        .replace(/\bE\b/gi, 'East')
        .replace(/\bW\b/gi, 'West');
      addressParts.push(propertyFormatted);
    }
    if (unit_number) {
      const unitFormatted = unit_number.replace(/#/g, 'number ');
      addressParts.push(`unit ${unitFormatted}`);
    }
    
    const heardAddress = addressParts.length > 0 
      ? addressParts.join(', ')
      : 'that information';
    
    return {
      success: false,
      heardAddress: heardAddress,
      address: address,
      property_name: property_name,
      unit_number: unit_number,
      message: `I heard the address as "${heardAddress}". Is that correct? If not, could you repeat it or correct any mistakes?`
    };
  } catch (error) {
    console.error('[Voice Bot] Error identifying caller by location:', error);
    
    // Build a readable address string from what we heard (if available)
    // Replace "#" with "number" for proper pronunciation (e.g., "#201" -> "number 201")
    // Expand directional abbreviations for proper speech (e.g., "NE" -> "Northeast")
    const { property_name, unit_number, address } = functionArgs || {};
    const addressParts = [];
    if (address) {
      let addressFormatted = address.replace(/#/g, 'number ')
        .replace(/\bNE\b/gi, 'Northeast')
        .replace(/\bNW\b/gi, 'Northwest')
        .replace(/\bSE\b/gi, 'Southeast')
        .replace(/\bSW\b/gi, 'Southwest')
        .replace(/\bN\b/gi, 'North')
        .replace(/\bS\b/gi, 'South')
        .replace(/\bE\b/gi, 'East')
        .replace(/\bW\b/gi, 'West');
      addressParts.push(addressFormatted);
    }
    if (property_name) {
      let propertyFormatted = property_name.replace(/#/g, 'number ')
        .replace(/\bNE\b/gi, 'Northeast')
        .replace(/\bNW\b/gi, 'Northwest')
        .replace(/\bSE\b/gi, 'Southeast')
        .replace(/\bSW\b/gi, 'Southwest')
        .replace(/\bN\b/gi, 'North')
        .replace(/\bS\b/gi, 'South')
        .replace(/\bE\b/gi, 'East')
        .replace(/\bW\b/gi, 'West');
      addressParts.push(propertyFormatted);
    }
    if (unit_number) {
      const unitFormatted = unit_number.replace(/#/g, 'number ');
      addressParts.push(`unit ${unitFormatted}`);
    }
    
    const heardAddress = addressParts.length > 0 
      ? addressParts.join(', ')
      : 'that information';
    
    return {
      success: false,
      heardAddress: heardAddress,
      address: address,
      property_name: property_name,
      unit_number: unit_number,
      message: `I encountered an error looking up your information. I heard the address as "${heardAddress}". Is that correct? If not, could you repeat it?`
    };
  }
}

// Identify caller by name and birthdate (for responsible person)
async function identifyCallerByNameAndBirthdate(functionArgs, supabase) {
  try {
    const { first_name, last_name, date_of_birth } = functionArgs;
    
    if (!first_name || !last_name || !date_of_birth) {
      return {
        success: false,
        message: 'I need your first name, last name, and date of birth to verify your identity.'
      };
    }
    
    const userMatch = await findUserByNameAndBirthdate(supabase, first_name, last_name, date_of_birth);
    
    if (!userMatch) {
      return {
        success: false,
        message: 'I couldn\'t find a match with that information. Could you spell your last name for me? And what\'s your date of birth?'
      };
    }
    
    // Get user's unit info
    const unitInfo = await getUserUnitInfo(supabase, userMatch.userId);
    
    if (unitInfo && unitInfo.unitId) {
      return {
        success: true,
        unitId: unitInfo.unitId,
        propertyId: unitInfo.propertyId,
        userId: userMatch.userId,
        message: `Thank you ${first_name}, I found your account. How can I help you with your maintenance request?`
      };
    }
    
    return {
      success: false,
      message: 'I found your account but couldn\'t find an active unit. I\'ll continue with your request as an unassigned maintenance request that an administrator will review.'
    };
  } catch (error) {
    console.error('[Voice Bot] Error identifying caller by name and birthdate:', error);
    return {
      success: false,
      message: 'I encountered an error looking up your information. Could you spell your last name for me? And what\'s your date of birth?'
    };
  }
}

// Identify responsible person by name and location (for strangers calling about someone else's property)
async function identifyResponsiblePersonByNameAndLocation(functionArgs, supabase) {
  try {
    const { first_name, last_name, property_name, address, unit_number } = functionArgs;
    
    if (!first_name || !last_name) {
      return {
        success: false,
        message: 'I need the first and last name of the person responsible for the property.'
      };
    }
    
    if (!property_name && !address) {
      return {
        success: false,
        message: 'I need either the property name or address to find the responsible person.'
      };
    }
    
    const match = await findResponsiblePersonByNameAndLocation(
      supabase, 
      first_name, 
      last_name, 
      property_name, 
      address, 
      unit_number
    );
    
    if (!match) {
      // Build a readable address string from what we heard
      // Expand directional abbreviations for proper speech (e.g., "NE" -> "Northeast")
      const addressParts = [];
      if (address) {
        let addressFormatted = address
          .replace(/\bNE\b/gi, 'Northeast')
          .replace(/\bNW\b/gi, 'Northwest')
          .replace(/\bSE\b/gi, 'Southeast')
          .replace(/\bSW\b/gi, 'Southwest')
          .replace(/\bN\b/gi, 'North')
          .replace(/\bS\b/gi, 'South')
          .replace(/\bE\b/gi, 'East')
          .replace(/\bW\b/gi, 'West');
        addressParts.push(addressFormatted);
      }
      if (property_name) {
        let propertyFormatted = property_name
          .replace(/\bNE\b/gi, 'Northeast')
          .replace(/\bNW\b/gi, 'Northwest')
          .replace(/\bSE\b/gi, 'Southeast')
          .replace(/\bSW\b/gi, 'Southwest')
          .replace(/\bN\b/gi, 'North')
          .replace(/\bS\b/gi, 'South')
          .replace(/\bE\b/gi, 'East')
          .replace(/\bW\b/gi, 'West');
        addressParts.push(propertyFormatted);
      }
      if (unit_number) {
        // Replace "#" with "number" for proper pronunciation (e.g., "#201" -> "number 201")
        const unitFormatted = unit_number.replace(/#/g, 'number ');
        addressParts.push(`unit ${unitFormatted}`);
      }
      
      const heardAddress = addressParts.length > 0 
        ? addressParts.join(', ')
        : 'that information';
      
      return {
        success: false,
        heardAddress: heardAddress,
        address: address,
        property_name: property_name,
        unit_number: unit_number,
        first_name: first_name,
        last_name: last_name,
        message: `I couldn't find a match for ${first_name} ${last_name} at "${heardAddress}". I heard the address as "${heardAddress}" - is that correct? If not, could you repeat it or correct any mistakes?`
      };
    }
    
    // Handle multiple properties or units
    if (match.needsClarification) {
      const propertyList = match.multipleProperties.map(p => 
        `${p.property_name}${p.address ? ' in ' + p.address : ''}`
      ).join(', or ');
      return {
        success: false,
        multipleProperties: match.multipleProperties,
        message: `I found multiple properties. Could you clarify which one? Is it ${propertyList}?`
      };
    }
    
    if (match.needsUnitNumber) {
      // Replace "#" in property name for proper pronunciation
      const propertyNameFormatted = match.property.property_name.replace(/#/g, 'number ');
      return {
        success: false,
        needsUnitNumber: true,
        property: match.property,
        units: match.units,
        message: `I found ${propertyNameFormatted}, but there are multiple units. What's the unit number?`
      };
    }
    
    if (match.userId && match.unitId) {
      return {
        success: true,
        unitId: match.unitId,
        propertyId: match.propertyId,
        userId: match.userId,
        message: `I found ${first_name} ${last_name}'s account. How can I help you with the maintenance request?`
      };
    }
    
    return {
      success: false,
      message: 'I found the property but couldn\'t find an active lease for that person. I\'ll continue with your request as an unassigned maintenance request that an administrator will review.'
    };
  } catch (error) {
    console.error('[Voice Bot] Error identifying responsible person:', error);
    return {
      success: false,
      message: 'I encountered an error looking up the information. Could you spell the last name? And could you repeat the address or property name?'
    };
  }
}

// Identify caller by personal information (phone number or email address)
async function identifyCallerByInfo(functionArgs, supabase) {
  try {
    const { caller_name, responsible_person_phone } = functionArgs;
    
    if (!responsible_person_phone) {
      return {
        success: false,
        message: 'I need the phone number or email address of the person responsible for the unit to look them up.'
      };
    }
    
    // Check if input is an email address
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsible_person_phone.trim());
    
    let contact = null;
    let foundUserId = null;
    
    if (isEmail) {
      // Search by email address
      const email = responsible_person_phone.trim().toLowerCase();
      console.log('[Voice Bot] Searching by email address:', email);
      
      // Try 'user' type first
      const { data: contactMethodUser } = await supabase
        .from('contact_methods')
        .select('contact_id, method_type, contacts!inner(contactable_id, contactable_type)')
        .eq('value', email)
        .eq('contacts.contactable_type', 'user')
        .in('method_type', ['Email', 'email', 'Email Address'])
        .limit(1)
        .maybeSingle();
      
      if (contactMethodUser?.contacts) {
        contact = contactMethodUser.contacts;
        foundUserId = contact.contactable_id;
        console.log('[Voice Bot] Found user by email:', { userId: foundUserId, email });
      } else {
        // Try 'client' type (clients/tenants have contactable_type='client')
        const { data: contactMethodTenant } = await supabase
          .from('contact_methods')
          .select('contact_id, method_type, contacts!inner(contactable_id, contactable_type)')
          .eq('value', email)
          .eq('contacts.contactable_type', 'client')
          .in('method_type', ['Email', 'email', 'Email Address'])
          .limit(1)
          .maybeSingle();
        
        if (contactMethodTenant?.contacts) {
          const tenantContact = contactMethodTenant.contacts;
          // Get the user_id from the client record
          const { data: client } = await supabase
            .from('clients')
            .select('user_id')
            .eq('client_id', tenantContact.contactable_id)
            .maybeSingle();
          
          if (client?.user_id) {
            foundUserId = client.user_id;
            contact = { contactable_id: foundUserId, contactable_type: 'user' };
            console.log('[Voice Bot] Found tenant by email, converted to user_id:', { userId: foundUserId, email });
          }
        }
      }
    } else {
      // Find user by phone number
      const normalized = normalizePhoneNumber(responsible_person_phone);
      const searchFormats = [
        normalized,
        `+1${normalized}`,
        `1${normalized}`,
        responsible_person_phone.replace(/\D/g, '')
      ].filter(Boolean);
      
      // Try both 'user' and 'tenant' contactable types
      for (const format of searchFormats) {
        // Try 'user' type first
        const { data: contactMethodUser } = await supabase
          .from('contact_methods')
          .select('contact_id, contacts!inner(contactable_id, contactable_type)')
          .eq('value', format)
          .eq('contacts.contactable_type', 'user')
          .limit(1)
          .maybeSingle();
        
        if (contactMethodUser?.contacts) {
          contact = contactMethodUser.contacts;
          foundUserId = contact.contactable_id;
          break;
        }
        
        // Try 'client' type (clients/tenants have contactable_type='client')
        const { data: contactMethodTenant } = await supabase
          .from('contact_methods')
          .select('contact_id, contacts!inner(contactable_id, contactable_type)')
          .eq('value', format)
          .eq('contacts.contactable_type', 'client')
          .limit(1)
          .maybeSingle();
        
        if (contactMethodTenant?.contacts) {
          const tenantContact = contactMethodTenant.contacts;
          // Get the user_id from the client record
          const { data: client } = await supabase
            .from('clients')
            .select('user_id')
            .eq('client_id', tenantContact.contactable_id)
            .maybeSingle();
          
          if (client?.user_id) {
            foundUserId = client.user_id;
            contact = { contactable_id: foundUserId, contactable_type: 'user' };
            break;
          }
        }
      }
    }
    
    if (!foundUserId) {
      return {
        success: false,
        message: isEmail 
          ? 'I couldn\'t find an account with that email address. Could you please verify the email address or try providing your phone number instead?'
          : 'I couldn\'t find an account with that phone number. Could you please verify the phone number? For example, is it spelled out or do you have an alternative number I could try?'
      };
    }
    
    // Get user's unit info
    const unitInfo = await getUserUnitInfo(supabase, foundUserId);
    
    if (unitInfo && unitInfo.unitId) {
      return {
        success: true,
        unitId: unitInfo.unitId,
        propertyId: unitInfo.propertyId,
        userId: foundUserId,
        caller_name: caller_name || null,
        message: `Thank you ${caller_name ? caller_name + ', ' : ''}I found the account. How can I help you with your maintenance request?`
      };
    }
    
    return {
      success: false,
      message: 'I found the account but couldn\'t find an active unit. I\'ll continue with your request as an unassigned maintenance request that an administrator will review.'
    };
  } catch (error) {
    console.error('[Voice Bot] Error identifying caller by info:', error);
    return {
      success: false,
      message: 'I encountered an error looking up the information. I\'ll continue with your request as an unassigned maintenance request that an administrator will review.'
    };
  }
}

// Call vendor function - makes outbound call to vendor
async function callVendor(vendorId, vendorPhone, maintenanceRequestId, callId, supabase) {
  try {
    if (!process.env.VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY not configured');
    }

    // Get vendor information
    const { data: vendor } = await supabase
      .from('vendors')
      .select('company_name, description')
      .eq('vendor_id', vendorId)
      .single();

    // Get maintenance request details and tenant phone
    const { data: maintenanceRequest } = await supabase
      .from('maintenance_requests')
      .select('description, priority, tenant_user_id, admin_notes, units!inner(unit_number, properties!inner(property_type))')
      .eq('request_id', maintenanceRequestId)
      .single();
    
    // Extract scheduling preferences from admin_notes
    let schedulingPreferences = '';
    if (maintenanceRequest?.admin_notes) {
      const preferencesMatch = maintenanceRequest.admin_notes.match(/Scheduling Preferences:\s*(.+?)(?:\n\n|$)/i);
      if (preferencesMatch) {
        schedulingPreferences = preferencesMatch[1].trim();
      }
    }

    // Get tenant phone number for DEBUG_MODE routing
    let tenantPhone = null;
    if (maintenanceRequest?.tenant_user_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('contact_id')
        .eq('contactable_id', maintenanceRequest.tenant_user_id)
        .eq('contactable_type', 'user')
        .limit(1)
        .maybeSingle();
      
      if (contact) {
        const { data: contactMethods } = await supabase
          .from('contact_methods')
          .select('value, method_type')
          .eq('contact_id', contact.contact_id)
          .in('method_type', ['Phone', 'phone', 'Cell', 'cell'])
          .limit(1)
          .maybeSingle();
        
        if (contactMethods) {
          tenantPhone = contactMethods.value;
        }
      }
    }

    // Route phone number based on DEBUG_MODE
    let actualPhone;
    let rolePlayMessage = '';
    
    if (isDebugMode()) {
      try {
        // In DEBUG_MODE, route to Global Admin
        actualPhone = await routePhoneNumber(supabase, vendorPhone, tenantPhone);
        
        // Get Global Admin phone for role-play announcement
        const adminPhones = await getGlobalAdminPhones(supabase);
        if (adminPhones.length > 0) {
          const adminPhone = adminPhones[0];
          const e164AdminPhone = adminPhone.length === 10 ? `+1${adminPhone}` : `+${adminPhone}`;
          rolePlayMessage = `\n\nIMPORTANT - DEBUG_MODE: You are calling a Global Admin at ${e164AdminPhone} who will role-play as the vendor "${vendor?.company_name || 'Vendor'}". Start the call by saying: "Hello, I'm calling on behalf of the property management company. I need to speak with ${vendor?.company_name || 'the vendor'} about a maintenance request. Are you ready to role-play as ${vendor?.company_name || 'the vendor'}?" If they respond with "No", "Stop", or hang up, end the call immediately and do not call again.`;
        }
      } catch (error) {
        // In DEBUG_MODE, if routing fails (not a Global Admin), don't make the call
        console.error('[DEBUG_MODE] Cannot call vendor - not a Global Admin phone:', error.message);
        return {
          success: false,
          error: 'DEBUG_MODE: Cannot call non-Global Admin phone number'
        };
      }
    } else {
      actualPhone = vendorPhone;
    }

    // Create Vapi.ai outbound call
    const vapiResponse = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, // Your Vapi.ai phone number ID
        customer: {
          number: actualPhone
        },
        assistant: {
          model: {
            provider: 'openai',
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: `You are calling a vendor to schedule a maintenance appointment. 

Maintenance Request Details:
- Request ID: ${maintenanceRequestId}
- Issue: ${maintenanceRequest?.description || 'Not specified'}
- Priority: ${maintenanceRequest?.priority || 'Not specified'}
- Unit: ${maintenanceRequest?.units?.unit_number || 'Not specified'}
- Property Type: ${maintenanceRequest?.units?.properties?.property_type || 'Not specified'}
${schedulingPreferences ? `- Tenant Scheduling Preferences: ${schedulingPreferences}` : ''}

Vendor Information:
- Company: ${vendor?.company_name || 'Not specified'}
- Description: ${vendor?.description || 'Not specified'}
${rolePlayMessage}

Your goal is to:
1. ${rolePlayMessage ? 'First, ask if they are ready to role-play as the vendor. If they say "No", "Stop", or hang up, end the call immediately.' : 'Introduce yourself as calling from the property management company'}
2. Explain the maintenance issue briefly and clearly
${schedulingPreferences ? `3. IMPORTANT: The tenant has provided scheduling preferences: "${schedulingPreferences}". Please consider these preferences when scheduling the appointment.` : '3. Ask if they can schedule a service appointment'}
4. Get a preferred date/time if possible${schedulingPreferences ? ', keeping in mind the tenant\'s preferences' : ''}
5. When a date/time is agreed upon, use the schedule_appointment function to save the appointment
6. Confirm the appointment details
7. Thank them and end the call politely

IMPORTANT: When the vendor agrees to a specific date and time, you MUST call the schedule_appointment function with:
- vendorId: ${vendorId}
- maintenanceRequestId: ${maintenanceRequestId}
- scheduledDateTime: The agreed date/time in ISO 8601 format (e.g., "2025-01-15T14:30:00-08:00")
- estimatedDurationMinutes: (optional) Estimated duration if discussed
- notes: (optional) Any special notes about the appointment

Keep the conversation professional, concise, and friendly. If they cannot schedule immediately, ask when would be a good time to call back.`
              }
            ],
            functions: [
              {
                name: 'schedule_appointment',
                description: 'Schedule an appointment between a tenant and vendor for a maintenance request. Use this when the vendor agrees to a specific date and time during a call, or when scheduling an appointment directly. The appointment will be saved to the database and the tenant will be notified according to their notification preferences.',
                parameters: {
                  type: 'object',
                  properties: {
                    vendorId: {
                      type: 'number',
                      description: 'The vendor ID for the appointment'
                    },
                    maintenanceRequestId: {
                      type: 'number',
                      description: 'The maintenance request ID associated with this appointment'
                    },
                    scheduledDateTime: {
                      type: 'string',
                      description: 'The scheduled date and time in ISO 8601 format (e.g., "2025-01-15T14:30:00Z" or "2025-01-15T14:30:00-08:00"). Must include timezone information.'
                    },
                    estimatedDurationMinutes: {
                      type: 'number',
                      description: 'Optional: Estimated duration of the appointment in minutes (e.g., 60 for 1 hour)'
                    },
                    notes: {
                      type: 'string',
                      description: 'Optional: Additional notes about the appointment (e.g., "Vendor will bring replacement parts", "Tenant requested morning appointment")'
                    }
                  },
                  required: ['vendorId', 'maintenanceRequestId', 'scheduledDateTime']
                }
              }
            ]
          },
          voice: {
            provider: '11labs',
            voiceId: process.env.VAPI_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
            // Voice settings to improve volume and consistency
            stability: 0.9,           // High stability for consistent, clear output (0-1)
            similarityBoost: 0.8,     // High similarity for clear voice matching (0-1)
            style: 0.0,              // Low style to prevent volume variations (0-1)
            useSpeakerBoost: true,   // Boost speaker clarity and volume
            speed: 1.0               // Normal speaking speed (0.7-1.2)
          },
          serverUrl: process.env.VAPI_SERVER_URL || `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/voice/maintenance-bot`
        },
        customData: {
          type: 'vendor_call',
          maintenanceRequestId,
          vendorId
        }
      })
    });

    if (!vapiResponse.ok) {
      const error = await vapiResponse.text();
      throw new Error(`Vapi.ai API error: ${error}`);
    }

    const callData = await vapiResponse.json();

    return {
      success: true,
      callId: callData.id,
      message: `Calling vendor at ${actualPhone}...`
    };
  } catch (error) {
    console.error('[Voice Bot] Error calling vendor:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function scheduleAppointment(vendorId, maintenanceRequestId, scheduledDateTime, estimatedDurationMinutes, notes, supabase) {
  try {
    console.log('[Voice Bot] [scheduleAppointment] Called with:', {
      vendorId,
      maintenanceRequestId,
      scheduledDateTime,
      estimatedDurationMinutes,
      notes
    });

    // Validate scheduled date/time
    const scheduledDate = new Date(scheduledDateTime);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error(`Invalid date/time format: ${scheduledDateTime}. Must be ISO 8601 format.`);
    }

    // Get maintenance request to find client_id
    const { data: maintenanceRequest, error: requestError } = await supabase
      .from('maintenance_requests')
      .select('tenant_user_id, unit_id')
      .eq('request_id', maintenanceRequestId)
      .single();

    if (requestError || !maintenanceRequest) {
      throw new Error(`Maintenance request ${maintenanceRequestId} not found: ${requestError?.message || 'Not found'}`);
    }

    if (!maintenanceRequest.tenant_user_id) {
      throw new Error(`Maintenance request ${maintenanceRequestId} has no tenant_user_id`);
    }

    // Get client_id from user_id
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('client_id')
      .eq('user_id', maintenanceRequest.tenant_user_id)
      .maybeSingle();

    if (clientError) {
      console.error('[Voice Bot] [scheduleAppointment] Error finding client:', clientError);
      throw new Error(`Error finding client for user ${maintenanceRequest.tenant_user_id}: ${clientError.message}`);
    }

    if (!client?.client_id) {
      throw new Error(`No client found for user_id ${maintenanceRequest.tenant_user_id}`);
    }

    // Create appointment record
    const { data: appointment, error: appointmentError } = await supabase
      .from('client_appointments')
      .insert([{
        client_id: client.client_id,
        vendor_id: vendorId,
        maintenance_request_id: maintenanceRequestId,
        scheduled_date_time: scheduledDate.toISOString(),
        estimated_duration_minutes: estimatedDurationMinutes || null,
        notes: notes || null,
        status: 'scheduled',
        created_by_user_id: null  // Bot-created
      }])
      .select('appointment_id')
      .single();

    if (appointmentError) {
      console.error('[Voice Bot] [scheduleAppointment] Error creating appointment:', appointmentError);
      throw new Error(`Failed to create appointment: ${appointmentError.message}`);
    }

    console.log('[Voice Bot] [scheduleAppointment] Appointment created:', appointment.appointment_id);

    // Send notification to tenant (async - don't wait)
    // Use the notification system endpoint
    fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/notifications/send-appointment-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
      },
      body: JSON.stringify({
        appointmentId: appointment.appointment_id
      })
    }).catch(err => {
      console.error('[Voice Bot] [scheduleAppointment] Error sending notification (non-blocking):', err);
    });

    // Make confirmation call to tenant (async - don't wait)
    makeConfirmationCall(appointment.appointment_id, maintenanceRequestId, supabase).catch(err => {
      console.error('[Voice Bot] [scheduleAppointment] Error making confirmation call (non-blocking):', err);
    });

    // Format date/time for user-friendly message
    const formattedDate = scheduledDate.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    return {
      success: true,
      appointmentId: appointment.appointment_id,
      message: `Appointment scheduled for ${formattedDate}. The tenant will receive a confirmation notification and a confirmation call.`
    };
  } catch (error) {
    console.error('[Voice Bot] [scheduleAppointment] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

