# Metro Landmark — Deployment Setup Guide

Companion to the [README](./README.md) quickstart. Use this document when deploying Metro Landmark to Vercel with Supabase (and optional email, SMS, or voice).

Local development only needs `.db-environments.json` + `npm run env:select` as described in the README. This guide covers the full set of server and client environment variables and post-deploy checks.

## Table of Contents

1. [Required Subscriptions & Services](#required-subscriptions--services)
2. [Prerequisites](#prerequisites)
3. [Environment Variables](#environment-variables)
4. [Database Utility (db-util) Setup](#database-utility-db-util-setup)
5. [Initial Database Setup](#initial-database-setup)
6. [Vercel Deployment](#vercel-deployment)
7. [Post-Deployment Configuration](#post-deployment-configuration)
8. [Troubleshooting](#troubleshooting)

---

## Required Subscriptions & Services

### Core Services (Required)

1. **Supabase** (Database & Authentication)
   - **Purpose**: PostgreSQL database, authentication, and storage
   - **Sign up**: [supabase.com](https://supabase.com)
   - **Free tier**: Available (suitable for development)
   - **What you need**:
     - Project URL
     - Anon (public) key
     - Service role key (for server-side operations)
     - Database password (set during project creation)

2. **Vercel** (Hosting & Serverless Functions)
   - **Purpose**: Frontend hosting and API serverless functions
   - **Sign up**: [vercel.com](https://vercel.com)
   - **Free tier**: Available (suitable for development)
   - **What you need**:
     - Vercel account
     - Project connected to your Git repository

3. **OpenAI** (AI Features)
   - **Purpose**: PDF form extraction, document processing, AI chat bot
   - **Sign up**: [openai.com](https://openai.com)
   - **Pricing**: Pay-as-you-go (typically $5-20/month for moderate usage)
   - **What you need**:
     - API key with GPT-4 access

### Optional Services

4. **SendGrid** (Email Notifications)
   - **Purpose**: Email notifications to users
   - **Sign up**: [sendgrid.com](https://sendgrid.com)
   - **Free tier**: 100 emails/day
   - **What you need**:
     - API key with "Mail Send" permissions

5. **Twilio** (SMS Notifications - Optional)
   - **Purpose**: SMS notifications to users
   - **Sign up**: [twilio.com](https://twilio.com)
   - **Pricing**: Pay-as-you-go (~$0.0075 per SMS)
   - **What you need**:
     - Account SID
     - Auth Token
     - Phone number (purchased from Twilio)

6. **Vapi.ai** (Voice Bot - Optional)
   - **Purpose**: Voice-based maintenance request system
   - **Sign up**: [vapi.ai](https://vapi.ai)
   - **Pricing**: Pay-as-you-go (~$0.30-0.60 per call)
   - **What you need**:
     - Private API key (for serverless functions)
     - Public API key (for frontend, if needed)

---

## Prerequisites

Before setting up a new deployment, ensure you have:

1. **Node.js 22.x** installed
   ```bash
   node --version  # Should show v22.x.x
   ```

2. **Git** installed and repository cloned
   ```bash
   git clone <your-repository-url>
   cd metro-landmark
   ```

3. **npm** installed (comes with Node.js)
   ```bash
   npm --version
   ```

4. **Supabase Project Created**
   - Create a new project at [supabase.com](https://supabase.com)
   - Note down:
     - Project URL (e.g., `https://xxxxx.supabase.co`)
     - Anon key (found in Settings → API)
     - Service role key (found in Settings → API)
     - Database password (set during project creation)

5. **Vercel Account**
   - Sign up at [vercel.com](https://vercel.com)
   - Connect your Git repository

---

## Environment Variables

### Required Environment Variables

These must be set in **Vercel Dashboard → Settings → Environment Variables**:

#### Database & Supabase
```bash
# Supabase Project URL
SUPABASE_URL=https://your-project.supabase.co

# Supabase Publishable (Public) Key
SUPABASE_PUBLISHABLE_KEY=your_publishable_key_here

# Supabase Service Role Key (for server-side operations)
# Also known as "secret" key - use either variable name
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
# OR (both work - code checks for both)
SUPABASE_SECRET_KEY=your_service_role_key_here

# Database Connection String (for direct database access)
DATABASE_URL=postgresql://postgres:your_password@db.your-project.supabase.co:5432/postgres
```

#### OpenAI (Required for AI Features)
```bash
# OpenAI API Key
OPENAI_API_KEY=sk-proj-...

# Optional: Specify model (defaults to gpt-4-turbo)
OPENAI_MODEL=gpt-4-turbo
```

### Optional Environment Variables

#### Email Notifications (SendGrid)
```bash
# SendGrid API Key
SENDGRID_API_KEY=SG.xxxxx

# Optional: Custom sender email and name
FROM_EMAIL=noreply@yourdomain.com
FROM_NAME=Metro Landmark
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=Metro Landmark
```

#### SMS Notifications (Twilio - Optional)
```bash
# Twilio Credentials
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
FROM_PHONE=+1234567890
TWILIO_PHONE_NUMBER=+1234567890
```

#### Voice Bot (Vapi.ai - Optional)
```bash
# Vapi.ai Private API Key (for serverless functions)
VAPI_API_KEY=your_vapi_private_key

# Vapi phone number resource UUID (required for outbound vendor calls)
VAPI_PHONE_NUMBER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Optional: E.164 of the same Vapi number (also used as tenant-facing default)
VAPI_PHONE_NUMBER=+12064017109

# Tenant UI "Call Voice Bot" number (browser). Defaults to reference 206 number if unset.
VITE_TENANT_MAINTENANCE_PHONE=+12064017109

# Optional: Testing mode - routes all calls to this number
TESTER_PHONE_NUMBER=+1234567890
```

#### Cron Jobs (Optional Security)
```bash
# Secret for securing cron job endpoints
CRON_SECRET=your-random-secret-string
VERCEL_CRON_SECRET=your-random-secret-string
```

### Client-Side / Brand Environment Variables

Operator rebrand needs at most three variables. Heading, sidebar stacked lines, and the auth `localStorage` key are **derived** from `VITE_PRODUCT_NAME`. Logo and background use JSON so path and optional alt travel together.

On Vercel, set these in the dashboard (enable **Production**) so `/api/brand-config` can apply them at request time. Redeploy after changes. Paste the JSON as a single-line value (no need to escape quotes in the Vercel UI).

```bash
# Required for the SPA to talk to Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key_here

# Optional Salish Landmark reference branding
VITE_PRODUCT_NAME=Salish Landmark
VITE_LOGO={"logo":[{"path":"/brand/salish-landmark-totem.svg"},{"alt":"Totem Pole"}]}
VITE_BACKGROUND={"background":[{"path":"/brand/salish-landmark-background.jpg"},{"alt":"Longhouse"}]}
```

`alt` entries are optional. Path and alt may be on the same array item or separate items.

After a correct Salish setup, `GET /api/brand-config` should look like:

```json
{
  "productName": "Salish Landmark",
  "logoUrl": "/brand/salish-landmark-totem.svg",
  "logoAlt": "Totem Pole",
  "backgroundUrl": "/brand/salish-landmark-background.jpg",
  "backgroundAlt": "Longhouse"
}
```

---

## Database Utility (db-util) Setup

The `db-util` is a comprehensive database management tool that handles:
- Database initialization
- Schema migrations
- User management
- Environment switching

### Prerequisites for Using db-util

**Before running db-util, you must:**

1. **Have Supabase credentials ready**:
   - Project URL
   - Database password
   - Anon key (optional, for some operations)
   - Service role key (optional, for some operations)

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Ensure Node.js 22.x is installed** (required by `package.json`)

### Starting db-util

#### Option 1: Web GUI (Recommended)

```bash
npm run db:util
```

This starts a web server at `http://localhost:3001` with a user-friendly interface for:
- Adding/editing database environments
- Testing connections
- Running database operations (initialize, migrate, create admin)
- Viewing database statistics

#### Option 2: Command Line Interface

```bash
node scripts/db-util-menu.js
```

Provides an interactive menu for database operations.

### Using db-util Web GUI

1. **Start the utility**:
   ```bash
   npm run db:util
   ```

2. **Open your browser** to `http://localhost:3001`

3. **Add a Database Environment**:
   - Click "Add Environment" or "Manage Environments"
   - Fill in:
     - **Name**: Descriptive name (e.g., "Production", "Development")
     - **Type**: Select "Supabase"
     - **Supabase URL**: Your project URL (e.g., `https://xxxxx.supabase.co`)
     - **Database Password**: The password you set when creating the Supabase project
     - **Anon Key** (optional): For client-side operations
     - **Service Role Key** (optional): For server-side operations
   - Click "Test Connection" to verify
   - Click "Save Environment"

4. **Select Environment**:
   - Choose your environment from the dropdown
   - Click "Select Environment"

5. **Initialize Database**:
   - Click "Initialize Database"
   - This will:
     - Create all database tables
     - Run schema migrations
     - Create initial admin user (if specified)

6. **Create Admin User** (if not done during initialization):
   - Click "Create Global Admin"
   - Enter:
     - First Name
     - Middle Name (optional)
     - Last Name
     - Email
     - Password
     - Confirm Password

### db-util Command Line Options

```bash
# Initialize database (creates tables + runs migrations)
node scripts/db-util.js init [environment-name]

# Run migrations only
node scripts/db-util.js migrate [environment-name]

# Create global admin user only
node scripts/db-util.js create-admin [environment-name]

# Drop database (local only)
node scripts/db-util.js drop [environment-name]

# Create database (local only)
node scripts/db-util.js create [environment-name]

# Reset database (drop + create + initialize)
node scripts/db-util.js reset [environment-name]
```

### Environment Configuration File

db-util stores environment configurations in `.db-environments.json` (created automatically):

```json
{
  "environments": [
    {
      "name": "Production",
      "type": "supabase",
      "supabaseUrl": "https://xxxxx.supabase.co",
      "databasePassword": "your_password",
      "anonKey": "your_anon_key",
      "serviceRoleKey": "your_service_role_key"
    }
  ],
  "lastUsed": "Production"
}
```

**Important**: Never commit `.db-environments.json` to version control. It contains sensitive credentials.

---

## Initial Database Setup

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in:
   - **Name**: Your project name
   - **Database Password**: Choose a strong password (save this!)
   - **Region**: Choose closest to your users
4. Wait for project to be created (~2 minutes)

### Step 2: Get Supabase Credentials

1. In Supabase Dashboard, go to **Settings → API**
2. Copy:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **Publishable** key (client-side, safe to expose)
   - **Secret** key (server-side only, keep this secret!)

3. Go to **Settings → Database**
4. Find your **Database Password** (the one you set during creation)

### Step 3: Configure db-util

1. Start db-util:
   ```bash
   npm run db:util
   ```

2. Open `http://localhost:3001` in your browser

3. Add your Supabase environment:
   - Click "Add Environment"
   - Enter all credentials from Step 2
   - Test connection
   - Save

### Step 4: Initialize Database

1. In db-util GUI, select your environment
2. Click "Initialize Database"
3. Wait for completion (this creates all tables and runs migrations)

### Step 5: Create Initial Admin User

1. In db-util GUI, click "Create Global Admin"
2. Enter admin user details:
   - First Name: Admin
   - Last Name: User
   - Email: admin@yourdomain.com
   - Password: (choose a strong password)
3. Click "Create"

**Important**: Change the admin password after first login!

### Step 6: Verify Database

1. In db-util GUI, click "View Statistics"
2. Verify tables were created:
   - `users` (should have 1 admin user)
   - `pm_companies`
   - `landlords`
   - `properties`
   - `units`
   - `clients`
   - And many more...

---

## Vercel Deployment

### Step 1: Connect Repository to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your Git repository
4. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `./` (root)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

### Step 2: Configure Environment Variables

1. In Vercel project, go to **Settings → Environment Variables**
2. Add all required variables (see [Environment Variables](#environment-variables) section)
3. **Important**: Add variables for all environments:
   - Production
   - Preview
   - Development

### Step 3: Deploy

1. Click "Deploy" (or push to your main branch)
2. Wait for deployment to complete
3. Vercel will provide a URL (e.g., `https://your-project.vercel.app`)

### Step 4: Configure Vercel Cron Jobs

Cron jobs are automatically configured in `vercel.json`:

- **Call Vendors**: Every 10 minutes (`*/10 * * * *`)
- **Daily Digest Notifications**: Every day at 8 AM UTC (`0 8 * * *`)
- **Weekly Digest Notifications**: Every Monday at 8 AM UTC (`0 8 * * 1`)
- **Close Resolved Requests**: Every hour (`0 * * * *`)

No additional configuration needed - Vercel reads `vercel.json` automatically.

### Step 5: Set Up Supabase Storage (for Documents)

#### 5.1: Create Storage Bucket

1. In Supabase Dashboard, go to **Storage**
2. Click **New bucket**
3. Create a new bucket with these settings:
   - **Name**: `documents`
   - **Public**: No (private bucket - files require authentication)
   - **File size limit**: 10MB (or as needed)
   - **Allowed MIME types**: `application/pdf,image/png,image/jpeg,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document`

#### 5.2: Configure Storage Policies (Required)

**Important**: Storage policies must be created manually because the `storage.objects` table requires special permissions that regular database users don't have.

You have three options (in order of recommendation):

**Option 1: Supabase Dashboard UI (Easiest - Recommended)**

This is the most reliable method and doesn't require any special permissions. Follow these detailed steps:

#### Step 1: Navigate to Storage Policies

1. Log in to your Supabase Dashboard
2. Select your project
3. In the left sidebar, click **Storage**
4. Click **Policies** (you should see tabs for "Buckets" and "Schema" at the top)
5. Click the **Schema** tab (important: not the "Buckets" tab)

#### Step 2: Create Policy 1 - Upload (INSERT)

1. Under the section **"Other policies under storage.objects"**, click **New policy**
2. Fill in the form:
   - **Policy name**: `Allow authenticated users to upload to documents bucket`
   - **Allowed operation**: Select `INSERT` from the dropdown
   - **Target roles**: Type `authenticated` (or select it if it appears in the dropdown)
   - **WITH CHECK expression**: Enter `bucket_id = 'documents' AND auth.uid() IS NOT NULL`
   - Leave **USING expression** empty (not needed for INSERT)
3. Click **Review** to verify, then click **Save policy**

#### Step 3: Create Policy 2 - Download (SELECT)

1. Click **New policy** again (under "Other policies under storage.objects")
2. Fill in the form:
   - **Policy name**: `Allow authenticated users to read from documents bucket`
   - **Allowed operation**: Select `SELECT` from the dropdown
   - **Target roles**: Type `authenticated`
   - **USING expression**: Enter `bucket_id = 'documents' AND auth.uid() IS NOT NULL`
   - Leave **WITH CHECK expression** empty (not needed for SELECT)
3. Click **Review**, then click **Save policy**

#### Step 4: Create Policy 3 - Update

1. Click **New policy** again
2. Fill in the form:
   - **Policy name**: `Allow authenticated users to update documents bucket`
   - **Allowed operation**: Select `UPDATE` from the dropdown
   - **Target roles**: Type `authenticated`
   - **USING expression**: Enter `bucket_id = 'documents' AND auth.uid() IS NOT NULL`
   - **WITH CHECK expression**: Enter `bucket_id = 'documents' AND auth.uid() IS NOT NULL`
3. Click **Review**, then click **Save policy**

#### Step 5: Create Policy 4 - Delete

1. Click **New policy** again
2. Fill in the form:
   - **Policy name**: `Allow authenticated users to delete from documents bucket`
   - **Allowed operation**: Select `DELETE` from the dropdown
   - **Target roles**: Type `authenticated`
   - **USING expression**: Enter `bucket_id = 'documents' AND auth.uid() IS NOT NULL`
   - Leave **WITH CHECK expression** empty (not needed for DELETE)
3. Click **Review**, then click **Save policy**

#### Verification

After creating all four policies, you should see them listed under "Other policies under storage.objects". 

**To verify policies via SQL** (you can run this in the SQL Editor - it only requires SELECT permission):

```sql
-- Check if all four storage policies exist
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%documents bucket%'
ORDER BY policyname;
```

This query should return 4 rows (one for each policy). If you see all four policies listed, they're set up correctly.

**To verify in Dashboard**:
- Go to **Storage → Policies → Schema** tab
- Under "Other policies under storage.objects", you should see all 4 policies listed

**To test functionality**:
- Try uploading a document in your application
- Try downloading a document
- If both work without RLS errors, the policies are configured correctly

**Option 2: Supabase CLI (If you have CLI installed)**

If you have the Supabase CLI installed and configured:

1. Install Supabase CLI: `npm install -g supabase`
2. Link your project: `supabase link --project-ref your-project-ref`
3. Run the SQL script: `supabase db query --file STORAGE_POLICIES.sql`

The CLI may have elevated permissions that allow it to create storage policies.

**Note**: The SQL Editor cannot be used because:
- Regular database users cannot use `SET ROLE` to switch to `supabase_storage_admin`
- You'll get a "permission denied" error if you try
- The Dashboard UI (Option 1) is the most reliable method

**Note**: These policies allow all authenticated users to upload, download, update, and delete files in the `documents` bucket. For more restrictive access (e.g., users can only access their own files), modify the policy expressions accordingly.

---

## Post-Deployment Configuration

### 1. Verify Environment Variables

1. In Vercel Dashboard, go to **Settings → Environment Variables**
2. Verify all required variables are set
3. Check that variables are applied to the correct environments

### 2. Test Database Connection

1. Visit your deployed site
2. Try logging in with the admin user you created
3. If login fails, check:
   - `SUPABASE_URL` is correct
   - `SUPABASE_PUBLISHABLE_KEY` is correct
   - Database is accessible from Vercel

### 3. Test API Endpoints

Test key endpoints:
- `/api/login` - Authentication
- `/api/documents/list` - Document listing
- `/api/notifications/test` - Notification system

### 4. Configure Email Domain (SendGrid)

If using SendGrid:
1. Verify your sender domain in SendGrid
2. Set up SPF and DKIM records
3. Update `FROM_EMAIL` to use your verified domain

### 5. Test Voice Bot (if enabled)

1. Ensure `VAPI_API_KEY` is set
2. Test a maintenance call
3. Verify call routing works

---

## Troubleshooting

### Database Connection Issues

**Problem**: Cannot connect to Supabase database

**Solutions**:
1. Verify database password is correct
2. Check Supabase project is active (not paused)
3. Verify IP allowlist in Supabase (if enabled)
4. Try using connection pooler instead of direct connection
5. Check `DATABASE_URL` format is correct

### Migration Errors

**Problem**: Migrations fail when running db-util

**Solutions**:
1. Check database has proper permissions
2. Verify no conflicting tables exist
3. Review migration logs in `db-util.log`
4. Try running migrations individually
5. Check Supabase logs for detailed errors

### Environment Variable Issues

**Problem**: Variables not available in Vercel functions

**Solutions**:
1. Ensure variables are set in Vercel Dashboard
2. Redeploy after adding variables
3. Check variable names match exactly (case-sensitive)
4. Verify variables are applied to correct environment
5. For client-side: ensure `VITE_` prefix is used

### Build Failures

**Problem**: Vercel build fails

**Solutions**:
1. Check Node.js version (must be 22.x)
2. Verify all dependencies in `package.json`
3. Check build logs for specific errors
4. Ensure `package-lock.json` is committed
5. Try building locally: `npm run build`

### Authentication Issues

**Problem**: Users cannot log in

**Solutions**:
1. Verify `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are correct
2. Check Supabase authentication is enabled
3. Verify user exists in database
4. Check password hashing is working
5. Review Supabase authentication logs

### API Function Timeouts

**Problem**: API functions timeout

**Solutions**:
1. Check function timeout settings in `vercel.json`
2. Optimize function code
3. Consider increasing `maxDuration` for long-running functions
4. Review function logs for bottlenecks

---

## Quick Reference

### Essential Commands

```bash
# Start db-util GUI
npm run db:util

# Initialize database
node scripts/db-util.js init [environment]

# Run migrations
node scripts/db-util.js migrate [environment]

# Create admin user
node scripts/db-util.js create-admin [environment]

# Build for production
npm run build

# Deploy to Vercel
vercel --prod
```

### Important Files

- `vercel.json` - Vercel configuration (cron jobs, function settings)
- `.db-environments.json` - Database environment configurations (DO NOT COMMIT)
- `scripts/migrations/00-comprehensive-schema-migration.sql` - Database schema
- `scripts/db-util-server.js` - Database utility server
- `package.json` - Project dependencies and scripts

### Support Resources

- **Supabase Docs**: [supabase.com/docs](https://supabase.com/docs)
- **Vercel Docs**: [vercel.com/docs](https://vercel.com/docs)
- **OpenAI Docs**: [platform.openai.com/docs](https://platform.openai.com/docs)
- **SendGrid Docs**: [docs.sendgrid.com](https://docs.sendgrid.com)
- **Twilio Docs**: [twilio.com/docs](https://twilio.com/docs)

---

## Security Best Practices

1. **Never commit credentials**:
   - `.db-environments.json` should be in `.gitignore`
   - Never commit `.env` files
   - Use environment variables in Vercel

2. **Use strong passwords**:
   - Database passwords should be complex
   - Admin user passwords should be strong
   - Rotate passwords regularly

3. **Limit service role key access**:
   - Service role key bypasses RLS - use carefully
   - Only use in serverless functions
   - Never expose to client-side code

4. **Enable RLS in Supabase**:
   - Set up Row Level Security policies
   - Test policies thoroughly
   - Review access patterns regularly

5. **Monitor API usage**:
   - Set up usage alerts for OpenAI
   - Monitor Vercel function invocations
   - Track database connection usage

---

**Last Updated**: December 2025  
**Version**: 1.0

