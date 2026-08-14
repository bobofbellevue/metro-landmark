/**
 * Vapi.ai Configuration Helper
 * 
 * Provides configuration for Vapi.ai voice assistant calls
 * and handles debug mode phone number routing
 */

/**
 * Check if DEBUG_MODE is active
 * Accepts: 'true', 'TRUE', 'True', '1', 'On', 'on' (case-insensitive)
 * @returns {boolean} True if DEBUG_MODE is active
 */
export function isDebugMode() {
  const debugMode = process.env.DEBUG_MODE;
  if (!debugMode) return false;
  
  const normalized = debugMode.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on';
}

/**
 * Get Global Admin phone numbers from database
 * @param {Object} supabase - Supabase client
 * @returns {Promise<string[]>} Array of Global Admin phone numbers (normalized)
 */
export async function getGlobalAdminPhones(supabase) {
  try {
    // Find all global admins
    const { data: globalAdmins, error } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('role', 'global_admin');
    
    if (error || !globalAdmins || globalAdmins.length === 0) {
      console.log('[DEBUG_MODE] No global admins found');
      return [];
    }
    
    const phoneNumbers = [];
    
    for (const admin of globalAdmins) {
      // Get contact for user
      const { data: contact } = await supabase
        .from('contacts')
        .select('contact_id')
        .eq('contactable_id', admin.user_id)
        .eq('contactable_type', 'user')
        .limit(1)
        .maybeSingle();
      
      if (!contact) continue;
      
      // Get phone numbers (Phone or Cell)
      const { data: contactMethods } = await supabase
        .from('contact_methods')
        .select('value, method_type')
        .eq('contact_id', contact.contact_id)
        .in('method_type', ['Phone', 'phone', 'Cell', 'cell'])
        .limit(10);
      
      if (contactMethods && contactMethods.length > 0) {
        for (const method of contactMethods) {
          const normalized = normalizePhoneNumber(method.value);
          if (normalized && !phoneNumbers.includes(normalized)) {
            phoneNumbers.push(normalized);
          }
        }
      }
    }
    
    console.log('[DEBUG_MODE] Found Global Admin phones:', phoneNumbers);
    return phoneNumbers;
  } catch (error) {
    console.error('[DEBUG_MODE] Error getting Global Admin phones:', error);
    return [];
  }
}

/**
 * Normalize phone number for comparison
 * @param {string} phone - Phone number
 * @returns {string|null} Normalized phone number (digits only, no country code)
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const digitsOnly = phone.replace(/\D/g, '');
  // Remove leading 1 if present (US country code)
  const withoutCountryCode = digitsOnly.startsWith('1') && digitsOnly.length === 11 
    ? digitsOnly.substring(1) 
    : digitsOnly;
  return withoutCountryCode;
}

/**
 * Check if a phone number matches any Global Admin phone number
 * @param {Object} supabase - Supabase client
 * @param {string} phoneNumber - Phone number to check
 * @returns {Promise<boolean>} True if phone matches a Global Admin
 */
export async function isGlobalAdminPhone(supabase, phoneNumber) {
  if (!isDebugMode()) return false;
  if (!phoneNumber) return false;
  
  const adminPhones = await getGlobalAdminPhones(supabase);
  if (adminPhones.length === 0) return false;
  
  const normalized = normalizePhoneNumber(phoneNumber);
  return adminPhones.includes(normalized);
}

/**
 * Route phone number based on DEBUG_MODE
 * In DEBUG_MODE, always route vendor calls to Global Admin (for testing)
 * This ensures vendor calls go to you (Global Admin) instead of real vendors
 * @param {Object} supabase - Supabase client
 * @param {string} phoneNumber - Original phone number (vendor phone for vendor calls)
 * @param {string} tenantPhone - Tenant phone number (if known, used for context only)
 * @returns {Promise<string>} Phone number to use (Global Admin phone in DEBUG_MODE)
 */
export async function routePhoneNumber(supabase, phoneNumber, tenantPhone = null) {
  if (!isDebugMode()) {
    return phoneNumber;
  }
  
  // Get Global Admin phones
  const adminPhones = await getGlobalAdminPhones(supabase);
  if (adminPhones.length === 0) {
    console.log(`[DEBUG_MODE] No Global Admin phones found - blocking call to ${phoneNumber}`);
    throw new Error('DEBUG_MODE: No Global Admin phones found. Make sure you have a phone number registered as a Global Admin.');
  }
  
  // In DEBUG_MODE, always route vendor calls to the first Global Admin
  // This ensures you (the Global Admin) receive the call instead of the real vendor
  const targetPhone = adminPhones[0];
  
  // Convert back to E.164 format for calling
  const e164Phone = targetPhone.length === 10 ? `+1${targetPhone}` : `+${targetPhone}`;
  console.log(`[DEBUG_MODE] Routing vendor call from ${phoneNumber} to Global Admin: ${e164Phone}`);
  return e164Phone;
}

/**
 * Get Vapi.ai assistant configuration
 * @param {Object} options - Configuration options
 * @param {string} options.systemPrompt - System prompt for the AI
 * @param {number|null} options.userId - User ID
 * @param {number|null} options.unitId - Unit ID
 * @param {number|null} options.propertyId - Property ID
 * @param {string|null} options.userEmail - User email
 * @param {string} options.callerPhone - Caller's phone number
 * @returns {Object} Vapi.ai assistant configuration
 */
export function getVapiConfig({ systemPrompt, userId, unitId, propertyId, userEmail, callerPhone }) {
  // Note: routePhoneNumber is now async and requires supabase, so we can't call it here
  // The actual routing happens in maintenance-bot.js when making calls

  return {
    model: {
      provider: 'openai',
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        }
      ],
      functions: [
        {
          name: 'assess_urgency',
          description: 'Assess the urgency level of a maintenance issue. Returns the urgency level and recommended action.',
          parameters: {
            type: 'object',
            properties: {
              issue_description: {
                type: 'string',
                description: 'The maintenance issue described by the tenant'
              },
              urgency_level: {
                type: 'string',
                enum: ['life_threatening', 'emergency', 'urgent', 'routine'],
                description: 'The assessed urgency level'
              },
              reasoning: {
                type: 'string',
                description: 'Brief explanation of why this urgency level was chosen'
              }
            },
            required: ['issue_description', 'urgency_level', 'reasoning']
          }
        },
        {
          name: 'find_emergency_vendors',
          description: 'Find vendors approved for emergency service that match the maintenance issue. Use the full call summary or issue description for better matching. Only use this for emergency or urgent situations.',
          parameters: {
            type: 'object',
            properties: {
              call_summary: {
                type: 'string',
                description: 'Full summary of the conversation describing the maintenance issue. This should include all relevant details from the conversation, not just keywords.'
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional keywords describing the maintenance issue (e.g., ["plumbing", "leak", "water"]). If call_summary is provided, this may be omitted.'
              }
            },
            required: []
          }
        },
        {
          name: 'find_routine_vendors',
          description: 'Find vendors that can handle routine maintenance issues. Use the full call summary or issue description for better matching.',
          parameters: {
            type: 'object',
            properties: {
              call_summary: {
                type: 'string',
                description: 'Full summary of the conversation describing the maintenance issue. This should include all relevant details from the conversation, not just keywords.'
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional keywords describing the maintenance issue. If call_summary is provided, this may be omitted.'
              }
            },
            required: []
          }
        },
        {
          name: 'create_maintenance_request',
          description: 'Create a maintenance request in the system. Use this when the tenant has provided enough information about the issue and scheduling preferences. DO NOT pass userId, unitId, or propertyId - the system will automatically look up the correct values from the caller\'s phone number. If the caller was identified during the call (e.g., by identify_caller_by_location), that identification is already stored in the system context and will be used automatically.',
          parameters: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Detailed description of the maintenance issue'
              },
              priority: {
                type: 'string',
                enum: ['Low', 'Medium', 'High', 'Urgent'],
                description: 'Priority level based on urgency assessment'
              },
              status: {
                type: 'string',
                enum: ['New', 'In Progress', 'On Hold', 'Completed'],
                description: 'Initial status (usually "New")'
              }
            },
            required: ['description', 'priority', 'status']
          }
        },
        {
          name: 'call_vendor',
          description: 'Call a vendor directly to schedule an appointment. Use this for emergency or urgent situations when immediate vendor contact is needed.',
          parameters: {
            type: 'object',
            properties: {
              vendorId: {
                type: 'number',
                description: 'The vendor ID to call'
              },
              vendorPhone: {
                type: 'string',
                description: 'The vendor phone number'
              },
              maintenanceRequestId: {
                type: 'number',
                description: 'The maintenance request ID associated with this call'
              }
            },
            required: ['vendorId', 'vendorPhone', 'maintenanceRequestId']
          }
        },
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
        },
        {
          name: 'identify_caller_by_location',
          description: 'Identify the caller by their location information. Use this when the caller provides property name + unit number (e.g., "Wuthering Heights B2") or an address. This helps identify the unit and tenant.',
          parameters: {
            type: 'object',
            properties: {
              property_name: {
                type: 'string',
                description: 'Property or complex name (e.g., "Wuthering Heights", "Sunset Apartments")'
              },
              unit_number: {
                type: 'string',
                description: 'Unit number (e.g., "B2", "101", "Apt 3")'
              },
              address: {
                type: 'string',
                description: 'Full address or address description (e.g., "4125 161st Ave SE, Bellevue, WA 98006" or "161st Avenue Southeast in Bellevue")'
              }
            },
            required: []
          }
        },
        {
          name: 'identify_caller_by_info',
          description: 'Identify the caller by their personal information. Use this when location-based identification fails. Ask for the caller\'s name and the phone number or email address of the person responsible for the unit.',
          parameters: {
            type: 'object',
            properties: {
              caller_name: {
                type: 'string',
                description: 'The caller\'s name (may be a friend or relative of the tenant)'
              },
              responsible_person_phone: {
                type: 'string',
                description: 'Phone number or email address of the person responsible for the unit (the tenant). Can accept either format.'
              }
            },
            required: []
          }
        },
        {
          name: 'identify_caller_by_name_and_birthdate',
          description: 'Identify the caller by their first name, last name, and date of birth. Use this when the caller confirms they are the person responsible for the property. Accept dates in various formats (e.g., "May 15th 1990", "5/15/1990"). If the match fails, ask them to spell their last name.',
          parameters: {
            type: 'object',
            properties: {
              first_name: {
                type: 'string',
                description: 'The caller\'s first name'
              },
              last_name: {
                type: 'string',
                description: 'The caller\'s last name'
              },
              date_of_birth: {
                type: 'string',
                description: 'The caller\'s date of birth in any format (e.g., "May 15th 1990", "5/15/1990", "05-15-1990")'
              }
            },
            required: ['first_name', 'last_name', 'date_of_birth']
          }
        },
        {
          name: 'identify_responsible_person_by_name_and_location',
          description: 'Identify the person responsible for the property by their name and location (property name or address). Use this when the caller is NOT the responsible person (a stranger). If multiple properties match, ask for clarification. If property has multiple units, ask for unit number.',
          parameters: {
            type: 'object',
            properties: {
              first_name: {
                type: 'string',
                description: 'First name of the person responsible for the property'
              },
              last_name: {
                type: 'string',
                description: 'Last name of the person responsible for the property'
              },
              property_name: {
                type: 'string',
                description: 'Property or complex name (e.g., "Wuthering Heights", "Wuthering Heights Apartments")'
              },
              address: {
                type: 'string',
                description: 'Property address (e.g., "3300 N State Rd, Deckerville, MI 48427" or partial like "N State Rd, Deckerville")'
              },
              unit_number: {
                type: 'string',
                description: 'Unit number if property has multiple units (e.g., "B2", "101")'
              }
            },
            required: ['first_name', 'last_name']
          }
        },
        {
          name: 'get_responsible_person_phone',
          description: 'Get the phone number of the person responsible for the property. This is only available to verified tenants. The system searches in order: property manager at PM company, company admin, global admin, or property owner. If the tenant specifically asks for the property owner\'s phone number, set return_owner_only to true.',
          parameters: {
            type: 'object',
            properties: {
              return_owner_only: {
                type: 'boolean',
                description: 'If true, only return the property owner\'s phone number. If false or not provided, returns the first available contact in the priority order (manager, company admin, global admin, owner).'
              }
            },
            required: []
          }
        },
        {
          name: 'update_scheduling_preferences',
          description: 'Update a maintenance request with tenant scheduling preferences (preferred dates/times or dates/times to avoid). Use this after creating a maintenance request when the tenant provides their scheduling preferences.',
          parameters: {
            type: 'object',
            properties: {
              maintenanceRequestId: {
                type: 'number',
                description: 'The maintenance request ID to update'
              },
              schedulingPreferences: {
                type: 'string',
                description: 'The tenant\'s scheduling preferences (e.g., "Prefer mornings, avoid weekends", "Available Monday-Friday after 2pm", "Must avoid next Tuesday")'
              }
            },
            required: ['maintenanceRequestId', 'schedulingPreferences']
          }
        },
        {
          name: 'request_reschedule',
          description: 'Request rescheduling of an appointment. This will call the vendor again to get a new appointment time. Use this when the tenant wants to change the appointment time during a confirmation call, or when a rescheduling request is detected through the dashboard, chat bot, or voice bot.',
          parameters: {
            type: 'object',
            properties: {
              appointmentId: {
                type: 'number',
                description: 'The appointment ID to reschedule'
              },
              reason: {
                type: 'string',
                description: 'Optional reason for rescheduling (e.g., "Tenant unavailable", "Time conflict", "Tenant requested different time")'
              }
            },
            required: ['appointmentId']
          }
        }
      ],
      // Don't force a function call at start - let the conversation flow naturally
      // functionCall: { name: 'assess_urgency' },
      temperature: 0.7
    },
    voice: {
      provider: '11labs',
      voiceId: process.env.VAPI_VOICE_ID || '21m00Tcm4TlvDq8ikWAM', // Default voice
      // Voice settings to improve volume and consistency
      stability: 0.9,           // High stability for consistent, clear output (0-1)
      similarityBoost: 0.8,     // High similarity for clear voice matching (0-1)
      style: 0.0,              // Low style to prevent volume variations (0-1)
      useSpeakerBoost: true,   // Boost speaker clarity and volume
      speed: 1.0               // Normal speaking speed (0.7-1.2)
    },
    firstMessage: 'Hello! This is Kate, your property management maintenance assistant. This call may be recorded for quality purposes. How can I help you today?',
    // Speech configuration - controls when the assistant starts and stops speaking
    // See: https://docs.vapi.ai/customization/speech-configuration
    startSpeakingPlan: {
      // Wait time before speaking after customer finishes (default 0.4s)
      // Increase to reduce interruptions when user pauses briefly
      waitSeconds: 1.0,
      // Smart endpointing - detects when customer has truly finished speaking
      // Using LiveKit for English (recommended) - provides sophisticated detection
      smartEndpointingPlan: {
        provider: 'livekit',
        // Custom wait function: maps probability (0-1) to milliseconds
        // 0 = high confidence user stopped, 1 = high confidence still speaking
        // Default: "200 + 8000 * x" (200ms to 8200ms wait)
        // This configuration waits longer when uncertain, reducing interruptions
        waitFunction: "400 + 6000 * x"
      }
      // Note: transcriptionBasedDetection is not allowed in Vapi.ai assistant configuration
      // It was removed to fix the "Invalid Assistant" error
    },
    // Stop speaking plan - controls when assistant stops if customer interrupts
    stopSpeakingPlan: {
      numWords: 2, // Number of words customer needs to say before assistant stops (0 = immediate)
      voiceSeconds: 0.3, // How long customer needs to be speaking (default 0.2s)
      backoffSeconds: 1.0 // Wait before resuming after interruption (default 1s)
    },
    // Background sound handling (default 'office' for phone, 'off' for web)
    backgroundSound: 'office',
    // Note: customData is NOT allowed in assistant request responses - Vapi.ai validation rejects it
    // We'll pass context through function calls instead
    // Server URL for function calls - use production URL
    // Functions will call this URL when invoked by the AI
    // serverUrl: process.env.VAPI_SERVER_URL || 'https://salish-landmark.vercel.app/api/voice/maintenance-bot'
    // Note: serverUrl might also not be allowed - let's try without it first since phone number already has server.url configured
  };
}

