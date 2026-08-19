/* eslint-env node */
import sgMail from '@sendgrid/mail';
import { brand } from './brand.js';
import { formatSendGridDeliveryError } from './email-delivery-error.js';

/**
 * Initialize SendGrid with API key
 */
function initializeSendGrid() {
  const apiKey = process.env.SENDGRID_API_KEY;
  
  if (!apiKey) {
    console.warn('SENDGRID_API_KEY not configured. Email sending will be disabled.');
    return false;
  }

  sgMail.setApiKey(apiKey);
  return true;
}

// Initialize on module load
const sendGridInitialized = initializeSendGrid();

/**
 * Send email using SendGrid
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} options.text - Plain text email body (optional, will be generated from HTML if not provided)
 * @param {string} options.from - Sender email (optional, uses FROM_EMAIL env var or default)
 * @param {string} options.fromName - Sender name (optional, uses FROM_NAME env var or default)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, html, text, from, fromName }) {
  if (!sendGridInitialized) {
    // Log to console if SendGrid is not configured (for development)
    console.log('Email notification (SendGrid not configured):', {
      to,
      subject,
      html: html?.substring(0, 100) + '...'
    });
    return { 
      success: true, 
      skipped: true, 
      reason: 'SendGrid not configured',
      messageId: `mock-${Date.now()}`
    };
  }

  const fromEmail = from || brand.fromEmail;
  const fromNameValue = fromName || brand.fromName;

  try {
    // Generate plain text from HTML if not provided
    let plainText = text;
    if (!plainText && html) {
      // Simple HTML to text conversion (remove tags, decode entities)
      plainText = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    }

    const msg = {
      to,
      from: {
        email: fromEmail,
        name: fromNameValue
      },
      subject,
      text: plainText || subject,
      html: html || plainText
    };

    const [response] = await sgMail.send(msg);

    return {
      success: true,
      messageId: response.headers['x-message-id'] || `sg-${Date.now()}`,
      statusCode: response.statusCode
    };
  } catch (error) {
    console.error('Error sending email via SendGrid:', error);
    return {
      success: false,
      error: formatSendGridDeliveryError(error, fromEmail),
      statusCode: error.response?.statusCode,
    };
  }
}

/**
 * Send email with retry logic
 * @param {Object} options - Email options (same as sendEmail)
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Delay between retries in ms (default: 1000)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string, retries?: number}>}
 */
export async function sendEmailWithRetry(options, maxRetries = 3, retryDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await sendEmail(options);
    
    if (result.success) {
      return {
        ...result,
        retries: attempt
      };
    }

    lastError = result;
    
    // Don't retry if SendGrid is not configured
    if (result.skipped) {
      return result;
    }

    // Don't retry on certain error codes (4xx client errors)
    if (result.statusCode && result.statusCode >= 400 && result.statusCode < 500) {
      return result;
    }

    // Wait before retrying (except on last attempt)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }

  return {
    success: false,
    error: lastError?.error || 'Failed to send email after retries',
    retries: maxRetries
  };
}

