/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';
import { applyCors } from '../utils/cors.js';
import { requireSessionUserId, sendAuthError } from '../utils/session.js';

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
  applyCors(req, res, 'PUT, OPTIONS');

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
    const auth = requireSessionUserId(req);
    if (auth.userId == null) {
      sendAuthError(res, auth);
      return;
    }
    const userId = auth.userId;

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

