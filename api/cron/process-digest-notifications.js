/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { processDigestNotifications } from '../utils/notification-service.js';

/**
 * Vercel cron job to process digest notifications
 * 
 * This should be called by Vercel cron:
 * - Daily digest: Every day at 8 AM
 * - Weekly digest: Every Monday at 8 AM
 * 
 * Query params:
 * - frequency: 'daily_digest' or 'weekly_digest'
 * - secret: CRON_SECRET for authentication
 */
export default async function handler(req, res) {
  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
  const providedSecret = req.query.secret || req.headers['x-cron-secret'];

  if (cronSecret && providedSecret !== cronSecret) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  try {
    const frequency = req.query.frequency || 'daily_digest';

    if (!['daily_digest', 'weekly_digest'].includes(frequency)) {
      return res.status(400).json({
        success: false,
        error: 'frequency must be daily_digest or weekly_digest'
      });
    }

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

    // Process digest notifications
    const result = await processDigestNotifications(frequency, supabase);

    return res.status(200).json({
      success: result.success,
      frequency,
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in process-digest-notifications cron:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

