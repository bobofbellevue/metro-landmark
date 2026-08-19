/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';

/**
 * GET /api/notifications/preferences
 * PUT /api/notifications/preferences
 */

export function defaultNotificationPreferences(userId) {
  return {
    user_id: userId,
    email_enabled: true,
    sms_enabled: false,
    push_enabled: false,
    maintenance_email: true,
    maintenance_sms: false,
    maintenance_push: false,
    maintenance_frequency: 'immediate',
    lease_email: true,
    lease_sms: false,
    lease_push: false,
    lease_frequency: 'immediate',
    payment_email: true,
    payment_sms: false,
    payment_push: false,
    payment_frequency: 'immediate',
    general_email: true,
    general_sms: false,
    general_push: false,
    general_frequency: 'immediate',
  };
}

export function parseUserIdHeader(headers = {}) {
  const n = parseInt(headers['x-user-id'], 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Database configuration error',
    });
  }

  try {
    const userId = parseUserIdHeader(req.headers);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    if (req.method === 'GET') {
      const { data: preferences, error } = await supabase
        .from('user_notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching preferences:', error);
        return res.status(200).json({
          success: true,
          preferences: defaultNotificationPreferences(userId),
          warning: error.message || 'Failed to fetch preferences',
        });
      }

      if (preferences) {
        return res.status(200).json({
          success: true,
          preferences,
        });
      }

      const defaults = defaultNotificationPreferences(userId);
      const { data: newPreferences, error: createError } = await supabase
        .from('user_notification_preferences')
        .insert(defaults)
        .select()
        .maybeSingle();

      if (createError) {
        console.error('Error creating default preferences:', createError);
        return res.status(200).json({
          success: true,
          preferences: defaults,
          warning: createError.message || 'Failed to persist default preferences',
        });
      }

      return res.status(200).json({
        success: true,
        preferences: newPreferences || defaults,
      });
    }

    if (req.method === 'PUT') {
      const updateData = {
        ...req.body,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('user_notification_preferences')
        .select('preference_id')
        .eq('user_id', userId)
        .maybeSingle();

      let result;
      if (existing) {
        const { data, error } = await supabase
          .from('user_notification_preferences')
          .update(updateData)
          .eq('user_id', userId)
          .select()
          .maybeSingle();

        if (error) {
          console.error('Error updating preferences:', error);
          return res.status(500).json({
            success: false,
            error: error.message || 'Failed to update preferences',
          });
        }

        result = data;
      } else {
        const row = {
          ...defaultNotificationPreferences(userId),
          ...updateData,
          user_id: userId,
        };

        const { data, error } = await supabase
          .from('user_notification_preferences')
          .insert(row)
          .select()
          .maybeSingle();

        if (error) {
          console.error('Error creating preferences:', error);
          return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create preferences',
          });
        }

        result = data;
      }

      return res.status(200).json({
        success: true,
        preferences: result,
      });
    }

    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  } catch (error) {
    console.error('Error in notification preferences handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
