import { createClient } from '@supabase/supabase-js';

// Supabase configuration — require Vite env (no hardcoded project keys).
// Local: set VITE_* in .env.local, or run `npm run env:select` / `npm run dev`
// after configuring .db-environments.json (gitignored).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. ' +
      'Set them in .env.local, or run npm run env:select after configuring .db-environments.json.'
  );
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseKey);

// Test RLS policies on initialization (only log errors)
(async () => {
  try {
    const { data: testData, error: testError } = await supabase
      .from('users')
      .select('user_id')
      .limit(1);
    
    if (testError) {
      console.error('[Supabase] RLS test failed - queries may be blocked:', testError);
      if (testError.code === '42501' || testError.message?.includes('permission denied') || testError.message?.includes('policy')) {
        console.error('[Supabase] RLS Policy Issue: Run the migration file to create RLS policies: scripts/migrations/000_comprehensive_schema_migration.sql');
      }
    }
  } catch (err) {
    console.error('[Supabase] Error testing RLS:', err);
  }
})();
