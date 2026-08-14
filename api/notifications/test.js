/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../utils/notification-service.js';

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
    // Initialize Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

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
      metadata: { test: true }
    }, supabase);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to send test notification'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Test notification sent successfully',
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error in test notification handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

