/* eslint-env node */
import { brand } from './brand.js';

/**
 * Generate email HTML template
 * @param {Object} options
 * @param {string} options.subject - Email subject
 * @param {string} options.message - Email message body
 * @param {string} options.category - Notification category
 * @param {string} options.userName - User's name (optional)
 * @param {string} options.actionUrl - Action URL (optional)
 * @param {string} options.actionText - Action button text (optional)
 * @returns {string} - HTML email template
 */
export function generateEmailTemplate({ subject, message, category, userName, actionUrl, actionText }) {
  const categoryColors = {
    maintenance: '#F59E0B', // Amber
    lease: '#3B82F6', // Blue
    payment: '#EF4444', // Red
    general: '#4F46E5' // Indigo
  };

  const categoryColor = categoryColors[category] || categoryColors.general;
  const greeting = userName ? `Hello ${userName},` : 'Hello,';
  const actionButton = actionUrl && actionText ? `
    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${categoryColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
        ${actionText}
      </a>
    </div>
  ` : '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f3f4f6;
          }
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
          }
          .header {
            background-color: ${categoryColor};
            color: white;
            padding: 30px 20px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
          }
          .content {
            padding: 30px 20px;
            background-color: #ffffff;
          }
          .content p {
            margin: 0 0 15px 0;
            color: #374151;
          }
          .content p:last-child {
            margin-bottom: 0;
          }
          .message-content {
            white-space: pre-wrap;
            color: #1f2937;
            line-height: 1.8;
          }
          .footer {
            text-align: center;
            padding: 20px;
            background-color: #f9fafb;
            color: #6b7280;
            font-size: 12px;
            border-top: 1px solid #e5e7eb;
          }
          .footer p {
            margin: 5px 0;
          }
          .action-link {
            word-break: break-all;
            color: ${categoryColor};
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>${subject}</h1>
          </div>
          <div class="content">
            <p>${greeting}</p>
            <div class="message-content">${message.replace(/\n/g, '<br>')}</div>
            ${actionButton}
            ${actionUrl && !actionText ? `
              <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
                <a href="${actionUrl}" class="action-link">${actionUrl}</a>
              </p>
            ` : ''}
          </div>
          <div class="footer">
            <p><strong>${brand.emailFooterName}</strong></p>
            <p>This is an automated notification. Please do not reply to this email.</p>
            <p>If you have questions, please contact us through your tenant portal.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generate SMS message template
 * @param {Object} options
 * @param {string} options.subject - Notification subject
 * @param {string} options.message - Notification message
 * @param {string} options.category - Notification category
 * @returns {string} - SMS message text
 */
export function generateSMSTemplate({ subject, message, category }) {
  // SMS messages should be concise
  const categoryPrefix = {
    maintenance: '[Maintenance]',
    lease: '[Lease]',
    payment: '[Payment]',
    general: '[Notice]'
  };

  const prefix = categoryPrefix[category] || categoryPrefix.general;
  const smsMessage = message.length > 140 
    ? message.substring(0, 137) + '...'
    : message;

  return `${prefix} ${subject}\n\n${smsMessage}`;
}

/**
 * Generate maintenance request notification
 */
export function generateMaintenanceNotification({ requestId, title, description, priority, userName, propertyAddress, actionUrl }) {
  const priorityLabels = {
    low: 'Low Priority',
    medium: 'Medium Priority',
    high: 'High Priority',
    urgent: 'Urgent'
  };

  const subject = `Maintenance Request: ${title}`;
  const message = `Your maintenance request has been ${priority === 'urgent' ? 'received and is being prioritized' : 'received'}.\n\n` +
    `Request ID: ${requestId}\n` +
    `Priority: ${priorityLabels[priority] || priority}\n` +
    `Property: ${propertyAddress}\n\n` +
    `${description ? `Description: ${description}\n\n` : ''}` +
    `We will keep you updated on the status of your request.`;

  return {
    subject,
    message,
    emailHtml: generateEmailTemplate({
      subject,
      message,
      category: 'maintenance',
      userName,
      actionUrl,
      actionText: 'View Request Details'
    }),
    smsText: generateSMSTemplate({ subject, message, category: 'maintenance' })
  };
}

/**
 * Generate lease renewal reminder notification
 */
export function generateLeaseRenewalNotification({ leaseId, propertyAddress, expirationDate, daysUntilExpiration, userName, actionUrl }) {
  const subject = `Lease Renewal Reminder: ${propertyAddress}`;
  const message = `Your lease for ${propertyAddress} expires in ${daysUntilExpiration} day${daysUntilExpiration !== 1 ? 's' : ''} on ${expirationDate}.\n\n` +
    `Please review your renewal options and let us know if you'd like to renew your lease.`;

  return {
    subject,
    message,
    emailHtml: generateEmailTemplate({
      subject,
      message,
      category: 'lease',
      userName,
      actionUrl,
      actionText: 'Review Lease Renewal'
    }),
    smsText: generateSMSTemplate({ subject, message, category: 'lease' })
  };
}

/**
 * Generate payment reminder notification
 */
export function generatePaymentReminderNotification({ amount, dueDate, propertyAddress, userName, actionUrl }) {
  const subject = `Payment Reminder: $${amount.toFixed(2)} Due ${dueDate}`;
  const message = `This is a reminder that your payment of $${amount.toFixed(2)} for ${propertyAddress} is due on ${dueDate}.\n\n` +
    `Please ensure your payment is submitted on time to avoid late fees.`;

  return {
    subject,
    message,
    emailHtml: generateEmailTemplate({
      subject,
      message,
      category: 'payment',
      userName,
      actionUrl,
      actionText: 'Make Payment'
    }),
    smsText: generateSMSTemplate({ subject, message, category: 'payment' })
  };
}

/**
 * Generate appointment confirmation notification
 */
export function generateAppointmentConfirmationNotification({ appointmentType, date, time, propertyAddress, userName, actionUrl }) {
  const subject = `Appointment Confirmed: ${appointmentType}`;
  const message = `Your ${appointmentType} appointment has been confirmed.\n\n` +
    `Date: ${date}\n` +
    `Time: ${time}\n` +
    `Property: ${propertyAddress}\n\n` +
    `Please arrive on time. If you need to reschedule, please contact us as soon as possible.`;

  return {
    subject,
    message,
    emailHtml: generateEmailTemplate({
      subject,
      message,
      category: 'general',
      userName,
      actionUrl,
      actionText: 'View Appointment Details'
    }),
    smsText: generateSMSTemplate({ subject, message, category: 'general' })
  };
}

/**
 * Generate general notification
 */
export function generateGeneralNotification({ subject, message, userName, actionUrl, actionText }) {
  return {
    subject,
    message,
    emailHtml: generateEmailTemplate({
      subject,
      message,
      category: 'general',
      userName,
      actionUrl,
      actionText
    }),
    smsText: generateSMSTemplate({ subject, message, category: 'general' })
  };
}

/**
 * Generate digest notification
 */
export function generateDigestNotification({ category, frequency, notifications, userName }) {
  const frequencyLabel = frequency === 'daily_digest' ? 'Daily' : 'Weekly';
  const count = notifications.length;
  const subject = `${frequencyLabel} ${category.charAt(0).toUpperCase() + category.slice(1)} Digest - ${count} Notification${count !== 1 ? 's' : ''}`;
  
  let message = `You have ${count} ${category} notification${count !== 1 ? 's' : ''} in your ${frequencyLabel.toLowerCase()} digest:\n\n`;
  
  notifications.forEach((notif, index) => {
    message += `${index + 1}. ${notif.subject}\n`;
    if (notif.message) {
      const preview = notif.message.length > 100 
        ? notif.message.substring(0, 97) + '...'
        : notif.message;
      message += `   ${preview}\n`;
    }
    message += '\n';
  });

  return {
    subject,
    message,
    emailHtml: generateEmailTemplate({
      subject,
      message,
      category,
      userName
    }),
    smsText: generateSMSTemplate({ subject, message, category })
  };
}

