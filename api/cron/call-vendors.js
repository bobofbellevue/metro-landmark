/* eslint-env node */
/**
 * Automatic Vendor Calling Cron Job
 * 
 * This job runs periodically (every 10 minutes) to:
 * 1. Find maintenance requests (Urgent, High, or Medium priority) without vendor contact
 * 2. Automatically call the assigned vendor to schedule
 * 3. Update request status
 * 
 * Setup in Vercel:
 * - Configured in vercel.json with schedule: every 10 minutes
 * - IMPORTANT: Vercel cron jobs ONLY run in Production environment
 * - They do NOT run on preview deployments
 * - Ensure the project is deployed to Production
 * - Verify cron jobs are enabled in Vercel dashboard (Settings > Cron Jobs)
 * - Cron jobs require a paid Vercel plan (Hobby plan or above)
 * 
 * To test manually:
 * - Use Vercel dashboard "Run" button (only works in Production)
 * - Or make a GET request to /api/cron/call-vendors with proper authorization
 */

import { createClient } from '@supabase/supabase-js';
import { isDebugMode, getGlobalAdminPhones } from '../voice/vapi-config.js';
import { getVapiPhoneNumberE164, getVapiPhoneNumberId, resolveOutboundVapiPhoneNumberId } from '../utils/phones.js';
import OpenAI from 'openai';
import { brand } from '../utils/brand.js';

export default async function handler(req, res) {
  try {
    const startTime = new Date().toISOString();
    
    // Health check endpoint - respond immediately BEFORE any other checks
    // Parse query from URL or req.query (Vercel serverless functions)
    let healthCheck = false;
    if (req.query && req.query.health === 'check') {
      healthCheck = true;
    } else if (req.url && req.url.includes('health=check')) {
      healthCheck = true;
    }
    
    if (healthCheck) {
      return res.json({ 
        status: 'healthy', 
        timestamp: startTime,
        environment: process.env.VERCEL_ENV || 'unknown',
        cronConfigured: true,
        method: req.method,
        url: req.url,
        moduleLoaded: true
      });
    }
    
    console.log(`[Call Vendors Cron] ===== CRON JOB TRIGGERED at ${startTime} =====`);
    console.log(`[Call Vendors Cron] Request method: ${req.method}`);
    console.log(`[Call Vendors Cron] Request URL: ${req.url}`);
    console.log(`[Call Vendors Cron] Request headers:`, {
      authorization: req.headers.authorization ? 'present' : 'missing',
      'user-agent': req.headers['user-agent'],
      'x-vercel-cron': req.headers['x-vercel-cron'],
      'x-vercel-id': req.headers['x-vercel-id']
    });
    
    // Verify this is a cron job request
    // Vercel cron jobs send user-agent: 'vercel-cron/1.0' but may not send Authorization header
    // External cron services should send Authorization header with CRON_SECRET
    const isVercelCron = req.headers['user-agent'] === 'vercel-cron/1.0';
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
    
    if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.error(`[Call Vendors Cron] Unauthorized - Expected: Bearer ${cronSecret?.substring(0, 10)}..., Got: ${authHeader?.substring(0, 20)}...`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (isVercelCron) {
      console.log('[Call Vendors Cron] Authenticated as Vercel cron job');
    }

    // Check for required environment variables
    if (!process.env.VAPI_API_KEY) {
      console.error('[Call Vendors Cron] VAPI_API_KEY not set');
      return res.status(500).json({ error: 'VAPI_API_KEY not configured' });
    }

    // Check for either VAPI_PHONE_NUMBER_ID (UUID) or VAPI_PHONE_NUMBER (E.164 format)
    if (!getVapiPhoneNumberId() && !getVapiPhoneNumberE164()) {
      console.error('[Call Vendors Cron] Neither VAPI_PHONE_NUMBER_ID nor VAPI_PHONE_NUMBER is set');
      return res.status(500).json({ error: 'Either VAPI_PHONE_NUMBER_ID (UUID) or VAPI_PHONE_NUMBER (E.164 format like +12064017109) must be configured for outbound calls.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('[Call Vendors Cron] OPENAI_API_KEY not set');
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
      console.error('[Call Vendors Cron] Supabase credentials not set');
      return res.status(500).json({ error: 'Database credentials missing' });
    }

    // Initialize clients
    const supabase = createClient(
      process.env.SUPABASE_URL,
      supabaseSecretKey
    );

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Start vendor calling job
    console.log('[Call Vendors Cron] Starting vendor calling job...');

    // Check if a specific request ID was provided (e.g., from chatbot)
    const specificRequestId = req.body?.maintenance_request_id || req.query?.maintenance_request_id;
    
    let requestsToProcess = [];
    
    if (specificRequestId) {
      // Process the specific request (regardless of priority)
      console.log(`[Call Vendors Cron] Processing specific request: ${specificRequestId}`);
      const { data: specificRequest, error: specificError } = await supabase
        .from('maintenance_requests')
        .select(`
          request_id,
          description,
          priority,
          status,
          assigned_vendor_id,
          unit_id,
          tenant_user_id,
          created_at,
          admin_notes,
          units!inner(
            unit_id,
            unit_number,
            property_id,
            properties!inner(
              property_id,
              property_name,
              property_type,
              landlord_id,
              pmc_id,
              manager_id
            )
          )
        `)
        .eq('request_id', specificRequestId)
        .single();

      if (specificError) {
        console.error(`[Call Vendors Cron] Error fetching specific request ${specificRequestId}:`, specificError);
        return res.status(500).json({ error: 'Error fetching request' });
      }

      if (!specificRequest) {
        console.log(`[Call Vendors Cron] Request ${specificRequestId} not found`);
        return res.json({ 
          success: true, 
          message: `Request ${specificRequestId} not found`,
          processed: 0 
        });
      }

      // Only process if it has an assigned vendor and is in 'New' status
      if (specificRequest.assigned_vendor_id && specificRequest.status === 'New') {
        requestsToProcess = [specificRequest];
        console.log(`[Call Vendors Cron] Will process specific request ${specificRequestId} (Priority: ${specificRequest.priority})`);
      } else {
        // Check if request already has an appointment
        const { data: existingAppointment } = await supabase
          .from('client_appointments')
          .select('appointment_id')
          .eq('maintenance_request_id', specificRequestId)
          .neq('status', 'cancelled')
          .eq('is_archived', false)
          .limit(1)
          .maybeSingle();

        if (existingAppointment) {
          console.log(`[Call Vendors Cron] Skipping request ${specificRequestId} - already has an appointment`);
          return res.json({ 
            success: true, 
            message: `Request ${specificRequestId} skipped (already has an appointment)`,
            processed: 0 
          });
        }

        console.log(`[Call Vendors Cron] Skipping request ${specificRequestId} - no vendor assigned or wrong status`);
        return res.json({ 
          success: true, 
          message: `Request ${specificRequestId} skipped (no vendor or wrong status)`,
          processed: 0 
        });
      }
    } else {
      // Normal cron job: Find maintenance requests that:
      // 1. Are "New" status only
      // 2. Have an assigned vendor
      // 3. Don't already have an appointment scheduled
      // 4. Were created in the last 24 hours (or 15 minutes in DEBUG_MODE to prevent repeated calls)
      const cutoffTime = new Date();
      if (isDebugMode()) {
        // In DEBUG_MODE, only process requests from last 15 minutes to prevent repeated calls
        cutoffTime.setMinutes(cutoffTime.getMinutes() - 15);
        console.log(`[Call Vendors Cron] [DEBUG_MODE] Using 15-minute window to prevent repeated calls`);
      } else {
        // Normal mode: 24 hours
        cutoffTime.setHours(cutoffTime.getHours() - 24);
      }

      console.log(`[Call Vendors Cron] Searching for requests with cutoff time: ${cutoffTime.toISOString()}`);

      // First, get all maintenance requests that match our criteria
      const { data: allRequests, error: requestsError } = await supabase
        .from('maintenance_requests')
        .select(`
          request_id,
          description,
          priority,
          status,
          assigned_vendor_id,
          unit_id,
          tenant_user_id,
          created_at,
          admin_notes,
          units!inner(
            unit_id,
            unit_number,
            property_id,
            properties!inner(
              property_id,
              property_name,
              property_type,
              landlord_id,
              pmc_id,
              manager_id
            )
          )
        `)
        .eq('status', 'New')
        .not('assigned_vendor_id', 'is', null)
        .gte('created_at', cutoffTime.toISOString())
        .order('created_at', { ascending: false })
        .limit(50); // Get more to filter out ones with appointments

      if (requestsError) {
        console.error('[Call Vendors Cron] Error fetching requests:', requestsError);
        return res.status(500).json({ error: 'Error fetching requests' });
      }

      if (!allRequests || allRequests.length === 0) {
        console.log(`[Call Vendors Cron] No requests found matching criteria (status: New, has vendor, created after cutoff)`);
        return res.json({ 
          success: true, 
          message: 'No requests found matching criteria',
          processed: 0 
        });
      }

      // Get all request IDs that already have appointments (excluding cancelled ones)
      const requestIds = allRequests.map(r => r.request_id);
      const { data: existingAppointments } = await supabase
        .from('client_appointments')
        .select('maintenance_request_id')
        .in('maintenance_request_id', requestIds)
        .neq('status', 'cancelled')
        .eq('is_archived', false);

      const requestIdsWithAppointments = new Set(
        (existingAppointments || []).map(a => a.maintenance_request_id)
      );

      // Filter out requests that already have appointments
      const requestsToCall = allRequests.filter(r => !requestIdsWithAppointments.has(r.request_id));

      if (requestIdsWithAppointments.size > 0) {
        console.log(`[Call Vendors Cron] Skipping ${requestIdsWithAppointments.size} request(s) that already have appointments:`, Array.from(requestIdsWithAppointments));
      }

      if (!requestsToCall || requestsToCall.length === 0) {
        console.log(`[Call Vendors Cron] No requests found matching criteria (status: New, has vendor, no existing appointment, created after cutoff)`);
        // Log a sample query to help debug - show why requests are being filtered out
        const { data: sampleRequests } = await supabase
          .from('maintenance_requests')
          .select('request_id, priority, status, assigned_vendor_id, created_at')
          .gte('created_at', cutoffTime.toISOString())
          .order('created_at', { ascending: false })
          .limit(10);
        console.log(`[Call Vendors Cron] Sample of recent requests (last 10):`, sampleRequests);
        
        // Analyze why requests might be filtered out
        if (sampleRequests && sampleRequests.length > 0) {
          const reasons = {
            wrongStatus: sampleRequests.filter(r => r.status !== 'New').length,
            noVendor: sampleRequests.filter(r => !r.assigned_vendor_id).length,
            beforeCutoff: sampleRequests.filter(r => new Date(r.created_at) < cutoffTime).length
          };
          console.log(`[Call Vendors Cron] Filter analysis:`, reasons);
        }
        
        return res.json({ 
          success: true, 
          message: 'No requests found matching criteria',
          processed: 0 
        });
      }

      // Limit to 10 requests per run
      requestsToProcess = requestsToCall.slice(0, 10);
      
      console.log(`[Call Vendors Cron] Found ${requestsToProcess.length} requests to process (out of ${allRequests.length} total matching requests):`, 
        requestsToProcess.map(r => ({ 
          id: r.request_id, 
          priority: r.priority, 
          status: r.status,
          created: r.created_at 
        }))
      );
    }

    const results = [];
    
    console.log(`[Call Vendors Cron] Starting to process ${requestsToProcess.length} request(s)`);
    
    for (const request of requestsToProcess) {
      try {
        console.log(`[Call Vendors Cron] Processing request ${request.request_id}:`, {
          priority: request.priority,
          status: request.status,
          assigned_vendor_id: request.assigned_vendor_id,
          has_admin_notes: !!request.admin_notes
        });
        
        // Check if we've already called this vendor for this request
        // We'll use admin_notes to track calls (or add a new column later)
        const hasCalled = request.admin_notes?.includes('Vendor called automatically');
        
        if (hasCalled) {
          console.log(`[Call Vendors Cron] Skipping request ${request.request_id} - vendor already called`);
          continue;
        }

        // Get vendor contact information
        const { data: vendor, error: vendorError } = await supabase
          .from('vendors')
          .select('vendor_id, company_name, description')
          .eq('vendor_id', request.assigned_vendor_id)
          .single();

        if (vendorError || !vendor) {
          console.error(`[Call Vendors Cron] Error fetching vendor ${request.assigned_vendor_id}:`, vendorError);
          continue;
        }

        // Get vendor contact phone number
        const { data: contacts } = await supabase
          .from('contacts')
          .select('contact_id, contactable_id')
          .eq('contactable_id', vendor.vendor_id)
          .eq('contactable_type', 'vendor')
          .limit(1);

        if (!contacts || contacts.length === 0) {
          console.log(`[Call Vendors Cron] No contact found for vendor ${vendor.vendor_id}`);
          continue;
        }

        // Route phone number based on DEBUG_MODE
        // In DEBUG_MODE, check admin_notes first for [DEBUG_MODE phone: ...]
        let actualPhone = null;
        
        if (isDebugMode()) {
          // Check if admin_notes contains a specific DEBUG_MODE phone number
          // Format: [DEBUG_MODE phone: XXX-XXX-XXXX] or [DEBUG_MODE phone: +1XXX-XXX-XXXX]
          let debugModePhone = null;
          if (request.admin_notes) {
            console.log(`[Call Vendors Cron] [DEBUG_MODE] Checking admin_notes for DEBUG_MODE phone. Admin notes length: ${request.admin_notes.length}`);
            // More flexible regex - allows for variations in spacing and format
            const debugPhoneMatch = request.admin_notes.match(/\[DEBUG_MODE\s+phone\s*:\s*([+\d\s\-\(\)\.]+)\]/i);
            if (debugPhoneMatch && debugPhoneMatch[1]) {
              debugModePhone = debugPhoneMatch[1].trim();
              console.log(`[Call Vendors Cron] [DEBUG_MODE] Found specific phone in admin_notes: ${debugModePhone}`);
            } else {
              // Try alternative patterns
              const altPatterns = [
                /DEBUG_MODE\s+phone\s*:\s*([+\d\s\-\(\)\.]+)/i,
                /\[DEBUG_MODE\s+phone\s*:\s*([+\d\s\-\(\)\.]+)/i,
                /DEBUG_MODE.*?phone.*?([+\d\s\-\(\)\.]{10,})/i
              ];
              
              for (const pattern of altPatterns) {
                const match = request.admin_notes.match(pattern);
                if (match && match[1]) {
                  debugModePhone = match[1].trim();
                  console.log(`[Call Vendors Cron] [DEBUG_MODE] Found phone using alternative pattern: ${debugModePhone}`);
                  break;
                }
              }
            }
          }
          
          // In DEBUG_MODE, require a DEBUG_MODE phone in admin_notes
          if (!debugModePhone) {
            console.log(`[Call Vendors Cron] [DEBUG_MODE] No DEBUG_MODE phone found in admin_notes for request ${request.request_id}.`);
            if (request.admin_notes) {
              console.log(`[Call Vendors Cron] [DEBUG_MODE] Admin notes preview: ${request.admin_notes.substring(0, 200)}...`);
            }
            console.log(`[Call Vendors Cron] [DEBUG_MODE] Skipping call. Add [DEBUG_MODE phone: YOUR-PHONE] to admin_notes.`);
            continue;
          }
          
          try {
            // Normalize the phone number (remove spaces, dashes, parentheses)
            const normalized = debugModePhone.replace(/[\s\-\(\)]/g, '');
            // Ensure it's in E.164 format
            if (normalized.startsWith('+')) {
              actualPhone = normalized;
            } else if (normalized.startsWith('1') && normalized.length === 11) {
              actualPhone = `+${normalized}`;
            } else if (normalized.length === 10) {
              actualPhone = `+1${normalized}`;
            } else {
              actualPhone = debugModePhone; // Use as-is if we can't parse it
            }
            console.log(`[Call Vendors Cron] [DEBUG_MODE] Using phone from admin_notes: ${actualPhone}`);
          } catch (error) {
            console.error(`[Call Vendors Cron] [DEBUG_MODE] Error processing phone number: ${error.message}`);
            console.error(`[Call Vendors Cron] [DEBUG_MODE] Skipping call - error processing phone number.`);
            continue;
          }
        } else {
          // Not in DEBUG_MODE: Get vendor phone from contact methods with priority-based lookup
          const contactIds = contacts.map(c => c.contact_id);
          const { data: contactMethods } = await supabase
            .from('contact_methods')
            .select('value, method_type')
            .in('contact_id', contactIds)
            .limit(50); // Get all contact methods to allow flexible matching

          if (!contactMethods || contactMethods.length === 0) {
            console.log(`[Call Vendors Cron] No contact methods found for vendor ${vendor.vendor_id}`);
            continue;
          }

          // Helper function to normalize text for pattern matching (remove punctuation, whitespace, lowercase)
          const normalizeForMatching = (text) => {
            if (!text) return '';
            return text.toLowerCase().replace(/[\s\-_\.\(\)\[\]]/g, '');
          };

          // Helper function to check if method_type matches a pattern (words can be in any order)
          const matchesPattern = (methodType, words) => {
            const normalized = normalizeForMatching(methodType);
            return words.every(word => normalized.includes(word));
          };

          // Helper function to validate phone number (US numbers only)
          const isValidPhoneNumber = (value) => {
            if (!value) return false;
            // Remove all non-digit characters except +
            const cleaned = value.replace(/[^\d+]/g, '');
            const digitsOnly = cleaned.replace(/\+/g, '');
            
            // Only accept US phone numbers:
            // - 10 digits (US number without country code)
            // - 11 digits starting with 1 (US with country code)
            // - Starts with +1 (US in international format)
            if (digitsOnly.length === 10) return true; // 10-digit US number
            if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) return true; // US with country code
            if (cleaned.startsWith('+1') && digitsOnly.length === 11) return true; // US in +1 format
            // Reject international numbers (any + that isn't +1)
            if (cleaned.startsWith('+') && !cleaned.startsWith('+1')) return false;
            return false;
          };

          // Priority-based phone lookup
          let foundPhone = null;
          let foundMethodType = null;

          // Priority 1: Any combination of 'schedul' and 'phone' (matches schedule, scheduler, scheduling)
          for (const method of contactMethods) {
            if (matchesPattern(method.method_type, ['schedul', 'phone']) && isValidPhoneNumber(method.value)) {
              foundPhone = method.value;
              foundMethodType = method.method_type;
              break;
            }
          }

          // Priority 2: Any combination of 'office' and 'phone'
          if (!foundPhone) {
            for (const method of contactMethods) {
              if (matchesPattern(method.method_type, ['office', 'phone']) && isValidPhoneNumber(method.value)) {
                foundPhone = method.value;
                foundMethodType = method.method_type;
                break;
              }
            }
          }

          // Priority 3: Any 'phone'
          if (!foundPhone) {
            for (const method of contactMethods) {
              const normalized = normalizeForMatching(method.method_type);
              if (normalized.includes('phone') && isValidPhoneNumber(method.value)) {
                foundPhone = method.value;
                foundMethodType = method.method_type;
                break;
              }
            }
          }

          // Priority 4: 'cell'
          if (!foundPhone) {
            for (const method of contactMethods) {
              const normalized = normalizeForMatching(method.method_type);
              if (normalized.includes('cell') && isValidPhoneNumber(method.value)) {
                foundPhone = method.value;
                foundMethodType = method.method_type;
                break;
              }
            }
          }

          // Priority 5: 'mobile'
          if (!foundPhone) {
            for (const method of contactMethods) {
              const normalized = normalizeForMatching(method.method_type);
              if (normalized.includes('mobile') && isValidPhoneNumber(method.value)) {
                foundPhone = method.value;
                foundMethodType = method.method_type;
                break;
              }
            }
          }

          // Priority 6: Any contact method with a valid phone number (regardless of label)
          if (!foundPhone) {
            for (const method of contactMethods) {
              if (isValidPhoneNumber(method.value)) {
                foundPhone = method.value;
                foundMethodType = method.method_type;
                break;
              }
            }
          }

          if (!foundPhone) {
            console.log(`[Call Vendors Cron] No valid phone number found for vendor ${vendor.vendor_id}`);
            console.log(`[Call Vendors Cron] Available contact methods:`, contactMethods.map(m => ({ type: m.method_type, value: m.value?.substring(0, 20) })));
            continue;
          }

          actualPhone = foundPhone;
          console.log(`[Call Vendors Cron] Using vendor phone: ${actualPhone} (method: ${foundMethodType})`);
        }

        console.log(`[Call Vendors Cron] Calling vendor ${vendor.company_name} at ${actualPhone} for request ${request.request_id}`);

        // Make the call
        const callResult = await makeVendorCall({
          vendor,
          request,
          vendorPhone: actualPhone,
          supabase,
          openai,
          isDebugMode: isDebugMode()
        });

        if (callResult.success) {
          // Update request with call information
          const callNote = `Vendor called automatically on ${new Date().toISOString()}. Call ID: ${callResult.callId}. ${callResult.message || ''}`;
          
          await supabase
            .from('maintenance_requests')
            .update({
              admin_notes: request.admin_notes 
                ? `${request.admin_notes}\n\n${callNote}`
                : callNote
            })
            .eq('request_id', request.request_id);

          results.push({
            request_id: request.request_id,
            vendor_id: vendor.vendor_id,
            success: true,
            callId: callResult.callId
          });

          console.log(`[Call Vendors Cron] Successfully called vendor for request ${request.request_id}`);
        } else {
          results.push({
            request_id: request.request_id,
            vendor_id: vendor.vendor_id,
            success: false,
            error: callResult.error
          });

          console.error(`[Call Vendors Cron] Failed to call vendor for request ${request.request_id}:`, callResult.error);
        }

        // Add small delay between calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`[Call Vendors Cron] Error processing request ${request.request_id}:`, error);
        results.push({
          request_id: request.request_id,
          success: false,
          error: error.message
        });
      }
    }

    const endTime = new Date().toISOString();
    const duration = new Date(endTime) - new Date(startTime);
    console.log(`[Call Vendors Cron] ===== CRON JOB COMPLETED at ${endTime} (took ${duration}ms) =====`);
    console.log(`[Call Vendors Cron] Processed ${results.length} requests`);
    
    return res.json({
      success: true,
      processed: results.length,
      results: results,
      timestamp: endTime
    });

  } catch (error) {
    const endTime = new Date().toISOString();
    console.error(`[Call Vendors Cron] ===== CRON JOB ERROR at ${endTime} =====`);
    console.error('[Call Vendors Cron] Error:', error);
    console.error('[Call Vendors Cron] Error name:', error.name);
    console.error('[Call Vendors Cron] Error message:', error.message);
    console.error('[Call Vendors Cron] Stack:', error.stack);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      name: error.name,
      timestamp: endTime
    });
  }
}

/**
 * Make a vendor call using Vapi.ai
 */
async function makeVendorCall({ vendor, request, vendorPhone, supabase, openai, isDebugMode = false }) {
  try {
    const unitNumber = request.units?.unit_number || 'Not specified';
    const propertyName = request.units?.properties?.property_name || 'Not specified';
    const propertyType = request.units?.properties?.property_type || 'Not specified';
    const propertyId = request.units?.properties?.property_id;
    const landlordId = request.units?.properties?.landlord_id;
    const pmcId = request.units?.properties?.pmc_id;
    const managerId = request.units?.properties?.manager_id;

    // Vapi.ai requires phoneNumberId (UUID of the purchased DID in their dashboard).
    const phoneNumberId = await resolveOutboundVapiPhoneNumberId(supabase, pmcId);
    
    if (!phoneNumberId) {
      throw new Error('VAPI_PHONE_NUMBER_ID is not set. Cannot make outbound call. This must be the UUID of your phone number from Vapi.ai dashboard, not the phone number itself.');
    }
    
    // Validate that phoneNumberId is a UUID (Vapi.ai requires UUID format)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(phoneNumberId)) {
      throw new Error(`VAPI_PHONE_NUMBER_ID must be a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx), but got: ${phoneNumberId.substring(0, 30)}... This should be the ID/UUID of your phone number from the Vapi.ai dashboard, not the phone number itself (like +12064017109). To find it: Vapi.ai dashboard → Phone Numbers → Your phone number → Copy the ID.`);
    }

    // Fetch additional property details for voicemail
    let propertyAddress = 'Not specified';
    let ownerName = 'Not specified';
    let managerName = null;
    let managerPhone = null;
    let pmCompanyName = null;

    if (propertyId) {
      // Get property address
      const { data: address } = await supabase
        .from('addresses')
        .select('address_line_1, address_line_2, city, state_province_region, postal_code')
        .eq('addressable_id', propertyId)
        .eq('addressable_type', 'property')
        .limit(1)
        .maybeSingle();

      if (address) {
        const addressParts = [
          address.address_line_1,
          address.address_line_2,
          address.city,
          address.state_province_region,
          address.postal_code
        ].filter(Boolean);
        propertyAddress = addressParts.join(', ') || 'Not specified';
        console.log(`[Call Vendors Cron] Found property address: ${propertyAddress}`);
      } else {
        console.log(`[Call Vendors Cron] No address found for property_id: ${propertyId}, addressable_type: property`);
      }

      // Get owner name
      if (landlordId) {
        const { data: landlord } = await supabase
          .from('landlords')
          .select('landlord_id, company_name, first_name, last_name')
          .eq('landlord_id', landlordId)
          .limit(1)
          .maybeSingle();

        if (landlord) {
          if (landlord.company_name) {
            ownerName = landlord.company_name;
          } else {
            const nameParts = [landlord.first_name, landlord.last_name].filter(Boolean);
            ownerName = nameParts.join(' ') || 'Not specified';
          }
        }
      }

      // Get manager name and phone
      if (managerId) {
        const { data: managerContact, error: managerError } = await supabase
          .from('contacts')
          .select('first_name, middle_name, last_name, contact_id')
          .eq('contactable_id', managerId)
          .eq('contactable_type', 'user')
          .limit(1)
          .maybeSingle();

        if (managerError) {
          console.error(`[Call Vendors Cron] Error fetching manager ${managerId}:`, managerError);
        } else if (managerContact) {
          const nameParts = [
            managerContact.first_name,
            managerContact.middle_name,
            managerContact.last_name
          ].filter(Boolean);
          managerName = nameParts.join(' ') || null;
          console.log(`[Call Vendors Cron] Found manager: ${managerName}`);

          // Get manager phone number
          if (managerContact.contact_id) {
            const { data: managerContactMethods } = await supabase
              .from('contact_methods')
              .select('value, method_type')
              .eq('contact_id', managerContact.contact_id)
              .in('method_type', ['phone', 'Phone', 'cell', 'Cell', 'mobile', 'Mobile', 'CELL', 'MOBILE'])
              .limit(1)
              .maybeSingle();

            if (managerContactMethods) {
              managerPhone = managerContactMethods.value;
              console.log(`[Call Vendors Cron] Found manager phone: ${managerPhone}`);
            }
          }
        } else {
          console.log(`[Call Vendors Cron] No manager contact found for manager_id: ${managerId}, contactable_type: user`);
        }
      } else {
        console.log(`[Call Vendors Cron] No manager_id in property data`);
      }

      // Get PM company name
      if (pmcId) {
        const { data: pmCompany } = await supabase
          .from('pm_companies')
          .select('company_name')
          .eq('pmc_id', pmcId)
          .limit(1)
          .maybeSingle();

        if (pmCompany) {
          pmCompanyName = pmCompany.company_name;
          console.log(`[Call Vendors Cron] Found PM company: ${pmCompanyName}`);
        } else {
          console.log(`[Call Vendors Cron] No PM company found for pmc_id: ${pmcId}`);
        }
      } else {
        console.log(`[Call Vendors Cron] No pmc_id in property data`);
      }
    }

    // Build contact information for payment questions and voicemail
    let paymentContactInfo = '';
    let contactInfoWithPhone = '';
    
    if (managerName && pmCompanyName) {
      paymentContactInfo = `the property manager ${managerName} at ${pmCompanyName}`;
      if (managerPhone) {
        contactInfoWithPhone = `the property manager ${managerName} at ${pmCompanyName}. You can reach ${managerName} directly at ${managerPhone}`;
      } else {
        contactInfoWithPhone = `the property manager ${managerName} at ${pmCompanyName}`;
      }
    } else if (managerName) {
      paymentContactInfo = `the property manager ${managerName}`;
      if (managerPhone) {
        contactInfoWithPhone = `the property manager ${managerName}. You can reach ${managerName} directly at ${managerPhone}`;
      } else {
        contactInfoWithPhone = `the property manager ${managerName}`;
      }
    } else if (pmCompanyName) {
      paymentContactInfo = `${pmCompanyName}`;
      contactInfoWithPhone = `${pmCompanyName}`;
    } else if (effectiveOwnerName) {
      paymentContactInfo = `the property owner ${effectiveOwnerName}`;
      contactInfoWithPhone = `the property owner ${effectiveOwnerName}`;
    } else {
      paymentContactInfo = `the property management company`;
      contactInfoWithPhone = `the property management company`;
    }

    // Get support information if available
    const supportName = process.env.SUPPORT_NAME || '';
    const supportPhone = process.env.SUPPORT_PHONE || '';
    const supportEmail = process.env.SUPPORT_EMAIL || '';
    let supportInfo = '';
    if (supportName || supportPhone || supportEmail) {
      const supportParts = [];
      if (supportName) supportParts.push(supportName);
      if (supportPhone) supportParts.push(supportPhone);
      if (supportEmail) supportParts.push(supportEmail);
      supportInfo = supportParts.join(', ');
    }

    // Determine who you're calling on behalf of
    // Treat "Not specified" as null/undefined for this purpose
    const effectiveOwnerName = (ownerName && ownerName !== 'Not specified') ? ownerName : null;
    // Always use the actual company name if available, never fall back to generic phrase
    // If pmCompanyName exists, use it; otherwise use owner name; only use generic as last resort
    const callingOnBehalfOf = pmCompanyName || effectiveOwnerName || 'the property management company';

    // Extract scheduling preferences from admin_notes
    let schedulingPreferencesText = '';
    let hasSchedulingPreferences = false;
    if (request.admin_notes) {
      const preferencesMatch = request.admin_notes.match(/Scheduling Preferences:\s*(.+?)(?:\n\n|$)/i);
      if (preferencesMatch) {
        schedulingPreferencesText = preferencesMatch[1].trim();
        hasSchedulingPreferences = true;
      }
    }

    // Clean up description to remove trivial details - focus on the main issue
    let cleanedDescription = request.description || 'Not specified';
    // Remove trivial tenant actions/details that aren't relevant to scheduling
    cleanedDescription = cleanedDescription.replace(/the tenant is currently [^.]*\./gi, '');
    cleanedDescription = cleanedDescription.replace(/tenant is [^.]*\./gi, '');
    cleanedDescription = cleanedDescription.trim();
    
    // Summarize description to one sentence for voicemail
    // Extract the first sentence or create a summary
    function summarizeToSentence(text) {
      if (!text || text === 'Not specified') return text;
      // Remove extra whitespace
      text = text.trim().replace(/\s+/g, ' ');
      // If it's already one sentence (no periods except at the end), return it
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length <= 1) {
        return text.endsWith('.') ? text : text + '.';
      }
      // Take the first sentence, or if it's very short, take first two
      const firstSentence = sentences[0].trim();
      if (firstSentence.length < 30 && sentences.length > 1) {
        return (firstSentence + ' ' + sentences[1].trim()).replace(/\s+/g, ' ').trim() + '.';
      }
      return firstSentence.trim() + '.';
    }
    
    const voicemailDescription = summarizeToSentence(cleanedDescription);

    /**
     * Remove duplicate unit information from address
     * Detects unit identifiers in address (e.g., "#201", "Unit 201", "Apt 201", "G-201") 
     * and removes them if they match the unit number from the units table
     */
    function removeDuplicateUnitFromAddress(address, unitNumber) {
      if (!address || !unitNumber || unitNumber === 'Not specified') {
        return address;
      }

      // Normalize unit number for comparison (remove spaces, dashes, convert to lowercase)
      const normalizeUnit = (unit) => {
        if (!unit) return '';
        return unit.toString().toLowerCase().replace(/[\s\-_]/g, '');
      };

      const normalizedUnitNumber = normalizeUnit(unitNumber);

      // Split address into lines
      const addressLines = address.split(',').map(line => line.trim());
      const cleanedLines = [];

      for (let line of addressLines) {
        // Pattern to match unit identifiers: #201, Unit 201, Apt 201, Apt#201, G-201, G201, etc.
        // Matches: optional prefix (unit, apt, apartment, #, number) + optional separator + unit identifier
        const unitPattern = /(?:^|\s)(?:unit|apt|apartment|#|number|no\.?|num\.?)\s*[:\-]?\s*([a-z0-9\-]+)/i;
        const match = line.match(unitPattern);

        if (match && match[1]) {
          const foundUnit = normalizeUnit(match[1]);
          // If the found unit matches our unit number, skip this line
          if (foundUnit === normalizedUnitNumber) {
            continue; // Skip this line - it's a duplicate
          }
        }

        // Also check if the entire line is just a unit identifier
        const lineNormalized = normalizeUnit(line);
        if (lineNormalized === normalizedUnitNumber || 
            lineNormalized === `#${normalizedUnitNumber}` ||
            lineNormalized === `unit${normalizedUnitNumber}` ||
            lineNormalized === `apt${normalizedUnitNumber}`) {
          continue; // Skip this line
        }

        // Check if unit number appears at the end of the line (e.g., "Street #201")
        const endUnitPattern = /[\s#]([a-z0-9\-]+)$/i;
        const endMatch = line.match(endUnitPattern);
        if (endMatch && normalizeUnit(endMatch[1]) === normalizedUnitNumber) {
          // Remove the unit identifier from the end
          line = line.replace(/[\s#][a-z0-9\-]+$/i, '').trim();
        }

        cleanedLines.push(line);
      }

      return cleanedLines.filter(line => line.length > 0).join(', ');
    }

    // Format address and remove duplicate unit information
    let formattedAddress = removeDuplicateUnitFromAddress(propertyAddress, unitNumber);

    // Build system message content
    let systemContent = `You are Kate, an AI assistant calling on behalf of ${callingOnBehalfOf} to schedule a maintenance appointment with a vendor.

YOUR IDENTITY:
- Your name is Kate
- You are an AI assistant working for ${callingOnBehalfOf}
- You may identify yourself as an AI if asked directly, but do not volunteer this information
- NEVER discuss internal implementation details such as: roleplaying, functions, databases, Vapi, software systems, request IDs, or technical implementation
- If asked about the developer, company, or tech support behind the ${brand.productName} system${supportInfo ? `, you may provide: ${supportInfo}` : ', you do not have that information available'}

SPEAKING STYLE:
- Speak SLOWLY and CLEARLY, especially when leaving voicemail messages
- Pause between important pieces of information to allow the listener to write things down
- When reading addresses, phone numbers, or other critical information, speak at a measured pace
- Repeat addresses and phone numbers when leaving voicemail messages

ADDRESS PRONUNCIATION RULES:
- Directional indicators (N, S, E, W, NE, NW, SE, SW) should be pronounced in full: North, South, East, West, Northeast, Northwest, Southeast, Southwest
- Unit numbers preceded by "#" or "hash" should be pronounced as "number" (e.g., "#201" = "number 201")
- Unit numbers should be embedded in the address when first mentioned, not stated separately
- Read addresses clearly and slowly, pausing between street, city, state, and zip code

Maintenance Request Details:
- Request ID: ${request.request_id} (for internal use only - DO NOT mention this to vendors)
- Issue: ${cleanedDescription}
- Priority: ${request.priority || 'Not specified'}
- Unit: ${unitNumber}
- Property: ${propertyName}
- Property Type: ${propertyType}
- Address: ${formattedAddress}
- Owner: ${effectiveOwnerName || 'Not specified'}`;

    if (managerName) {
      systemContent += `\n- Manager: ${managerName}`;
    }

    if (pmCompanyName) {
      systemContent += `\n- Property Management Company: ${pmCompanyName}`;
    }

    if (hasSchedulingPreferences) {
      systemContent += `\n- Tenant Scheduling Preferences: ${schedulingPreferencesText}`;
    }

    systemContent += `\n\nVendor Information:
- Expected Company: ${vendor.company_name || 'Not specified'}
- Description: ${vendor.description || 'Not specified'}

CALLING INSTRUCTIONS:
1. Introduce yourself as "Kate" and state that you're calling on behalf of ${callingOnBehalfOf}
2. Ask to speak with "the person responsible for scheduling" (do NOT ask for a specific named person or the vendor company name)
3. If the voicemail message identifies a company name:
   - If it matches "${vendor.company_name}", you don't need to mention the company name
   - If it doesn't match or you're unsure, you can mention you're calling for "${vendor.company_name}"
4. Explain the maintenance issue briefly and clearly`;

    if (hasSchedulingPreferences) {
      systemContent += `\n5. IMPORTANT: The tenant has provided scheduling preferences: "${schedulingPreferencesText}". Please consider these preferences when scheduling the appointment.`;
    } else {
      systemContent += '\n5. Ask if they can schedule a service appointment';
    }

    const schedulingNote = hasSchedulingPreferences ? ', keeping in mind the tenant\'s preferences' : '';
    systemContent += `\n6. Get a preferred date/time if possible${schedulingNote}
7. When a date/time is agreed upon, use the schedule_appointment function to save the appointment
8. Confirm the appointment details
9. Thank them and end the call politely

PAYMENT QUESTIONS:
If the vendor asks who will be paying or asks for a payment method, provide contact information in this order:
${managerName && pmCompanyName ? `1. Property manager ${managerName} at ${pmCompanyName}` : managerName ? `1. Property manager ${managerName}` : pmCompanyName ? `1. ${pmCompanyName}` : `1. Property owner ${ownerName}`}
${managerName && pmCompanyName ? `2. ${pmCompanyName} (if manager is unavailable)` : ''}
${!managerName && pmCompanyName ? `2. Property owner ${ownerName} (if ${pmCompanyName} is unavailable)` : !pmCompanyName ? '' : `3. Property owner ${ownerName} (if ${pmCompanyName} is unavailable)`}
Do NOT offer the tenant as a payment option.

VOICEMAIL INSTRUCTIONS:
If the call goes to voicemail, leave a detailed voicemail message that includes:
- Your name: "This is Kate"
- That you're calling on behalf of ${callingOnBehalfOf}${pmCompanyName ? ` (${pmCompanyName})` : ''}
- Ask to speak with "the person responsible for scheduling"
- The maintenance request issue: ${voicemailDescription}
- Property address: ${formattedAddress} (pronounce directionals in full: NE = "Northeast", SW = "Southwest", etc. If there's a "#" or "hash" before a unit number, say "number" instead. Read slowly and clearly)
${managerName || pmCompanyName ? `- ${managerName ? `Manager: ${managerName}` : ''}${managerName && pmCompanyName ? ` at ${pmCompanyName}` : pmCompanyName ? `Property Management Company: ${pmCompanyName}` : ''}` : effectiveOwnerName ? `- Owner: ${effectiveOwnerName}` : ''}
- Contact information: ${contactInfoWithPhone}. Please contact them to schedule a service appointment
- End with exactly these words: "Thank you. Goodbye."

CRITICAL VOICEMAIL RULES:
1. Speak VERY SLOWLY and clearly - imagine someone is writing this down by hand
2. Pause between each piece of information (name, company, issue, address, contact info)
3. REPEAT the address and contact information (including phone number if provided) at the end of the message, before saying "Thank you. Goodbye."
4. DO NOT mention request IDs, database IDs, or any internal implementation details
5. DO NOT ask them to call you back - instead, provide the contact information (${contactInfoWithPhone}) so they can call to schedule
6. After saying "Thank you. Goodbye.", immediately stop speaking. Do not say anything else. Do not describe what you are doing. Do not narrate any actions. Do not say words like "hangs up" or "ending call" or any other action words. Just stop talking completely after "Goodbye."

IMPORTANT: When the vendor agrees to a specific date and time, you MUST call the schedule_appointment function with:
- vendorId: ${vendor.vendor_id}
- maintenanceRequestId: ${request.request_id}
- scheduledDateTime: The agreed date/time in ISO 8601 format (e.g., "2025-01-15T14:30:00-08:00")
- estimatedDurationMinutes: (optional) Estimated duration if discussed
- notes: (optional) Any special notes about the appointment

Keep the conversation professional, concise, and friendly. If they cannot schedule immediately, ask when would be a good time to call back.`;

    // Create Vapi.ai outbound call
    // Build the call payload - use phoneNumberId (UUID) if available, otherwise phoneNumber (E.164)
    const callPayload = {
      customer: {
        number: vendorPhone
      },
      assistant: {
          model: {
            provider: 'openai',
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: systemContent
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
            // Voice settings to improve volume and consistency for voicemail messages
            stability: 0.9,           // High stability for consistent, clear output (0-1)
            similarityBoost: 0.8,    // High similarity for clear voice matching (0-1)
            style: 0.0,              // Low style to prevent volume variations (0-1)
            useSpeakerBoost: true,    // Boost speaker clarity and volume
            speed: 1.0                // Normal speaking speed (0.7-1.2)
          },
          serverUrl: (() => {
            // Use VAPI_SERVER_URL if set, otherwise construct from VERCEL_URL
            if (process.env.VAPI_SERVER_URL) {
              return process.env.VAPI_SERVER_URL;
            }
            // Ensure serverUrl has https:// protocol
            const baseUrl = process.env.VERCEL_URL || 'http://localhost:3000';
            const urlWithProtocol = baseUrl.startsWith('http://') || baseUrl.startsWith('https://') 
              ? baseUrl 
              : `https://${baseUrl}`;
            return `${urlWithProtocol}/api/voice/maintenance-bot`;
          })()
        }
      };
    
    // Add phoneNumberId to the payload (Vapi.ai requires this UUID for outbound calls)
    callPayload.phoneNumberId = phoneNumberId;
    console.log(`[Call Vendors Cron] Making Vapi.ai call with phoneNumberId: ${phoneNumberId.substring(0, 10)}...`);
    
    const vapiResponse = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(callPayload)
    });

    if (!vapiResponse.ok) {
      const error = await vapiResponse.text();
      throw new Error(`Vapi.ai API error: ${error}`);
    }

    const callData = await vapiResponse.json();

    return {
      success: true,
      callId: callData.id,
      message: `Call initiated to ${vendorPhone}`
    };

  } catch (error) {
    console.error('[Call Vendors Cron] Error making vendor call:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

