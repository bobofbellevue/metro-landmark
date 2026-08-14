/**
 * Policy Retrieval Utility with Inheritance
 * Retrieves applicable policies with proper inheritance chain resolution
 */

import { supabase } from '../lib/supabase.js';

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
 * Get applicable policy with inheritance chain
 * @param {string} policyType - Type of policy (e.g., 'applicant_screening', 'rent_increase')
 * @param {Object} context - Context object
 * @param {number} context.propertyId - Property ID (optional)
 * @param {number} context.landlordId - Landlord ID (optional)
 * @param {number} context.pmcId - PM Company ID (optional)
 * @param {Object} context.supabase - Supabase client (optional, uses default if not provided)
 * @returns {Promise<Object|null>} - Merged policy with inheritance chain, or null if not found
 */
export async function getApplicablePolicy(policyType, context = {}) {
  const { propertyId, landlordId, pmcId } = context;
  const client = context.supabase || supabase;

  // Try to find policy at each level, starting from most specific
  let policy = null;
  let level = null;
  const inheritanceChain = [];

  // 1. Property level
  if (propertyId) {
    const { data, error } = await client
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'property')
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      policy = data;
      level = 'property';
      inheritanceChain.push('property');
    }
  }

  // 2. Landlord level
  if (!policy && landlordId) {
    const { data, error } = await client
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'landlord')
      .eq('landlord_id', landlordId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      policy = data;
      level = 'landlord';
      inheritanceChain.push('landlord');
    }
  }

  // 3. Company level
  if (!policy && pmcId) {
    const { data, error } = await client
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'company')
      .eq('pmc_id', pmcId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      policy = data;
      level = 'company';
      inheritanceChain.push('company');
    }
  }

  // 4. System level (fallback)
  if (!policy) {
    const { data, error } = await client
      .from('compliance_policies')
      .select('*')
      .eq('policy_type', policyType)
      .eq('policy_level', 'system')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      policy = data;
      level = 'system';
      inheritanceChain.push('system');
    }
  }

  if (!policy) {
    return null;
  }

  // Build inheritance chain and merge
  let mergedPolicyData = policy.policy_data || {};
  let currentPolicy = policy;

  // Follow explicit inheritance chain (inherits_from_policy_id)
  while (currentPolicy.inherits_from_policy_id) {
    const { data: parentPolicy, error } = await client
      .from('compliance_policies')
      .select('*')
      .eq('policy_id', currentPolicy.inherits_from_policy_id)
      .maybeSingle();

    if (!error && parentPolicy) {
      const parentData = parentPolicy.policy_data || {};
      mergedPolicyData = mergePolicyData(
        mergedPolicyData,
        parentData,
        currentPolicy.inheritance_mode || 'extend'
      );
      inheritanceChain.push(parentPolicy.policy_level);
      currentPolicy = parentPolicy;
    } else {
      break;
    }
  }

  // If no explicit inheritance, build implicit chain based on hierarchy
  if (!currentPolicy.inherits_from_policy_id) {
    // For property level, also check landlord, company, system
    if (level === 'property' && landlordId) {
      const { data: landlordPolicy } = await client
        .from('compliance_policies')
        .select('*')
        .eq('policy_type', policyType)
        .eq('policy_level', 'landlord')
        .eq('landlord_id', landlordId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (landlordPolicy) {
        mergedPolicyData = mergePolicyData(
          mergedPolicyData,
          landlordPolicy.policy_data || {},
          'extend'
        );
        if (!inheritanceChain.includes('landlord')) {
          inheritanceChain.push('landlord');
        }
      }
    }

    // For property or landlord level, check company
    if ((level === 'property' || level === 'landlord') && pmcId) {
      const { data: companyPolicy } = await client
        .from('compliance_policies')
        .select('*')
        .eq('policy_type', policyType)
        .eq('policy_level', 'company')
        .eq('pmc_id', pmcId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (companyPolicy) {
        mergedPolicyData = mergePolicyData(
          mergedPolicyData,
          companyPolicy.policy_data || {},
          'extend'
        );
        if (!inheritanceChain.includes('company')) {
          inheritanceChain.push('company');
        }
      }
    }

    // Always check system level as final fallback
    if (level !== 'system') {
      const { data: systemPolicy } = await client
        .from('compliance_policies')
        .select('*')
        .eq('policy_type', policyType)
        .eq('policy_level', 'system')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (systemPolicy) {
        mergedPolicyData = mergePolicyData(
          mergedPolicyData,
          systemPolicy.policy_data || {},
          'extend'
        );
        if (!inheritanceChain.includes('system')) {
          inheritanceChain.push('system');
        }
      }
    }
  }

  return {
    ...policy,
    policy_data: mergedPolicyData,
    effective_level: level,
    inheritance_chain: inheritanceChain
  };
}

