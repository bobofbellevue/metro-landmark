/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';
import { applyCors } from '../utils/cors.js';
import { requireSessionUserId, sendAuthError } from '../utils/session.js';

/**
 * Vercel serverless function to get notification history
 * 
 * GET /api/notifications/history
 * Query params:
 * - limit: number (default: 50)
 * - offset: number (default: 0)
 * - category: 'maintenance' | 'lease' | 'payment' | 'general'
 * - notification_type: 'email' | 'sms' | 'push'
 * - read: boolean
 * - start_date: ISO date string
 * - end_date: ISO date string
 */
export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.'
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

    // Build query
    let query = supabase
      .from('notification_history')
      .select('*')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false });

    // Apply filters
    if (req.query.category) {
      query = query.eq('category', req.query.category);
    }

    if (req.query.notification_type) {
      query = query.eq('notification_type', req.query.notification_type);
    }

    if (req.query.read !== undefined) {
      query = query.eq('read', req.query.read === 'true');
    }

    if (req.query.start_date) {
      query = query.gte('sent_at', req.query.start_date);
    }

    if (req.query.end_date) {
      query = query.lte('sent_at', req.query.end_date);
    }

    // Apply pagination
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    query = query.range(offset, offset + limit - 1);

    const { data: notifications, error, count } = await query;

    if (error) {
      console.error('Error fetching notification history:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch notification history'
      });
    }

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('notification_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return res.status(200).json({
      success: true,
      notifications: notifications || [],
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        hasMore: (offset + limit) < (totalCount || 0)
      }
    });
  } catch (error) {
    console.error('Error in notification history handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

