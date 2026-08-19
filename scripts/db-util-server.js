#!/usr/bin/env node

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(express.json());
// Don't serve static files - only serve the HTML file explicitly

// Log file path
const LOG_FILE = path.join(process.cwd(), 'db-util.log');

// Initialize log file (wipe existing if present)
function initLogFile() {
  try {
    const timestamp = new Date().toISOString();
    const header = `=== Database Utility Log - Started at ${timestamp} ===\n\n`;
    fs.writeFileSync(LOG_FILE, header);
  } catch (error) {
    console.error('⚠️ Could not initialize log file:', error.message);
  }
}

// Logging function for high-level messages (console + file)
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Write to console (high-level messages only)
  if (type === 'error') {
    console.error(message);
  } else {
    console.log(message);
  }
  
  // Write to file
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (error) {
    // Silently fail if we can't write to log file
  }
}

// Logging function for detailed messages (file only, no console)
function logDetail(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Write to file only (detailed migration steps)
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (error) {
    // Silently fail if we can't write to log file
  }
  
  // Only log errors to console from detail logs
  if (type === 'error') {
    console.error(message);
  }
}

// Initialize log file on startup
initLogFile();

// Configuration file path
const CONFIG_FILE = path.join(process.cwd(), '.db-environments.json');

// Load saved environments
function loadEnvironments() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('⚠️ Could not load saved environments:', error.message);
  }
  return { environments: [], lastUsed: null };
}

// Save environments
function saveEnvironments(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.log('⚠️ Could not save environments:', error.message);
  }
}

function getSelectedEnvironmentConfig(preferredName) {
  const config = loadEnvironments();
  const environments = Array.isArray(config.environments) ? config.environments : [];
  if (environments.length === 0) {
    throw new Error('No database environments are configured. Please add an environment before running this action.');
  }

  const environmentName = preferredName || config.lastUsed || environments[0].name;
  const environment = environments.find(env => env.name === environmentName);

  if (!environment) {
    throw new Error(`Selected environment '${environmentName}' was not found. Please re-select an environment.`);
  }

  return environment;
}

function extractEnvironmentName(req) {
  return req.body?.environmentName || req.body?.environment?.name || req.query?.environmentName;
}

async function connectToEnvironment(preferredName) {
  const environment = getSelectedEnvironmentConfig(preferredName);
  const sql = await getConnectionWithFallback(environment);
  return { environment, sql };
}

async function renameColumnIfExists(sqlClient, tableName, oldColumn, newColumn) {
  try {
    const [result] = await sqlClient`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = ${tableName}
          AND column_name = ${oldColumn}
        ) AS old_exists,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = ${tableName}
          AND column_name = ${newColumn}
        ) AS new_exists
    `;

    if (result?.old_exists && !result?.new_exists) {
      await sqlClient.unsafe(`ALTER TABLE ${tableName} RENAME COLUMN ${oldColumn} TO ${newColumn}`);
      logDetail(`🔄 Renamed column ${tableName}.${oldColumn} to ${newColumn}`);
    }
  } catch (error) {
    logDetail(`⚠️ Could not rename column ${tableName}.${oldColumn}: ${error.message}`, 'error');
  }
}

async function resetDatabase(sql, environment = null) {
  // Complete list of all tables - no duplicates, alphabetical order
  const tables = [
    'addresses',
    'amenities',
    'audit_logs',
    'chatbot_conversations',
    'client_applications',
    'client_appointments',
    'client_units',
    'clients',
    'communications',
    'compliance_policies',
    'compliance_rules',
    'compliance_workflows',
    'contact_methods',
    'contacts',
    'deposit_deductions',
    'document_signatures',
    'documents',
    'features',
    'invoices',
    'landlords',
    'lease_clients',
    'lease_fee_types',
    'leases',
    'legal_notices',
    'maintenance_requests',
    'notification_history',
    'payments',
    'phone_resources',
    'pm_companies',
    'properties',
    'property_amenities',
    'property_inspections',
    'property_types',
    'security_deposits',
    'templates',
    'transactions',
    'unit_features',
    'units',
    'user_notification_preferences',
    'users',
    'vendor_approvals',
    'vendor_hours',
    'vendor_keywords',
    'vendor_service_areas',
    'vendor_service_keywords',
    'vendors'
  ];

  log('📦 Dropping existing tables (if any)...');
  for (const table of tables) {
    try {
      await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
      logDetail(`✅ Dropped table: ${table}`);
    } catch (error) {
      logDetail(`⚠️ Error dropping table ${table}: ${error.message}`, 'error');
    }
  }
  log('✅ Table drop phase complete');

  // Return storage cleanup result for inclusion in response
  let storageCleanupResult = null;
  
  // Clean up storage files if environment is provided (check for Supabase URL regardless of type)
  if (environment && environment.supabaseUrl) {
    try {
      log('🗑️  Cleaning up Supabase Storage files...');
      
      const supabaseUrl = environment.supabaseUrl;
      // Try multiple possible key names (including Supabase-specific naming)
      const supabaseKey = environment.serviceKey || 
                         environment.serviceRoleKey || 
                         environment.service_role_key ||
                         environment.supabaseSecretKey ||
                         environment.supabase_secret_key ||
                         environment.secretKey ||
                         environment.secret_key ||
                         environment.anonKey || 
                         environment.anon_key;
      
      if (!supabaseKey) {
        const message = 'No Supabase service key found. Skipping storage cleanup.';
        log(`⚠️  ${message}`, 'error');
        logDetail('⚠️  Storage cleanup requires one of: serviceRoleKey, serviceKey, service_role_key, supabaseSecretKey, supabase_secret_key, secretKey, or secret_key in environment configuration.');
        logDetail(`⚠️  Available environment keys: ${Object.keys(environment).join(', ')}`);
        storageCleanupResult = { success: false, message, deleted_count: 0 };
      } else {
        // Determine which key was used for logging
        const keyType = environment.serviceKey ? 'serviceKey' :
                       environment.serviceRoleKey ? 'serviceRoleKey' :
                       environment.service_role_key ? 'service_role_key' :
                       environment.supabaseSecretKey ? 'supabaseSecretKey' :
                       environment.supabase_secret_key ? 'supabase_secret_key' :
                       environment.secretKey ? 'secretKey' :
                       environment.secret_key ? 'secret_key' :
                       'anonKey';
        logDetail(`🔑 Using Supabase key from environment (key type: ${keyType})`);
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // First, try to list the bucket to see if it exists
        const { data: bucketList, error: bucketError } = await supabase.storage.listBuckets();
        
        if (bucketError) {
          const message = `Error accessing storage: ${bucketError.message}. This might be a permissions issue.`;
          log(`⚠️  ${message}`, 'error');
          logDetail('⚠️  Ensure the service key has storage access.');
          storageCleanupResult = { success: false, message, deleted_count: 0 };
        } else {
          const documentsBucket = bucketList?.find(b => b.name === 'documents');
          if (!documentsBucket) {
            const message = 'Documents bucket does not exist. Nothing to clean up.';
            log(`ℹ️  ${message}`);
            storageCleanupResult = { success: true, message, deleted_count: 0 };
          } else {
            logDetail(`📦 Found documents bucket. Starting cleanup...`);
            
            // Recursively list and delete all files in the documents bucket
            let totalDeleted = 0;
            async function deleteAllFiles(folder = '') {
              const { data: items, error } = await supabase.storage
                .from('documents')
                .list(folder, {
                  limit: 1000,
                  offset: 0
                });

              if (error) {
                // If folder doesn't exist or is empty, that's fine
                if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
                  return;
                }
                log(`⚠️  Error listing folder ${folder || 'root'}: ${error.message}`, 'error');
                return;
              }

              if (!items || items.length === 0) {
                return;
              }

              const filesToDelete = [];
              const foldersToProcess = [];
              
              for (const item of items) {
                const fullPath = folder ? `${folder}/${item.name}` : item.name;
                
                // Check if it's a folder (folders typically have id === null or metadata === null)
                if (item.id === null || (item.metadata === null && !item.updated_at)) {
                  // It's a folder, recurse
                  foldersToProcess.push(fullPath);
                } else {
                  // It's a file
                  filesToDelete.push(fullPath);
                }
              }

              // Delete files in batches
              if (filesToDelete.length > 0) {
                const { error: deleteError } = await supabase.storage
                  .from('documents')
                  .remove(filesToDelete);

                if (deleteError) {
                  log(`⚠️  Error deleting files from ${folder || 'root'}: ${deleteError.message}`, 'error');
                } else {
                  totalDeleted += filesToDelete.length;
                  logDetail(`✅ Deleted ${filesToDelete.length} file(s) from ${folder || 'root'}`);
                }
              }

              // Process subfolders
              for (const subFolder of foldersToProcess) {
                await deleteAllFiles(subFolder);
              }
            }

            await deleteAllFiles();
            if (totalDeleted > 0) {
              const message = `Storage cleanup complete. Deleted ${totalDeleted} file(s) total.`;
              log(`✅ ${message}`);
              storageCleanupResult = { success: true, message, deleted_count: totalDeleted };
            } else {
              const message = 'Storage cleanup complete. No files found to delete.';
              log(`✅ ${message}`);
              storageCleanupResult = { success: true, message, deleted_count: 0 };
            }
          }
        }
      }
    } catch (error) {
      const message = `Error during storage cleanup: ${error.message}`;
      log(`⚠️  ${message}`, 'error');
      if (error.stack) {
        logDetail(error.stack, 'error');
      }
      logDetail('⚠️  Database tables were dropped, but some storage files may remain.');
      logDetail('⚠️  You can clean them up manually using the "Database Cleanup" tool in the Administration page.');
      storageCleanupResult = { success: false, message, deleted_count: 0, error: error.message };
    }
  } else if (environment && !environment.supabaseUrl) {
    const message = 'Storage cleanup is only available for Supabase environments (requires supabaseUrl).';
    log(`ℹ️  ${message}`);
    storageCleanupResult = { success: true, message, deleted_count: 0 };
  }
  
  return storageCleanupResult;
}

// Get database connection (Supabase only)
function getConnection(config, attemptPooler = false) {
  // For Supabase environments using direct connection
  // Extract project reference from URL
  const projectRef = config.supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // For direct database access, we need the actual database password
  const dbPassword = config.databasePassword || config.supabaseDatabasePassword;
  
  if (!dbPassword) {
    throw new Error('Database password is required for Supabase direct connection. Please add it to your environment configuration.');
  }
  
  // Use direct connection by default (matches vercel.json DATABASE_URL format)
  // Direct connection: db.{project_ref}.supabase.co:5432
  // Pooler connection: {project_ref}.pooler.supabase.com:6543 (fallback for VPN/network issues)
  // attemptPooler parameter allows automatic fallback when direct connection fails
  const usePooler = config.useConnectionPooler === true || attemptPooler;
  const host = usePooler 
    ? `${projectRef}.pooler.supabase.com`
    : `db.${projectRef}.supabase.co`;
  const port = usePooler ? 6543 : 5432;
  const username = usePooler ? `postgres.${projectRef}` : 'postgres';
  
  const sql = postgres({ 
    host: host,
    port: port,
    database: 'postgres',
    username: username,
    password: dbPassword,
    ssl: {
      rejectUnauthorized: false
    },
    transform: {
      undefined: null
    }
    // Note: The postgres library handles timeouts automatically
    // No need to configure connection timeout - it uses default socket timeout
    // Note: client_min_messages will be set after connection in getConnectionWithFallback
  });
  
  return sql;
}

// Get connection with automatic VPN fallback
async function getConnectionWithFallback(config) {
  // If pooler is preferred, try it first
  const preferPooler = config.useConnectionPooler === true || config.preferPooler === true;
  
  // Helper to suppress NOTICE messages on a connection
  async function suppressNotices(sql) {
    try {
      await sql`SET client_min_messages TO WARNING`;
    } catch (error) {
      // Ignore if this fails - connection might not be ready
    }
  }
  
  if (preferPooler) {
    try {
      // Try pooler first
      const sql = getConnection(config, true);
      await sql`SELECT 1 as test`; // Quick test
      await suppressNotices(sql);
      return sql;
    } catch (error) {
      // If pooler fails with network error, try direct
      if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message?.includes('getaddrinfo')) {
        console.log('⚠️ Pooler connection failed, trying direct connection...');
        const sql = getConnection(config, false);
        await sql`SELECT 1 as test`;
        await suppressNotices(sql);
        return sql;
      } else {
        throw error;
      }
    }
  } else {
    try {
      // Try direct connection first
      const sql = getConnection(config, false);
      await sql`SELECT 1 as test`; // Quick test
      await suppressNotices(sql);
      return sql;
    } catch (error) {
      // If direct connection fails with network error, try pooler
      if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message?.includes('getaddrinfo')) {
        console.log('⚠️ Direct connection failed, trying pooler connection...');
        const sql = getConnection(config, true);
        await sql`SELECT 1 as test`;
        await suppressNotices(sql);
        return sql;
      } else {
        throw error;
      }
    }
  }
}

// Test database connection with automatic VPN fallback
async function testConnection(config) {
  // If user has configured to prefer pooler, or if we've had DNS issues before, try pooler first
  const preferPooler = config.useConnectionPooler === true || config.preferPooler === true;
  const methods = [];
  const errors = [];
  
  // Try pooler first if preferred (often works better with VPNs/network issues)
  if (preferPooler) {
    methods.push({ name: 'Connection Pooler', usePooler: true });
    methods.push({ name: 'Direct Connection', usePooler: false });
  } else {
    // Try direct connection first (default, matches vercel.json)
    methods.push({ name: 'Direct Connection', usePooler: false });
    // Try pooler as fallback (often works better with VPNs)
    // Note: Pooler may not exist for all projects, so we'll catch ENOTFOUND and continue
    methods.push({ name: 'Connection Pooler', usePooler: true });
  }
  
  let lastError = null;
  for (const method of methods) {
    try {
      const sql = getConnection(config, method.usePooler);
      await sql`SELECT 1 as test`;
      await sql.end();
      return { 
        success: true, 
        message: `Connection successful using ${method.name}`,
        connectionMethod: method.name,
        usePooler: method.usePooler
      };
    } catch (error) {
      const errorInfo = {
        method: method.name,
        error: error.message,
        code: error.code
      };
      errors.push(errorInfo);
      lastError = error;
      
      // If pooler hostname doesn't exist (ENOTFOUND), skip it and don't treat as fatal
      // This is common - not all Supabase projects have pooler enabled
      if (method.usePooler && (error.code === 'ENOTFOUND' || error.message?.includes('ENOTFOUND'))) {
        console.log(`⚠️ Pooler connection not available (hostname doesn't exist), this is normal for some projects`);
        // Continue to try next method or return direct connection error if it was tried first
        continue;
      }
      
      // Check if this is a VPN/network issue that pooler might solve
      const isNetworkError = error.code === 'ENOTFOUND' || 
                            error.code === 'ETIMEDOUT' || 
                            error.code === 'ECONNREFUSED' ||
                            error.message.includes('getaddrinfo') ||
                            error.message.includes('ENOTFOUND');
      
      if (isNetworkError && !method.usePooler) {
        // Network issue with direct connection - pooler might work
        console.log(`⚠️ Direct connection failed (${error.code}), trying pooler as fallback...`);
      }
      // Continue to try next method
    }
  }
  
  // If all methods failed, return helpful error message
  const projectRef = config.supabaseUrl?.replace('https://', '').replace('.supabase.co', '') || 'unknown';
  
  // Filter out pooler errors if they're just "hostname doesn't exist" (normal for some projects)
  const relevantErrors = errors.filter(e => {
    // If it's a pooler ENOTFOUND, it's likely just that pooler doesn't exist - focus on direct connection error
    if (e.method === 'Connection Pooler' && e.code === 'ENOTFOUND') {
      return false; // Don't show this as the main error
    }
    return true;
  });
  
  const primaryError = relevantErrors[0] || errors[0] || lastError;
  const isDirectConnectionError = primaryError?.method === 'Direct Connection' || 
                                   (errors.length > 0 && errors.find(e => e.method === 'Direct Connection'));
  const isDNSIssue = primaryError?.code === 'ENOTFOUND' || primaryError?.error?.includes('getaddrinfo');
  
  let troubleshootingSteps = '';
  if (isDNSIssue && isDirectConnectionError) {
    troubleshootingSteps = `🛡️ DNS Resolution Failed (ENOTFOUND)

This usually means your computer cannot resolve the Supabase hostname.

Quick fixes:
1. Flush DNS cache (run as Administrator):
   Windows: ipconfig /flushdns
   Mac/Linux: sudo dscacheutil -flushcache (or sudo systemd-resolve --flush-caches)

2. Check if VPN is still interfering:
   - Completely exit VPN application (not just disconnect)
   - Restart your computer if DNS issues persist
   - Check VPN settings for DNS override options

3. Test DNS resolution manually:
   Windows: nslookup db.${projectRef}.supabase.co
   Mac/Linux: dig db.${projectRef}.supabase.co

4. Try using a different DNS server:
   - Google DNS: 8.8.8.8, 8.8.4.4
   - Cloudflare DNS: 1.1.1.1, 1.0.0.1

5. Check if Supabase project is active:
   - Visit https://supabase.com/dashboard
   - Ensure project is not paused`;
  } else if (primaryError?.code !== 'ENOTFOUND' || !primaryError?.error?.includes('pooler')) {
    // For non-DNS errors, provide general troubleshooting
    troubleshootingSteps = `Connection Error Details:
- Method: ${primaryError?.method || 'Unknown'}
- Error Code: ${primaryError?.code || 'Unknown'}
- Error: ${primaryError?.error || lastError?.message || 'Unknown error'}

Common issues:
- Database password might be incorrect
- Supabase project might be paused (check Supabase dashboard)
- Network/firewall might be blocking connection
- SSL/TLS certificate issues`;
  }
  
  // Build error summary
  const errorSummary = errors.map(e => `  - ${e.method}: ${e.error} (${e.code || 'no code'})`).join('\n');
  const poolerNote = errors.some(e => e.method === 'Connection Pooler' && e.code === 'ENOTFOUND') 
    ? '\n\nNote: Pooler connection is not available for this project (this is normal).' 
    : '';
  
  return { 
    success: false, 
    message: `Connection failed: ${primaryError?.error || lastError?.message || 'Unknown error'}. 
    
Connection attempts:
${errorSummary}${poolerNote}

${troubleshootingSteps}

Tried connections:
- Direct: db.${projectRef}.supabase.co:5432
- Pooler: ${projectRef}.pooler.supabase.com:6543 (may not exist for this project)` 
  };
}

// Create database if it doesn't exist (for local environments)
async function createDatabaseIfNotExists(config) {
  if (config.type === 'local') {
    try {
      // Connect to postgres database to create the target database
      const adminSql = postgres({
        host: config.host,
        port: config.port,
        database: 'postgres', // Connect to default postgres database
        username: config.username,
        password: config.password,
        ssl: config.ssl
      });
      
      // Create database if it doesn't exist
      await adminSql.unsafe(`CREATE DATABASE "${config.database}"`);
      console.log(`✅ Database '${config.database}' created successfully`);
      
      await adminSql.end();
    } catch (error) {
      if (error.code === '42P04') {
        // Database already exists, that's fine
        console.log(`ℹ️ Database '${config.database}' already exists`);
      } else {
        throw error;
      }
    }
  }
}

// Database schema creation
async function createTables(sql) {
  try {
    log('🏗️ Creating database tables...');
    // Create pm_companies table FIRST (no dependencies)
    await sql`
      CREATE TABLE IF NOT EXISTS pm_companies (
        pmc_id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER,
        archive_reason TEXT,
        theme JSONB
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_pm_companies_archived ON pm_companies(is_archived, archived_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS phone_resources (
        phone_resource_id SERIAL PRIMARY KEY,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE CASCADE,
        purpose VARCHAR(50) NOT NULL,
        e164 VARCHAR(32) NOT NULL,
        vapi_phone_number_id VARCHAR(64),
        label VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT phone_resources_purpose_check CHECK (
          purpose IN ('tenant_maintenance', 'vendor_dispatch', 'marketing', 'appointments')
        )
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_resources_pmc_purpose ON phone_resources (pmc_id, purpose) WHERE is_active = true AND pmc_id IS NOT NULL`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_resources_system_purpose ON phone_resources (purpose) WHERE is_active = true AND pmc_id IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_phone_resources_pmc ON phone_resources (pmc_id) WHERE pmc_id IS NOT NULL`;

    // Create users table (depends on pm_companies)
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_archived ON users(is_archived, archived_at)`;

    // Add foreign key constraint from pm_companies to users (now that users table exists)
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'pm_companies_archived_by_user_id_fkey'
          AND table_name = 'pm_companies'
        ) THEN
          ALTER TABLE pm_companies 
          ADD CONSTRAINT pm_companies_archived_by_user_id_fkey 
          FOREIGN KEY (archived_by_user_id) REFERENCES users(user_id);
        END IF;
      END $$;
    `;

    // Create landlords table (without name fields)
    await sql`
      CREATE TABLE IF NOT EXISTS landlords (
        landlord_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        manager_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_landlords_archived ON landlords(is_archived, archived_at)`;

    // Create clients table (unified applicant/tenant identity)
    await sql`
      CREATE TABLE IF NOT EXISTS clients (
        client_id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'active',
        risk_tier VARCHAR(50),
        date_of_birth DATE,
        social_security_number VARCHAR(11),
        gender VARCHAR(50),
        document_data JSONB DEFAULT '{}'::jsonb,
        profile_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_clients_archived ON clients(is_archived, archived_at)`;
    
    // Remove pmc_id column if it exists (migration cleanup)
    await sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'clients' 
          AND column_name = 'pmc_id'
        ) THEN
          DROP INDEX IF EXISTS idx_clients_pmc;
          ALTER TABLE clients DROP COLUMN pmc_id;
        END IF;
      END $$;
    `;

    // Views removed - code updated to use underlying tables directly
    // Drop any existing table or view with these names
    await sql`
      DO $$
      BEGIN
        DROP TABLE IF EXISTS tenants CASCADE;
        DROP VIEW IF EXISTS tenants CASCADE;
        DROP TABLE IF EXISTS applicants CASCADE;
        DROP VIEW IF EXISTS applicants CASCADE;
      END $$;
    `;

    // Create contacts table (with name fields)
    await sql`
      CREATE TABLE IF NOT EXISTS contacts (
        contact_id SERIAL PRIMARY KEY,
        contactable_id INTEGER NOT NULL,
        contactable_type VARCHAR(50) NOT NULL,
        first_name VARCHAR(255),
        middle_name VARCHAR(255),
        last_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create addresses table
    await sql`
      CREATE TABLE IF NOT EXISTS addresses (
        address_id SERIAL PRIMARY KEY,
        addressable_id INTEGER NOT NULL,
        addressable_type VARCHAR(50) NOT NULL,
        address_line_1 VARCHAR(255),
        address_line_2 VARCHAR(255),
        city VARCHAR(255),
        state_province_region VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create contact_methods table
    await sql`
      CREATE TABLE IF NOT EXISTS contact_methods (
        method_id SERIAL PRIMARY KEY,
        contact_id INTEGER REFERENCES contacts(contact_id) ON DELETE CASCADE,
        method_type VARCHAR(50) NOT NULL,
        value VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create properties table
    await sql`
      CREATE TABLE IF NOT EXISTS properties (
        property_id SERIAL PRIMARY KEY,
        property_name VARCHAR(255),
        property_type VARCHAR(100) NOT NULL,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
        landlord_id INTEGER REFERENCES landlords(landlord_id),
        city_of_jurisdiction VARCHAR(255),
        county_of_jurisdiction VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE properties ADD COLUMN city_of_jurisdiction VARCHAR(255);
        EXCEPTION WHEN duplicate_column THEN
          NULL;
        END;
        BEGIN
          ALTER TABLE properties ADD COLUMN county_of_jurisdiction VARCHAR(255);
        EXCEPTION WHEN duplicate_column THEN
          NULL;
        END;
        BEGIN
          ALTER TABLE properties ADD COLUMN property_name VARCHAR(255);
        EXCEPTION WHEN duplicate_column THEN
          NULL;
        END;
      END $$;
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_properties_archived ON properties(is_archived, archived_at)`;

    // Create units table
    await sql`
      CREATE TABLE IF NOT EXISTS units (
        unit_id SERIAL PRIMARY KEY,
        property_id INTEGER REFERENCES properties(property_id) ON DELETE CASCADE,
        unit_number VARCHAR(50),
        beds INTEGER,
        baths DECIMAL(3,1),
        square_footage INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_units_archived ON units(is_archived, archived_at)`;

    // Create client applications table (replaces application_units)
    // Note: pmc_id, landlord_id, and property_id are NOT stored here - they are derived
    // through the unit relationship: unit_id → units.property_id → properties (pmc_id, landlord_id)
    await sql`
      CREATE TABLE IF NOT EXISTS client_applications (
        application_id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
        unit_id INTEGER REFERENCES units(unit_id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'pending',
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP,
        decided_at TIMESTAMP,
        decision_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        decision_notes TEXT,
        notes TEXT,
        field_data JSONB DEFAULT '{}'::jsonb,
        processing_status VARCHAR(50) DEFAULT 'pending',
        processing_error TEXT,
        extraction_confidence DECIMAL(5,2),
        template_id INTEGER,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(client_id, unit_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_applications_client ON client_applications(client_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_applications_unit ON client_applications(unit_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_applications_field_data ON client_applications USING GIN(field_data)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_applications_archived ON client_applications(is_archived, archived_at)`;

    // Views removed - code updated to use underlying tables directly
    // Drop any existing application_units table or view
    await sql`
      DO $$
      BEGIN
        DROP TABLE IF EXISTS application_units CASCADE;
        DROP VIEW IF EXISTS application_units CASCADE;
      END $$;
    `;

    // Create amenities table
    await sql`
      CREATE TABLE IF NOT EXISTS amenities (
        amenity_id SERIAL PRIMARY KEY,
        amenity_name VARCHAR(100) NOT NULL UNIQUE
      )
    `;

    // Create features table
    await sql`
      CREATE TABLE IF NOT EXISTS features (
        feature_id SERIAL PRIMARY KEY,
        feature_name VARCHAR(100) NOT NULL UNIQUE
      )
    `;

    // Create lease_fee_types table
    await sql`
      CREATE TABLE IF NOT EXISTS lease_fee_types (
        fee_type_id SERIAL PRIMARY KEY,
        fee_name VARCHAR(100) NOT NULL UNIQUE,
        calculation_type VARCHAR(50) NOT NULL
      )
    `;

    // Create property_types table
    await sql`
      CREATE TABLE IF NOT EXISTS property_types (
        type_id SERIAL PRIMARY KEY,
        type_name VARCHAR(100) NOT NULL UNIQUE,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create property_amenities junction table
    await sql`
      CREATE TABLE IF NOT EXISTS property_amenities (
        property_id INTEGER NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
        amenity_id INTEGER NOT NULL REFERENCES amenities(amenity_id) ON DELETE CASCADE,
        PRIMARY KEY (property_id, amenity_id)
      )
    `;

    // Create unit_features junction table
    await sql`
      CREATE TABLE IF NOT EXISTS unit_features (
        unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
        feature_id INTEGER NOT NULL REFERENCES features(feature_id) ON DELETE CASCADE,
        PRIMARY KEY (unit_id, feature_id)
      )
    `;

    // Create leases table (updated with all fields)
    await sql`
      CREATE TABLE IF NOT EXISTS leases (
        lease_id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
        landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE SET NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        monthly_rent_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) NOT NULL,
        date_of_agreement DATE,
        security_deposit_amount DECIMAL(10,2),
        pet_deposit_amount DECIMAL(10,2),
        dependent_names TEXT,
        pets TEXT,
        comment TEXT,
        other_fee_amount DECIMAL(10,2),
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status, start_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_leases_archived ON leases(is_archived, archived_at)`;

    // Create lease_clients junction table (links leases to unified clients)
    await sql`
      CREATE TABLE IF NOT EXISTS lease_clients (
        lease_client_id SERIAL PRIMARY KEY,
        lease_id INTEGER NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
        relationship_type VARCHAR(50) DEFAULT 'resident',
        occupancy_status VARCHAR(50) DEFAULT 'active',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        vacated_at TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT,
        UNIQUE(lease_id, client_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_lease_clients_client ON lease_clients(client_id, occupancy_status)`;

    await sql`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id SERIAL PRIMARY KEY,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
        lease_id INTEGER NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
        kind VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        due_date DATE,
        paid_at TIMESTAMP,
        method VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'due',
        memo TEXT,
        period_label VARCHAR(32),
        stripe_checkout_session_id VARCHAR(255),
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT payments_kind_check CHECK (
          kind IN ('rent', 'deposit', 'fee', 'other')
        ),
        CONSTRAINT payments_status_check CHECK (
          status IN ('due', 'paid', 'void')
        ),
        CONSTRAINT payments_method_check CHECK (
          method IS NULL OR method IN ('cash', 'check', 'ach', 'card', 'other')
        ),
        CONSTRAINT payments_amount_positive CHECK (amount > 0)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_payments_pmc ON payments (pmc_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_payments_lease ON payments (lease_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_payments_status_due ON payments (status, due_date)`;

    // Create client_units table (direct client-unit relationship)
    // This table tracks direct assignments of clients to units, whether from applications, leases, or direct assignment
    await sql`
      CREATE TABLE IF NOT EXISTS client_units (
        client_unit_id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
        unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
        application_id INTEGER REFERENCES client_applications(application_id) ON DELETE SET NULL,
        lease_id INTEGER REFERENCES leases(lease_id) ON DELETE SET NULL,
        assignment_type VARCHAR(50) DEFAULT 'direct',
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        start_date DATE,
        end_date DATE,
        vacated_at TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(client_id, unit_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_units_client ON client_units(client_id, is_archived)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_units_unit ON client_units(unit_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_units_application ON client_units(application_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_units_lease ON client_units(lease_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_units_archived ON client_units(is_archived, archived_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_units_dates ON client_units(start_date, end_date) WHERE is_archived = false`;

    // Views removed - code updated to use underlying tables directly
    // Drop any existing lease_tenants table or view
    await sql`
      DO $$
      BEGIN
        DROP TABLE IF EXISTS lease_tenants CASCADE;
        DROP VIEW IF EXISTS lease_tenants CASCADE;
      END $$;
    `;

    // Create invoices table
    await sql`
      CREATE TABLE IF NOT EXISTS invoices (
        invoice_id SERIAL PRIMARY KEY,
        lease_id INTEGER NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
        issue_date DATE NOT NULL,
        due_date DATE NOT NULL,
        total_amount_due DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) NOT NULL
      )
    `;

    // Create transactions table
    await sql`
      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id SERIAL PRIMARY KEY,
        invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
        lease_id INTEGER REFERENCES leases(lease_id) ON DELETE SET NULL,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        transaction_date TIMESTAMP NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) NOT NULL
      )
    `;

    // Create vendors table (following landlords pattern - uses users table for email, contacts table for names)
    await sql`
      CREATE TABLE IF NOT EXISTS vendors (
        vendor_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id),
        company_name VARCHAR(255),
        job_title VARCHAR(255),
        description TEXT,
        available_for_emergencies BOOLEAN NOT NULL DEFAULT false,
        business_hours_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_vendors_archived ON vendors(is_archived, archived_at)`;

    // Create vendor_service_keywords table (flexible list of service keywords)
    await sql`
      CREATE TABLE IF NOT EXISTS vendor_service_keywords (
        keyword_id SERIAL PRIMARY KEY,
        keyword_name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create vendor_keywords junction table (many-to-many)
    await sql`
      CREATE TABLE IF NOT EXISTS vendor_keywords (
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        keyword_id INTEGER NOT NULL REFERENCES vendor_service_keywords(keyword_id) ON DELETE CASCADE,
        PRIMARY KEY (vendor_id, keyword_id)
      )
    `;

    // Create vendor_service_areas table (for counties, zip codes, cities, states, countries, areas)
    await sql`
      CREATE TABLE IF NOT EXISTS vendor_service_areas (
        area_id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        area_type VARCHAR(50) NOT NULL CHECK (area_type IN ('county', 'zip_code', 'city', 'state', 'country', 'area')),
        area_value VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create vendor_approvals table (global, PM company, landlord, property approvals)
    await sql`
      CREATE TABLE IF NOT EXISTS vendor_approvals (
        approval_id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        approval_level VARCHAR(50) NOT NULL CHECK (approval_level IN ('global', 'pm_company', 'landlord', 'property')),
        approved_by_pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE CASCADE,
        approved_by_landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE CASCADE,
        approved_by_property_id INTEGER REFERENCES properties(property_id) ON DELETE CASCADE,
        can_emergency_service BOOLEAN NOT NULL DEFAULT false,
        approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        CONSTRAINT approval_level_check CHECK (
          (approval_level = 'global' AND approved_by_pmc_id IS NULL AND approved_by_landlord_id IS NULL AND approved_by_property_id IS NULL) OR
          (approval_level = 'pm_company' AND approved_by_pmc_id IS NOT NULL AND approved_by_landlord_id IS NULL AND approved_by_property_id IS NULL) OR
          (approval_level = 'landlord' AND approved_by_landlord_id IS NOT NULL AND approved_by_pmc_id IS NULL AND approved_by_property_id IS NULL) OR
          (approval_level = 'property' AND approved_by_property_id IS NOT NULL AND approved_by_pmc_id IS NULL AND approved_by_landlord_id IS NULL)
        )
      )
    `;

    // Create vendor_hours table (hours of operation)
    await sql`
      CREATE TABLE IF NOT EXISTS vendor_hours (
        hours_id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
        open_time TIME,
        close_time TIME,
        is_closed BOOLEAN NOT NULL DEFAULT false,
        available_for_emergencies BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(vendor_id, day_of_week)
      )
    `;

    // Create communications table
    await sql`
      CREATE TABLE IF NOT EXISTS communications (
        communication_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        channel VARCHAR(50) NOT NULL,
        direction VARCHAR(50) NOT NULL,
        message_content TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        logged_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL
      )
    `;

    // Create maintenance_requests table
    await sql`
      CREATE TABLE IF NOT EXISTS maintenance_requests (
        request_id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
        tenant_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        initial_communication_id INTEGER REFERENCES communications(communication_id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        status VARCHAR(50) NOT NULL,
        priority VARCHAR(50) NOT NULL,
        assigned_vendor_id INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
        admin_notes TEXT,
        notes_updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        notes_updated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_maintenance_requests_archived ON maintenance_requests(is_archived, archived_at)`;

    // Create client_appointments table
    await sql`
      CREATE TABLE IF NOT EXISTS client_appointments (
        appointment_id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        maintenance_request_id INTEGER NOT NULL REFERENCES maintenance_requests(request_id) ON DELETE CASCADE,
        scheduled_date_time TIMESTAMP NOT NULL,
        actual_date_time TIMESTAMP,
        estimated_duration_minutes INTEGER,
        status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (
          status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled', 'in_progress')
        ),
        result TEXT,
        resolved_issue BOOLEAN DEFAULT false,
        notes TEXT,
        vendor_contact_id INTEGER REFERENCES contacts(contact_id) ON DELETE SET NULL,
        created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cancelled_at TIMESTAMP,
        cancelled_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        cancelled_reason TEXT,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_client ON client_appointments(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_vendor ON client_appointments(vendor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_request ON client_appointments(maintenance_request_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_status ON client_appointments(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_scheduled ON client_appointments(scheduled_date_time)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_archived ON client_appointments(is_archived, archived_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_client_appointments_request_status ON client_appointments(maintenance_request_id, status)`;

    // Create chatbot_conversations table
    await sql`
      CREATE TABLE IF NOT EXISTS chatbot_conversations (
        conversation_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        unit_id INTEGER REFERENCES units(unit_id) ON DELETE SET NULL,
        transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
        maintenance_request_id INTEGER REFERENCES maintenance_requests(request_id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        feedback_rating INTEGER CHECK (feedback_rating >= 1 AND feedback_rating <= 5),
        feedback_comment TEXT,
        feedback_provided_at TIMESTAMP,
        caller_phone VARCHAR(50),
        is_incomplete BOOLEAN DEFAULT false,
        call_id VARCHAR(255),
        duration INTEGER,
        ended_reason VARCHAR(100)
      )
    `;

    // Create indexes for chatbot_conversations
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_user_id ON chatbot_conversations(user_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_unit_id ON chatbot_conversations(unit_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_incomplete ON chatbot_conversations(is_incomplete, created_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_call_id ON chatbot_conversations(call_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_created_at ON chatbot_conversations(created_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_feedback_rating ON chatbot_conversations(feedback_rating) WHERE feedback_rating IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_transcript ON chatbot_conversations USING GIN(transcript)
    `;

    // Create security_deposits table
    await sql`
      CREATE TABLE IF NOT EXISTS security_deposits (
        deposit_id SERIAL PRIMARY KEY,
        lease_id INTEGER NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
        general_deposit_amount DECIMAL(10,2) NOT NULL,
        pet_deposit_amount DECIMAL(10,2) DEFAULT 0.00,
        date_collected DATE NOT NULL,
        date_returned DATE,
        status VARCHAR(50) NOT NULL
      )
    `;

    // Create deposit_deductions table
    await sql`
      CREATE TABLE IF NOT EXISTS deposit_deductions (
        deduction_id SERIAL PRIMARY KEY,
        deposit_id INTEGER NOT NULL REFERENCES security_deposits(deposit_id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        reason TEXT NOT NULL,
        deduction_type VARCHAR(50) NOT NULL DEFAULT 'General'
      )
    `;

    // Create legal_notices table
    await sql`
      CREATE TABLE IF NOT EXISTS legal_notices (
        notice_id SERIAL PRIMARY KEY,
        lease_id INTEGER NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
        notice_type VARCHAR(100) NOT NULL,
        date_generated TIMESTAMP NOT NULL,
        date_served DATE,
        effective_date DATE NOT NULL
      )
    `;

    // Create templates table
    await sql`
      CREATE TABLE IF NOT EXISTS templates (
        template_id SERIAL PRIMARY KEY,
        template_type VARCHAR(50) NOT NULL CHECK (template_type IN ('Application', 'Lease', 'Notice')),
        template_level VARCHAR(50) NOT NULL CHECK (template_level IN ('system', 'company', 'landlord')),
        template_name VARCHAR(255) NOT NULL,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
        landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE SET NULL,
        applies_to_all_companies BOOLEAN DEFAULT false,
        applies_to_all_landlords BOOLEAN DEFAULT false,
        applies_to_independent_landlords BOOLEAN DEFAULT false,
        template_data JSONB NOT NULL DEFAULT '{}',
        template_data_raw TEXT,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT false,
        archived_at TIMESTAMP,
        archived_by_user_id INTEGER REFERENCES users(user_id),
        archive_reason TEXT,
        CONSTRAINT template_level_check CHECK (
          (template_level = 'system' AND pmc_id IS NULL AND landlord_id IS NULL) OR
          (template_level = 'company' AND landlord_id IS NULL AND (pmc_id IS NOT NULL OR applies_to_all_companies = true)) OR
          (template_level = 'landlord' AND landlord_id IS NOT NULL)
        )
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_templates_archived ON templates(is_archived, archived_at)`;

    // Add foreign key constraint from client_applications to templates (now that templates table exists)
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'client_applications_template_id_fkey'
          AND table_name = 'client_applications'
        ) THEN
          ALTER TABLE client_applications 
          ADD CONSTRAINT client_applications_template_id_fkey 
          FOREIGN KEY (template_id) REFERENCES templates(template_id) ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    // Create index for template queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_templates_type_level ON templates(template_type, template_level)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_templates_pmc ON templates(pmc_id) WHERE pmc_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_templates_landlord ON templates(landlord_id) WHERE landlord_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_templates_template_data ON templates USING GIN(template_data)
    `;

    // ============================================
    // PHASE 0: NEW TABLES FOR FOUNDATION FEATURES
    // ============================================

    // Create audit_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        audit_id SERIAL PRIMARY KEY,
        table_name VARCHAR(100) NOT NULL,
        record_id INTEGER NOT NULL,
        action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        old_values JSONB,
        new_values JSONB,
        changed_fields TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for audit_logs
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_old_values ON audit_logs USING GIN(old_values)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_new_values ON audit_logs USING GIN(new_values)
    `;

    // Create user_notification_preferences table
    await sql`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        preference_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        email_enabled BOOLEAN DEFAULT true,
        sms_enabled BOOLEAN DEFAULT false,
        push_enabled BOOLEAN DEFAULT false,
        maintenance_email BOOLEAN DEFAULT true,
        maintenance_sms BOOLEAN DEFAULT false,
        maintenance_push BOOLEAN DEFAULT false,
        maintenance_frequency VARCHAR(50) DEFAULT 'immediate',
        lease_email BOOLEAN DEFAULT true,
        lease_sms BOOLEAN DEFAULT false,
        lease_push BOOLEAN DEFAULT false,
        lease_frequency VARCHAR(50) DEFAULT 'immediate',
        payment_email BOOLEAN DEFAULT true,
        payment_sms BOOLEAN DEFAULT false,
        payment_push BOOLEAN DEFAULT false,
        payment_frequency VARCHAR(50) DEFAULT 'immediate',
        general_email BOOLEAN DEFAULT true,
        general_sms BOOLEAN DEFAULT false,
        general_push BOOLEAN DEFAULT false,
        general_frequency VARCHAR(50) DEFAULT 'immediate',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `;

    // Create notification_history table
    await sql`
      CREATE TABLE IF NOT EXISTS notification_history (
        notification_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        notification_type VARCHAR(50) NOT NULL,
        category VARCHAR(50) NOT NULL,
        subject VARCHAR(255),
        message TEXT,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP,
        read BOOLEAN DEFAULT false,
        delivery_status VARCHAR(50),
        error_message TEXT,
        metadata JSONB DEFAULT '{}'
      )
    `;

    // Create indexes for notification_history
    await sql`
      CREATE INDEX IF NOT EXISTS idx_notification_history_user ON notification_history(user_id, sent_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_notification_history_read ON notification_history(read) WHERE read = false
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_notification_history_metadata ON notification_history USING GIN(metadata)
    `;

    // Rename legacy ID columns if they still exist
    await renameColumnIfExists(sql, 'compliance_workflows', 'id', 'workflow_id');
    await renameColumnIfExists(sql, 'compliance_policies', 'id', 'policy_id');
    await renameColumnIfExists(sql, 'documents', 'id', 'document_id');
    await renameColumnIfExists(sql, 'legal_notices', 'id', 'notice_id');

    // Create compliance_workflows table
    await sql`
      CREATE TABLE IF NOT EXISTS compliance_workflows (
        workflow_id SERIAL PRIMARY KEY,
        workflow_type VARCHAR(100) NOT NULL,
        lease_id INTEGER REFERENCES leases(lease_id) ON DELETE CASCADE,
        unit_id INTEGER REFERENCES units(unit_id) ON DELETE SET NULL,
        property_id INTEGER REFERENCES properties(property_id) ON DELETE SET NULL,
        tenant_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE SET NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        current_step INTEGER DEFAULT 1,
        total_steps INTEGER NOT NULL,
        jurisdiction VARCHAR(50) NOT NULL,
        notice_period_days INTEGER,
        required_notice_date DATE,
        effective_date DATE,
        served_date DATE,
        served_method VARCHAR(50),
        proof_of_service TEXT,
        workflow_data JSONB DEFAULT '{}',
        created_by_user_id INTEGER REFERENCES users(user_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `;

    // Create indexes for compliance_workflows
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_workflows_type ON compliance_workflows(workflow_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_workflows_lease ON compliance_workflows(lease_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_workflows_status ON compliance_workflows(status)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_workflows_jurisdiction ON compliance_workflows(jurisdiction)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_workflows_workflow_data ON compliance_workflows USING GIN(workflow_data)
    `;

    // Create compliance_policies table
    await sql`
      CREATE TABLE IF NOT EXISTS compliance_policies (
        policy_id SERIAL PRIMARY KEY,
        policy_type VARCHAR(100) NOT NULL,
        policy_level VARCHAR(50) NOT NULL,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE CASCADE,
        landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE CASCADE,
        property_id INTEGER REFERENCES properties(property_id) ON DELETE CASCADE,
        policy_name VARCHAR(255) NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        policy_data JSONB NOT NULL DEFAULT '{}',
        inherits_from_policy_id INTEGER REFERENCES compliance_policies(policy_id) ON DELETE SET NULL,
        inheritance_mode VARCHAR(50) DEFAULT 'extend',
        template_id INTEGER REFERENCES templates(template_id) ON DELETE SET NULL,
        created_by_user_id INTEGER REFERENCES users(user_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        version INTEGER DEFAULT 1,
        CONSTRAINT policy_level_check CHECK (
          (policy_level = 'system' AND pmc_id IS NULL AND landlord_id IS NULL AND property_id IS NULL) OR
          (policy_level = 'company' AND pmc_id IS NOT NULL AND landlord_id IS NULL AND property_id IS NULL) OR
          (policy_level = 'landlord' AND landlord_id IS NOT NULL AND property_id IS NULL) OR
          (policy_level = 'property' AND property_id IS NOT NULL)
        )
      )
    `;

    // Create indexes for compliance_policies
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_policies_type_level ON compliance_policies(policy_type, policy_level)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_policies_pmc ON compliance_policies(pmc_id) WHERE pmc_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_policies_landlord ON compliance_policies(landlord_id) WHERE landlord_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_policies_property ON compliance_policies(property_id) WHERE property_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_policies_active ON compliance_policies(is_active) WHERE is_active = true
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_policies_policy_data ON compliance_policies USING GIN(policy_data)
    `;

    // Create trigger function for updated_at on compliance_policies
    await sql`
      CREATE OR REPLACE FUNCTION update_compliance_policies_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;

    // Drop existing trigger if it exists
    await sql.unsafe(`
      DROP TRIGGER IF EXISTS trigger_update_compliance_policies_updated_at ON compliance_policies;
    `);

    // Create trigger for updated_at on compliance_policies
    await sql`
      CREATE TRIGGER trigger_update_compliance_policies_updated_at
        BEFORE UPDATE ON compliance_policies
        FOR EACH ROW
        EXECUTE FUNCTION update_compliance_policies_updated_at();
    `;

    // Create compliance_rules table
    await sql`
      CREATE TABLE IF NOT EXISTS compliance_rules (
        rule_id SERIAL PRIMARY KEY,
        rule_name VARCHAR(255) NOT NULL,
        rule_type VARCHAR(100) NOT NULL,
        jurisdiction VARCHAR(50) NOT NULL,
        applies_to VARCHAR(100),
        rule_condition JSONB NOT NULL,
        rule_action TEXT NOT NULL,
        notice_period_days INTEGER,
        prohibited BOOLEAN DEFAULT false,
        source TEXT,
        effective_date DATE,
        expiration_date DATE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for compliance_rules
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_rules_jurisdiction ON compliance_rules(jurisdiction, is_active)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_rules_applies_to ON compliance_rules(applies_to, is_active)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_compliance_rules_rule_condition ON compliance_rules USING GIN(rule_condition)
    `;

    // Create property_inspections table
    await sql`
      CREATE TABLE IF NOT EXISTS property_inspections (
        inspection_id SERIAL PRIMARY KEY,
        lease_id INTEGER REFERENCES leases(lease_id) ON DELETE CASCADE,
        unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
        inspection_type VARCHAR(50) NOT NULL,
        inspection_date DATE NOT NULL,
        conducted_by_user_id INTEGER REFERENCES users(user_id),
        tenant_present BOOLEAN DEFAULT false,
        tenant_user_id INTEGER REFERENCES users(user_id),
        condition_report JSONB NOT NULL DEFAULT '{}',
        photos JSONB DEFAULT '[]',
        notes TEXT,
        overall_condition VARCHAR(50),
        tenant_signed BOOLEAN DEFAULT false,
        tenant_signed_at TIMESTAMP,
        landlord_signed BOOLEAN DEFAULT false,
        landlord_signed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for property_inspections
    await sql`
      CREATE INDEX IF NOT EXISTS idx_property_inspections_lease ON property_inspections(lease_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_property_inspections_type ON property_inspections(inspection_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_property_inspections_date ON property_inspections(inspection_date)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_property_inspections_condition_report ON property_inspections USING GIN(condition_report)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_property_inspections_photos ON property_inspections USING GIN(photos)
    `;

    // Create documents table
    await sql`
      CREATE TABLE IF NOT EXISTS documents (
        document_id SERIAL PRIMARY KEY,
        document_type VARCHAR(100) NOT NULL,
        document_name VARCHAR(255) NOT NULL,
        storage_path TEXT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size BIGINT,
        mime_type VARCHAR(100),
        lease_id INTEGER REFERENCES leases(lease_id) ON DELETE SET NULL,
        unit_id INTEGER REFERENCES units(unit_id) ON DELETE SET NULL,
        property_id INTEGER REFERENCES properties(property_id) ON DELETE SET NULL,
        tenant_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE SET NULL,
        template_id INTEGER REFERENCES templates(template_id) ON DELETE SET NULL,
        compliance_workflow_id INTEGER REFERENCES compliance_workflows(workflow_id) ON DELETE SET NULL,
        metadata JSONB DEFAULT '{}',
        signature_metadata JSONB DEFAULT '{}',
        created_by_user_id INTEGER REFERENCES users(user_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for documents
    await sql`
      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_documents_lease ON documents(lease_id) WHERE lease_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_documents_unit ON documents(unit_id) WHERE unit_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING GIN(metadata)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_documents_signature_metadata ON documents USING GIN(signature_metadata)
    `;

    // Create document_signatures table
    await sql`
      CREATE TABLE IF NOT EXISTS document_signatures (
        signature_id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
        signer_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        signer_type VARCHAR(50) NOT NULL,
        signature_data JSONB NOT NULL,
        signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address INET,
        user_agent TEXT
      )
    `;

    // Create indexes for document_signatures
    await sql`
      CREATE INDEX IF NOT EXISTS idx_document_signatures_document ON document_signatures(document_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_document_signatures_signer ON document_signatures(signer_user_id) WHERE signer_user_id IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_document_signatures_signature_data ON document_signatures USING GIN(signature_data)
    `;

    // Seed default property types
    await sql`
      INSERT INTO property_types (type_name, is_default) VALUES
      ('Condominium', true),
      ('House', true),
      ('Townhouse', true),
      ('Other', true)
      ON CONFLICT (type_name) DO NOTHING
    `;
    
    // Ensure archiving/audit functions are current
    await createArchivingAndAuditFunctions(sql);
    log('✅ Table creation completed');
  } catch (error) {
    log(`❌ Error creating tables: ${error.message}`, 'error');
    throw error;
  }
}

// Create archiving and audit functions
async function createArchivingAndAuditFunctions(sql) {
  try {
    log('📋 Creating archiving and audit functions...');

    // Create generic archive function
    await sql`
      CREATE OR REPLACE FUNCTION archive_entity(
        p_table_name TEXT,
        p_entity_id INTEGER,
        p_archived_by_user_id INTEGER,
        p_archive_reason TEXT DEFAULT NULL,
        p_cascade BOOLEAN DEFAULT true
      )
      RETURNS VOID
      LANGUAGE plpgsql
      SET search_path = public, pg_catalog
      AS $$
      DECLARE
        v_sql TEXT;
        v_pk_column TEXT;
      BEGIN
        -- Validate table name to prevent SQL injection
        IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                               'clients', 'vendors', 'leases', 'client_applications', 
                               'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                               'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices') THEN
          RAISE EXCEPTION 'Invalid table name: %', p_table_name;
        END IF;

        -- Determine primary key column name based on table
        CASE p_table_name
          WHEN 'pm_companies' THEN v_pk_column := 'pmc_id';
          WHEN 'users' THEN v_pk_column := 'user_id';
          WHEN 'landlords' THEN v_pk_column := 'landlord_id';
          WHEN 'properties' THEN v_pk_column := 'property_id';
          WHEN 'units' THEN v_pk_column := 'unit_id';
          WHEN 'clients' THEN v_pk_column := 'client_id';
          WHEN 'vendors' THEN v_pk_column := 'vendor_id';
          WHEN 'leases' THEN v_pk_column := 'lease_id';
          WHEN 'maintenance_requests' THEN v_pk_column := 'request_id';
          WHEN 'templates' THEN v_pk_column := 'template_id';
          WHEN 'client_applications' THEN v_pk_column := 'application_id';
          WHEN 'lease_clients' THEN v_pk_column := 'lease_client_id';
          WHEN 'compliance_workflows' THEN v_pk_column := 'workflow_id';
          WHEN 'compliance_policies' THEN v_pk_column := 'policy_id';
          WHEN 'documents' THEN v_pk_column := 'document_id';
          WHEN 'legal_notices' THEN v_pk_column := 'notice_id';
          WHEN 'client_units' THEN v_pk_column := 'client_unit_id';
          ELSE v_pk_column := p_table_name || '_id'; -- Fallback
        END CASE;

        -- Set archiving fields
        v_sql := format('
          UPDATE %I 
          SET is_archived = true,
              archived_at = CURRENT_TIMESTAMP,
              archived_by_user_id = %s,
              archive_reason = %L
          WHERE %I = %s
          AND is_archived = false',
          p_table_name,
          p_archived_by_user_id,
          COALESCE(p_archive_reason, 'No reason provided'),
          v_pk_column,
          p_entity_id
        );
        
        EXECUTE v_sql;

        -- Cascade archiving for related entities
        IF p_cascade THEN
          -- Archive related entities based on table type
          IF p_table_name = 'landlords' THEN
            -- Archive all properties owned by this landlord
            UPDATE properties 
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: landlord %s archived', p_entity_id)
            WHERE landlord_id = p_entity_id
            AND is_archived = false;
            
          ELSIF p_table_name = 'properties' THEN
            -- Archive all units in this property
            UPDATE units
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: property %s archived', p_entity_id)
            WHERE property_id = p_entity_id
            AND is_archived = false;
            
          ELSIF p_table_name = 'units' THEN
            -- Archive all leases for this unit
            UPDATE leases
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: unit %s archived', p_entity_id)
            WHERE unit_id = p_entity_id
            AND is_archived = false;
            
          ELSIF p_table_name = 'pm_companies' THEN
            -- Archive all users, landlords, and properties associated with this company
            UPDATE users
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: PM company %s archived', p_entity_id)
            WHERE pmc_id = p_entity_id
            AND is_archived = false;
            
          ELSIF p_table_name = 'users' THEN
            -- Check if user is a landlord and archive their properties
            UPDATE properties
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: user %s archived', p_entity_id)
            WHERE landlord_id IN (
              SELECT landlord_id FROM landlords WHERE user_id = p_entity_id
            )
            AND is_archived = false;
          ELSIF p_table_name = 'clients' THEN
            -- Archive the associated user record
            UPDATE users
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: client %s archived', p_entity_id)
            WHERE user_id IN (
              SELECT user_id FROM clients WHERE client_id = p_entity_id
            )
            AND is_archived = false;
            
            UPDATE client_applications
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: client %s archived', p_entity_id)
            WHERE client_id = p_entity_id
            AND is_archived = false;

            UPDATE lease_clients
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: client %s archived', p_entity_id)
            WHERE client_id = p_entity_id
            AND is_archived = false;
          ELSIF p_table_name = 'leases' THEN
            UPDATE lease_clients
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by_user_id = p_archived_by_user_id,
                archive_reason = format('Cascade archive: lease %s archived', p_entity_id)
            WHERE lease_id = p_entity_id
            AND is_archived = false;
          END IF;
        END IF;
      END;
      $$;
    `;

    // Create generic restore function
    await sql`
      CREATE OR REPLACE FUNCTION restore_entity(
        p_table_name TEXT,
        p_entity_id INTEGER,
        p_restored_by_user_id INTEGER
      )
      RETURNS VOID
      LANGUAGE plpgsql
      SET search_path = public, pg_catalog
      AS $$
      DECLARE
        v_sql TEXT;
        v_pk_column TEXT;
      BEGIN
        -- Validate table name
        IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                               'clients', 'vendors', 'leases', 'client_applications', 
                               'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                               'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices') THEN
          RAISE EXCEPTION 'Invalid table name: %', p_table_name;
        END IF;

        -- Determine primary key column name based on table
        CASE p_table_name
          WHEN 'pm_companies' THEN v_pk_column := 'pmc_id';
          WHEN 'users' THEN v_pk_column := 'user_id';
          WHEN 'landlords' THEN v_pk_column := 'landlord_id';
          WHEN 'properties' THEN v_pk_column := 'property_id';
          WHEN 'units' THEN v_pk_column := 'unit_id';
          WHEN 'clients' THEN v_pk_column := 'client_id';
          WHEN 'vendors' THEN v_pk_column := 'vendor_id';
          WHEN 'leases' THEN v_pk_column := 'lease_id';
          WHEN 'maintenance_requests' THEN v_pk_column := 'request_id';
          WHEN 'templates' THEN v_pk_column := 'template_id';
          WHEN 'client_applications' THEN v_pk_column := 'application_id';
          WHEN 'lease_clients' THEN v_pk_column := 'lease_client_id';
          WHEN 'compliance_workflows' THEN v_pk_column := 'workflow_id';
          WHEN 'compliance_policies' THEN v_pk_column := 'policy_id';
          WHEN 'documents' THEN v_pk_column := 'document_id';
          WHEN 'legal_notices' THEN v_pk_column := 'notice_id';
          WHEN 'client_units' THEN v_pk_column := 'client_unit_id';
          ELSE v_pk_column := p_table_name || '_id'; -- Fallback
        END CASE;

        -- Restore entity
        v_sql := format('
          UPDATE %I 
          SET is_archived = false,
              archived_at = NULL,
              archived_by_user_id = NULL,
              archive_reason = NULL
          WHERE %I = %s
          AND is_archived = true',
          p_table_name,
          v_pk_column,
          p_entity_id
        );
        
        EXECUTE v_sql;
      END;
      $$;
    `;

    // Create hard delete function
    await sql`
      CREATE OR REPLACE FUNCTION hard_delete_entity(
        p_table_name TEXT,
        p_entity_id INTEGER,
        p_deleted_by_user_id INTEGER,
        p_force BOOLEAN DEFAULT false
      )
      RETURNS VOID
      LANGUAGE plpgsql
      SET search_path = public, pg_catalog
      AS $$
      DECLARE
        v_sql TEXT;
        v_has_relationships BOOLEAN := false;
        v_id_column TEXT;
        v_user_id INTEGER;
      BEGIN
        -- Validate table name
        IF p_table_name NOT IN ('pm_companies', 'users', 'landlords', 'properties', 'units', 
                               'clients', 'vendors', 'leases', 'client_applications', 
                               'lease_clients', 'maintenance_requests', 'templates', 'client_units',
                               'compliance_workflows', 'compliance_policies', 'documents', 'legal_notices') THEN
          RAISE EXCEPTION 'Invalid table name: %', p_table_name;
        END IF;

        -- Determine the correct ID column name based on table
        CASE p_table_name
          WHEN 'pm_companies' THEN v_id_column := 'pmc_id';
          WHEN 'users' THEN v_id_column := 'user_id';
          WHEN 'landlords' THEN v_id_column := 'landlord_id';
          WHEN 'properties' THEN v_id_column := 'property_id';
          WHEN 'units' THEN v_id_column := 'unit_id';
          WHEN 'clients' THEN v_id_column := 'client_id';
          WHEN 'vendors' THEN v_id_column := 'vendor_id';
          WHEN 'leases' THEN v_id_column := 'lease_id';
          WHEN 'maintenance_requests' THEN v_id_column := 'request_id';
          WHEN 'templates' THEN v_id_column := 'template_id';
          WHEN 'client_applications' THEN v_id_column := 'application_id';
          WHEN 'lease_clients' THEN v_id_column := 'lease_client_id';
          WHEN 'compliance_workflows' THEN v_id_column := 'workflow_id';
          WHEN 'compliance_policies' THEN v_id_column := 'policy_id';
          WHEN 'documents' THEN v_id_column := 'document_id';
          WHEN 'legal_notices' THEN v_id_column := 'notice_id';
          WHEN 'client_units' THEN v_id_column := 'client_unit_id';
          ELSE v_id_column := p_table_name || '_id'; -- Fallback
        END CASE;

        -- Check for relationships (unless force is true)
        IF NOT p_force THEN
          -- Check if entity has relationships that would be lost
          IF p_table_name = 'landlords' THEN
            SELECT EXISTS(SELECT 1 FROM properties WHERE landlord_id = p_entity_id)
            INTO v_has_relationships;
          ELSIF p_table_name = 'properties' THEN
            SELECT EXISTS(SELECT 1 FROM units WHERE property_id = p_entity_id)
            INTO v_has_relationships;
          ELSIF p_table_name = 'units' THEN
            SELECT EXISTS(SELECT 1 FROM leases WHERE unit_id = p_entity_id)
            INTO v_has_relationships;
          END IF;

          IF v_has_relationships THEN
            RAISE EXCEPTION 'Cannot hard delete % with ID % because it has related records. Archive instead, or use force=true to override.', 
              p_table_name, p_entity_id;
          END IF;
        END IF;

        -- For clients, delete associated documents, contact record, and user record before deleting client
        IF p_table_name = 'clients' THEN
          -- Get user_id from client record
          SELECT user_id INTO v_user_id
          FROM clients
          WHERE client_id = p_entity_id;
          
          -- Delete associated documents linked via tenant_user_id
          IF v_user_id IS NOT NULL THEN
            DELETE FROM documents
            WHERE tenant_user_id = v_user_id;
          END IF;
          
          -- Delete contact records and their associated contact_methods
          -- Find all contact_ids for this client's user_id
          IF v_user_id IS NOT NULL THEN
            -- Delete contact_methods first (explicitly, in case CASCADE doesn't work)
            DELETE FROM contact_methods
            WHERE contact_id IN (
              SELECT contact_id FROM contacts
              WHERE contactable_id = v_user_id
              AND contactable_type = 'client'
            );
            
            -- Then delete the contacts (contact_methods should also cascade, but we're being explicit)
            DELETE FROM contacts
            WHERE contactable_id = v_user_id
            AND contactable_type = 'client';
            
            -- Delete the user record to prevent orphaned users
            DELETE FROM users
            WHERE user_id = v_user_id;
          END IF;
        END IF;

        -- For users, delete associated documents before deleting user
        IF p_table_name = 'users' THEN
          DELETE FROM documents
          WHERE tenant_user_id = p_entity_id
          OR created_by_user_id = p_entity_id;
        END IF;

        -- For templates, delete associated documents before deleting template
        IF p_table_name = 'templates' THEN
          DELETE FROM documents
          WHERE template_id = p_entity_id;
        END IF;

        -- Perform hard delete
        v_sql := format('DELETE FROM %I WHERE %I = %s', 
          p_table_name,
          v_id_column,
          p_entity_id
        );
        
        EXECUTE v_sql;
      END;
      $$;
    `;

    // Create function to mask sensitive data in JSONB
    await sql`
      CREATE OR REPLACE FUNCTION mask_sensitive_data(data JSONB)
      RETURNS JSONB
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      DECLARE
        result JSONB;
        key TEXT;
        value JSONB;
        sensitive_keys TEXT[] := ARRAY[
          'password', 'password_hash', 'password_hash_salt',
          'social_security_number', 'ssn',
          'credit_card', 'credit_card_number', 'card_number',
          'bank_account', 'bank_account_number', 'routing_number'
        ];
      BEGIN
        IF data IS NULL THEN
          RETURN NULL;
        END IF;

        result := data;

        -- Iterate through all keys and mask sensitive ones
        FOR key, value IN SELECT * FROM jsonb_each(data)
        LOOP
          IF key = ANY(sensitive_keys) OR LOWER(key) LIKE '%password%' OR LOWER(key) LIKE '%ssn%' OR LOWER(key) LIKE '%credit%' OR LOWER(key) LIKE '%bank%' THEN
            result := result || jsonb_build_object(key, '***MASKED***');
          ELSIF jsonb_typeof(value) = 'object' THEN
            -- Recursively mask nested objects
            result := result || jsonb_build_object(key, mask_sensitive_data(value));
          END IF;
        END LOOP;

        RETURN result;
      END;
      $$;
    `;

    // Create audit trigger function
    // Note: This function extracts the primary key dynamically based on table name
    // Also captures IP address and user agent from session variables
    await sql`
      CREATE OR REPLACE FUNCTION audit_trigger_function()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SET search_path = public, pg_catalog
      AS $$
      DECLARE
        v_old_values JSONB;
        v_new_values JSONB;
        v_changed_fields TEXT[];
        v_record_id INTEGER;
        v_table_name TEXT;
        v_pk_column TEXT;
        v_user_id INTEGER;
      BEGIN
        v_table_name := TG_TABLE_NAME;
        
        -- Determine primary key column name based on table
        CASE v_table_name
          WHEN 'pm_companies' THEN v_pk_column := 'pmc_id';
          WHEN 'users' THEN v_pk_column := 'user_id';
          WHEN 'landlords' THEN v_pk_column := 'landlord_id';
          WHEN 'properties' THEN v_pk_column := 'property_id';
          WHEN 'units' THEN v_pk_column := 'unit_id';
          WHEN 'clients' THEN v_pk_column := 'client_id';
          WHEN 'vendors' THEN v_pk_column := 'vendor_id';
          WHEN 'leases' THEN v_pk_column := 'lease_id';
          WHEN 'maintenance_requests' THEN v_pk_column := 'request_id';
          WHEN 'templates' THEN v_pk_column := 'template_id';
          WHEN 'client_applications' THEN v_pk_column := 'application_id';
          WHEN 'lease_clients' THEN v_pk_column := 'lease_client_id';
          WHEN 'compliance_workflows' THEN v_pk_column := 'workflow_id';
          WHEN 'compliance_policies' THEN v_pk_column := 'policy_id';
          WHEN 'documents' THEN v_pk_column := 'document_id';
          WHEN 'legal_notices' THEN v_pk_column := 'notice_id';
          WHEN 'client_units' THEN v_pk_column := 'client_unit_id';
          ELSE v_pk_column := 'id'; -- Fallback
        END CASE;
        
        -- Get record ID and values
        IF TG_OP = 'DELETE' THEN
          EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING OLD INTO v_record_id;
          v_old_values := to_jsonb(OLD);
          v_new_values := NULL;
        ELSIF TG_OP = 'INSERT' THEN
          EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING NEW INTO v_record_id;
          v_old_values := NULL;
          v_new_values := to_jsonb(NEW);
        ELSIF TG_OP = 'UPDATE' THEN
          EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING NEW INTO v_record_id;
          v_old_values := to_jsonb(OLD);
          v_new_values := to_jsonb(NEW);
          
          -- Calculate changed fields
          SELECT array_agg(key)
          INTO v_changed_fields
          FROM jsonb_each(v_new_values)
          WHERE jsonb_extract_path(v_old_values, key) IS DISTINCT FROM value;
        END IF;

        -- Get user_id from session variables
        BEGIN
          v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
        EXCEPTION WHEN OTHERS THEN
          v_user_id := NULL;
        END;

        -- Mask sensitive data before storing
        v_old_values := mask_sensitive_data(v_old_values);
        v_new_values := mask_sensitive_data(v_new_values);

        -- Insert audit log
        INSERT INTO audit_logs (
          table_name,
          record_id,
          action,
          user_id,
          old_values,
          new_values,
          changed_fields
        ) VALUES (
          v_table_name,
          v_record_id,
          TG_OP,
          v_user_id,
          v_old_values,
          v_new_values,
          v_changed_fields
        );

        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        ELSE
          RETURN NEW;
        END IF;
      END;
      $$;
    `;

    log('✅ Archiving and audit functions created');
  } catch (error) {
    log(`❌ Error creating archiving and audit functions: ${error.message}`, 'error');
    throw error;
  }
}

async function ensurePropertyJurisdictionColumns(sql) {
  const columnStatements = [
    {
      name: 'property_name',
      statement: sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_name VARCHAR(255)`
    },
    {
      name: 'city_of_jurisdiction',
      statement: sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS city_of_jurisdiction VARCHAR(255)`
    },
    {
      name: 'county_of_jurisdiction',
      statement: sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS county_of_jurisdiction VARCHAR(255)`
    }
  ];

  for (const column of columnStatements) {
    try {
      logDetail(`Ensuring properties.${column.name} exists...`);
      await column.statement;
      logDetail(`✅ properties.${column.name} verified/created`);
    } catch (error) {
      logDetail(`⚠️ Could not ensure properties.${column.name}: ${error.message}`, 'error');
      if (error.code !== '42701') {
        throw error;
      }
    }
  }
}

async function ensurePmCompaniesThemeColumn(sql) {
  try {
    logDetail('Ensuring pm_companies.theme exists...');
    await sql`ALTER TABLE pm_companies ADD COLUMN IF NOT EXISTS theme JSONB`;
    logDetail('✅ pm_companies.theme verified/created');
  } catch (error) {
    logDetail(`⚠️ Could not ensure pm_companies.theme: ${error.message}`, 'error');
    if (error.code !== '42701') {
      throw error;
    }
  }
}

async function ensurePaymentsTable(sql) {
  try {
    logDetail('Ensuring payments table exists...');
    await sql`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id SERIAL PRIMARY KEY,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE SET NULL,
        lease_id INTEGER NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
        kind VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        due_date DATE,
        paid_at TIMESTAMP,
        method VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'due',
        memo TEXT,
        period_label VARCHAR(32),
        stripe_checkout_session_id VARCHAR(255),
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_payments_pmc ON payments (pmc_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_payments_lease ON payments (lease_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_payments_status_due ON payments (status, due_date)`;
    logDetail('✅ payments verified/created');
  } catch (error) {
    logDetail(`⚠️ Could not ensure payments: ${error.message}`, 'error');
    throw error;
  }
}

async function ensurePhoneResourcesTable(sql) {
  try {
    logDetail('Ensuring phone_resources table exists...');
    await sql`
      CREATE TABLE IF NOT EXISTS phone_resources (
        phone_resource_id SERIAL PRIMARY KEY,
        pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE CASCADE,
        purpose VARCHAR(50) NOT NULL,
        e164 VARCHAR(32) NOT NULL,
        vapi_phone_number_id VARCHAR(64),
        label VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_resources_pmc_purpose ON phone_resources (pmc_id, purpose) WHERE is_active = true AND pmc_id IS NOT NULL`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_resources_system_purpose ON phone_resources (purpose) WHERE is_active = true AND pmc_id IS NULL`;
    logDetail('✅ phone_resources verified/created');
  } catch (error) {
    logDetail(`⚠️ Could not ensure phone_resources: ${error.message}`, 'error');
    throw error;
  }
}

async function ensureVendorColumns(sql) {
  const vendorColumns = [
    {
      name: 'business_hours_note',
      statement: sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS business_hours_note TEXT`
    }
  ];

  for (const column of vendorColumns) {
    try {
      logDetail(`Ensuring vendors.${column.name} exists...`);
      await column.statement;
      logDetail(`✅ vendors.${column.name} verified/created`);
    } catch (error) {
      logDetail(`⚠️ Could not ensure vendors.${column.name}: ${error.message}`, 'error');
      if (error.code !== '42701') {
        throw error;
      }
    }
  }
}

// Run SQL migration files from scripts/migrations folder
async function runSQLMigrations(sql) {
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      logDetail('No migrations directory found, skipping SQL migrations');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => /^\d{3}_.+\.sql$/.test(file))
      .sort(); // Three-digit prefix so lexicographic order matches numeric order

    if (migrationFiles.length === 0) {
      logDetail('No SQL migration files found');
      return;
    }

    log(`📄 Found ${migrationFiles.length} SQL migration file(s)`);

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      log(`🔄 Running migration: ${file}`);
      
      try {
        const sqlContent = fs.readFileSync(filePath, 'utf8');
        
        // Execute the migration inside its own transaction to satisfy postgres.js safety checks
        await sql.begin(async transactionalSql => {
          // PostgreSQL can handle multiple statements separated by semicolons
          // Wrapping in sql.begin avoids UNSAFE_TRANSACTION errors for scripts with multiple statements
          await transactionalSql.unsafe(sqlContent);
        });
        
        log(`✅ Completed migration: ${file}`);
      } catch (error) {
        // Check if error is because table/column already exists (safe to ignore)
        if (error.message.includes('already exists') || 
            error.code === '42P07' || // duplicate_table
            error.code === '42710') { // duplicate_object
          log(`⚠️ Migration ${file} skipped (objects already exist): ${error.message}`);
          logDetail(`  This is normal if migration was already run`);
        } else {
          log(`❌ Error in migration ${file}: ${error.message}`, 'error');
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('❌ SQL migration failed:', error);
    throw error;
  }
}

// Run schema migrations
// NOTE: All schema creation is now in createTables() - this function runs
// incremental migrations for existing databases
async function runSchemaMigrations(sql) {
  try {
    log('🔄 Running schema migrations...');
    await ensurePropertyJurisdictionColumns(sql);
    await ensureVendorColumns(sql);
    await ensurePmCompaniesThemeColumn(sql);
    await ensurePhoneResourcesTable(sql);
    await ensurePaymentsTable(sql);
    
    // Run SQL migration files from migrations folder
    await runSQLMigrations(sql);
    
    log('✅ Schema migrations completed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Create Global Admin user
async function createGlobalAdmin(sql, userData) {
  try {
    const { firstName, middleName, lastName, email, password } = userData;
    
    log(`🔄 Creating global admin user: ${email}`);
    logDetail(`   Name: ${firstName} ${middleName || ''} ${lastName}`.trim());
    
    // Check if user already exists
    const existingUser = await sql`SELECT user_id FROM users WHERE email = ${email}`;
    if (existingUser.length > 0) {
      log(`❌ User with email ${email} already exists`);
      throw new Error('User with this email already exists');
    }
    
    // Hash password
    logDetail('   Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    logDetail('   Creating user record...');
    const [user] = await sql`
      INSERT INTO users (email, password_hash, role, is_active)
      VALUES (${email}, ${hashedPassword}, 'global_admin', true)
      RETURNING user_id
    `;
    
    // Create contact record
    logDetail('   Creating contact record...');
    await sql`
      INSERT INTO contacts (contactable_id, contactable_type, first_name, middle_name, last_name)
      VALUES (${user.user_id}, 'user', ${firstName}, ${middleName || null}, ${lastName})
    `;
    
    log(`✅ Global admin created successfully: ${email} (user_id: ${user.user_id})`);
    return user.user_id;
  } catch (error) {
    log(`❌ Error creating global admin: ${error.message}`, 'error');
    throw error;
  }
}

// Import default templates from templates folder
async function importDefaultTemplates(sql) {
  try {
    const templatesDir = path.join(__dirname, '..', 'public', 'templates');
    
    // Check for system_default_rental_application.json
    const applicationTemplatePath = path.join(templatesDir, 'system_default_rental_application.json');
    if (fs.existsSync(applicationTemplatePath)) {
      // Read file as string to preserve original key order
      const templateString = fs.readFileSync(applicationTemplatePath, 'utf8');
      // Validate it's valid JSON by parsing (will throw if invalid)
      JSON.parse(templateString);
      
      // Check if default application template already exists
      const existing = await sql`
        SELECT template_id FROM templates 
        WHERE template_level = 'system' 
        AND template_type = 'Application' 
        AND is_default = true
        LIMIT 1
      `;
      
      if (existing.length === 0) {
        // Use the original string to preserve key order exactly as in the file
        await sql`
          INSERT INTO templates (template_type, template_level, template_name, template_data, template_data_raw, is_default)
          VALUES ('Application', 'system', 'System Default Rental Application', ${templateString}::jsonb, ${templateString}, true)
        `;
        console.log('✅ Imported system default rental application template');
      } else {
        // Update existing template - use original string to preserve order
        await sql`
          UPDATE templates 
          SET template_data = ${templateString}::jsonb,
              template_data_raw = ${templateString},
              updated_at = CURRENT_TIMESTAMP
          WHERE template_id = ${existing[0].template_id}
        `;
        console.log('✅ Updated system default rental application template');
      }
    }
    
    // Check for system_default_lease.json
    const leaseTemplatePath = path.join(templatesDir, 'system_default_lease.json');
    if (fs.existsSync(leaseTemplatePath)) {
      // Read file as string to preserve original key order
      const templateString = fs.readFileSync(leaseTemplatePath, 'utf8');
      // Validate it's valid JSON by parsing (will throw if invalid)
      JSON.parse(templateString);
      
      // Check if default lease template already exists
      const existing = await sql`
        SELECT template_id FROM templates 
        WHERE template_level = 'system' 
        AND template_type = 'Lease' 
        AND is_default = true
        LIMIT 1
      `;
      
      if (existing.length === 0) {
        // Use the original string to preserve key order exactly as in the file
        await sql`
          INSERT INTO templates (template_type, template_level, template_name, template_data, template_data_raw, is_default)
          VALUES ('Lease', 'system', 'System Default Lease', ${templateString}::jsonb, ${templateString}, true)
        `;
        console.log('✅ Imported system default lease template');
      } else {
        // Update existing template - use original string to preserve order
        await sql`
          UPDATE templates 
          SET template_data = ${templateString}::jsonb,
              template_data_raw = ${templateString},
              updated_at = CURRENT_TIMESTAMP
          WHERE template_id = ${existing[0].template_id}
        `;
        console.log('✅ Updated system default lease template');
      }
    }
  } catch (error) {
    console.error('⚠️ Error importing default templates:', error.message);
    // Don't throw - template import is optional
  }
}

// Initialize system-wide default compliance policies
async function initializeCompliancePolicies(sql) {
  try {
    log('📋 Initializing system-wide default compliance policies...');
    
    // Get default policy data structure for each type
    const getDefaultPolicyData = (policyType) => {
      const baseStructure = {
        template_version: '1.0',
        sections: [],
        description: `System-wide default policy for ${policyType.replace(/_/g, ' ')}`,
        notes: 'This is a system default policy. Company, landlord, and property-level policies can extend or override this policy.'
      };

      // Enhanced structure for applicant_screening (critical for Seattle compliance)
      if (policyType === 'applicant_screening') {
        return {
          ...baseStructure,
          sections: [
            {
              section_id: 'income_requirements',
              section_title: 'Income Requirements',
              fields: [
                {
                  field_id: 'minimum_income_ratio',
                  field_type: 'number',
                  label: 'Minimum Income to Rent Ratio',
                  value: 3.0,
                  required: true,
                  description: 'Applicant must earn at least 3x monthly rent'
                },
                {
                  field_id: 'accept_co_signers',
                  field_type: 'boolean',
                  label: 'Accept Co-Signers',
                  value: true,
                  required: false
                }
              ]
            },
            {
              section_id: 'credit_requirements',
              section_title: 'Credit Requirements',
              fields: [
                {
                  field_id: 'minimum_credit_score',
                  field_type: 'number',
                  label: 'Minimum Credit Score',
                  value: 650,
                  required: true
                },
                {
                  field_id: 'allow_bankruptcies',
                  field_type: 'boolean',
                  label: 'Allow Applicants with Bankruptcies',
                  value: false,
                  required: false
                }
              ]
            },
            {
              section_id: 'rental_history',
              section_title: 'Rental History Requirements',
              fields: [
                {
                  field_id: 'minimum_rental_history_months',
                  field_type: 'number',
                  label: 'Minimum Rental History (months)',
                  value: 12,
                  required: true
                },
                {
                  field_id: 'allow_evictions',
                  field_type: 'boolean',
                  label: 'Allow Applicants with Prior Evictions',
                  value: false,
                  required: false
                }
              ]
            },
            {
              section_id: 'qualification_order',
              section_title: 'Qualification Order (Seattle First Qualified Applicant Rule)',
              fields: [
                {
                  field_id: 'application_order',
                  field_type: 'select',
                  label: 'Application Processing Order',
                  value: 'first_qualified',
                  options: ['first_qualified', 'first_applied', 'best_qualified'],
                  required: true,
                  description: 'Seattle requires "first_qualified" - must approve first applicant who meets all criteria'
                }
              ]
            }
          ]
        };
      }

      return baseStructure;
    };

    // Policy types to initialize
    const policyTypes = [
      'applicant_screening',
      'rent_increase',
      'eviction',
      'move_in',
      'move_out',
      'security_deposit',
      'collections',
      'lease_violation',
      'lease_termination',
      'habitability',
      'entry_notice',
      'tenant_screening'
    ];

    for (const policyType of policyTypes) {
      // Check if system policy already exists
      const existing = await sql`
        SELECT policy_id FROM compliance_policies 
        WHERE policy_level = 'system' 
        AND policy_type = ${policyType}
        AND is_default = true
        LIMIT 1
      `;
      
      if (existing.length === 0) {
        const defaultPolicyData = getDefaultPolicyData(policyType);
        const policyName = `System Default ${policyType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} Policy`;

        await sql`
          INSERT INTO compliance_policies (
            policy_type,
            policy_level,
            policy_name,
            description,
            policy_data,
            is_default,
            is_active
          ) VALUES (
            ${policyType},
            'system',
            ${policyName},
            ${defaultPolicyData.description},
            ${JSON.stringify(defaultPolicyData)}::jsonb,
            true,
            true
          )
        `;
        
        logDetail(`✅ Created system default policy for ${policyType}`);
      } else {
        logDetail(`ℹ️ System default policy for ${policyType} already exists`);
      }
    }
    
    log('✅ System-wide compliance policies initialized');
  } catch (error) {
    logDetail(`⚠️ Error initializing compliance policies: ${error.message}`, 'error');
    if (error.stack) {
      logDetail(error.stack, 'error');
    }
    // Don't throw - policy initialization is optional
    log('⚠️ Continuing without compliance policies initialization');
  }
}

// Initialize system-wide default compliance rules
async function initializeComplianceRules(sql) {
  try {
    log('📋 Initializing system-wide default compliance rules...');
    
    // Washington State rules
    const waStateRules = [
      {
        rule_name: 'Rent Increase Notice - 90 Days (RCW 59.18.140)',
        rule_type: 'notice_period',
        jurisdiction: 'washington_state',
        applies_to: 'rent_increase',
        rule_condition: { subsidized: false },
        rule_action: '90 days prior written notice required for ordinary rent increases (RCW 59.18.140(3)(a))',
        notice_period_days: 90,
        prohibited: false,
        source: 'RCW 59.18.140'
      },
      {
        rule_name: 'Rent Increase Notice - Subsidized 30 Days (RCW 59.18.140)',
        rule_type: 'notice_period',
        jurisdiction: 'washington_state',
        applies_to: 'rent_increase',
        rule_condition: { subsidized: true },
        rule_action: '30 days prior written notice for income-based subsidized tenancies (RCW 59.18.140(3)(b))',
        notice_period_days: 30,
        prohibited: false,
        source: 'RCW 59.18.140'
      },
      {
        rule_name: 'Security Deposit Return - 30 Days',
        rule_type: 'notice_period',
        jurisdiction: 'washington_state',
        applies_to: 'security_deposit',
        rule_condition: {},
        rule_action: 'Landlord must return security deposit or provide itemized deductions within 30 days',
        notice_period_days: 30,
        prohibited: false,
        source: 'RCW 59.18.280'
      },
      {
        rule_name: 'Entry Notice - Two Days',
        rule_type: 'notice_period',
        jurisdiction: 'washington_state',
        applies_to: 'entry',
        rule_condition: { is_emergency: false },
        rule_action: 'At least two days written notice required for non-emergency entry (RCW 59.18.150)',
        notice_period_days: null, // Hours, not days — see jurisdiction pack (48)
        prohibited: false,
        source: 'RCW 59.18.150'
      },
      {
        rule_name: 'Just Cause Required to End Tenancy (RCW 59.18.650)',
        rule_type: 'prohibited_action',
        jurisdiction: 'washington_state',
        applies_to: 'lease_termination',
        rule_condition: { has_just_cause: false },
        rule_action: 'Statewide just cause required to end a periodic tenancy except limited statutory paths',
        notice_period_days: null,
        prohibited: true,
        source: 'RCW 59.18.650'
      }
    ];

    // Seattle-specific rules
    const seattleRules = [
      {
        rule_name: 'Seattle - First Qualified Applicant Rule',
        rule_type: 'required_disclosure',
        jurisdiction: 'seattle',
        applies_to: 'applicant_screening',
        rule_condition: {},
        rule_action: 'Must approve first applicant who meets all written screening criteria',
        notice_period_days: null,
        prohibited: false,
        source: 'Seattle Municipal Code 14.09'
      },
      {
        rule_name: 'Seattle - Written Screening Criteria Required',
        rule_type: 'required_disclosure',
        jurisdiction: 'seattle',
        applies_to: 'applicant_screening',
        rule_condition: {},
        rule_action: 'Written screening criteria must be documented and available',
        notice_period_days: null,
        prohibited: false,
        source: 'Seattle Municipal Code 14.09'
      },
      {
        rule_name: 'Seattle - Just Cause Eviction Required',
        rule_type: 'prohibited_action',
        jurisdiction: 'seattle',
        applies_to: 'eviction',
        rule_condition: { has_just_cause: false },
        rule_action: 'Just cause required for evictions in Seattle',
        notice_period_days: null,
        prohibited: true,
        source: 'Seattle Municipal Code 22.206'
      }
    ];

    const allRules = [...waStateRules, ...seattleRules];

    for (const rule of allRules) {
      // Check if rule already exists
      const existing = await sql`
        SELECT rule_id FROM compliance_rules
        WHERE rule_name = ${rule.rule_name}
        AND jurisdiction = ${rule.jurisdiction}
        LIMIT 1
      `;

      if (existing.length === 0) {
        await sql`
          INSERT INTO compliance_rules (
            rule_name,
            rule_type,
            jurisdiction,
            applies_to,
            rule_condition,
            rule_action,
            notice_period_days,
            prohibited,
            source,
            is_active
          ) VALUES (
            ${rule.rule_name},
            ${rule.rule_type},
            ${rule.jurisdiction},
            ${rule.applies_to},
            ${JSON.stringify(rule.rule_condition)}::jsonb,
            ${rule.rule_action},
            ${rule.notice_period_days},
            ${rule.prohibited},
            ${rule.source},
            true
          )
        `;
        logDetail(`✅ Created compliance rule: ${rule.rule_name}`);
      } else {
        logDetail(`ℹ️ Compliance rule already exists: ${rule.rule_name}`);
      }
    }

    log('✅ System-wide compliance rules initialized');
  } catch (error) {
    logDetail(`⚠️ Error initializing compliance rules: ${error.message}`, 'error');
    if (error.stack) {
      logDetail(error.stack, 'error');
    }
    // Don't throw - rule initialization is optional
    log('⚠️ Continuing without compliance rules initialization');
  }
}

// Get database statistics
async function getStatistics(sql) {
  try {
    // Check if tables exist and get counts, return 0 if table doesn't exist
    const getTableCount = async (tableName) => {
      try {
        const [result] = await sql`SELECT COUNT(*) as count FROM ${sql(tableName)}`;
        return result.count;
      } catch (error) {
        // Table doesn't exist, return 0
        return 0;
      }
    };
    
    const getGlobalAdmins = async () => {
      try {
        const admins = await sql`
          SELECT u.email, c.first_name, c.middle_name, c.last_name
          FROM users u
          LEFT JOIN contacts c ON u.user_id = c.contactable_id AND c.contactable_type = 'user'
          WHERE u.role = 'global_admin'
          ORDER BY u.created_at
        `;
        return admins;
      } catch (error) {
        // Tables don't exist or no admins, return empty array
        return [];
      }
    };

    const users = await getTableCount('users');
    const landlords = await getTableCount('landlords');
    const tenants = await getTableCount('clients');
    const properties = await getTableCount('properties');
    const units = await getTableCount('units');
    const leases = await getTableCount('leases');
    const maintenance_requests = await getTableCount('maintenance_requests');
    const vendors = await getTableCount('vendors');
    const invoices = await getTableCount('invoices');
    const transactions = await getTableCount('transactions');
    const amenities = await getTableCount('amenities');
    const features = await getTableCount('features');
    const property_types = await getTableCount('property_types');
    const globalAdmins = await getGlobalAdmins();
    
    return {
      users,
      landlords,
      tenants,
      properties,
      units,
      leases,
      maintenance_requests,
      vendors,
      invoices,
      transactions,
      amenities,
      features,
      property_types,
      globalAdmins
    };
  } catch (error) {
    console.error('Error getting statistics:', error);
    throw error;
  }
}

// API Routes

// Get environments
app.get('/api/environments', (req, res) => {
  try {
    const config = loadEnvironments();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get selected environment
app.get('/api/selected-environment', (req, res) => {
  try {
    const config = loadEnvironments();
    res.json({ selectedEnvironment: config.lastUsed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set selected environment
app.post('/api/selected-environment', (req, res) => {
  try {
    const config = loadEnvironments();
    const { environmentName } = req.body;
    
    config.lastUsed = environmentName;
    saveEnvironments(config);
    
    res.json({ success: true, message: 'Selected environment updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add environment or sync all environments
app.post('/api/environments', async (req, res) => {
  try {
    const config = loadEnvironments();
    const requestBody = req.body;
    
    // Check if this is a bulk sync (array of environments)
    if (Array.isArray(requestBody)) {
      // Bulk sync - replace all environments
      config.environments = requestBody;
    } else {
      // Single environment add/update
      const { name, url, anonKey, serviceKey } = requestBody;
      
      if (!name || !url || !anonKey || !serviceKey) {
        return res.status(400).json({ error: 'Missing required fields: name, url, anonKey, serviceKey' });
      }
      
      // Find existing environment or create new one
      const existingIndex = config.environments.findIndex(env => env.name === name);
      const environment = {
        name,
        url,
        anonKey,
        serviceKey
      };
      
      if (existingIndex >= 0) {
        config.environments[existingIndex] = environment;
      } else {
        config.environments.push(environment);
      }
    }
    
    saveEnvironments(config);
    res.json({ success: true, message: 'Environment saved', config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete environment
app.delete('/api/environments/:name', (req, res) => {
  try {
    const config = loadEnvironments();
    const { name } = req.params;
    
    config.environments = config.environments.filter(env => env.name !== name);
    
    // If deleted environment was selected, clear selection
    if (config.lastUsed === name) {
      config.lastUsed = null;
    }
    
    saveEnvironments(config);
    res.json({ success: true, message: 'Environment deleted', config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test database connection
app.post('/api/test-connection', async (req, res) => {
  let sql;
  const startTime = Date.now();
  
  try {
    log('🔌 Testing database connection...');
    
    const environmentName = extractEnvironmentName(req);
    const { environment, sql: sqlClient } = await connectToEnvironment(environmentName);
    sql = sqlClient;
    
    // Test connection with a simple query
    await sql`SELECT 1 as test`;
    
    await sql.end();
    const totalTime = Date.now() - startTime;
    
    log(`✅ Connection successful (${totalTime}ms)`);
    
    res.json({ 
      success: true, 
      message: `Connection to '${environment.name}' successful`
    });
  } catch (error) {
    if (sql) {
      try {
        await sql.end();
      } catch (endError) {
        logDetail(`Error closing connection: ${endError.message}`, 'error');
      }
    }
    
    const totalTime = Date.now() - startTime;
    log(`❌ Connection failed after ${totalTime}ms: ${error.message}`, 'error');
    
    // Check if it's a network/DNS issue (often caused by VPN)
    const isNetworkIssue = error.code === 'ENOTFOUND' || 
                          error.code === 'ETIMEDOUT' || 
                          error.code === 'ECONNREFUSED' ||
                          error.message?.includes('getaddrinfo') ||
                          error.message?.includes('ENOTFOUND');
    
    if (isNetworkIssue) {
      res.status(500).json({ 
        error: error.message,
        details: {
          code: error.code,
          message: error.message
        },
        vpnCheck: true // Flag to trigger VPN check in UI
      });
    } else {
      res.status(500).json({ 
        error: error.message,
        details: {
          code: error.code,
          message: error.message
        }
      });
    }
  }
});

// Initialize database
app.post('/api/initialize', async (req, res) => {
  let sql;
  try {
    const requestBody = req.body || {};
    const userData = requestBody.userData;
    const { environment, sql: sqlClient } = await connectToEnvironment(extractEnvironmentName(req));
    log(`🔄 Initializing database for environment: ${environment.name}`);
    sql = sqlClient;
    const storageCleanupResult = await resetDatabase(sql, environment);
    await createTables(sql);
    // Note: Template import removed - templates should be imported through the UI Import Form
    // which properly handles field positions, file storage, and image conversion
    await initializeCompliancePolicies(sql);
    await initializeComplianceRules(sql);

    let createdAdminEmail = null;
    if (userData) {
      const adminData = {
        firstName: userData.firstName?.trim(),
        middleName: userData.middleName?.trim() || null,
        lastName: userData.lastName?.trim(),
        email: userData.email?.trim(),
        password: userData.password
      };

      if (!adminData.firstName || !adminData.lastName || !adminData.email || !adminData.password) {
        throw new Error('Missing required fields for initial global admin (first name, last name, email, password)');
      }

      if (userData.password !== userData.confirmPassword) {
        throw new Error('Passwords do not match for initial global admin');
      }

      await createGlobalAdmin(sql, adminData);
      createdAdminEmail = adminData.email;
      log(`✅ Created initial global admin (${adminData.email})`);
    } else {
      logDetail('ℹ️ No user data provided for initial global admin creation');
    }

    await sql.end();
    
    // Build success message with storage cleanup info
    let successMessage = createdAdminEmail
      ? `Database initialized successfully for '${environment.name}'. Global admin ${createdAdminEmail} created.`
      : `Database initialized successfully for '${environment.name}'.`;
    
    if (storageCleanupResult) {
      if (storageCleanupResult.success) {
        if (storageCleanupResult.deleted_count > 0) {
          successMessage += ` Storage cleanup: ${storageCleanupResult.deleted_count} file(s) deleted.`;
        } else {
          successMessage += ` Storage cleanup: ${storageCleanupResult.message}`;
        }
      } else {
        successMessage += ` Storage cleanup warning: ${storageCleanupResult.message}`;
      }
    }
    
    res.json({ success: true, message: successMessage, storageCleanup: storageCleanupResult });
  } catch (error) {
    if (sql) await sql.end().catch(() => {});
    log(`❌ Initialization failed: ${error.message}`, 'error');
    if (error.stack) {
      logDetail(error.stack, 'error');
    }
    res.status(500).json({ error: error.message });
  }
});

// Run migrations
app.post('/api/migrate', async (req, res) => {
  let sql;
  let migrationErrors = [];
  try {
    const { environment, sql: sqlClient } = await connectToEnvironment(extractEnvironmentName(req));
    log(`🔄 Starting migration for environment: ${environment.name}`);
    sql = sqlClient;
    
    try {
      await runSchemaMigrations(sql);
    } catch (migrationError) {
      migrationErrors.push(migrationError.message);
      logDetail(`⚠️ Schema migration error: ${migrationError.message}`, 'error');
    }
    
    await sql.end();
    
    if (migrationErrors.length > 0) {
      log(`⚠️ Migrations completed with ${migrationErrors.length} error(s). See log file for details.`, 'error');
      res.status(500).json({ success: false, message: 'Migrations completed with errors. See log file for details.', errors: migrationErrors });
    } else {
      log('✅ Migrations completed successfully');
      res.json({ success: true, message: `Migrations completed successfully for '${environment.name}'` });
    }
  } catch (error) {
    if (sql) await sql.end().catch(() => {});
    log(`❌ Migration failed: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Create global admin
app.post('/api/create-admin', async (req, res) => {
  let sql;
  try {
    // Extract userData from request body (GUI sends it nested)
    const userData = req.body.userData || req.body;
    const { firstName, middleName, lastName, email, password, confirmPassword } = userData;
    
    const { environment, sql: sqlClient } = await connectToEnvironment(extractEnvironmentName(req));
    log(`🔄 Creating additional global admin in environment: ${environment.name}`);
    sql = sqlClient;
    
    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      throw new Error('Missing required fields: first name, last name, email, and password are required');
    }
    
    // Validate password confirmation if provided
    if (confirmPassword && password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }
    
    const userId = await createGlobalAdmin(sql, { firstName, middleName, lastName, email, password });
    await sql.end();
    
    const successMessage = `Global admin created successfully in '${environment.name}'`;
    log(`✅ ${successMessage}`);
    res.json({ success: true, message: successMessage, userId });
  } catch (error) {
    if (sql) await sql.end().catch(() => {});
    log(`❌ Failed to create global admin: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Drop all tables
app.post('/api/drop', async (req, res) => {
  let sql;
  try {
    const { environment, sql: sqlClient } = await connectToEnvironment(extractEnvironmentName(req));
    sql = sqlClient;
    log(`🗑️ Dropping all tables for environment: ${environment.name}...`);
    
    await resetDatabase(sql, environment);
    
    await sql.end();
    log('✅ All tables dropped');
    res.json({ success: true, message: `All tables dropped successfully for '${environment.name}'` });
  } catch (error) {
    if (sql) await sql.end().catch(() => {});
    log(`❌ Error dropping tables: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.post('/api/statistics', async (req, res) => {
  let sql;
  try {
    const { environment, sql: sqlClient } = await connectToEnvironment(extractEnvironmentName(req));
    sql = sqlClient;
    const stats = await getStatistics(sql);
    await sql.end();
    res.json({ success: true, statistics: stats, environment: environment.name });
  } catch (error) {
    if (sql) await sql.end().catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

// Serve GUI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'db-util-gui.html'));
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Database Utility GUI running at http://localhost:${PORT}`);
  console.log(`📱 Open your browser and navigate to the URL above`);
  console.log(`🛑 Press Ctrl+C to stop the server`);
  console.log(`📝 Log file: ${LOG_FILE}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down Database Utility GUI...');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
  process.exit(1);
});