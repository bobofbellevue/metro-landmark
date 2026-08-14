/**
 * Compliance Rules Engine
 * Validates actions against Washington State and Seattle regulations
 */

/**
 * Get applicable compliance rules
 * @param {Object} params - Rule parameters
 * @param {string} params.jurisdiction - 'seattle' or 'washington_state'
 * @param {string} params.appliesTo - 'rent_increase', 'eviction', 'deposit', etc.
 * @param {Object} params.context - Additional context (lease type, etc.)
 * @returns {Promise<Array>} - Array of applicable rules
 */
export async function getApplicableRules({ jurisdiction, appliesTo, context = {} }) {
  try {
    const response = await fetch(
      `/api/compliance/rules?jurisdiction=${jurisdiction}&applies_to=${appliesTo}`
    );
    if (!response.ok) {
      throw new Error('Failed to fetch compliance rules');
    }
    const data = await response.json();
    return data.rules || [];
  } catch (error) {
    console.error('Error fetching compliance rules:', error);
    return [];
  }
}

/**
 * Validate an action against compliance rules
 * @param {Object} params - Validation parameters
 * @param {string} params.action - Action type ('rent_increase', 'eviction', etc.)
 * @param {string} params.jurisdiction - 'seattle' or 'washington_state'
 * @param {Object} params.actionData - Data about the action
 * @returns {Promise<Object>} - Validation result
 */
export async function validateAction({ action, jurisdiction, actionData }) {
  try {
    const response = await fetch('/api/compliance/rules/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, jurisdiction, actionData })
    });
    if (!response.ok) {
      throw new Error('Failed to validate action');
    }
    return await response.json();
  } catch (error) {
    console.error('Error validating action:', error);
    return {
      valid: false,
      errors: [error.message],
      warnings: []
    };
  }
}

/**
 * Check if an action is prohibited
 * @param {string} action - Action type
 * @param {string} jurisdiction - 'seattle' or 'washington_state'
 * @param {Object} context - Additional context
 * @returns {Promise<boolean>} - True if prohibited
 */
export async function isActionProhibited(action, jurisdiction, context = {}) {
  const rules = await getApplicableRules({
    jurisdiction,
    appliesTo: action,
    context
  });

  return rules.some(rule => rule.prohibited === true && rule.is_active === true);
}

/**
 * Get required disclosures for an action
 * @param {string} action - Action type
 * @param {string} jurisdiction - 'seattle' or 'washington_state'
 * @returns {Promise<Array>} - Array of required disclosures
 */
export async function getRequiredDisclosures(action, jurisdiction) {
  const rules = await getApplicableRules({
    jurisdiction,
    appliesTo: action
  });

  return rules
    .filter(rule => rule.rule_type === 'required_disclosure' && rule.is_active)
    .map(rule => ({
      title: rule.rule_name,
      description: rule.rule_action,
      source: rule.source
    }));
}

/**
 * Get notice period requirement from rules
 * @param {string} action - Action type
 * @param {string} jurisdiction - 'seattle' or 'washington_state'
 * @param {Object} context - Additional context
 * @returns {Promise<number|null>} - Required notice period in days, or null if not specified
 */
export async function getNoticePeriodFromRules(action, jurisdiction, context = {}) {
  const rules = await getApplicableRules({
    jurisdiction,
    appliesTo: action,
    context
  });

  const noticeRule = rules.find(
    rule => rule.rule_type === 'notice_period' && rule.is_active
  );

  return noticeRule?.notice_period_days || null;
}

