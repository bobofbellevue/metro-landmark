/**
 * Audit Helper Functions
 * 
 * These functions wrap Supabase operations to ensure user_id is captured in audit logs
 * by using RPC functions that set session variables before executing database operations.
 */

import { supabase } from './supabase.js';

/**
 * Wrapper for Supabase insert that captures user_id in audit logs
 * @param {string} table - Table name
 * @param {array} data - Array of objects to insert
 * @param {number} userId - Current user ID
 * @returns {Promise} Supabase response with data and error
 */
export async function insertWithAudit(table, data, userId) {
    if (!data || data.length === 0) {
        return { data: null, error: { message: 'No data to insert' } };
    }
    
    // For single record, use RPC function
    if (data.length === 1) {
        try {
            const { data: result, error } = await supabase.rpc('insert_with_audit', {
                p_table_name: table,
                p_data: data[0],
                p_user_id: userId
            });
            return { data: result ? [result] : null, error };
        } catch (error) {
            return { data: null, error };
        }
    }
    
    // For multiple records, insert one by one with audit
    const results = [];
    const errors = [];
    for (const record of data) {
        const { data: result, error } = await supabase.rpc('insert_with_audit', {
            p_table_name: table,
            p_data: record,
            p_user_id: userId
        });
        if (error) {
            errors.push(error);
        } else if (result) {
            results.push(result);
        }
    }
    
    return { 
        data: results.length > 0 ? results : null, 
        error: errors.length > 0 ? errors[0] : null 
    };
}

/**
 * Wrapper for Supabase update that captures user_id in audit logs
 * @param {string} table - Table name
 * @param {object} data - Data to update
 * @param {string} column - Column to match on
 * @param {any} value - Value to match
 * @param {number} userId - Current user ID
 * @returns {Promise} Supabase response
 */
export async function updateWithAudit(table, data, column, value, userId) {
    // Get the record ID first if needed
    let recordId = value;
    
    // If column is not the primary key, we need to find the record
    const pkColumns = {
        'pm_companies': 'pmc_id',
        'users': 'user_id',
        'landlords': 'landlord_id',
        'properties': 'property_id',
        'units': 'unit_id',
        'clients': 'client_id',
        'vendors': 'vendor_id',
        'leases': 'lease_id',
        'maintenance_requests': 'request_id',
        'templates': 'template_id',
        'client_applications': 'application_id',
        'addresses': 'address_id',
        'contacts': 'contact_id',
        'contact_methods': 'method_id'
    };
    
    const pkColumn = pkColumns[table] || 'id';
    
    // If the column is not the primary key, fetch the record ID
    if (column !== pkColumn) {
        const { data: records } = await supabase
            .from(table)
            .select(pkColumn)
            .eq(column, value)
            .limit(1);
        
        if (!records || records.length === 0) {
            return { data: null, error: { message: 'Record not found' } };
        }
        recordId = records[0][pkColumn];
    }
    
    try {
        const { data: result, error } = await supabase.rpc('update_with_audit', {
            p_table_name: table,
            p_record_id: recordId,
            p_data: data,
            p_user_id: userId
        });
        return { data: result ? [result] : null, error };
    } catch (error) {
        return { data: null, error };
    }
}

/**
 * Wrapper for Supabase delete that captures user_id in audit logs
 * @param {string} table - Table name
 * @param {string} column - Column to match on
 * @param {any} value - Value to match
 * @param {number} userId - Current user ID
 * @returns {Promise} Supabase response
 */
export async function deleteWithAudit(table, column, value, userId) {
    // Get the record ID first
    const pkColumns = {
        'pm_companies': 'pmc_id',
        'users': 'user_id',
        'landlords': 'landlord_id',
        'properties': 'property_id',
        'units': 'unit_id',
        'clients': 'client_id',
        'vendors': 'vendor_id',
        'leases': 'lease_id',
        'maintenance_requests': 'request_id',
        'templates': 'template_id',
        'client_applications': 'application_id',
        'addresses': 'address_id',
        'contacts': 'contact_id',
        'contact_methods': 'method_id'
    };
    
    const pkColumn = pkColumns[table] || 'id';
    let recordId = value;
    
    // If the column is not the primary key, fetch the record ID
    if (column !== pkColumn) {
        const { data: records } = await supabase
            .from(table)
            .select(pkColumn)
            .eq(column, value)
            .limit(1);
        
        if (!records || records.length === 0) {
            return { data: null, error: { message: 'Record not found' } };
        }
        recordId = records[0][pkColumn];
    }
    
    try {
        const { error } = await supabase.rpc('delete_with_audit', {
            p_table_name: table,
            p_record_id: recordId,
            p_user_id: userId
        });
        return { data: null, error };
    } catch (error) {
        return { data: null, error };
    }
}

