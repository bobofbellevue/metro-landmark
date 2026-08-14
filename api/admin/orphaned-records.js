/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to find orphaned database records
 * 
 * This implementation dynamically discovers all tables and their relationships
 * from the database schema using PostgreSQL's information_schema, making it
 * completely self-maintaining as the schema evolves.
 * 
 * GET /api/admin/orphaned-records - Find orphaned records
 * DELETE /api/admin/orphaned-records - Delete selected orphaned records
 * 
 * Query params (GET):
 * - type: 'documents' | 'all' (default: 'all')
 * 
 * Body (DELETE):
 * {
 *   records: [{ table: string, id: number, type: string }]
 * }
 */

/**
 * Discover primary key column for a table using database function
 */
async function getPrimaryKey(supabase, tableName) {
  try {
    // Try to get from database function first
    const { data: pkData, error } = await supabase.rpc('discover_primary_keys');
    
    if (!error && pkData) {
      const tableInfo = Array.isArray(pkData) 
        ? pkData.find(t => t.table_name === tableName)
        : Object.values(pkData).find(t => t.table_name === tableName);
      
      if (tableInfo && tableInfo.primary_key) {
        return tableInfo.primary_key;
      }
    }
  } catch (err) {
    // Fall through to fallback
  }

  // Fallback: common patterns
  const idColumnMap = {
    'contacts': 'contact_id',
    'contact_methods': 'method_id',
    'addresses': 'address_id',
    'pm_companies': 'pmc_id'
  };

  return idColumnMap[tableName] || `${tableName.slice(0, -1)}_id`;
}

/**
 * Discover all foreign key relationships from the database schema
 * Returns a map: { childTable: [{ parentTable, childColumn, parentColumn, onDelete }] }
 */
async function discoverForeignKeys(supabase) {
  try {
    // Call database function to get foreign keys
    const { data: fkData, error } = await supabase.rpc('discover_foreign_keys');
    
    if (error) {
      console.warn('Failed to discover foreign keys from database:', error.message);
      return {};
    }

    if (!fkData) {
      return {};
    }

    // Convert array to map structure
    const relationships = {};
    const fkArray = Array.isArray(fkData) ? fkData : Object.values(fkData);

    for (const fk of fkArray) {
      const childTable = fk.child_table || fk.childTable;
      const parentTable = fk.parent_table || fk.parentTable;
      const childColumn = fk.child_column || fk.childColumn;
      const parentColumn = fk.parent_column || fk.parentColumn;
      const onDelete = fk.on_delete || fk.onDelete || 'NO ACTION';

      if (!relationships[childTable]) {
        relationships[childTable] = [];
      }

      relationships[childTable].push({
        parentTable,
        childColumn,
        parentColumn,
        onDelete
      });
    }

    return relationships;
  } catch (error) {
    console.error('Error discovering foreign keys:', error);
    return {};
  }
}

/**
 * Handle polymorphic relationships (contacts, addresses)
 */
async function findOrphanedPolymorphicRecords(supabase, tableName, idColumn, typeColumn, idValueColumn, orphanedRecords) {
  const typeMappings = {
    'contacts': {
      'client': { checkTable: 'users', checkColumn: 'user_id', requiresClient: true },
      'landlord': { checkTable: 'landlords', checkColumn: 'landlord_id' },
      'vendor': { checkTable: 'vendors', checkColumn: 'vendor_id' },
      'pm_company': { checkTable: 'pm_companies', checkColumn: 'pmc_id' },
      'property': { checkTable: 'properties', checkColumn: 'property_id' },
      'user': { checkTable: 'users', checkColumn: 'user_id' }
    },
    'addresses': {
      'property': { checkTable: 'properties', checkColumn: 'property_id' },
      'landlord': { checkTable: 'landlords', checkColumn: 'landlord_id' },
      'pm_company': { checkTable: 'pm_companies', checkColumn: 'pmc_id' },
      'user': { checkTable: 'users', checkColumn: 'user_id' }
    }
  };

  const mapping = typeMappings[tableName];
  if (!mapping) return;

  // Get all records
  const { data: records, error } = await supabase
    .from(tableName)
    .select(`${idColumn}, ${typeColumn}, ${idValueColumn}, first_name, last_name, address_line_1, city`);

  if (error || !records) return;

  // Group by type
  const byType = {};
  records.forEach(record => {
    const type = record[typeColumn];
    if (!byType[type]) byType[type] = [];
    byType[type].push(record);
  });

  // Check each type
  for (const [type, typeRecords] of Object.entries(byType)) {
    const typeConfig = mapping[type];
    if (!typeConfig) continue;

    const ids = [...new Set(typeRecords.map(r => r[idValueColumn]).filter(id => id !== null))];
    if (ids.length === 0) continue;

    let validIds = new Set();

    // Special handling for client type (contacts)
    if (type === 'client' && tableName === 'contacts' && typeConfig.requiresClient) {
      const { data: validUsers } = await supabase
        .from('users')
        .select('user_id, clients!inner(client_id)')
        .in('user_id', ids);
      validIds = new Set((validUsers || []).map(u => u.user_id));
    } else {
      const { data: validRecords } = await supabase
        .from(typeConfig.checkTable)
        .select(typeConfig.checkColumn)
        .in(typeConfig.checkColumn, ids);
      validIds = new Set((validRecords || []).map(r => r[typeConfig.checkColumn]));
    }

    // Find orphaned records
    typeRecords.forEach(record => {
      if (!validIds.has(record[idValueColumn])) {
        const nameField = tableName === 'contacts' ? 
          `${record.first_name || ''} ${record.last_name || ''}`.trim() || 'Unnamed' :
          record.address_line_1 || record.city || 'Unknown';
        
        orphanedRecords.push({
          table: tableName,
          id: record[idColumn],
          type: tableName.slice(0, -1),
          description: `${tableName.slice(0, -1).replace(/_/g, ' ')} "${nameField}" (ID: ${record[idColumn]}) references non-existent ${type} with ID ${record[idValueColumn]}`,
          [idValueColumn]: record[idValueColumn],
          [typeColumn]: record[typeColumn]
        });
      }
    });
  }
}

/**
 * Find orphaned records for a table based on foreign key relationships
 */
async function findOrphanedRecordsForTable(supabase, tableName, relationships, orphanedRecords) {
  const tableRelationships = relationships[tableName];
  if (!tableRelationships || tableRelationships.length === 0) return;

  // Get primary key
  const primaryKey = await getPrimaryKey(supabase, tableName);
  if (!primaryKey) return;

  // Get all records from this table (with reasonable limit)
  const { data: allRecords, error } = await supabase
    .from(tableName)
    .select('*')
    .limit(10000);

  if (error || !allRecords || allRecords.length === 0) return;

  // Check each relationship
  for (const rel of tableRelationships) {
    const { parentTable, childColumn, parentColumn } = rel;

    // Get all non-null values for this foreign key
    const foreignKeyValues = [...new Set(
      allRecords
        .map(r => r[childColumn])
        .filter(id => id !== null && id !== undefined)
    )];

    if (foreignKeyValues.length === 0) continue;

    // Check if parent records exist
    const { data: validParents } = await supabase
      .from(parentTable)
      .select(parentColumn)
      .in(parentColumn, foreignKeyValues);

    const validParentIds = new Set((validParents || []).map(p => p[parentColumn]));

    // Find orphaned records
    allRecords.forEach(record => {
      if (record[childColumn] && !validParentIds.has(record[childColumn])) {
        const recordId = record[primaryKey];
        const description = `${tableName.replace(/_/g, ' ')} (ID: ${recordId}) references non-existent ${parentTable.replace(/_/g, ' ')} with ${parentColumn} ${record[childColumn]}`;
        
        orphanedRecords.push({
          table: tableName,
          id: recordId,
          type: tableName.replace(/_/g, '_'),
          description,
          [childColumn]: record[childColumn],
          parentTable,
          parentColumn
        });
      }
    });
  }
}

/**
 * Find all orphaned records dynamically
 */
async function findAllOrphanedRecords(supabase) {
  const orphanedRecords = [];
  
  // Discover relationships from database schema
  const relationships = await discoverForeignKeys(supabase);
  
  // Handle polymorphic relationships first (these don't use standard FKs)
  await findOrphanedPolymorphicRecords(supabase, 'contacts', 'contact_id', 'contactable_type', 'contactable_id', orphanedRecords);
  await findOrphanedPolymorphicRecords(supabase, 'addresses', 'address_id', 'addressable_type', 'addressable_id', orphanedRecords);
  
  // Find orphaned users (users with role='client' that don't have a corresponding client record)
  await findOrphanedUsers(supabase, orphanedRecords);
  
  // Handle standard foreign key relationships for all tables
  const tables = Object.keys(relationships);
  for (const tableName of tables) {
    await findOrphanedRecordsForTable(supabase, tableName, relationships, orphanedRecords);
  }

  return orphanedRecords;
}

/**
 * Find orphaned user records (users with role='client' that don't have a corresponding client record)
 */
async function findOrphanedUsers(supabase, orphanedRecords) {
  try {
    // Get all users with role='client'
    const { data: clientUsers, error: usersError } = await supabase
      .from('users')
      .select('user_id, email, role')
      .eq('role', 'client');
    
    if (usersError || !clientUsers || clientUsers.length === 0) return;
    
    // Get all client records
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('user_id');
    
    if (clientsError) {
      console.error('[Orphaned Records] Error fetching clients:', clientsError);
      return;
    }
    
    // Create set of user_ids that have client records
    const validUserIds = new Set((clients || []).map(c => c.user_id).filter(id => id !== null));
    
    // Find orphaned users (users without client records)
    clientUsers.forEach(user => {
      if (!validUserIds.has(user.user_id)) {
        orphanedRecords.push({
          table: 'users',
          id: user.user_id,
          type: 'user',
          description: `User "${user.email || 'Unknown'}" (ID: ${user.user_id}) with role 'client' has no corresponding client record`
        });
      }
    });
  } catch (error) {
    console.error('[Orphaned Records] Error finding orphaned users:', error);
  }
}

/**
 * Get all child tables for a given parent table
 */
function getChildTables(parentTable, relationships) {
  const children = [];
  for (const [childTable, rels] of Object.entries(relationships)) {
    if (rels.some(rel => rel.parentTable === parentTable)) {
      children.push({ table: childTable, relationships: rels.filter(rel => rel.parentTable === parentTable) });
    }
  }
  return children;
}

/**
 * Recursively delete a record and all its children
 */
async function deleteRecordWithChildren(supabase, tableName, recordId, relationships, deleted = new Set()) {
  const deleteKey = `${tableName}-${recordId}`;
  if (deleted.has(deleteKey)) return; // Already deleted
  deleted.add(deleteKey);

  const primaryKey = await getPrimaryKey(supabase, tableName);
  if (!primaryKey) return;

  // Find all child tables
  const childTables = getChildTables(tableName, relationships);

  // Delete children first (depth-first)
  for (const child of childTables) {
    const { table: childTable, relationships: childRels } = child;
    
    for (const rel of childRels) {
      // Find all child records
      const { data: childRecords } = await supabase
        .from(childTable)
        .select(rel.childColumn)
        .eq(rel.childColumn, recordId);

      if (childRecords && childRecords.length > 0) {
        const childPrimaryKey = await getPrimaryKey(supabase, childTable);
        
        // Get full child records to get their IDs
        const { data: fullChildRecords } = await supabase
          .from(childTable)
          .select(childPrimaryKey)
          .eq(rel.childColumn, recordId);

        if (fullChildRecords) {
          // Recursively delete each child
          for (const childRecord of fullChildRecords) {
            await deleteRecordWithChildren(supabase, childTable, childRecord[childPrimaryKey], relationships, deleted);
          }
        }
      }
    }
  }

  // Special handling for polymorphic relationships
  if (tableName === 'contacts') {
    // Delete contact_methods first (children of contacts)
    const { data: contactMethods } = await supabase
      .from('contact_methods')
      .select('method_id')
      .eq('contact_id', recordId);

    if (contactMethods) {
      const methodPrimaryKey = await getPrimaryKey(supabase, 'contact_methods');
      for (const method of contactMethods) {
        await deleteRecordWithChildren(supabase, 'contact_methods', method[methodPrimaryKey], relationships, deleted);
      }
    }
  }

  // Delete polymorphic children (contacts, addresses)
  // These need special handling since they use polymorphic keys
  const polymorphicChildren = [
    { table: 'contacts', typeColumn: 'contactable_type', idColumn: 'contactable_id' },
    { table: 'addresses', typeColumn: 'addressable_type', idColumn: 'addressable_id' }
  ];

  for (const polyChild of polymorphicChildren) {
    // Determine the ID column name for this parent table
    const parentIdColumn = await getPrimaryKey(supabase, tableName);
    
    // Find polymorphic records that reference this parent
    const typeMappings = {
      'contacts': {
        'client': 'user_id', // For clients, contactable_id is user_id
        'landlord': 'landlord_id',
        'vendor': 'vendor_id',
        'pm_company': 'pmc_id',
        'property': 'property_id',
        'user': 'user_id'
      },
      'addresses': {
        'property': 'property_id',
        'landlord': 'landlord_id',
        'pm_company': 'pmc_id',
        'user': 'user_id'
      }
    };

    const mapping = typeMappings[polyChild.table];
    if (!mapping) continue;

    // Find the type that matches this table
    const matchingType = Object.entries(mapping).find(([type, idCol]) => idCol === parentIdColumn);
    if (!matchingType) continue;

    const [type, idCol] = matchingType;
    
    // Delete polymorphic children
    const { data: polyRecords } = await supabase
      .from(polyChild.table)
      .select(await getPrimaryKey(supabase, polyChild.table))
      .eq(polyChild.typeColumn, type)
      .eq(polyChild.idColumn, recordId);

    if (polyRecords) {
      const polyPrimaryKey = await getPrimaryKey(supabase, polyChild.table);
      for (const polyRecord of polyRecords) {
        await deleteRecordWithChildren(supabase, polyChild.table, polyRecord[polyPrimaryKey], relationships, deleted);
      }
    }
  }

  // Finally, delete the record itself
  await supabase
    .from(tableName)
    .delete()
    .eq(primaryKey, recordId);
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Initialize Supabase client with service role key (bypasses RLS)
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    if (req.method === 'GET') {
      const { type = 'all' } = req.query;
      const orphanedRecords = [];

      if (type === 'all') {
        const found = await findAllOrphanedRecords(supabase);
        orphanedRecords.push(...found);
      } else if (type === 'documents') {
        // For documents, we can still use a focused check
        const relationships = await discoverForeignKeys(supabase);
        await findOrphanedRecordsForTable(supabase, 'documents', relationships, orphanedRecords);
      }

      // Deduplicate by table and id
      const uniqueRecords = Array.from(
        new Map(orphanedRecords.map(r => [`${r.table}-${r.id}`, r])).values()
      );

      return res.status(200).json({
        success: true,
        records: uniqueRecords,
        count: uniqueRecords.length
      });

    } else if (req.method === 'DELETE') {
      const { records } = req.body;

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'records array is required'
        });
      }

      const deleted = [];
      const errors = [];
      const relationships = await discoverForeignKeys(supabase);
      const deletedSet = new Set();

      for (const record of records) {
        try {
          // Delete storage file if it exists (for documents)
          if (record.storage_path) {
            await supabase.storage
              .from('documents')
              .remove([record.storage_path]);
          }

          // For orphaned users, delete directly without recursive check (much faster)
          // Orphaned users have no relationships, so we can skip the expensive recursive deletion
          if (record.table === 'users') {
            const primaryKey = await getPrimaryKey(supabase, 'users');
            const { error: deleteError } = await supabase
              .from('users')
              .delete()
              .eq(primaryKey, record.id);
            
            if (deleteError) {
              throw new Error(deleteError.message);
            }
            deleted.push(record.id);
          } else {
            // For other records, use recursive deletion
            await deleteRecordWithChildren(supabase, record.table, record.id, relationships, deletedSet);
            deleted.push(record.id);
          }
        } catch (error) {
          errors.push({ record, error: error.message });
        }
      }

      return res.status(200).json({
        success: errors.length === 0,
        deleted_count: deleted.length,
        deleted_ids: deleted,
        errors: errors.length > 0 ? errors : undefined
      });
    }

  } catch (error) {
    console.error('Error in orphaned-records:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
