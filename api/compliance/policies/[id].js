/* eslint-env node */
import { createSupabaseClient } from '../../utils/supabase-client.js';

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

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Database configuration error',
    });
  }

  try {
    const { method } = req;
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Policy ID required' });
    }

    // GET /api/compliance/policies/:id or /api/compliance/policies/:id?merged=true
    if (method === 'GET') {
      // Special endpoint: /api/compliance/policies/:id?merged=true (get with full inheritance)
      if (req.query.merged === 'true') {
        const { data: policy, error } = await supabase
          .from('compliance_policies')
          .select('*')
          .eq('policy_id', id)
          .single();

        if (error) {
          return res.status(404).json({ success: false, error: error.message });
        }

        // Build full inheritance chain
        let mergedPolicy = { ...policy };
        let currentPolicy = policy;
        const inheritanceChain = [policy.policy_level];

        while (currentPolicy.inherits_from_policy_id) {
          const { data: parentPolicy } = await supabase
            .from('compliance_policies')
            .select('*')
            .eq('policy_id', currentPolicy.inherits_from_policy_id)
            .single();

          if (parentPolicy) {
            mergedPolicy.policy_data = mergePolicyData(
              mergedPolicy.policy_data,
              parentPolicy.policy_data,
              currentPolicy.inheritance_mode || 'extend'
            );
            inheritanceChain.push(parentPolicy.policy_level);
            currentPolicy = parentPolicy;
          } else {
            break;
          }
        }

        return res.status(200).json({
          success: true,
          policy: {
            ...mergedPolicy,
            inheritance_chain: inheritanceChain
          }
        });
      }

      // Get single policy
      const { data, error } = await supabase
        .from('compliance_policies')
        .select('*')
        .eq('policy_id', id)
        .single();

      if (error) {
        return res.status(404).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true, policy: data });
    }

    // PUT /api/compliance/policies/:id
    if (method === 'PUT') {
      const {
        policy_name,
        description,
        is_default,
        is_active,
        policy_data,
        inheritance_mode,
        version
      } = req.body;

      const updateData = {};
      if (policy_name !== undefined) updateData.policy_name = policy_name;
      if (description !== undefined) updateData.description = description;
      if (is_default !== undefined) updateData.is_default = is_default;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (policy_data !== undefined) updateData.policy_data = policy_data;
      if (inheritance_mode !== undefined) updateData.inheritance_mode = inheritance_mode;
      if (version !== undefined) updateData.version = version;

      const { data, error } = await supabase
        .from('compliance_policies')
        .update(updateData)
        .eq('policy_id', id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true, policy: data });
    }

    // DELETE /api/compliance/policies/:id
    if (method === 'DELETE') {
      const { error } = await supabase
        .from('compliance_policies')
        .delete()
        .eq('policy_id', id);

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true });
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
