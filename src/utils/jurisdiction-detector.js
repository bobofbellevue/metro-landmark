/**
 * Jurisdiction Detection Utility
 * Resolves a property to a jurisdiction pack id (washington_state, seattle, …).
 */

import {
  DEFAULT_JURISDICTION_PACK_ID,
  detectJurisdictionPackId,
  getJurisdictionDisplayName as packDisplayName,
} from '../jurisdictions/index.js';

/**
 * Detect jurisdiction from property data
 * @param {Object} property - Property object with city_of_jurisdiction or address
 * @returns {string} - pack id ('seattle', 'washington_state', …)
 */
export function detectJurisdiction(property) {
  return detectJurisdictionPackId(property);
}

/**
 * Detect jurisdiction from property ID (fetches property from database)
 * @param {number} propertyId - Property ID
 * @param {Object} supabaseClient - Optional Supabase client (uses default if not provided)
 * @returns {Promise<string>} - pack id
 */
export async function detectJurisdictionFromPropertyId(propertyId, supabaseClient = null) {
  if (!propertyId) {
    return DEFAULT_JURISDICTION_PACK_ID;
  }

  try {
    let client = supabaseClient;
    if (!client) {
      // Lazy import so unit tests of packs/calculator do not require VITE_* env.
      const { supabase } = await import('../lib/supabase.js');
      client = supabase;
    }

    const { data: property, error } = await client
      .from('properties')
      .select('city_of_jurisdiction, address')
      .eq('property_id', propertyId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching property for jurisdiction detection:', error);
      return DEFAULT_JURISDICTION_PACK_ID;
    }

    if (!property) {
      return DEFAULT_JURISDICTION_PACK_ID;
    }

    return detectJurisdiction(property);
  } catch (error) {
    console.error('Error in detectJurisdictionFromPropertyId:', error);
    return DEFAULT_JURISDICTION_PACK_ID;
  }
}

/**
 * Get jurisdiction display name
 * @param {string} jurisdiction - Jurisdiction / pack id
 * @returns {string} - Display name
 */
export function getJurisdictionDisplayName(jurisdiction) {
  return packDisplayName(jurisdiction);
}

/**
 * Check if jurisdiction is Seattle
 * @param {string} jurisdiction - Jurisdiction code
 * @returns {boolean}
 */
export function isSeattle(jurisdiction) {
  return jurisdiction === 'seattle';
}
