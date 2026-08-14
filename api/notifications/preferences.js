/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to manage notification preferences
 * 
 * GET /api/notifications/preferences
 * - Returns user's notification preferences
 * 
 * PUT /api/notifications/preferences
 * - Updates user's notification preferences
 * Body: {
 *   email_enabled?: boolean,
 *   sms_enabled?: boolean,
 *   push_enabled?: boolean,
 *   maintenance_email?: boolean,
 *   maintenance_sms?: boolean,
 *   maintenance_push?: boolean,
 *   maintenance_frequency?: 'immediate' | 'daily_digest' | 'weekly_digest',
 *   lease_email?: boolean,
 *   lease_sms?: boolean,
 *   lease_push?: boolean,
 *   lease_frequency?: 'immediate' | 'daily_digest' | 'weekly_digest',
 *   payment_email?: boolean,
 *   payment_sms?: boolean,
 *   payment_push?: boolean,
 *   payment_frequency?: 'immediate' | 'daily_digest' | 'weekly_digest',
 *   general_email?: boolean,
 *   general_sms?: boolean,
 *   general_push?: boolean,
 *   general_frequency?: 'immediate' | 'daily_digest' | 'weekly_digest'
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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

    if (req.method === 'GET') {
      // Get user preferences
      const { data: preferences, error } = await supabase
        .from('user_notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('Error fetching preferences:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch preferences'
        });
      }

      // If no preferences exist, return defaults
      if (!preferences) {
        const defaultPreferences = {
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
          general_frequency: 'immediate'
        };

        // Create default preferences
        const { data: newPreferences, error: createError } = await supabase
          .from('user_notification_preferences')
          .insert(defaultPreferences)
          .select()
          .single();

        if (createError) {
          console.error('Error creating default preferences:', createError);
          return res.status(500).json({
            success: false,
            error: 'Failed to create default preferences'
          });
        }

        return res.status(200).json({
          success: true,
          preferences: newPreferences
        });
      }

      return res.status(200).json({
        success: true,
        preferences
      });
    }

    if (req.method === 'PUT') {
      // Update user preferences
      const updateData = {
        ...req.body,
        updated_at: new Date().toISOString()
      };

      // Check if preferences exist
      const { data: existing } = await supabase
        .from('user_notification_preferences')
        .select('preference_id')
        .eq('user_id', userId)
        .single();

      let result;
      if (existing) {
        // Update existing preferences
        const { data, error } = await supabase
          .from('user_notification_preferences')
          .update(updateData)
          .eq('user_id', userId)
          .select()
          .single();

        if (error) {
          console.error('Error updating preferences:', error);
          return res.status(500).json({
            success: false,
            error: 'Failed to update preferences'
          });
        }

        result = data;
      } else {
        // Create new preferences with provided data and defaults
        const defaultPreferences = {
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
          ...updateData
        };

        const { data, error } = await supabase
          .from('user_notification_preferences')
          .insert(defaultPreferences)
          .select()
          .single();

        if (error) {
          console.error('Error creating preferences:', error);
          return res.status(500).json({
            success: false,
            error: 'Failed to create preferences'
          });
        }

        result = data;
      }

      return res.status(200).json({
        success: true,
        preferences: result
      });
    }

    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  } catch (error) {
    console.error('Error in notification preferences handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

