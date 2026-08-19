/* eslint-env node */
import { sendEmail, sendEmailWithRetry } from './email-service.js';
import { sendSMS, sendSMSWithRetry, getUserPhoneNumber } from './sms-service.js';
import { generateEmailTemplate, generateSMSTemplate, generateDigestNotification } from './notification-templates.js';

/**
 * Send notification based on user preferences
 * Supports sending to multiple channels (email, SMS) if both are enabled
 * @param {Object} options
 * @param {number} options.userId - User ID
 * @param {string|Array<string>} options.notificationType - 'email', 'sms', 'push', or array of types
 * @param {string} options.category - 'maintenance', 'lease', 'payment', or 'general'
 * @param {string} options.subject - Notification subject
 * @param {string} options.message - Notification message
 * @param {string} options.html - HTML email body (optional, will be generated if not provided)
 * @param {string} options.text - Plain text message (optional, will be generated if not provided)
 * @param {string} options.userName - User's name for personalization (optional)
 * @param {string} options.actionUrl - Action URL for email template (optional)
 * @param {string} options.actionText - Action button text (optional)
 * @param {Object} options.metadata - Additional metadata
 * @param {boolean} options.bypassPreferences - Send the requested types even if prefs are off
 * @param {boolean} options.forceImmediate - Skip digest queue and send now
 * @param {number} options.maxRetries - Delivery retries (default 3)
 * @param {Object} supabase - Supabase client instance
 * @returns {Promise<{success: boolean, notificationIds?: Array<number>, results?: Object, error?: string}>}
 */
export async function sendNotification({ 
  userId, 
  notificationType, 
  category, 
  subject, 
  message, 
  html,
  text,
  userName,
  actionUrl,
  actionText,
  metadata = {},
  bypassPreferences = false,
  forceImmediate = false,
  maxRetries = 3,
}, supabase) {
  try {
    // Get user preferences
    const { data: preferences, error: prefError } = await supabase
      .from('user_notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (prefError && prefError.code !== 'PGRST116') {
      console.error('Error fetching preferences:', prefError);
      return { success: false, error: 'Failed to fetch preferences' };
    }

    // Use defaults if no preferences exist
    const prefs = preferences || {
      email_enabled: true,
      sms_enabled: false,
      push_enabled: false,
      maintenance_email: true,
      maintenance_sms: false,
      maintenance_push: false,
      lease_email: true,
      lease_sms: false,
      lease_push: false,
      payment_email: true,
      payment_sms: false,
      payment_push: false,
      general_email: true,
      general_sms: false,
      general_push: false
    };

    // Normalize notificationType to array
    const types = Array.isArray(notificationType) ? notificationType : [notificationType];
    
    const enabledTypes = bypassPreferences
      ? types
      : types.filter(type => {
          const globalEnabled = prefs[`${type}_enabled`];
          const categoryEnabled = prefs[`${category}_${type}`];
          return globalEnabled && categoryEnabled;
        });

    if (enabledTypes.length === 0) {
      return { success: false, error: 'No notification types enabled for this category' };
    }

    // Check frequency preference
    const frequency = prefs[`${category}_frequency`] || 'immediate';

    // If not immediate, queue for digest (handled by cron jobs)
    if (!forceImmediate && frequency !== 'immediate') {
      // Store in notification_history with digest flag for each enabled type
      const notificationIds = [];
      const errors = [];

      for (const type of enabledTypes) {
        const { data: notification, error: notifError } = await supabase
          .from('notification_history')
          .insert({
            user_id: userId,
            notification_type: type,
            category,
            subject,
            message,
            delivery_status: 'queued',
            metadata: { ...metadata, digest: frequency }
          })
          .select()
          .single();

        if (notifError) {
          console.error('Error queuing notification:', notifError);
          errors.push(`Failed to queue ${type} notification: ${notifError.message}`);
        } else {
          notificationIds.push(notification.notification_id);
        }
      }

      if (errors.length > 0 && notificationIds.length === 0) {
        return { success: false, error: errors.join('; ') };
      }

      return { 
        success: true, 
        notificationIds, 
        queued: true,
        errors: errors.length > 0 ? errors : undefined
      };
    }

    // Send immediate notifications
    const results = {};
    const notificationIds = [];
    const errors = [];

    // Get user info once
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, first_name, last_name')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'User not found' };
    }

    const userFullName = userName || (user.first_name && user.last_name 
      ? `${user.first_name} ${user.last_name}`
      : null);

    // Generate email HTML if not provided
    const emailHtml = html || generateEmailTemplate({
      subject,
      message,
      category,
      userName: userFullName,
      actionUrl,
      actionText
    });

    // Generate SMS text if not provided
    const smsText = text || generateSMSTemplate({ subject, message, category });

    // Send email if enabled
    if (enabledTypes.includes('email')) {
      if (!user.email) {
        const emailError = 'This account has no email address.';
        errors.push(emailError);
        results.email = { success: false, error: emailError, destination: null };
      } else {
        const emailResult = await sendEmailWithRetry({
          to: user.email,
          subject,
          html: emailHtml,
          text: message || text
        }, maxRetries);

        results.email = { ...emailResult, destination: user.email };

        // Record in notification_history
        const deliveryStatus = emailResult.success ? 'sent' : 'failed';
        const { data: notification, error: notifError } = await supabase
          .from('notification_history')
          .insert({
            user_id: userId,
            notification_type: 'email',
            category,
            subject,
            message,
            delivery_status: deliveryStatus,
            error_message: emailResult.error || null,
            metadata: { ...metadata, messageId: emailResult.messageId }
          })
          .select()
          .single();

        if (notifError) {
          console.error('Error recording email notification:', notifError);
          errors.push('Failed to record email notification');
        } else {
          notificationIds.push(notification.notification_id);
        }

        if (!emailResult.success && !emailResult.skipped) {
          errors.push(`Email failed: ${emailResult.error}`);
        }
      }
    }

    // Send SMS if enabled
    if (enabledTypes.includes('sms')) {
      const phoneNumber = await getUserPhoneNumber(supabase, userId);
      
      if (!phoneNumber) {
        const smsError = 'This account has no phone number.';
        errors.push(smsError);
        results.sms = { success: false, error: smsError, destination: null };
      } else {
        const smsResult = await sendSMSWithRetry({
          to: phoneNumber,
          message: smsText
        }, maxRetries);

        results.sms = { ...smsResult, destination: phoneNumber };

        // Record in notification_history
        const deliveryStatus = smsResult.success ? 'sent' : 'failed';
        const { data: notification, error: notifError } = await supabase
          .from('notification_history')
          .insert({
            user_id: userId,
            notification_type: 'sms',
            category,
            subject,
            message: smsText,
            delivery_status: deliveryStatus,
            error_message: smsResult.error || null,
            metadata: { ...metadata, messageSid: smsResult.messageSid, phoneNumber }
          })
          .select()
          .single();

        if (notifError) {
          console.error('Error recording SMS notification:', notifError);
          errors.push('Failed to record SMS notification');
        } else {
          notificationIds.push(notification.notification_id);
        }

        if (!smsResult.success && !smsResult.skipped) {
          errors.push(`SMS failed: ${smsResult.error}`);
        }
      }
    }

    // Push notifications not yet implemented
    if (enabledTypes.includes('push')) {
      console.log('Push notification requested but not implemented:', { userId, category, subject });
      results.push = {
        success: false,
        error: 'Browser notifications are not available yet.',
        destination: null,
      };
      errors.push('Browser notifications are not available yet.');
    }

    // Determine overall success
    const hasSuccess = Object.values(results).some(r => r.success || r.skipped);
    const allFailed =
      Object.values(results).length === 0 ||
      Object.values(results).every(r => !r.success && !r.skipped);

    return {
      success: hasSuccess && !allFailed,
      notificationIds,
      results,
      errors: errors.length > 0 ? errors : undefined,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  } catch (error) {
    console.error('Error in sendNotification:', error);
    return { success: false, error: error.message || 'Failed to send notification' };
  }
}

/**
 * Process digest notifications (called by cron jobs)
 * @param {string} frequency - 'daily_digest' or 'weekly_digest'
 * @param {Object} supabase - Supabase client instance
 * @returns {Promise<{success: boolean, processed: number, errors?: Array<string>}>}
 */
export async function processDigestNotifications(frequency, supabase) {
  try {
    // Get all queued notifications for this frequency
    // Note: Supabase JSONB contains operator requires the value to be a JSON object
    // We'll filter by checking metadata->digest field
    const { data: queuedNotifications, error } = await supabase
      .from('notification_history')
      .select('*')
      .eq('delivery_status', 'queued');

    if (error) {
      console.error('Error fetching queued notifications:', error);
      return { success: false, processed: 0, errors: [error.message] };
    }

    if (!queuedNotifications || queuedNotifications.length === 0) {
      return { success: true, processed: 0 };
    }

    // Filter by frequency in metadata
    const filteredNotifications = queuedNotifications.filter(notif => {
      const metadata = notif.metadata || {};
      return metadata.digest === frequency;
    });

    if (filteredNotifications.length === 0) {
      return { success: true, processed: 0 };
    }

    // Get user info for personalization
    const userIds = [...new Set(filteredNotifications.map(n => n.user_id))];
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('user_id, first_name, last_name')
      .in('user_id', userIds);

    if (usersError) {
      console.error('Error fetching users:', usersError);
    }

    const userMap = {};
    if (users) {
      users.forEach(user => {
        userMap[user.user_id] = user.first_name && user.last_name
          ? `${user.first_name} ${user.last_name}`
          : null;
      });
    }

    // Group by user, category, and notification type
    const grouped = {};
    for (const notif of filteredNotifications) {
      const key = `${notif.user_id}_${notif.category}_${notif.notification_type}`;
      if (!grouped[key]) {
        grouped[key] = {
          user_id: notif.user_id,
          category: notif.category,
          notification_type: notif.notification_type,
          notifications: []
        };
      }
      grouped[key].notifications.push(notif);
    }

    const errors = [];
    let processed = 0;

    // Process each group
    for (const group of Object.values(grouped)) {
      try {
        const userName = userMap[group.user_id] || null;
        
        // Generate digest notification
        const digest = generateDigestNotification({
          category: group.category,
          frequency,
          notifications: group.notifications,
          userName
        });

        // Send digest using the notification type from the group
        // But check preferences to see if we should send via email/SMS
        const result = await sendNotification({
          userId: group.user_id,
          notificationType: group.notification_type,
          category: group.category,
          subject: digest.subject,
          message: digest.message,
          html: digest.emailHtml,
          text: digest.smsText,
          userName,
          metadata: { 
            digest: frequency, 
            aggregated_count: group.notifications.length,
            is_digest: true
          }
        }, supabase);

        if (result.success && result.notificationIds && result.notificationIds.length > 0) {
          // Mark original notifications as sent
          const notificationIds = group.notifications.map(n => n.notification_id);
          const { error: updateError } = await supabase
            .from('notification_history')
            .update({ delivery_status: 'sent' })
            .in('notification_id', notificationIds);

          if (updateError) {
            console.error('Error updating notification status:', updateError);
            errors.push(`Failed to update status for user ${group.user_id}: ${updateError.message}`);
          } else {
            processed += group.notifications.length;
          }
        } else {
          const errorMsg = result.error || result.errors?.join('; ') || 'Unknown error';
          errors.push(`Failed to send digest for user ${group.user_id}: ${errorMsg}`);
        }
      } catch (error) {
        console.error(`Error processing digest for user ${group.user_id}:`, error);
        errors.push(`Error processing digest for user ${group.user_id}: ${error.message}`);
      }
    }

    return {
      success: errors.length === 0,
      processed,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('Error in processDigestNotifications:', error);
    return { success: false, processed: 0, errors: [error.message] };
  }
}

