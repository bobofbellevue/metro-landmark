/* eslint-env node */
import twilio from 'twilio';
import { resolveTwilioCredentials } from './twilio-credentials.js';

let twilioClient;
let twilioInitError;
let twilioInitialized = false;

function getTwilioClient() {
  if (twilioInitialized) {
    return { client: twilioClient, error: twilioInitError };
  }
  twilioInitialized = true;
  const resolved = resolveTwilioCredentials(process.env);
  if (resolved.error) {
    twilioInitError = resolved.error;
    twilioClient = null;
    return { client: null, error: twilioInitError };
  }
  if (!resolved.mode) {
    twilioClient = null;
    twilioInitError = null;
    return { client: null, error: null };
  }
  try {
    twilioClient =
      resolved.mode === 'api_key'
        ? twilio(resolved.apiKey, resolved.apiSecret, {
            accountSid: resolved.accountSid,
          })
        : twilio(resolved.accountSid, resolved.authToken);
    twilioInitError = null;
  } catch (error) {
    twilioClient = null;
    twilioInitError = error.message || 'Failed to initialize Twilio';
  }
  return { client: twilioClient, error: twilioInitError };
}

/**
 * Normalize phone number to E.164 format
 * @param {string} phone - Phone number in any format
 * @returns {string} - Phone number in E.164 format (+1XXXXXXXXXX)
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;

  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');

  // If it starts with 1 and has 11 digits, assume it's US/Canada
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // If it has 10 digits, assume it's US/Canada without country code
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If it already starts with +, return as is (assuming it's already in E.164)
  if (phone.startsWith('+')) {
    return phone;
  }

  // Otherwise, try to add +1 for US/Canada
  if (digits.length >= 10) {
    return `+1${digits.slice(-10)}`;
  }

  return phone;
}

/**
 * Send SMS using Twilio
 * @param {Object} options - SMS options
 * @param {string} options.to - Recipient phone number (will be normalized to E.164)
 * @param {string} options.message - SMS message body
 * @param {string} options.from - Sender phone number (optional, uses FROM_PHONE env var)
 * @returns {Promise<{success: boolean, messageSid?: string, error?: string}>}
 */
export async function sendSMS({ to, message, from }) {
  const { client, error: initError } = getTwilioClient();
  if (initError) {
    return { success: false, error: initError };
  }
  if (!client) {
    // Log to console if Twilio is not configured (for development)
    console.log('SMS notification (Twilio not configured):', {
      to,
      message: message?.substring(0, 50) + '...'
    });
    return {
      success: true,
      skipped: true,
      reason: 'Twilio not configured',
      messageSid: `mock-${Date.now()}`
    };
  }

  try {
    const toPhone = normalizePhoneNumber(to);
    const fromPhone = from || process.env.FROM_PHONE || process.env.TWILIO_PHONE_NUMBER;

    if (!fromPhone) {
      return {
        success: false,
        error: 'FROM_PHONE or TWILIO_PHONE_NUMBER environment variable is required'
      };
    }

    if (!toPhone) {
      return {
        success: false,
        error: 'Invalid recipient phone number'
      };
    }

    // Validate message length (SMS has 160 character limit for single message)
    // Twilio will automatically split longer messages, but we'll warn
    if (message.length > 1600) {
      console.warn(`SMS message is very long (${message.length} chars). Twilio will split into multiple messages.`);
    }

    const twilioMessage = await client.messages.create({
      body: message,
      to: toPhone,
      from: normalizePhoneNumber(fromPhone)
    });

    return {
      success: true,
      messageSid: twilioMessage.sid,
      status: twilioMessage.status,
      to: twilioMessage.to,
      from: twilioMessage.from
    };
  } catch (error) {
    console.error('Error sending SMS via Twilio:', error);

    // Handle Twilio-specific errors
    if (error.code) {
      return {
        success: false,
        error: `Twilio error (${error.code}): ${error.message}`,
        code: error.code
      };
    }

    return {
      success: false,
      error: error.message || 'Failed to send SMS'
    };
  }
}

/**
 * Send SMS with retry logic
 * @param {Object} options - SMS options (same as sendSMS)
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Delay between retries in ms (default: 1000)
 * @returns {Promise<{success: boolean, messageSid?: string, error?: string, retries?: number}>}
 */
export async function sendSMSWithRetry(options, maxRetries = 3, retryDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await sendSMS(options);

    if (result.success) {
      return {
        ...result,
        retries: attempt
      };
    }

    lastError = result;

    // Don't retry if Twilio is not configured
    if (result.skipped) {
      return result;
    }

    // Don't retry on certain error codes (4xx client errors)
    if (result.code && ['21211', '21212', '21214', '21215', '21216', '21217', '21218', '21219'].includes(result.code)) {
      return result;
    }

    // Wait before retrying (except on last attempt)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }

  return {
    success: false,
    error: lastError?.error || 'Failed to send SMS after retries',
    retries: maxRetries
  };
}

/**
 * Get user phone number from database
 * @param {Object} supabase - Supabase client instance
 * @param {number} userId - User ID
 * @returns {Promise<string|null>} - Phone number in E.164 format or null
 */
export async function getUserPhoneNumber(supabase, userId) {
  try {
    // Get contact for user
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('contactable_id', userId)
      .eq('contactable_type', 'user')
      .limit(1)
      .maybeSingle();

    if (contactError || !contact) {
      return null;
    }

    // Get phone number - check multiple method types
    const { data: contactMethods, error: methodError } = await supabase
      .from('contact_methods')
      .select('value, method_type')
      .eq('contact_id', contact.contact_id)
      .in('method_type', ['phone', 'Phone', 'cell', 'Cell', 'mobile', 'Mobile', 'CELL', 'MOBILE'])
      .limit(10);

    if (methodError || !contactMethods || contactMethods.length === 0) {
      return null;
    }

    // Return the first phone number found, normalized
    return normalizePhoneNumber(contactMethods[0].value);
  } catch (error) {
    console.error('Error getting user phone number:', error);
    return null;
  }
}

