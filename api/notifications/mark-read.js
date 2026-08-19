/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';

/**
 * Vercel serverless function to mark notifications as read/unread
 * 
 * PUT /api/notifications/mark-read
 * Body: {
 *   notification_id: number (optional, if not provided, marks all as read),
 *   read: boolean
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use PUT.'
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

    const { notification_id, read } = req.body;

    if (read === undefined) {
      return res.status(400).json({
        success: false,
        error: 'read field is required'
      });
    }

    const updateData = {
      read: read === true,
      read_at: read === true ? new Date().toISOString() : null
    };

    let query = supabase
      .from('notification_history')
      .update(updateData)
      .eq('user_id', userId);

    if (notification_id) {
      query = query.eq('notification_id', notification_id);
    }

    const { data, error } = await query.select();

    if (error) {
      console.error('Error updating notification:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update notification'
      });
    }

    return res.status(200).json({
      success: true,
      updated: data?.length || 0
    });
  } catch (error) {
    console.error('Error in mark-read handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

