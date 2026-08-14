/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { sendEmail as sendEmailViaService } from './email-service.js';
import { brand } from './brand.js';

/**
 * Send email notification using SendGrid (if configured) or log to console
 * This is a wrapper around the new email-service.js for backward compatibility
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} options.text - Plain text email body (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendEmail({ to, subject, html, text }) {
  // Use the new email service
  const result = await sendEmailViaService({ to, subject, html, text });
  
  // Return in the old format for backward compatibility
  if (result.skipped) {
    return { success: true, skipped: true, reason: result.reason };
  }
  
  return {
    success: result.success,
    error: result.error
  };
}

/**
 * Notify signer that a document is ready for signature
 * @param {Object} options
 * @param {number} options.documentId - Document ID
 * @param {number} options.signerUserId - User ID of the signer
 * @param {string} options.documentName - Name of the document
 * @param {string} options.documentUrl - URL to view/sign the document
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function notifyDocumentReadyForSignature({ documentId, signerUserId, documentName, documentUrl }) {
  try {
    // Get signer's email from database
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return { success: false, error: 'Supabase configuration missing' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, first_name, last_name')
      .eq('user_id', signerUserId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'Signer not found' };
    }

    const signerName = user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}`
      : user.email;

    const subject = `Document Ready for Signature: ${documentName}`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
            .content { background-color: #f9fafb; padding: 20px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 4px; margin-top: 20px; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Document Ready for Signature</h1>
            </div>
            <div class="content">
              <p>Hello ${signerName},</p>
              <p>A document is ready for your signature:</p>
              <p><strong>${documentName}</strong></p>
              <p>Please review and sign the document by clicking the button below:</p>
              <a href="${documentUrl}" class="button">Review & Sign Document</a>
              <p style="margin-top: 20px;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #4F46E5;">${documentUrl}</p>
            </div>
            <div class="footer">
              <p>This is an automated message from ${brand.emailSystemName}.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
Hello ${signerName},

A document is ready for your signature: ${documentName}

Please review and sign the document by visiting:
${documentUrl}

This is an automated message from ${brand.emailSystemName}.
    `;

    return await sendEmail({
      to: user.email,
      subject,
      html,
      text
    });
  } catch (error) {
    console.error('Error notifying document ready for signature:', error);
    return {
      success: false,
      error: error.message || 'Failed to send notification'
    };
  }
}

/**
 * Notify all parties when a document is fully signed
 * @param {Object} options
 * @param {number} options.documentId - Document ID
 * @param {string} options.documentName - Name of the document
 * @param {string} options.documentUrl - URL to download the signed document
 * @param {Array<number>} options.partyUserIds - Array of user IDs to notify
 * @returns {Promise<{success: boolean, errors?: Array<string>}>}
 */
export async function notifyDocumentFullySigned({ documentId, documentName, documentUrl, partyUserIds }) {
  const results = [];
  const errors = [];

  for (const userId of partyUserIds) {
    try {
      // Get user's email from database
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseKey = 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        errors.push(`Supabase configuration missing for user ${userId}`);
        continue;
      }

      const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('user_id', userId)
        .single();

      if (userError || !user) {
        errors.push(`User ${userId} not found`);
        continue;
      }

      const userName = user.first_name && user.last_name 
        ? `${user.first_name} ${user.last_name}`
        : user.email;

      const subject = `Document Fully Signed: ${documentName}`;
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #10B981; color: white; padding: 20px; text-align: center; }
              .content { background-color: #f9fafb; padding: 20px; }
              .button { display: inline-block; padding: 12px 24px; background-color: #10B981; color: white; text-decoration: none; border-radius: 4px; margin-top: 20px; }
              .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Document Fully Signed</h1>
              </div>
              <div class="content">
                <p>Hello ${userName},</p>
                <p>The following document has been fully signed by all parties:</p>
                <p><strong>${documentName}</strong></p>
                <p>You can download a copy of the signed document by clicking the button below:</p>
                <a href="${documentUrl}" class="button">Download Signed Document</a>
                <p style="margin-top: 20px;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #10B981;">${documentUrl}</p>
              </div>
              <div class="footer">
                <p>This is an automated message from ${brand.emailSystemName}.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const text = `
Hello ${userName},

The following document has been fully signed by all parties: ${documentName}

You can download a copy of the signed document by visiting:
${documentUrl}

This is an automated message from ${brand.emailSystemName}.
      `;

      const result = await sendEmail({
        to: user.email,
        subject,
        html,
        text
      });

      if (result.success) {
        results.push(userId);
      } else {
        errors.push(`Failed to notify user ${userId}: ${result.error}`);
      }
    } catch (error) {
      console.error(`Error notifying user ${userId}:`, error);
      errors.push(`Error notifying user ${userId}: ${error.message}`);
    }
  }

  return {
    success: errors.length === 0,
    notified: results.length,
    errors: errors.length > 0 ? errors : undefined
  };
}
