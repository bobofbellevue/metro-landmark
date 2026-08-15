/* eslint-env node */
import { createSupabaseClient } from '../utils/supabase-client.js';

function getSupabase() {
  return createSupabaseClient();
}

/**
 * Merge policy data with inheritance
 * @param {Object} childPolicy - Child policy data
 * @param {Object} parentPolicy - Parent policy data
 * @param {string} inheritanceMode - 'extend' or 'replace'
 * @returns {Object} - Merged policy data
 */
function mergePolicyData(childPolicy, parentPolicy, inheritanceMode) {
  if (inheritanceMode === 'replace') {
    return childPolicy;
  }

  // Extend mode: merge sections, with child overriding parent fields
  const merged = { ...parentPolicy };
  
  if (childPolicy.sections) {
    merged.sections = childPolicy.sections.map(childSection => {
      const parentSection = parentPolicy.sections?.find(
        s => s.section_id === childSection.section_id
      );

      if (parentSection) {
        // Merge fields, child overriding parent
        const mergedFields = parentSection.fields.map(parentField => {
          const childField = childSection.fields?.find(
            f => f.field_id === parentField.field_id
          );
          return childField || parentField;
        });

        // Add any new fields from child
        const newFields = childSection.fields?.filter(
          cf => !parentSection.fields.some(pf => pf.field_id === cf.field_id)
        ) || [];

        return {
          ...parentSection,
          ...childSection,
          fields: [...mergedFields, ...newFields]
        };
      }

      return childSection;
    });

    // Add any new sections from child
    const newSections = childPolicy.sections.filter(
      cs => !parentPolicy.sections?.some(ps => ps.section_id === cs.section_id)
    );
    merged.sections = [...merged.sections, ...newSections];
  }

  return merged;
}

/**
 * Get policy with inheritance chain
 * @param {string} policyType - Type of policy
 * @param {Object} context - Context (property_id, landlord_id, pmc_id)
 * @returns {Promise<Object>} - Merged policy
 */
async function getPolicyWithInheritance(policyType, context = {}) {
  const { property_id, landlord_id, pmc_id } = context;

  // Try to find policy at each level, starting from most specific
  let policy = null;
  let level = null;

  // 1. Property level
  if (property_id) {
    const { data } = await getSupabase()
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'property')
      .eq('property_id', property_id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      policy = data;
      level = 'property';
    }
  }

  // 2. Landlord level
  if (!policy && landlord_id) {
    const { data } = await getSupabase()
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'landlord')
      .eq('landlord_id', landlord_id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      policy = data;
      level = 'landlord';
    }
  }

  // 3. Company level
  if (!policy && pmc_id) {
    const { data } = await getSupabase()
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'company')
      .eq('pmc_id', pmc_id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      policy = data;
      level = 'company';
    }
  }

  // 4. System level (fallback)
  if (!policy) {
    const { data } = await getSupabase()
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'system')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      policy = data;
      level = 'system';
    }
  }

  if (!policy) {
    return null;
  }

  // Build inheritance chain and merge
  let mergedPolicy = { ...policy };
  let currentPolicy = policy;

  while (currentPolicy.inherits_from_policy_id) {
    const { data: parentPolicy } = await getSupabase()
      .from('compliance_policies')
      .select('*')
      .eq('policy_id', currentPolicy.inherits_from_policy_id)
      .single();

    if (parentPolicy) {
      mergedPolicy = mergePolicyData(
        mergedPolicy.policy_data,
        parentPolicy.policy_data,
        currentPolicy.inheritance_mode || 'extend'
      );
      currentPolicy = parentPolicy;
    } else {
      break;
    }
  }

  return {
    ...policy,
    policy_data: mergedPolicy,
    effective_level: level,
    inheritance_chain: [level]
  };
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Database configuration error',
    });
  }

  try {
    const { method } = req;
    const { id } = req.query;

    // GET /api/compliance/policies or /api/compliance/policies/:id
    if (method === 'GET') {
      // Special endpoint: /api/compliance/policies?type=X&property_id=Y (get with inheritance)
      if (req.query.type && (req.query.property_id || req.query.landlord_id || req.query.pmc_id)) {
        const policy = await getPolicyWithInheritance(req.query.type, {
          property_id: req.query.property_id,
          landlord_id: req.query.landlord_id,
          pmc_id: req.query.pmc_id
        });

        if (!policy) {
          return res.status(404).json({
            success: false,
            error: 'No policy found for the specified criteria'
          });
        }

        return res.status(200).json({ success: true, policy });
      }

      // List policies with filters (no id means list all)
      {
        // List policies with filters
        const { policy_type, policy_level, pmc_id, landlord_id, property_id } = req.query;
        let query = supabase
          .from('compliance_policies')
          .select('*')
          .order('created_at', { ascending: false });

        if (policy_type) query = query.eq('policy_type', policy_type);
        if (policy_level) query = query.eq('policy_level', policy_level);
        if (pmc_id) query = query.eq('pmc_id', pmc_id);
        if (landlord_id) query = query.eq('landlord_id', landlord_id);
        if (property_id) query = query.eq('property_id', property_id);

        const { data, error } = await query;

        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, policies: data || [] });
      }
    }

    // POST /api/compliance/policies
    if (method === 'POST') {
      const {
        policy_type,
        policy_level,
        pmc_id,
        landlord_id,
        property_id,
        policy_name,
        description,
        is_default,
        policy_data,
        inherits_from_policy_id,
        inheritance_mode,
        template_id,
        created_by_user_id
      } = req.body;

      if (!policy_type || !policy_level || !policy_name || !policy_data) {
        return res.status(400).json({
          success: false,
          error: 'policy_type, policy_level, policy_name, and policy_data are required'
        });
      }

      // Validate level constraints
      if (policy_level === 'system' && (pmc_id || landlord_id || property_id)) {
        return res.status(400).json({
          success: false,
          error: 'System-level policies cannot have pmc_id, landlord_id, or property_id'
        });
      }
      if (policy_level === 'company' && (!pmc_id || landlord_id || property_id)) {
        return res.status(400).json({
          success: false,
          error: 'Company-level policies must have pmc_id and cannot have landlord_id or property_id'
        });
      }
      if (policy_level === 'landlord' && (!landlord_id || property_id)) {
        return res.status(400).json({
          success: false,
          error: 'Landlord-level policies must have landlord_id and cannot have property_id'
        });
      }
      if (policy_level === 'property' && !property_id) {
        return res.status(400).json({
          success: false,
          error: 'Property-level policies must have property_id'
        });
      }

      const { data, error } = await supabase
        .from('compliance_policies')
        .insert({
          policy_type,
          policy_level,
          pmc_id: pmc_id || null,
          landlord_id: landlord_id || null,
          property_id: property_id || null,
          policy_name,
          description: description || null,
          is_default: is_default || false,
          is_active: true,
          policy_data,
          inherits_from_policy_id: inherits_from_policy_id || null,
          inheritance_mode: inheritance_mode || 'extend',
          template_id: template_id || null,
          created_by_user_id: created_by_user_id || null,
          version: 1
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(201).json({ success: true, policy: data });
    }


    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Compliance policies API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

