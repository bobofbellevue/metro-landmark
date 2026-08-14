# Database Utility (db-util)

A database management tool for Metro Landmark that supports both local PostgreSQL and Supabase environments.

## Features

- **Multi-environment support**: Local PostgreSQL, Supabase Dev, Supabase Prod
- **Database lifecycle management**: Create, drop, initialize, reset
- **Schema migrations**: Automated database schema updates
- **User management**: Create initial admin users
- **Environment switching**: Easy switching between database environments

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environments
Update `scripts/db-config.js` with your database credentials:

#### Basic Configuration (Current)
- **Local PostgreSQL** - Development database
- **Supabase Account 1** - Development environment
- **Supabase Account 2** - Staging environment  
- **Supabase Account 3** - Production environment

#### Advanced Configuration (Optional)
For more complex setups with multiple databases per account, use `scripts/db-config-advanced.js`:

- **Multiple Supabase Accounts** - Different organizations
- **Multiple Databases per Account** - Dev, Staging, Prod per account
- **Environment Variables** - Easy configuration management

### 3. Use the Database Utility (Recommended)

#### GUI Interface (Easiest)
```bash
npm run db:util
```

This will launch a web-based GUI at `http://localhost:3001` with:
- **Visual Environment Management** - Drag and drop interface
- **Real-time Connection Testing** - Instant feedback on connections
- **Interactive Database Actions** - Click to execute operations
- **Live Statistics Dashboard** - Real-time database counts
- **Modern Web Interface** - Responsive design for any device

#### Command Line Interface
```bash
node scripts/db-util-menu.js
```

This will launch the interactive command-line utility with:
- **Environment Management** - Save and switch between multiple environments
- **Persistent Configuration** - Remembers your last used environment
- **Multiple Local Databases** - Support for different local database names
- **Environment Switching** - Easy switching between saved environments
- **Statistics Dashboard** - View database counts and activity
- **Environment Deletion** - Remove saved environments from memory

## Database Utility Interface

The easiest way to use the database utility is through the web interface:

```bash
npm run db:util
```

Or use the command-line interface:

```bash
node scripts/db-util-menu.js
```

### Menu Options:
1. **Initialize Database** - Create tables + Global Admin
2. **Run Migrations Only** - Apply schema changes
3. **Create Global Admin Only** - Add new Global Admin user
4. **Drop Database** - Remove database (local only)
5. **Create Database** - Create new database (local only)
6. **Reset Database** - Drop + Create + Initialize
7. **Exit**

### Creating Global Admin:
When you select "Create Global Admin", you'll be prompted for:
- First Name
- Middle Name (optional)
- Last Name
- Email Address
- Password (hidden input)
- Confirm Password

## Command Line Interface

For automated scripts or CI/CD, you can still use the command-line interface:

```javascript
export const DB_CONFIGS = {
  local: {
    host: 'localhost',
    port: 5432,
    database: 'salish_landmark',
    username: 'postgres',
    password: 'your_password',
    ssl: false
  },
  supabase_dev: {
    url: 'postgresql://postgres.yourproject:yourpassword@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    ssl: true
  }
};
```

### 3. Run Commands

#### Local Development
```bash
# Initialize local database
npm run db:init:local

# Reset local database (drop, create, initialize)
npm run db:reset:local
```

#### Supabase Development
```bash
# Run migrations on Supabase
npm run db:migrate:supabase

# Initialize Supabase database
npm run db:init:supabase
```

## Available Commands

### NPM Scripts
- `npm run db:init` - Initialize database (defaults to local)
- `npm run db:migrate` - Run migrations
- `npm run db:drop` - Drop database (local only)
- `npm run db:create` - Create database (local only)
- `npm run db:reset` - Reset database (drop, create, initialize)
- `npm run db:init:local` - Initialize local database
- `npm run db:init:supabase` - Initialize Supabase database
- `npm run db:reset:local` - Reset local database
- `npm run db:migrate:supabase` - Run migrations on Supabase

### Direct Commands
```bash
# Initialize database
node scripts/db-util.js init [environment]

# Run migrations
node scripts/db-util.js migrate [environment]

# Drop database (local only)
node scripts/db-util.js drop [environment]

# Create database (local only)
node scripts/db-util.js create [environment]

# Reset database
node scripts/db-util.js reset [environment]
```

## Environments

- `local` - Local PostgreSQL database
- `supabase_dev` - Supabase development database
- `supabase_prod` - Supabase production database

## Schema Migrations

The utility includes automated schema migrations that fix database design issues:

### Current Migrations
1. **Remove duplicate names from landlords table** - Names should only be in contacts table
2. **Ensure contacts table has name fields** - Add first_name, middle_name, last_name to contacts

### Adding New Migrations
Add new migrations to `scripts/db-config.js`:

```javascript
export const SCHEMA_MIGRATIONS = [
  {
    name: 'your_migration_name',
    sql: `
      -- Your SQL migration here
      ALTER TABLE your_table ADD COLUMN new_field VARCHAR(255);
    `
  }
];
```

## Database Schema

The utility creates the following tables:

- `users` - User accounts and authentication
- `pm_companies` - Property management companies
- `landlords` - Landlord information (linked to users)
- `contacts` - Contact information (names, addresses, etc.)
- `addresses` - Address information
- `contact_methods` - Phone numbers, emails, etc.
- `properties` - Property information
- `units` - Unit information within properties
- `tenants` - Tenant information
- `leases` - Lease agreements

## Initial Admin User

The utility creates an initial admin user:
- **Email**: admin@salishlandmark.com
- **Password**: admin123
- **Role**: global_admin

⚠️ **Important**: Change the password after first login!

## Troubleshooting

### Local PostgreSQL Issues
1. Ensure PostgreSQL is running
2. Check connection credentials in `db-config.js`
3. Verify database permissions

### Supabase Issues
1. Check connection URL format
2. Verify SSL settings
3. Ensure database exists in Supabase dashboard

### Migration Issues
1. Check SQL syntax in migrations
2. Verify table exists before running migrations
3. Run migrations in order

## Examples

### Development Workflow
```bash
# Start with local database
npm run db:reset:local

# Test your changes locally
npm run dev

# When ready, deploy to Supabase
npm run db:migrate:supabase
```

### Production Deployment
```bash
# Run migrations on production
node scripts/db-util.js migrate supabase_prod
```

## Security Notes

- Never commit database credentials to version control
- Use environment variables for sensitive data
- Change default admin password in production
- Use SSL for remote connections
