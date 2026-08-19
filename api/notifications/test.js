/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';
import { sendNotification } from '../utils/notification-service.js';
import { formatNotificationTestMessage } from '../utils/notification-test-message.js';

/**
 * Vercel serverless function to send a test notification
 * 
 * POST /api/notifications/test
 * Body: {
 *   notification_type: 'email' | 'sms' | 'push',
 *   category: 'maintenance' | 'lease' | 'payment' | 'general'
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  try {
    const supabase = createSupabaseClient();

    // Get user ID from headers
    const userId = req.headers['x-user-id'] ? parseInt(req.headers['x-user-id']) : null;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required'
      });
    }

    const { notification_type, category } = req.body;

    if (!notification_type || !category) {
      return res.status(400).json({
        success: false,
        error: 'notification_type and category are required'
      });
    }

    if (!['email', 'sms', 'push'].includes(notification_type)) {
      return res.status(400).json({
        success: false,
        error: 'notification_type must be email, sms, or push'
      });
    }

    if (!['maintenance', 'lease', 'payment', 'general'].includes(category)) {
      return res.status(400).json({
        success: false,
        error: 'category must be maintenance, lease, payment, or general'
      });
    }

    // Get user email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, first_name, last_name')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Send test notification
    const result = await sendNotification({
      userId,
      notificationType: notification_type,
      category,
      subject: 'Test Notification',
      message: 'This is a test notification to verify your notification preferences are working correctly.',
      metadata: { test: true },
      bypassPreferences: true,
      forceImmediate: true,
      maxRetries: 0,
    }, supabase);

    const channelResult = result.results?.[notification_type] || {};
    const destination =
      channelResult.destination ||
      (notification_type === 'email' ? user.email : null) ||
      null;
    const message = formatNotificationTestMessage({
      channel: notification_type,
      destination,
      success: Boolean(result.success),
      skipped: Boolean(channelResult.skipped),
      queued: Boolean(result.queued),
      error: channelResult.error || result.error || result.errors?.[0],
    });
    const delivered = Boolean(result.success) && !channelResult.skipped && !result.queued;

    if (!delivered) {
      return res.status(200).json({
        success: false,
        error: message,
        message,
        destination,
      });
    }

    return res.status(200).json({
      success: true,
      message,
      destination,
      notificationId: result.notificationId,
    });
  } catch (error) {
    console.error('Error in test notification handler:', error);
    const notificationType = req.body?.notification_type;
    const message = formatNotificationTestMessage({
      channel: notificationType,
      error: error.message || 'Internal server error',
    });
    return res.status(500).json({
      success: false,
      error: message,
      message,
    });
  }
}

