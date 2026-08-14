# Row Level Security (RLS) Setup Guide

## ⚠️ Security Issue

Your Supabase tables are currently exposed without Row Level Security (RLS). This means anyone with the anon key (which is public in your frontend code) can potentially access your database tables directly.

## Tables That Need RLS

Based on your codebase, these tables need RLS enabled:
- `pm_companies`
- `users`
- `contacts`
- `properties`
- `landlords`
- `units`
- `leases`
- `applicants`
- `application_units`
- `contact_methods`
- `addresses`
- `lease_tenants`
- `templates`
- `maintenance_requests`
- And any other tables in the `public` schema

## How to Enable RLS

### Option 1: Using Supabase Dashboard (Recommended for Quick Setup)

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **Policies**
3. For each table:
   - Click on the table name
   - Click **"Enable RLS"** button
   - Create policies for SELECT, INSERT, UPDATE, DELETE

### Option 2: Using SQL (Recommended for Production)

Run these SQL commands in the Supabase SQL Editor:

```sql
-- Enable RLS on all tables
ALTER TABLE public.pm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
-- Add other tables as needed

-- Example: Basic policy to allow all authenticated users (you'll need to customize)
-- This is a TEMPORARY policy - you should replace with proper role-based policies

-- For users table - allow users to read their own data
CREATE POLICY "Users can read own data"
ON public.users
FOR SELECT
USING (auth.uid()::text = user_id::text);

-- For pm_companies - allow authenticated users to read
CREATE POLICY "Authenticated users can read companies"
ON public.pm_companies
FOR SELECT
TO authenticated
USING (true);

-- For contacts - allow authenticated users to read
CREATE POLICY "Authenticated users can read contacts"
ON public.contacts
FOR SELECT
TO authenticated
USING (true);

-- Continue for other tables...
```

## Recommended Policy Structure

Based on your app's role-based access:

### Global Admins
- Full access to all tables

### Company Admins
- Read/write access to their company's data
- Read access to system-level data

### Landlords
- Read/write access to their own properties/units/tenants
- Limited read access to other data

### Tenants
- Read access to their own lease/unit data
- No write access to most tables

### Staff/Managers
- Role-dependent access based on company assignment

## Example Policy Templates

### For `pm_companies` table:

```sql
-- Allow authenticated users to read companies
CREATE POLICY "Authenticated users can read companies"
ON public.pm_companies
FOR SELECT
TO authenticated
USING (true);

-- Allow global admins to insert/update/delete
CREATE POLICY "Global admins can manage companies"
ON public.pm_companies
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.user_id::text = auth.uid()::text
    AND users.role = 'global_admin'
  )
);
```

### For `properties` table:

```sql
-- Allow users to read properties based on their role
CREATE POLICY "Users can read properties"
ON public.properties
FOR SELECT
TO authenticated
USING (
  -- Global admins can see all
  EXISTS (SELECT 1 FROM public.users WHERE users.user_id::text = auth.uid()::text AND users.role = 'global_admin')
  OR
  -- Company admins can see their company's properties
  (EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.user_id::text = auth.uid()::text 
    AND users.role = 'company_admin'
    AND users.pmc_id = properties.pmc_id
  ))
  OR
  -- Landlords can see their own properties
  (EXISTS (
    SELECT 1 FROM public.landlords
    WHERE landlords.landlord_id = properties.landlord_id
    AND landlords.user_id::text = auth.uid()::text
  ))
);
```

## Important Notes

1. **Test Thoroughly**: After enabling RLS, test all features of your app to ensure policies work correctly
2. **Start Restrictive**: It's better to start with restrictive policies and open them up as needed
3. **Use Service Role for Backend**: Your API endpoints should use the service role key (not anon key) for admin operations
4. **Monitor Logs**: Check Supabase logs after enabling RLS to catch any policy issues

## Current App Architecture

Your app currently:
- Uses Supabase client directly from frontend with anon key
- Performs all queries from client-side
- Has no server-side authentication layer for Supabase

## Recommended Changes

1. **Enable RLS** (this guide)
2. **Create role-based policies** matching your app's access patterns
3. **Consider moving sensitive operations** to your API endpoints (which use service role key)

## Testing After RLS

After enabling RLS, test:
- Login/logout
- All CRUD operations for each role
- Data filtering based on user role
- Cross-company data isolation

## Need Help?

If you encounter issues:
1. Check Supabase logs for policy violations
2. Test policies in Supabase SQL Editor first
3. Temporarily disable RLS on a table if needed (but re-enable ASAP)


