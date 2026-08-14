/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Evaluate rule condition against action data
 * @param {Object} condition - Rule condition JSONB
 * @param {Object} actionData - Action data to validate
 * @returns {boolean} - True if condition matches
 */
function evaluateCondition(condition, actionData) {
  // Simple condition evaluation
  // Supports: { field: 'value' } or { field: { operator: 'gt', value: 10 } }
  for (const [key, value] of Object.entries(condition)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Complex condition with operator
      const { operator, value: conditionValue } = value;
      const actionValue = actionData[key];

      switch (operator) {
        case 'gt':
          if (!(actionValue > conditionValue)) return false;
          break;
        case 'gte':
          if (!(actionValue >= conditionValue)) return false;
          break;
        case 'lt':
          if (!(actionValue < conditionValue)) return false;
          break;
        case 'lte':
          if (!(actionValue <= conditionValue)) return false;
          break;
        case 'eq':
          if (actionValue !== conditionValue) return false;
          break;
        case 'ne':
          if (actionValue === conditionValue) return false;
          break;
        default:
          if (actionValue !== conditionValue) return false;
      }
    } else {
      // Simple equality check
      if (actionData[key] !== value) return false;
    }
  }
  return true;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { action, jurisdiction, actionData } = req.body;

    if (!action || !jurisdiction) {
      return res.status(400).json({
        success: false,
        error: 'action and jurisdiction are required'
      });
    }

    // Get applicable rules
    let query = supabase
      .from('compliance_rules')
      .select('*')
      .eq('jurisdiction', jurisdiction)
      .eq('applies_to', action)
      .eq('is_active', true);

    // Filter by effective/expiration dates
    const today = new Date().toISOString().split('T')[0];
    query = query.or(`effective_date.is.null,effective_date.lte.${today}`);
    query = query.or(`expiration_date.is.null,expiration_date.gte.${today}`);

    const { data: rules, error } = await query;

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const errors = [];
    const warnings = [];
    let valid = true;

    // Evaluate each rule
    for (const rule of rules || []) {
      // Check if condition matches
      if (rule.rule_condition && Object.keys(rule.rule_condition).length > 0) {
        if (!evaluateCondition(rule.rule_condition, actionData || {})) {
          continue; // Condition doesn't match, skip this rule
        }
      }

      // Check if action is prohibited
      if (rule.prohibited) {
        valid = false;
        errors.push({
          rule: rule.rule_name,
          message: rule.rule_action,
          source: rule.source
        });
      } else if (rule.rule_type === 'required_disclosure') {
        warnings.push({
          rule: rule.rule_name,
          message: rule.rule_action,
          source: rule.source
        });
      } else if (rule.rule_type === 'notice_period') {
        // Notice period validation would be handled separately
        warnings.push({
          rule: rule.rule_name,
          message: `Required notice period: ${rule.notice_period_days} days`,
          source: rule.source
        });
      }
    }

    return res.status(200).json({
      success: true,
      valid,
      errors,
      warnings,
      rules_applied: rules?.length || 0
    });
  } catch (error) {
    console.error('Compliance validation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

