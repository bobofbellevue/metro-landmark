import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client with service role key for server-side API endpoints.
 * Service role key bypasses RLS, which is appropriate for server-side operations.
 * 
 * @returns {Object} Supabase client instance
 */
export function createSupabaseClient() {
  const supabaseUrl = 
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  
  const supabaseKey = 
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase configuration missing. SUPABASE_URL and service role key required.');
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

