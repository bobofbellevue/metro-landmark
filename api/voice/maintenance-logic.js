/**
 * Shared Maintenance Logic
 * 
 * Extracted from maintenance-chat.js for reuse by both text and voice bots
 */

import OpenAI from 'openai';
import { normalizeAddressString, createAddressSearchString } from '../utils/address-normalizer.js';

/**
 * Expands directional abbreviations to full words for proper speech pronunciation.
 * Handles: N, S, E, W, NE, NW, SE, SW
 * Example: "138th Avenue NE" -> "138th Avenue Northeast"
 */
function expandDirectionalsForSpeech(text) {
  if (!text) return text;
  
  // Use word boundaries to match whole words only
  // Match standalone directional abbreviations (case-insensitive)
  return text
    .replace(/\bNE\b/gi, 'Northeast')
    .replace(/\bNW\b/gi, 'Northwest')
    .replace(/\bSE\b/gi, 'Southeast')
    .replace(/\bSW\b/gi, 'Southwest')
    .replace(/\bN\b/gi, 'North')
    .replace(/\bS\b/gi, 'South')
    .replace(/\bE\b/gi, 'East')
    .replace(/\bW\b/gi, 'West');
}

/**
 * Fuzzy name matching - handles variations like "Jimmy" vs "James", "Tennant" vs "Tenant"
 * Returns a similarity score between 0 and 1
 */
function fuzzyNameMatch(name1, name2) {
  if (!name1 || !name2) return 0;
  
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();
  
  // Exact match
  if (n1 === n2) return 1.0;
  
  // One contains the other (handles "Jimmy" vs "James")
  if (n1.includes(n2) || n2.includes(n1)) return 0.8;
  
  // Levenshtein distance for similar names
  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(n1, n2);
  return 1 - (distance / maxLen);
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}

/**
 * Parse date from spoken text (handles "May 15th 1990", "5/15/1990", "05-15-1990", etc.)
 * Returns date string in YYYY-MM-DD format or null if can't parse
 */
function parseSpokenDate(dateText) {
  if (!dateText) return null;
  
  // Try to extract date components
  const text = dateText.toLowerCase().trim();
  
  // Month names
  const months = {
    'january': 1, 'jan': 1,
    'february': 2, 'feb': 2,
    'march': 3, 'mar': 3,
    'april': 4, 'apr': 4,
    'may': 5,
    'june': 6, 'jun': 6,
    'july': 7, 'jul': 7,
    'august': 8, 'aug': 8,
    'september': 9, 'sep': 9, 'sept': 9,
    'october': 10, 'oct': 10,
    'november': 11, 'nov': 11,
    'december': 12, 'dec': 12
  };
  
  // Try MM/DD/YYYY or MM-DD-YYYY format first
  const numericMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (numericMatch) {
    let month = parseInt(numericMatch[1]);
    let day = parseInt(numericMatch[2]);
    let year = parseInt(numericMatch[3]);
    
    // Handle 2-digit years
    if (year < 100) {
      year = year < 50 ? 2000 + year : 1900 + year;
    }
    
    // Validate date
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      try {
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      } catch {
        // Invalid date
      }
    }
  }
  
  // Try "Month Day Year" format (e.g., "May 15 1990", "May 15th 1990", "September 1, 1989")
  for (const [monthName, monthNum] of Object.entries(months)) {
    // Allow for comma after day: "September 1, 1989" or "May 15, 1990"
    const regex = new RegExp(`${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})`, 'i');
    const match = text.match(regex);
    if (match) {
      const day = parseInt(match[1]);
      const year = parseInt(match[2]);
      if (day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
        try {
          const date = new Date(year, monthNum - 1, day);
          if (date.getFullYear() === year && date.getMonth() === monthNum - 1 && date.getDate() === day) {
            return `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          }
        } catch {
          // Invalid date
        }
      }
    }
  }
  
  return null;
}

/**
 * Get user's active unit information
 * Checks client_units (assignments) first, then falls back to leases
 * Assignments are required, leases are optional
 */
export async function getUserUnitInfo(supabase, userId) {
  try {
    // First, get the client_id from the user_id
    // Only look for tenants - applicants and other client types should not have access to maintenance bot
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('client_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (clientError) {
      console.log('[getUserUnitInfo] Error querying clients table for user_id:', userId, 'Error:', clientError);
      // Fall through to lease check
    } else if (!client?.client_id) {
      console.log('[getUserUnitInfo] No tenant client found for user_id:', userId, {
        userId,
        hasClientError: !!clientError,
        clientError: clientError?.message,
        clientData: client
      });
      // Fall through to lease check
    } else {
      console.log('[getUserUnitInfo] Found tenant client:', {
        userId,
        clientId: client.client_id
      });
      // Check client_units for active assignments (not archived)
      // Fetch unit_id first, then fetch unit separately (Supabase doesn't recognize the FK relationship)
      const { data: clientUnit, error: clientUnitError } = await supabase
        .from('client_units')
        .select('unit_id')
        .eq('client_id', client.client_id)
        .is('is_archived', false)
        .limit(1)
        .maybeSingle();

      if (clientUnitError) {
        console.log('[getUserUnitInfo] Error querying client_units for client_id:', client.client_id, 'Error:', clientUnitError);
      } else if (!clientUnit?.unit_id) {
        console.log('[getUserUnitInfo] No active client_units assignment found:', {
          userId,
          clientId: client.client_id,
          hasClientUnitError: !!clientUnitError,
          clientUnitError: clientUnitError?.message,
          clientUnitData: clientUnit
        });
      } else {
        // Fetch unit details with property name
        const { data: unit, error: unitError } = await supabase
          .from('units')
          .select(`
            unit_id,
            unit_number,
            property_id,
            properties!inner(
              property_id,
              property_name
            )
          `)
          .eq('unit_id', clientUnit.unit_id)
          .single();

        if (unitError || !unit) {
          console.log('[getUserUnitInfo] Error fetching unit details for unit_id:', clientUnit.unit_id, 'Error:', unitError);
        } else {
          // Format unit display: "unit_number at property_name"
          // Replace "#" with "number" for proper pronunciation (e.g., "#201" -> "number 201")
          // Expand directional abbreviations for proper speech (e.g., "NE" -> "Northeast")
          let unitNumber = unit.unit_number || 'Unknown Unit';
          const unitNumberBefore = unitNumber;
          unitNumber = unitNumber.replace(/#/g, 'number ');
          let propertyName = unit.properties?.property_name || 'Unknown Property';
          const propertyNameBefore = propertyName;
          // Replace "#" with "number" BEFORE expanding directionals (property_name might contain "#201" from address_line_2)
          propertyName = propertyName.replace(/#/g, 'number ');
          propertyName = expandDirectionalsForSpeech(propertyName);
          const unitDisplay = `${unitNumber} at ${propertyName}`;
          
          console.log('[getUserUnitInfo] Found unit from client_units assignment:', {
            userId,
            clientId: client.client_id,
            unitId: unit.unit_id,
            propertyId: unit.property_id,
            unitNumber: unit.unit_number,
            unitNumberBefore,
            unitNumberAfter: unitNumber,
            propertyNameBefore,
            propertyNameAfter: propertyName,
            unitDisplay,
            hasHashInUnitNumber: unitNumberBefore.includes('#'),
            hasHashInPropertyName: propertyNameBefore.includes('#'),
            note: 'unitId is the database unit_id, NOT the unit_number'
          });
          
          // Validate that unit_id is actually a number and not the unit_number
          if (unit.unit_id === parseInt(unit.unit_number)) {
            console.error('[getUserUnitInfo] WARNING: unit_id matches unit_number - this may indicate a data issue:', {
              unit_id: unit.unit_id,
              unit_number: unit.unit_number
            });
          }
          
          return {
            unitId: unit.unit_id,
            propertyId: unit.property_id,
            unitDisplay
          };
        }
      }
    }

    // Fall back to checking active leases
    // lease_clients uses client_id, not user_id, so we need to use the client we found earlier
    // If we didn't find a client, we can't check leases
    if (!client?.client_id) {
      console.log('[getUserUnitInfo] Skipping lease check - no client_id available');
    } else {
      const { data: activeLease, error: leaseError } = await supabase
        .from('lease_clients')
        .select('leases!inner(unit_id, status, units!inner(property_id))')
        .eq('client_id', client.client_id)
        .eq('leases.status', 'active')
        .limit(1)
        .maybeSingle();

      if (leaseError) {
        console.log('[getUserUnitInfo] Error querying leases for client_id:', client.client_id, 'Error:', leaseError);
      } else if (activeLease?.leases) {
        // Fetch full unit details with property name for lease
        const { data: unit, error: unitError } = await supabase
          .from('units')
          .select(`
            unit_id,
            unit_number,
            property_id,
            properties!inner(
              property_id,
              property_name
            )
          `)
          .eq('unit_id', activeLease.leases.unit_id)
          .single();

        if (!unitError && unit) {
          // Format unit display: "unit_number at property_name"
          // Replace "#" with "number" for proper pronunciation (e.g., "#201" -> "number 201")
          // Expand directional abbreviations for proper speech (e.g., "NE" -> "Northeast")
          let unitNumber = unit.unit_number || 'Unknown Unit';
          const unitNumberBefore = unitNumber;
          unitNumber = unitNumber.replace(/#/g, 'number ');
          let propertyName = unit.properties?.property_name || 'Unknown Property';
          const propertyNameBefore = propertyName;
          // Replace "#" with "number" BEFORE expanding directionals (property_name might contain "#201" from address_line_2)
          propertyName = propertyName.replace(/#/g, 'number ');
          propertyName = expandDirectionalsForSpeech(propertyName);
          const unitDisplay = `${unitNumber} at ${propertyName}`;
          
          console.log('[getUserUnitInfo] Found unit from lease:', {
            userId,
            clientId: client.client_id,
            unitId: activeLease.leases.unit_id,
            propertyId: activeLease.leases.units?.property_id,
            unitNumber: unit.unit_number,
            unitNumberBefore,
            unitNumberAfter: unitNumber,
            propertyNameBefore,
            propertyNameAfter: propertyName,
            unitDisplay,
            hasHashInUnitNumber: unitNumberBefore.includes('#'),
            hasHashInPropertyName: propertyNameBefore.includes('#'),
            hasHashInUnitDisplay: unitDisplay.includes('#')
          });
          return {
            unitId: activeLease.leases.unit_id,
            propertyId: activeLease.leases.units?.property_id,
            unitDisplay
          };
        } else {
          // Fallback if unit fetch fails
          console.log('[getUserUnitInfo] Found unit from lease (fallback):', {
            userId,
            clientId: client.client_id,
            unitId: activeLease.leases.unit_id,
            propertyId: activeLease.leases.units?.property_id
          });
          return {
            unitId: activeLease.leases.unit_id,
            propertyId: activeLease.leases.units?.property_id
          };
        }
      } else {
        console.log('[getUserUnitInfo] No active lease found:', {
          userId,
          clientId: client.client_id,
          hasLeaseError: !!leaseError,
          leaseError: leaseError?.message,
          leaseData: activeLease
        });
      }
    }

    console.log('[getUserUnitInfo] No unit found for user_id:', userId, '- checked both client_units assignments and active leases');
    return null;
  } catch (error) {
    console.error('[getUserUnitInfo] Error:', error);
    return null;
  }
}

/**
 * Get user_id for a unit by checking client_units (assignments) first, then leases
 * This is the preferred method since leases are optional but assignments are required
 */
export async function getUserIdForUnit(supabase, unitId) {
  try {
    // First check client_units for active assignments
    const { data: clientUnit, error: clientUnitError } = await supabase
      .from('client_units')
      .select('client_id')
      .eq('unit_id', unitId)
      .is('is_archived', false)
      .limit(1)
      .maybeSingle();

    if (!clientUnitError && clientUnit?.client_id) {
      // Get user_id from clients table
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('user_id')
        .eq('client_id', clientUnit.client_id)
        .maybeSingle();

      if (!clientError && client?.user_id) {
        console.log('[getUserIdForUnit] Found user_id from client_units:', client.user_id);
        return client.user_id;
      }
    }

    // Fall back to checking active leases
    const { data: activeLease, error: leaseError } = await supabase
      .from('lease_clients')
      .select('user_id, leases!inner(unit_id, status)')
      .eq('leases.unit_id', unitId)
      .eq('leases.status', 'active')
      .limit(1)
      .maybeSingle();

    if (!leaseError && activeLease?.user_id) {
      console.log('[getUserIdForUnit] Found user_id from lease:', activeLease.user_id);
      return activeLease.user_id;
    }

    return null;
  } catch (error) {
    console.error('[getUserIdForUnit] Error:', error);
    return null;
  }
}

/**
 * Get responsible person names for a unit
 * Returns array of {first_name, last_name} for all responsible adults assigned to the unit
 */
export async function getResponsiblePersonNamesForUnit(supabase, unitId) {
  try {
    const responsiblePersons = [];
    
    // Get client_ids from client_units
    const { data: clientUnits } = await supabase
      .from('client_units')
      .select('client_id')
      .eq('unit_id', unitId)
      .is('is_archived', false);
    
    const clientIds = clientUnits?.map(cu => cu.client_id).filter(Boolean) || [];
    
    // Also get client_ids from active leases
    const { data: leases } = await supabase
      .from('lease_clients')
      .select('client_id, leases!inner(unit_id, status)')
      .eq('leases.unit_id', unitId)
      .eq('leases.status', 'active');
    
    const leaseClientIds = leases?.map(l => l.client_id).filter(Boolean) || [];
    const allClientIds = [...new Set([...clientIds, ...leaseClientIds])];
    
    if (allClientIds.length === 0) {
      return [];
    }
    
    // Get contacts for these clients
    const { data: contacts } = await supabase
      .from('contacts')
      .select('first_name, last_name, middle_name, contactable_id')
      .eq('contactable_type', 'tenant')
      .in('contactable_id', allClientIds);
    
    if (contacts && contacts.length > 0) {
      for (const contact of contacts) {
        if (contact.first_name && contact.last_name) {
          responsiblePersons.push({
            first_name: contact.first_name,
            last_name: contact.last_name,
            middle_name: contact.middle_name
          });
        }
      }
    }
    
    return responsiblePersons;
  } catch (error) {
    console.error('[getResponsiblePersonNamesForUnit] Error:', error);
    return [];
  }
}

/**
 * Find unit by property name and unit number
 * @param {string} propertyName - Property or complex name
 * @param {string} unitNumber - Unit number
 * @returns {Object|null} - Unit info with unitId, propertyId, userId, or null if not found
 */
export async function findUnitByPropertyNameAndUnit(supabase, propertyName, unitNumber) {
  try {
    if (!propertyName || !unitNumber) return null;
    
    // Normalize property name for case-insensitive matching
    const normalizedPropertyName = propertyName.trim().toLowerCase();
    
    // Find properties matching the property name
    const { data: properties, error: propError } = await supabase
      .from('properties')
      .select('property_id, property_name')
      .ilike('property_name', `%${normalizedPropertyName}%`);
    
    if (propError) {
      console.error('[findUnitByPropertyNameAndUnit] Error finding properties:', propError);
      return null;
    }
    
    if (!properties || properties.length === 0) {
      return null;
    }
    
    // If multiple properties match, try exact match first
    let matchingProperty = properties.find(p => 
      p.property_name?.toLowerCase() === normalizedPropertyName
    );
    
    // If no exact match, use first result (could be improved with fuzzy matching)
    if (!matchingProperty) {
      matchingProperty = properties[0];
    }
    
    // Find units with matching unit number in this property
    const { data: units, error: unitError } = await supabase
      .from('units')
      .select('unit_id, property_id, unit_number')
      .eq('property_id', matchingProperty.property_id)
      .ilike('unit_number', unitNumber.trim());
    
    if (unitError) {
      console.error('[findUnitByPropertyNameAndUnit] Error finding units:', unitError);
      return null;
    }
    
    if (!units || units.length === 0) {
      return null;
    }
    
    // If multiple units match, try exact match first
    let matchingUnit = units.find(u => 
      u.unit_number?.toLowerCase() === unitNumber.trim().toLowerCase()
    );
    
    if (!matchingUnit) {
      matchingUnit = units[0];
    }
    
    // Get user_id for this unit (checks client_units first, then leases)
    const userId = await getUserIdForUnit(supabase, matchingUnit.unit_id);
    
    return {
      unitId: matchingUnit.unit_id,
      propertyId: matchingUnit.property_id,
      userId: userId
    };
  } catch (error) {
    console.error('[findUnitByPropertyNameAndUnit] Error:', error);
    return null;
  }
}

/**
 * Normalize unit number for comparison (remove spaces, dashes, underscores, convert to lowercase)
 * @param {string} unit - Unit number to normalize
 * @returns {string} - Normalized unit number
 */
function normalizeUnit(unit) {
  if (!unit) return '';
  return unit.toString().toLowerCase().replace(/[\s\-_]/g, '');
}

/**
 * Extract unit number from address string
 * Handles patterns like: "#201", "Unit 201", "Apt 201", "number 201", "201", etc.
 * @param {string} address - Address string to extract unit from
 * @returns {string|null} - Extracted unit number or null if not found
 */
function extractUnitFromAddress(address) {
  if (!address || typeof address !== 'string') return null;
  
  // Pattern to match unit identifiers: #201, Unit 201, Apt 201, Apt#201, G-201, G201, number 201, etc.
  // Matches: optional prefix (unit, apt, apartment, #, number, no., num.) + optional separator + unit identifier
  const unitPattern = /(?:^|\s)(?:unit|apt|apartment|#|number|no\.?|num\.?)\s*[:\-]?\s*([a-z0-9\-]+)/i;
  const match = address.match(unitPattern);
  
  if (match && match[1]) {
    return match[1];
  }
  
  // Also check if there's a standalone unit number at the end (e.g., "Street #201" or just "#201")
  const endUnitPattern = /[\s#]([a-z0-9\-]+)$/i;
  const endMatch = address.match(endUnitPattern);
  if (endMatch && endMatch[1]) {
    // Make sure it's not just part of a street number (e.g., "123 Main St" shouldn't match "123")
    // If it's all digits and short, it might be a unit number
    const potentialUnit = endMatch[1];
    if (/^[a-z0-9\-]+$/i.test(potentialUnit) && potentialUnit.length <= 10) {
      return potentialUnit;
    }
  }
  
  return null;
}

/**
 * Find unit by address (flexible matching)
 * @param {Object|string} address - Address object or string
 * @returns {Object|null} - Unit info with unitId, propertyId, userId, or null if not found
 */
/**
 * Extract city, state, and zip from address string
 * Returns { city, state, zip } or null values
 */
function extractAddressComponents(addressString) {
  if (!addressString || typeof addressString !== 'string') {
    return { city: null, state: null, zip: null };
  }
  
  // Normalize the address string
  const normalized = normalizeAddressString(addressString);
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  
  let city = null;
  let state = null;
  let zip = null;
  
  // Common state abbreviations (normalized to lowercase)
  const stateAbbrevs = ['wa', 'or', 'ca', 'id', 'mt', 'wy', 'ut', 'nv', 'az', 'nm', 'co'];
  
  // Look for zip code (5 digits, usually at the end)
  const zipPattern = /\b(\d{5})\b/;
  const zipMatch = normalized.match(zipPattern);
  if (zipMatch) {
    zip = zipMatch[1];
  }
  
  // Look for state (usually before zip, or standalone)
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i].toLowerCase();
    if (stateAbbrevs.includes(word)) {
      state = word;
      // City is usually the word before state
      if (i > 0) {
        city = words[i - 1];
      }
      break;
    }
  }
  
  // If no state found but we have zip, try to infer city
  // City is often the last word before zip/state
  if (!city && words.length >= 2) {
    const lastWord = words[words.length - 1];
    const secondLastWord = words[words.length - 2];
    // If last word is zip or looks like a number, city might be second-to-last
    if (/^\d{5}$/.test(lastWord) || /^\d+$/.test(lastWord)) {
      city = secondLastWord;
    }
  }
  
  return { city, state, zip };
}

export async function findUnitByAddress(supabase, address) {
  try {
    if (!address) return null;
    
    // Extract unit number from address if present (for matching later)
    const addressString = typeof address === 'string' ? address : 
      [address.address_line_1, address.address_line_2].filter(Boolean).join(' ');
    const extractedUnitNumber = extractUnitFromAddress(addressString);
    
    // Normalize address for search (but exclude unit number from property matching)
    const searchString = createAddressSearchString(address);
    if (!searchString) return null;
    
    // Extract city, state, zip to filter addresses query
    const { city, state, zip } = extractAddressComponents(addressString);
    
    // Query addresses table first with filters on city, state, and/or zip
    // This dramatically reduces the number of addresses we need to process
    let addressesQuery = supabase
      .from('addresses')
      .select('addressable_id, address_line_1, address_line_2, city, state_province_region, postal_code')
      .eq('addressable_type', 'property');
    
    // Apply filters if we found them
    if (zip) {
      addressesQuery = addressesQuery.eq('postal_code', zip);
    }
    if (state) {
      // State might be stored as full name or abbreviation, use ilike for flexible matching
      addressesQuery = addressesQuery.ilike('state_province_region', `%${state}%`);
    }
    if (city) {
      addressesQuery = addressesQuery.ilike('city', `%${city}%`);
    }
    
    const { data: addresses, error: addrError } = await addressesQuery;
    
    if (addrError) {
      console.error('[findUnitByAddress] Error finding addresses:', addrError);
      return null;
    }
    
    if (!addresses || addresses.length === 0) {
      console.log('[findUnitByAddress] No addresses found with filters:', { city, state, zip });
      return null;
    }
    
    // Get unique property IDs from the filtered addresses
    const propertyIds = [...new Set(addresses.map(a => a.addressable_id))];
    
    // Get properties for these IDs
    const { data: properties, error: propError } = await supabase
      .from('properties')
      .select('property_id, property_name')
      .in('property_id', propertyIds);
    
    if (propError) {
      console.error('[findUnitByAddress] Error finding properties:', propError);
      return null;
    }
    
    if (!properties || properties.length === 0) {
      return null;
    }
    
    // Find matching property by comparing normalized addresses
    let matchingProperty = null;
    let matchingAddress = null;
    const normalizedSearch = normalizeAddressString(searchString);
    
    console.log('[findUnitByAddress] Searching for address:', {
      original: searchString,
      normalized: normalizedSearch,
      extractedUnitNumber,
      addressCount: addresses?.length || 0,
      filters: { city, state, zip }
    });
    
    for (const addr of addresses || []) {
      const addrParts = [
        addr.address_line_1,
        addr.address_line_2,
        addr.city,
        addr.state_province_region,
        addr.postal_code
      ].filter(Boolean);
      
      const addrString = addrParts.join(' ');
      const normalizedAddr = normalizeAddressString(addrString);
      
      // Check if normalized addresses match (flexible matching)
      // Also try matching individual components for partial addresses
      const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 0);
      const addrWords = normalizedAddr.split(/\s+/).filter(w => w.length > 0);
      
      // Check full string match
      const fullMatch = normalizedAddr.includes(normalizedSearch) || normalizedSearch.includes(normalizedAddr);
      
      // Extract street numbers (first numeric word, handling ordinals like "138th")
      // Strip ordinal suffixes (st, nd, rd, th) for comparison
      const extractStreetNumber = (word) => {
        if (!word) return null;
        // Match pure numbers or numbers with ordinal suffixes
        const match = word.match(/^(\d+)(?:st|nd|rd|th)?$/i);
        return match ? parseInt(match[1]) : null;
      };
      
      const searchStreetNum = searchWords.map(extractStreetNumber).find(n => n !== null);
      const addrStreetNum = addrWords.map(extractStreetNumber).find(n => n !== null);
      
      // Check if street numbers are similar (within 20, for cases like 3310 vs 3300)
      const streetNumMatch = searchStreetNum !== null && addrStreetNum !== null && 
        Math.abs(searchStreetNum - addrStreetNum) <= 20;
      
      // Check if most non-numeric words match (for partial addresses like "3310 N State Rd" matching "3300 N State Rd")
      // Filter out pure numbers, but keep ordinals (like "138th") for matching
      const nonNumericSearchWords = searchWords.filter(w => {
        // Keep words that are not pure numbers (but keep ordinals like "138th")
        return !/^\d+$/.test(w) && w.length > 2;
      });
      const nonNumericAddrWords = addrWords.filter(w => {
        // Keep words that are not pure numbers (but keep ordinals like "138th")
        return !/^\d+$/.test(w) && w.length > 2;
      });
      
      // Also normalize ordinals for better matching (e.g., "138th" should match "138" in context)
      const normalizeForMatching = (word) => {
        // Remove ordinal suffixes for comparison purposes
        return word.replace(/(\d+)(?:st|nd|rd|th)\b/i, '$1');
      };
      
      const normalizedSearchWords = nonNumericSearchWords.map(normalizeForMatching);
      const normalizedAddrWords = nonNumericAddrWords.map(normalizeForMatching);
      
      // Match words using normalized versions (handles "138th" matching "138")
      const wordMatches = normalizedSearchWords.filter(word => 
        normalizedAddrWords.some(addrWord => addrWord.includes(word) || word.includes(addrWord))
      );
      const wordMatchRatio = nonNumericSearchWords.length > 0 ? wordMatches.length / nonNumericSearchWords.length : 0;
      
      // Debug logging for first match only (reduce log noise)
      if (!matchingProperty && addresses.indexOf(addr) < 1) {
        console.log('[findUnitByAddress] Comparing first address:', {
          dbAddress: addrString.substring(0, 50), // Truncate for logs
          normalizedDb: normalizedAddr.substring(0, 50),
          normalizedSearch: normalizedSearch.substring(0, 50),
          searchStreetNum,
          addrStreetNum,
          streetNumMatch,
          wordMatchRatio: wordMatchRatio.toFixed(2),
          fullMatch,
          willMatch: fullMatch || (streetNumMatch && wordMatchRatio >= 0.7)
        });
      }
      
      // Match if full string matches OR if street numbers are similar AND at least 70% of non-numeric words match
      if (fullMatch || (streetNumMatch && wordMatchRatio >= 0.7)) {
        matchingProperty = properties.find(p => p.property_id === addr.addressable_id);
        matchingAddress = addr;
        console.log('[findUnitByAddress] Found matching property:', {
          propertyId: matchingProperty?.property_id,
          propertyName: matchingProperty?.property_name,
          address: addrString
        });
        if (matchingProperty) break;
      }
    }
    
    if (!matchingProperty) {
      return null;
    }
    
    // Find units for this property
    const { data: units, error: unitError } = await supabase
      .from('units')
      .select('unit_id, property_id, unit_number')
      .eq('property_id', matchingProperty.property_id);
    
    if (unitError || !units || units.length === 0) {
      return null;
    }
    
    // If we extracted a unit number from the address, try to match it against units
    if (extractedUnitNumber) {
      const normalizedExtractedUnit = normalizeUnit(extractedUnitNumber);
      console.log('[findUnitByAddress] Extracted unit number from address:', extractedUnitNumber, 'normalized:', normalizedExtractedUnit);
      
      // Try to find a matching unit
      const matchingUnit = units.find(u => {
        const normalizedUnitNum = normalizeUnit(u.unit_number);
        return normalizedUnitNum === normalizedExtractedUnit;
      });
      
      if (matchingUnit) {
        console.log('[findUnitByAddress] Matched unit by extracted unit number:', matchingUnit.unit_number);
        // Get user_id for this unit (checks client_units first, then leases)
        const userId = await getUserIdForUnit(supabase, matchingUnit.unit_id);
        
        return {
          unitId: matchingUnit.unit_id,
          propertyId: matchingUnit.property_id,
          userId: userId
        };
      }
      
      // If no match found but we have a unit number, still return multiple units for clarification
      // (the unit number might be slightly different, e.g., "Unit 201" vs "#201")
      if (units.length > 1) {
        return {
          propertyId: matchingProperty.property_id,
          propertyName: matchingProperty.property_name,
          units: units,
          multipleUnits: true,
          heardUnitNumber: extractedUnitNumber
        };
      }
    }
    
    // If multiple units and no unit number extracted, return them for clarification
    if (units.length > 1) {
      return {
        propertyId: matchingProperty.property_id,
        propertyName: matchingProperty.property_name,
        units: units,
        multipleUnits: true
      };
    }
    
    const unit = units[0];
    
    // Get user_id for this unit (checks client_units first, then leases)
    const userId = await getUserIdForUnit(supabase, unit.unit_id);
    
    return {
      unitId: unit.unit_id,
      propertyId: unit.property_id,
      userId: userId
    };
  } catch (error) {
    console.error('[findUnitByAddress] Error:', error);
    return null;
  }
}

/**
 * Find unit by property name (partial matching, e.g., "Wuthering Heights" matches "Wuthering Heights Apartments")
 * Returns array of matching properties with their addresses for clarification
 */
export async function findPropertiesByName(supabase, propertyName) {
  try {
    if (!propertyName) return [];
    
    const normalizedName = propertyName.trim().toLowerCase();
    
    // Find properties matching the property name (partial match)
    const { data: properties, error: propError } = await supabase
      .from('properties')
      .select('property_id, property_name')
      .ilike('property_name', `%${normalizedName}%`);
    
    if (propError) {
      console.error('[findPropertiesByName] Error finding properties:', propError);
      return [];
    }
    
    if (!properties || properties.length === 0) {
      return [];
    }
    
    // Get addresses for matching properties
    const propertyIds = properties.map(p => p.property_id);
    const { data: addresses, error: addrError } = await supabase
      .from('addresses')
      .select('addressable_id, address_line_1, city, state_province_region')
      .eq('addressable_type', 'property')
      .in('addressable_id', propertyIds);
    
    if (addrError) {
      console.error('[findPropertiesByName] Error finding addresses:', addrError);
      return properties.map(p => ({ ...p, address: null }));
    }
    
    // Combine properties with addresses
    return properties.map(prop => {
      const addr = addresses?.find(a => a.addressable_id === prop.property_id);
      return {
        property_id: prop.property_id,
        property_name: prop.property_name,
        address: addr ? `${addr.address_line_1}, ${addr.city}, ${addr.state_province_region}` : null
      };
    });
  } catch (error) {
    console.error('[findPropertiesByName] Error:', error);
    return [];
  }
}

/**
 * Find user by first name, last name, and date of birth
 * Uses fuzzy matching for names
 */
export async function findUserByNameAndBirthdate(supabase, firstName, lastName, dateOfBirth) {
  try {
    if (!firstName || !lastName || !dateOfBirth) {
      return null;
    }
    
    // Parse the date
    const parsedDate = parseSpokenDate(dateOfBirth);
    if (!parsedDate) {
      console.log('[findUserByNameAndBirthdate] Could not parse date:', dateOfBirth);
      return null;
    }
    
    // Get all clients with matching birthdate
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('client_id, user_id, date_of_birth')
      .eq('date_of_birth', parsedDate);
    
    if (clientError || !clients || clients.length === 0) {
      return null;
    }
    
    // Get contacts for these clients
    const clientIds = clients.map(c => c.client_id);
    const { data: contacts, error: contactError } = await supabase
      .from('contacts')
      .select('contactable_id, first_name, last_name')
      .eq('contactable_type', 'tenant')
      .in('contactable_id', clientIds);
    
    if (contactError || !contacts || contacts.length === 0) {
      return null;
    }
    
    // Find best matching contact using fuzzy matching
    // Uses Levenshtein distance: score = 1 - (edit_distance / max_length)
    // For "Tennant" vs "Tenant": distance=1, maxLen=7, score=0.857 (85.7%)
    let bestMatch = null;
    let bestScore = 0;
    const threshold = 0.7; // 70% similarity required (allows "Tennant" vs "Tenant" at 85.7%)
    
    for (const contact of contacts) {
      const firstNameScore = fuzzyNameMatch(firstName, contact.first_name || '');
      const lastNameScore = fuzzyNameMatch(lastName, contact.last_name || '');
      const avgScore = (firstNameScore + lastNameScore) / 2;
      
      if (avgScore > bestScore && avgScore >= threshold) {
        bestScore = avgScore;
        const client = clients.find(c => c.client_id === contact.contactable_id);
        if (client) {
          bestMatch = {
            userId: client.user_id,
            clientId: client.client_id,
            firstName: contact.first_name,
            lastName: contact.last_name,
            matchScore: avgScore
          };
        }
      }
    }
    
    return bestMatch;
  } catch (error) {
    console.error('[findUserByNameAndBirthdate] Error:', error);
    return null;
  }
}

/**
 * Find responsible person by name and address/property name
 * Returns unit info if found
 */
export async function findResponsiblePersonByNameAndLocation(supabase, firstName, lastName, propertyName, address, unitNumber) {
  try {
    if (!firstName || !lastName) {
      return null;
    }
    
    let matchingProperty = null;
    let matchingUnits = [];
    
    // Try property name first
    if (propertyName) {
      const properties = await findPropertiesByName(supabase, propertyName);
      if (properties.length === 1) {
        matchingProperty = properties[0];
      } else if (properties.length > 1) {
        // Multiple matches - return them for clarification
        return {
          multipleProperties: properties,
          needsClarification: true
        };
      }
    }
    
    // Try address if property name didn't work
    if (!matchingProperty && address) {
      const unitInfo = await findUnitByAddress(supabase, address);
      if (unitInfo?.propertyId) {
        const { data: property } = await supabase
          .from('properties')
          .select('property_id, property_name')
          .eq('property_id', unitInfo.propertyId)
          .single();
        if (property) {
          matchingProperty = property;
          if (unitInfo.unitId) {
            matchingUnits = [{ unit_id: unitInfo.unitId, property_id: unitInfo.propertyId }];
          }
        }
      }
    }
    
    if (!matchingProperty) {
      return null;
    }
    
    // Get all units for this property
    if (matchingUnits.length === 0) {
      const { data: units } = await supabase
        .from('units')
        .select('unit_id, property_id, unit_number')
        .eq('property_id', matchingProperty.property_id);
      matchingUnits = units || [];
    }
    
    // If unit number provided, filter to that unit
    if (unitNumber) {
      matchingUnits = matchingUnits.filter(u => 
        u.unit_number?.toLowerCase() === unitNumber.trim().toLowerCase()
      );
    }
    
    // If multiple units and no unit number specified, return for clarification
    if (matchingUnits.length > 1 && !unitNumber) {
      return {
        property: matchingProperty,
        units: matchingUnits,
        needsUnitNumber: true
      };
    }
    
    // Find unit assignments (client_units) for matching units first, then fall back to leases
    const unitIds = matchingUnits.map(u => u.unit_id);
    
    // Get client_units for these units
    const { data: clientUnits, error: clientUnitError } = await supabase
      .from('client_units')
      .select('client_id, unit_id')
      .in('unit_id', unitIds)
      .is('is_archived', false);
    
    // Get user_ids from client_units
    let userIds = [];
    if (!clientUnitError && clientUnits && clientUnits.length > 0) {
      const clientIds = [...new Set(clientUnits.map(cu => cu.client_id))];
      const { data: clients } = await supabase
        .from('clients')
        .select('client_id, user_id')
        .in('client_id', clientIds)
;
      
      if (clients && clients.length > 0) {
        userIds = clients.map(c => c.user_id).filter(Boolean);
      }
    }
    
    // If no assignments found, fall back to active leases
    if (userIds.length === 0) {
      const { data: leases, error: leaseError } = await supabase
        .from('lease_clients')
        .select('user_id, leases!inner(unit_id, status)')
        .in('leases.unit_id', unitIds)
        .eq('leases.status', 'active');
      
      if (!leaseError && leases && leases.length > 0) {
        userIds = [...new Set(leases.map(l => l.user_id))].filter(Boolean);
      }
    }
    
    if (userIds.length === 0) {
      return null;
    }
    
    // Get contacts for these users and match by name
    const { data: clients } = await supabase
      .from('clients')
      .select('client_id, user_id')
      .in('user_id', userIds)
      .eq('lifecycle_stage', 'tenant');
    
    if (!clients || clients.length === 0) {
      return null;
    }
    
    const clientIds = clients.map(c => c.client_id);
    const { data: contacts, error: contactError } = await supabase
      .from('contacts')
      .select('contactable_id, first_name, last_name')
      .eq('contactable_type', 'tenant')
      .in('contactable_id', clientIds);
    
    if (contactError || !contacts || contacts.length === 0) {
      return null;
    }
    
    // Find best matching contact and their unit
    // Uses Levenshtein distance for fuzzy matching
    let bestMatch = null;
    let bestScore = 0;
    const threshold = 0.7; // 70% similarity required
    
    for (const contact of contacts) {
      const firstNameScore = fuzzyNameMatch(firstName, contact.first_name || '');
      const lastNameScore = fuzzyNameMatch(lastName, contact.last_name || '');
      const avgScore = (firstNameScore + lastNameScore) / 2;
      
      if (avgScore > bestScore && avgScore >= threshold) {
        bestScore = avgScore;
        const client = clients.find(c => c.client_id === contact.contactable_id);
        
        if (client) {
          // Find the unit for this client (from client_units or leases)
          let matchingUnit = null;
          
          // Check client_units first
          const clientUnit = clientUnits?.find(cu => {
            const clientForUnit = clients.find(c => c.client_id === cu.client_id);
            return clientForUnit?.client_id === contact.contactable_id;
          });
          
          if (clientUnit) {
            matchingUnit = matchingUnits.find(u => u.unit_id === clientUnit.unit_id);
          } else {
            // Fall back to leases
            const { data: leases } = await supabase
              .from('lease_clients')
              .select('leases!inner(unit_id, status)')
              .eq('user_id', client.user_id)
              .eq('leases.status', 'active')
              .in('leases.unit_id', unitIds)
              .limit(1)
              .maybeSingle();
            
            if (leases?.leases) {
              matchingUnit = matchingUnits.find(u => u.unit_id === leases.leases.unit_id);
            }
          }
          
          if (matchingUnit) {
            bestMatch = {
              userId: client.user_id,
              unitId: matchingUnit.unit_id,
              propertyId: matchingProperty.property_id,
              unitNumber: matchingUnit.unit_number,
              matchScore: avgScore
            };
          }
        }
      }
    }
    
    return bestMatch;
  } catch (error) {
    console.error('[findResponsiblePersonByNameAndLocation] Error:', error);
    return null;
  }
}

/**
 * Assess urgency of a maintenance issue
 */
export async function assessUrgency(functionArgs) {
  const urgencyLevel = functionArgs.urgency_level;
  const reasoning = functionArgs.reasoning;

  if (urgencyLevel === 'life_threatening') {
    return {
      urgency_level: 'life_threatening',
      message: 'This appears to be a life-threatening emergency. Please call 911 immediately. Do not wait. Your safety is the top priority. After calling 911, please contact your property manager to inform them of the situation.',
      action: 'call_911'
    };
  }

  return {
    urgency_level: urgencyLevel,
    reasoning: reasoning,
    message: `I've assessed this as ${urgencyLevel === 'emergency' ? 'an emergency' : urgencyLevel === 'urgent' ? 'an urgent' : 'a routine'} issue. ${reasoning}`
  };
}

/**
 * Find emergency vendors
 */
export async function findEmergencyVendors(keywords, propertyId, unitId, userId, supabase, openai, isVoiceCall = false, callSummary = null, requireEmergencyOnly = false) {
  try {
    // Get property info for service area matching
    let propertyCity = null;
    let propertyCounty = null;
    let propertyLandlordId = null;
    let propertyPmcId = null;
    
    if (propertyId) {
      const { data: property, error: propertyError } = await supabase
        .from('properties')
        .select('city_of_jurisdiction, county_of_jurisdiction, landlord_id, pmc_id')
        .eq('property_id', propertyId)
        .maybeSingle();
      
      if (propertyError) {
        console.error('[findEmergencyVendors] Error fetching property:', propertyError);
      }
      
      if (property) {
        propertyCity = property.city_of_jurisdiction;
        // Remove "County" suffix if present for matching
        propertyCounty = property.county_of_jurisdiction?.replace(/\s+County$/i, '') || null;
        propertyLandlordId = property.landlord_id;
        propertyPmcId = property.pmc_id;
        console.log('[findEmergencyVendors] Property data:', { propertyId, propertyCity, propertyCounty, propertyLandlordId, propertyPmcId });
      } else {
        console.log('[findEmergencyVendors] No property found for propertyId:', propertyId);
      }
    } else {
      console.log('[findEmergencyVendors] No propertyId provided');
    }
    
    // Find approved vendors - prioritize landlord-approved over PMC-approved
    // First get property-specific, then landlord, then PMC, then global
    let approvalsQuery = supabase
      .from('vendor_approvals')
      .select('vendor_id, can_emergency_service, approval_level, approved_by_landlord_id, approved_by_pmc_id, approved_by_property_id');
    
    // Build conditions prioritizing landlord approvals
    const conditions = [];
    if (propertyId) {
      conditions.push(`approved_by_property_id.eq.${propertyId}`);
    }
    if (propertyLandlordId) {
      conditions.push(`approved_by_landlord_id.eq.${propertyLandlordId}`);
    }
    if (propertyPmcId) {
      conditions.push(`approved_by_pmc_id.eq.${propertyPmcId}`);
    }
    if (propertyId) {
      conditions.push(`approval_level.eq.global`);
    }
    
    if (conditions.length === 0) {
      return {
        success: false,
        vendors: [],
        vendor_count: 0,
        count: 0,
        message: 'I couldn\'t find an approved vendor for this issue. Please contact your property manager directly.'
      };
    }
    
    approvalsQuery = approvalsQuery.or(conditions.join(','));
    
    console.log('[findEmergencyVendors] Query setup:', {
      requireEmergencyOnly,
      propertyId,
      propertyCity,
      propertyCounty,
      propertyLandlordId,
      propertyPmcId,
      willFilterEmergency: requireEmergencyOnly
    });
    
    if (requireEmergencyOnly) {
      approvalsQuery = approvalsQuery.eq('can_emergency_service', true);
      console.log('[findEmergencyVendors] Filtering to emergency service vendors only');
    } else {
      console.log('[findEmergencyVendors] Including all approved vendors (not filtering by emergency service)');
    }
    
    const { data: approvals, error: approvalsError } = await approvalsQuery;
    
    if (approvalsError) {
      console.error('[findEmergencyVendors] Error fetching approvals:', approvalsError);
    }
    
    console.log('[findEmergencyVendors] Approvals found:', {
      count: approvals?.length || 0,
      requireEmergencyOnly,
      emergencyCount: approvals?.filter(a => a.can_emergency_service).length || 0,
      nonEmergencyCount: approvals?.filter(a => !a.can_emergency_service).length || 0
    });

    const approvedVendorIds = (approvals || []).map(a => a.vendor_id);

    if (approvedVendorIds.length === 0) {
      return {
        success: false,
        vendors: [],
        vendor_count: 0,
        count: 0,
        message: requireEmergencyOnly 
          ? 'I couldn\'t find an emergency vendor for this issue. Please contact your property manager directly or call 911 if this is a life-threatening emergency.'
          : 'I couldn\'t find an approved vendor for this issue. Please contact your property manager directly.'
      };
    }

    // Fetch vendors with keywords and service areas
    const { data: vendors } = await supabase
      .from('vendors')
      .select(`
        vendor_id,
        company_name,
        description,
        vendor_keywords(
          vendor_service_keywords(
            keyword_name
          )
        ),
        vendor_service_areas(
          area_type,
          area_value
        )
      `)
      .in('vendor_id', approvedVendorIds);

    // Score all vendors using AI-based semantic matching
    // Use call summary if available, otherwise fall back to keywords
    const scoredVendors = [];
    const issueDescription = callSummary || (keywords && keywords.length > 0 ? keywords.join(' ') : '');

    if (!issueDescription || issueDescription.trim().length === 0) {
      console.warn('[findEmergencyVendors] No issue description available for matching');
      return {
        success: false,
        vendors: [],
        vendor_count: 0,
        count: 0,
        message: requireEmergencyOnly
          ? 'I couldn\'t find an emergency vendor for this issue. Please contact your property manager directly or call 911 if this is a life-threatening emergency.'
          : 'I couldn\'t find an approved vendor for this issue. Please contact your property manager directly.'
      };
    }

    // Score all vendors and filter by service area
    for (const vendor of vendors || []) {
      // Check service area match if property location is available
      let serviceAreaMatch = true; // Default to true if no property location
      let serviceAreaScore = 0;
      
      if (propertyCity || propertyCounty) {
        const vendorServiceAreas = (vendor.vendor_service_areas || []).map(sa => ({
          type: sa.area_type,
          value: sa.area_value?.toLowerCase().trim() || ''
        }));
        
        // Check for direct matches
        const cityMatch = propertyCity && vendorServiceAreas.some(sa => 
          sa.type === 'city' && sa.value === propertyCity.toLowerCase().trim()
        );
        const countyMatch = propertyCounty && vendorServiceAreas.some(sa => {
          if (sa.type !== 'county') return false;
          const saValue = sa.value;
          const propertyCountyLower = propertyCounty.toLowerCase();
          // Match with or without "County" suffix
          return saValue === propertyCountyLower || 
                 saValue === `${propertyCountyLower} county` ||
                 saValue.replace(/\s+county$/i, '') === propertyCountyLower;
        });
        
        // Check for area/region matches (inference-based)
        // Define area mappings (e.g., Redmond -> Eastside, North King County)
        const areaMappings = {
          'redmond': ['eastside', 'north king county', 'king county'],
          'bellevue': ['eastside', 'north king county', 'king county'],
          'kirkland': ['eastside', 'north king county', 'king county'],
          'seattle': ['puget sound area', 'greater seattle area', 'king county'],
          // Add more mappings as needed
        };
        
        const propertyCityLower = propertyCity?.toLowerCase().trim();
        const inferredAreas = areaMappings[propertyCityLower] || [];
        
        const areaMatch = inferredAreas.some(area => 
          vendorServiceAreas.some(sa => 
            sa.type === 'area' && sa.value.includes(area.toLowerCase())
          )
        );
        
        // Check state match
        const stateMatch = vendorServiceAreas.some(sa => sa.type === 'state');
        
        // Service area matches if: direct city/county match, area match, or state match (fallback)
        serviceAreaMatch = cityMatch || countyMatch || areaMatch || stateMatch;
        
        // Calculate service area score (higher = better match)
        if (cityMatch) serviceAreaScore = 1.0;
        else if (countyMatch) serviceAreaScore = 0.8;
        else if (areaMatch) serviceAreaScore = 0.6;
        else if (stateMatch) serviceAreaScore = 0.3;
        else serviceAreaScore = 0;
      }
      
      // Skip vendors that don't match service area
      if (!serviceAreaMatch) {
        console.log('[findEmergencyVendors] Vendor filtered out by service area:', {
          vendor_id: vendor.vendor_id,
          company_name: vendor.company_name,
          propertyCity,
          propertyCounty
        });
        continue;
      }
      
      const vendorKeywords = (vendor.vendor_keywords || []).flatMap(vk => {
        const serviceKeywords = vk.vendor_service_keywords;
        if (!serviceKeywords) return [];
        if (Array.isArray(serviceKeywords)) {
          return serviceKeywords.map(ks => ks.keyword_name?.toLowerCase()).filter(Boolean);
        } else if (serviceKeywords.keyword_name) {
          return [serviceKeywords.keyword_name.toLowerCase()];
        }
        return [];
      });

      // Score the vendor match
      const matchResult = await scoreVendorMatch(issueDescription, vendorKeywords, vendor.description, openai);
      
      // Combine service area score with capability match score
      // Prioritize landlord-approved vendors by adding bonus to their score
      const approval = approvals?.find(a => a.vendor_id === vendor.vendor_id);
      let approvalBonus = 0;
      if (approval) {
        if (approval.approved_by_landlord_id === propertyLandlordId) {
          approvalBonus = 0.2; // Boost landlord-approved vendors
        } else if (approval.approved_by_pmc_id === propertyPmcId) {
          approvalBonus = 0.1; // Smaller boost for PMC-approved
        }
      }
      
      const finalScore = (matchResult.score * 0.7) + (serviceAreaScore * 0.3) + approvalBonus;
      
      // Only include vendors with final score > 0.2 (reasonable match threshold)
      if (finalScore > 0.2) {
        scoredVendors.push({
          ...vendor,
          matchScore: finalScore,
          matchedKeywords: matchResult.matchedKeywords,
          serviceAreaScore,
          approvalLevel: approval?.approval_level
        });
      }
    }
    
    // Sort by score (highest first), prioritizing landlord-approved vendors
    scoredVendors.sort((a, b) => {
      // First sort by score
      if (Math.abs(b.matchScore - a.matchScore) > 0.1) {
        return b.matchScore - a.matchScore;
      }
      // If scores are close, prioritize landlord-approved
      const aIsLandlord = a.approvalLevel === 'landlord' || approvals?.find(ap => ap.vendor_id === a.vendor_id && ap.approved_by_landlord_id === propertyLandlordId);
      const bIsLandlord = b.approvalLevel === 'landlord' || approvals?.find(ap => ap.vendor_id === b.vendor_id && ap.approved_by_landlord_id === propertyLandlordId);
      if (aIsLandlord && !bIsLandlord) return -1;
      if (!aIsLandlord && bIsLandlord) return 1;
      return 0;
    });
    
    // Filter to only vendors with score >= 0.2 (reasonable match threshold)
    const matchingVendors = scoredVendors.filter(v => v.matchScore >= 0.2);

    if (matchingVendors.length === 0) {
      return {
        success: false,
        vendors: [],
        vendor_count: 0,
        count: 0,
        message: 'I couldn\'t find an emergency vendor for this issue. Please contact your property manager directly.'
      };
    }

    // Fetch contact information
    const matchingVendorIds = matchingVendors.map(v => v.vendor_id);
    const { data: contacts } = await supabase
      .from('contacts')
      .select('contact_id, contactable_id, first_name, middle_name, last_name')
      .in('contactable_id', matchingVendorIds)
      .eq('contactable_type', 'vendor');

    const contactIds = (contacts || []).map(c => c.contact_id);
    const { data: contactMethods } = contactIds.length > 0 ? await supabase
      .from('contact_methods')
      .select('contact_id, method_type, value')
      .in('contact_id', contactIds) : { data: [] };

    // Format vendor information
    const vendorInfo = matchingVendors.map(v => {
      const contact = (contacts || []).find(c => c.contactable_id === v.vendor_id);
      const contactName = contact ? [contact.first_name, contact.middle_name, contact.last_name]
        .filter(Boolean).join(' ') : null;
      const vendorName = v.company_name || contactName || v.description || 'Unnamed Vendor';
      
      const vendorContactMethods = (contactMethods || []).filter(cm => 
        contact && cm.contact_id === contact.contact_id
      );
      const phone = vendorContactMethods.find(cm => cm.method_type === 'phone')?.value;
      const website = vendorContactMethods.find(cm => cm.method_type === 'website' || cm.method_type === 'url')?.value;
      const email = vendorContactMethods.find(cm => cm.method_type === 'email')?.value;
      
      return {
        vendor_id: v.vendor_id,
        name: vendorName,
        phone: phone || null,
        website: website || null,
        email: email || null,
        description: v.description,
        matchScore: v.matchScore,
        matchedKeywords: v.matchedKeywords || []
      };
    });

    return {
      success: true,
      vendors: vendorInfo,
      vendor_count: matchingVendors.length,
      count: matchingVendors.length,
      message: `I found ${matchingVendors.length} emergency vendor(s) approved for emergency service. ${isVoiceCall ? 'I can call them directly for you, or I can provide their contact information.' : 'Here is their contact information:'}`
    };
  } catch (error) {
    console.error('[findEmergencyVendors] Error:', error);
    return {
      success: false,
      vendors: [],
      vendor_count: 0,
      count: 0,
      message: 'Error finding emergency vendors. Please contact your property manager directly.'
    };
  }
}

/**
 * Find routine vendors
 */
export async function findRoutineVendors(keywords, propertyId, unitId, userId, supabase, openai, callSummary = null) {
  try {
    // Get property info for service area matching
    let propertyCity = null;
    let propertyCounty = null;
    let propertyLandlordId = null;
    let propertyPmcId = null;
    
    if (propertyId) {
      const { data: property } = await supabase
        .from('properties')
        .select('city_of_jurisdiction, county_of_jurisdiction, landlord_id, pmc_id')
        .eq('property_id', propertyId)
        .maybeSingle();
      
      if (property) {
        propertyCity = property.city_of_jurisdiction;
        // Remove "County" suffix if present for matching
        propertyCounty = property.county_of_jurisdiction?.replace(/\s+County$/i, '') || null;
        propertyLandlordId = property.landlord_id;
        propertyPmcId = property.pmc_id;
      }
    }
    
    // Find vendors with approvals - prioritize landlord-approved over PMC-approved
    const conditions = [];
    if (propertyId) {
      conditions.push(`approved_by_property_id.eq.${propertyId}`);
    }
    if (propertyLandlordId) {
      conditions.push(`approved_by_landlord_id.eq.${propertyLandlordId}`);
    }
    if (propertyPmcId) {
      conditions.push(`approved_by_pmc_id.eq.${propertyPmcId}`);
    }
    if (propertyId) {
      conditions.push(`approval_level.eq.global`);
    }
    
    if (conditions.length === 0) {
      return {
        success: false,
        vendors: [],
        vendor_count: 0,
        count: 0,
        message: 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.'
      };
    }
    
    const { data: approvals } = await supabase
      .from('vendor_approvals')
      .select('vendor_id, approval_level, approved_by_landlord_id, approved_by_pmc_id, approved_by_property_id')
      .or(conditions.join(','));

    const approvedVendorIds = (approvals || []).map(a => a.vendor_id);

    if (approvedVendorIds.length === 0) {
      return {
        success: false,
        vendors: [],
        vendor_count: 0,
        count: 0,
        message: 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.'
      };
    }

    // Fetch vendors with keywords and service areas
    const { data: vendors } = await supabase
      .from('vendors')
      .select(`
        vendor_id,
        company_name,
        description,
        vendor_keywords(
          vendor_service_keywords(
            keyword_name
          )
        ),
        vendor_service_areas(
          area_type,
          area_value
        )
      `)
      .in('vendor_id', approvedVendorIds)
      .limit(10);

    // Filter vendors using AI-based semantic matching and service area matching
    // Use call summary if available, otherwise fall back to keywords
    const matchingVendors = [];
    const issueDescription = callSummary || (keywords && keywords.length > 0 ? keywords.join(' ') : '');

    if (!issueDescription || issueDescription.trim().length === 0) {
      console.warn('[findRoutineVendors] No issue description available for matching');
      return {
        success: false,
        vendors: [],
        vendor_count: 0,
        count: 0,
        message: 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.'
      };
    }

    for (const vendor of vendors || []) {
      // Check service area match if property location is available
      let serviceAreaMatch = true; // Default to true if no property location
      
      if (propertyCity || propertyCounty) {
        const vendorServiceAreas = (vendor.vendor_service_areas || []).map(sa => ({
          type: sa.area_type,
          value: sa.area_value?.toLowerCase().trim() || ''
        }));
        
        // Check for direct matches
        const cityMatch = propertyCity && vendorServiceAreas.some(sa => 
          sa.type === 'city' && sa.value === propertyCity.toLowerCase().trim()
        );
        const countyMatch = propertyCounty && vendorServiceAreas.some(sa => {
          if (sa.type !== 'county') return false;
          const saValue = sa.value;
          const propertyCountyLower = propertyCounty.toLowerCase();
          // Match with or without "County" suffix
          return saValue === propertyCountyLower || 
                 saValue === `${propertyCountyLower} county` ||
                 saValue.replace(/\s+county$/i, '') === propertyCountyLower;
        });
        
        // Check for area/region matches (inference-based)
        const areaMappings = {
          'redmond': ['eastside', 'north king county', 'king county'],
          'bellevue': ['eastside', 'north king county', 'king county'],
          'kirkland': ['eastside', 'north king county', 'king county'],
          'seattle': ['puget sound area', 'greater seattle area', 'king county'],
        };
        
        const propertyCityLower = propertyCity?.toLowerCase().trim();
        const inferredAreas = areaMappings[propertyCityLower] || [];
        
        const areaMatch = inferredAreas.some(area => 
          vendorServiceAreas.some(sa => 
            sa.type === 'area' && sa.value.includes(area.toLowerCase())
          )
        );
        
        // Check state match
        const stateMatch = vendorServiceAreas.some(sa => sa.type === 'state');
        
        // Service area matches if: direct city/county match, area match, or state match (fallback)
        serviceAreaMatch = cityMatch || countyMatch || areaMatch || stateMatch;
      }
      
      // Skip vendors that don't match service area
      if (!serviceAreaMatch) {
        continue;
      }
      
      const vendorKeywords = (vendor.vendor_keywords || []).flatMap(vk => {
        const serviceKeywords = vk.vendor_service_keywords;
        if (!serviceKeywords) return [];
        if (Array.isArray(serviceKeywords)) {
          return serviceKeywords.map(ks => ks.keyword_name?.toLowerCase()).filter(Boolean);
        } else if (serviceKeywords.keyword_name) {
          return [serviceKeywords.keyword_name.toLowerCase()];
        }
        return [];
      });

      const matches = await aiMatchVendor(issueDescription, vendorKeywords, vendor.description, openai);

      if (matches) {
        // Add approval info for prioritization
        const approval = approvals?.find(a => a.vendor_id === vendor.vendor_id);
        matchingVendors.push({
          ...vendor,
          approvalLevel: approval?.approval_level,
          isLandlordApproved: approval?.approved_by_landlord_id === propertyLandlordId
        });
      }
    }
    
    // Sort to prioritize landlord-approved vendors
    matchingVendors.sort((a, b) => {
      if (a.isLandlordApproved && !b.isLandlordApproved) return -1;
      if (!a.isLandlordApproved && b.isLandlordApproved) return 1;
      return 0;
    });

    return {
      success: true,
      vendors: matchingVendors.map(v => ({
        vendor_id: v.vendor_id,
        name: v.company_name || 'Unnamed Vendor',
        description: v.description
      })),
      vendor_count: matchingVendors.length,
      count: matchingVendors.length,
      message: `I found ${matchingVendors.length} vendor(s) that can handle this issue.`
    };
  } catch (error) {
    console.error('[findRoutineVendors] Error:', error);
    return {
      success: false,
      vendors: [],
      vendor_count: 0,
      count: 0,
      message: 'Error finding vendors. I\'ll create a maintenance request for the property manager to review.'
    };
  }
}

/**
 * Create maintenance request
 */
export async function createMaintenanceRequest(functionArgs, unitId, userId, supabase, openai = null, propertyId = null, callSummary = null) {
  try {
    // Allow creating unassigned requests when unitId/userId are missing
    // Include caller_name if provided for unassigned requests
    const callerName = functionArgs.caller_name || null;
    const isUnassigned = !unitId || !userId;
    const priority = functionArgs.priority || 'Medium';
    const isUrgent = priority === 'Urgent' || priority === 'Emergency';
    
    console.log('[createMaintenanceRequest] Called with context:', {
      unitId,
      userId,
      hasUnitId: !!unitId,
      hasUserId: !!userId,
      isUnassigned,
      caller_name: callerName,
      priority,
      isUrgent
    });
    
    // Try to auto-assign an approved vendor for all requests
    let assignedVendorId = null;
    let vendorAssignmentNote = null;
    
    console.log('[createMaintenanceRequest] Vendor assignment check:', {
      isUrgent,
      priority,
      hasPropertyId: !!propertyId,
      hasOpenai: !!openai,
      willAttemptAssignment: propertyId && openai
    });
    
    if (propertyId && openai) {
      try {
        const keywords = functionArgs.keywords || [];
        const issueDescription = callSummary || functionArgs.description;
        console.log('[createMaintenanceRequest] Calling findEmergencyVendors:', {
          keywordsCount: keywords.length,
          propertyId,
          unitId,
          userId,
          issueDescriptionLength: issueDescription?.length || 0
        });
        
        const emergencyVendors = await findEmergencyVendors(
          keywords,
          propertyId,
          unitId,
          userId,
          supabase,
          openai,
          false, // isVoiceCall = false
          issueDescription,
          isUrgent // requireEmergencyOnly - only require emergency service for urgent requests
        );
        
        console.log('[createMaintenanceRequest] findEmergencyVendors result:', {
          success: emergencyVendors.success,
          vendorsCount: emergencyVendors.vendors?.length || 0,
          hasVendors: !!(emergencyVendors.vendors && emergencyVendors.vendors.length > 0)
        });
        
        if (emergencyVendors.success && emergencyVendors.vendors && emergencyVendors.vendors.length > 0) {
          // Assign the first matching emergency vendor
          const selectedVendor = emergencyVendors.vendors[0];
          assignedVendorId = selectedVendor.vendor_id;
          const vendorName = selectedVendor.name || selectedVendor.company_name || 'Emergency Vendor';
          
          // Extract just the issue description, not the full call summary (which may include system prompts)
          // Use functionArgs.description if available, otherwise try to extract from callSummary
          let issueDescription = functionArgs.description || '';
          if (!issueDescription && callSummary) {
            // If callSummary contains the system prompt, try to extract just the user's description
            // Look for the actual issue description after any system prompts
            const promptMarker = 'You are a helpful maintenance assistant';
            const promptIndex = callSummary.indexOf(promptMarker);
            if (promptIndex !== -1) {
              // Extract text after the prompt, but limit to first 200 chars to avoid including full transcript
              const afterPrompt = callSummary.substring(promptIndex + promptMarker.length).trim();
              // Take first sentence or first 200 chars, whichever is shorter
              const firstSentence = afterPrompt.split(/[.!?]/)[0].trim();
              issueDescription = firstSentence.length > 0 && firstSentence.length < 200 
                ? firstSentence 
                : afterPrompt.substring(0, 200).trim();
            } else {
              // No prompt found, use first 200 chars of callSummary
              issueDescription = callSummary.substring(0, 200).trim();
            }
          }
          
          // Build vendor assignment note with best match explanation and alternatives
          const matchedKeywords = selectedVendor.matchedKeywords || [];
          const keywordsText = matchedKeywords.length > 0 
            ? matchedKeywords.slice(0, 5).join(', ')
            : 'service capabilities match';
          
          // Create a clear explanation of why this vendor was chosen
          const issueDesc = issueDescription || 'maintenance issue';
          const vendorType = isUrgent ? 'Emergency-approved vendor' : 'Approved vendor';
          let note = `Auto-assigned by voice bot: ${vendorName} - ${vendorType}. Selected because the maintenance request (${issueDesc.substring(0, 80)}${issueDesc.length > 80 ? '...' : ''}) matches the vendor's service capabilities (${keywordsText}).`;
          
          // Don't mention other vendors - only the chosen one
          
          vendorAssignmentNote = note;
          console.log('[createMaintenanceRequest] Auto-assigned request to vendor:', {
            vendorId: assignedVendorId,
            vendorName,
            priority,
            noteLength: note.length
          });
        } else {
          console.log('[createMaintenanceRequest] No vendors found or assignment failed:', {
            success: emergencyVendors.success,
            vendorsCount: emergencyVendors.vendors?.length || 0,
            error: emergencyVendors.error
          });
        }
      } catch (error) {
        console.error('[createMaintenanceRequest] Error finding vendor for auto-assignment:', {
          error: error.message,
          stack: error.stack,
          priority,
          propertyId
        });
        // Continue without auto-assignment if there's an error
      }
    } else {
      console.log('[createMaintenanceRequest] Skipping vendor assignment:', {
        reason: !propertyId ? 'no propertyId' : 'no openai client',
        priority,
        hasPropertyId: !!propertyId,
        hasOpenai: !!openai
      });
    }
    
    if (isUnassigned) {
      console.log('[createMaintenanceRequest] Creating unassigned request:', {
        caller_name: callerName,
        description: functionArgs.description,
        priority: functionArgs.priority
      });
      
      // Create unassigned maintenance request
      // Include caller information in description
      let description = functionArgs.description;
      const callerInfo = [];
      if (callerName) {
        callerInfo.push(`Caller: ${callerName}`);
      }
      if (functionArgs.caller_relationship) {
        callerInfo.push(`Relationship: ${functionArgs.caller_relationship}`);
      }
      if (functionArgs.caller_phone) {
        callerInfo.push(`Caller Phone: ${functionArgs.caller_phone}`);
      }
      if (callerInfo.length > 0) {
        description = `[Unassigned Request - ${callerInfo.join(', ')}] ${description}`;
      } else {
        description = `[Unassigned Request] ${description}`;
      }
      
      const { data: request, error } = await supabase
        .from('maintenance_requests')
        .insert([{
          unit_id: null,
          tenant_user_id: null,
          description: description,
          priority: functionArgs.priority,
          status: functionArgs.status || 'New',
          assigned_vendor_id: assignedVendorId,
          admin_notes: vendorAssignmentNote
        }])
        .select()
        .single();

      if (error) {
        console.error('[createMaintenanceRequest] Error creating unassigned request:', error);
        return {
          success: false,
          count: 0,
          error: 'Failed to create maintenance request',
          is_unassigned: true
        };
      }

      return {
        success: true,
        request_id: request.request_id,
        count: 1,
        priority: functionArgs.priority,
        description: functionArgs.description,
        is_unassigned: true,
        message: `I've created an unassigned maintenance request for you (Priority: ${functionArgs.priority}). An administrator will review your request and assign it to the appropriate unit. They will contact you soon.`
      };
    }

    // Build admin notes
    let adminNotes = vendorAssignmentNote || null;
    
    // In DEBUG_MODE, add the tenant's phone number to admin_notes
    // This allows the cron job to call the tenant (who is set up as a Global Admin for testing)
    const isDebugMode = () => {
      const debugMode = process.env.DEBUG_MODE;
      if (!debugMode) return false;
      const normalized = debugMode.trim().toLowerCase();
      return normalized === 'true' || normalized === '1' || normalized === 'on';
    };
    
    console.log('[createMaintenanceRequest] [DEBUG_MODE_CHECK]', {
      isDebugMode: isDebugMode(),
      hasUserId: !!userId,
      userId: userId,
      willAttemptPhoneLookup: isDebugMode() && userId
    });
    
    if (isDebugMode() && userId) {
      try {
        console.log('[createMaintenanceRequest] [DEBUG_MODE] Starting phone lookup for userId:', userId);
        // Get tenant phone number - try both 'user' and 'client' contactable types
        // For tenants, the contact might be stored as 'client' type
        let contact = null;
        
        // Try 'user' type first
        console.log('[createMaintenanceRequest] [DEBUG_MODE] Trying contactable_type: user for contactable_id:', userId);
        const { data: contactUser, error: contactUserError } = await supabase
          .from('contacts')
          .select('contact_id')
          .eq('contactable_id', userId)
          .eq('contactable_type', 'user')
          .limit(1)
          .maybeSingle();
        
        console.log('[createMaintenanceRequest] [DEBUG_MODE] User contact query result:', {
          hasContact: !!contactUser,
          contactId: contactUser?.contact_id,
          error: contactUserError?.message
        });
        
        if (contactUser) {
          contact = contactUser;
          console.log('[createMaintenanceRequest] [DEBUG_MODE] Found contact with type "user"');
        } else {
          // Try 'client' type - first try with userId directly (phone might be stored with contactable_id = user_id)
          console.log('[createMaintenanceRequest] [DEBUG_MODE] Trying contactable_type: client for contactable_id:', userId, '(user_id directly)');
          const { data: contactClientDirect, error: contactClientDirectError } = await supabase
            .from('contacts')
            .select('contact_id')
            .eq('contactable_id', userId)
            .eq('contactable_type', 'client')
            .limit(1)
            .maybeSingle();
          
          console.log('[createMaintenanceRequest] [DEBUG_MODE] Client contact query result (direct with user_id):', {
            hasContact: !!contactClientDirect,
            contactId: contactClientDirect?.contact_id,
            error: contactClientDirectError?.message
          });
          
          if (contactClientDirect) {
            contact = contactClientDirect;
            console.log('[createMaintenanceRequest] [DEBUG_MODE] Found contact with type "client" using user_id directly');
          } else {
            // Fallback: Try with client_id from clients table
            console.log('[createMaintenanceRequest] [DEBUG_MODE] Trying to find client for user_id:', userId);
            const { data: client, error: clientError } = await supabase
              .from('clients')
              .select('client_id')
              .eq('user_id', userId)
              .limit(1)
              .maybeSingle();
            
            console.log('[createMaintenanceRequest] [DEBUG_MODE] Client query result:', {
              hasClient: !!client,
              clientId: client?.client_id,
              error: clientError?.message
            });
            
            if (client) {
              console.log('[createMaintenanceRequest] [DEBUG_MODE] Trying contactable_type: client for contactable_id:', client.client_id, '(client_id from clients table)');
              const { data: contactClient, error: contactClientError } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', client.client_id)
                .eq('contactable_type', 'client')
                .limit(1)
                .maybeSingle();
              
              console.log('[createMaintenanceRequest] [DEBUG_MODE] Client contact query result (with client_id):', {
                hasContact: !!contactClient,
                contactId: contactClient?.contact_id,
                error: contactClientError?.message
              });
              
              if (contactClient) {
                contact = contactClient;
                console.log('[createMaintenanceRequest] [DEBUG_MODE] Found contact with type "client" using client_id');
              }
            }
          }
        }
        
        if (contact) {
          console.log('[createMaintenanceRequest] [DEBUG_MODE] Looking up contact_methods for contact_id:', contact.contact_id);
          const { data: contactMethods, error: contactMethodsError } = await supabase
            .from('contact_methods')
            .select('value, method_type')
            .eq('contact_id', contact.contact_id)
            .in('method_type', ['Phone', 'phone', 'Cell', 'cell', 'mobile', 'Mobile'])
            .limit(1)
            .maybeSingle();
          
          console.log('[createMaintenanceRequest] [DEBUG_MODE] Contact methods query result:', {
            hasMethods: !!contactMethods,
            value: contactMethods?.value,
            methodType: contactMethods?.method_type,
            error: contactMethodsError?.message
          });
          
          if (contactMethods) {
            const tenantPhone = contactMethods.value;
            // Format phone number nicely (add dashes for US numbers)
            const digitsOnly = tenantPhone.replace(/\D/g, '');
            let formattedPhone = digitsOnly;
            if (digitsOnly.length === 10) {
              formattedPhone = `${digitsOnly.substring(0, 3)}-${digitsOnly.substring(3, 6)}-${digitsOnly.substring(6)}`;
            } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
              // Remove leading 1 and format
              const tenDigits = digitsOnly.substring(1);
              formattedPhone = `${tenDigits.substring(0, 3)}-${tenDigits.substring(3, 6)}-${tenDigits.substring(6)}`;
            }
            const debugModePhoneNote = `\n[DEBUG_MODE phone: ${formattedPhone}]`;
            adminNotes = (adminNotes ? adminNotes + '\n' : '') + debugModePhoneNote;
            console.log(`[createMaintenanceRequest] [DEBUG_MODE] Successfully added tenant phone to admin_notes: ${formattedPhone}`, {
              originalPhone: tenantPhone,
              formattedPhone,
              adminNotesLength: adminNotes.length
            });
          } else {
            console.log(`[createMaintenanceRequest] [DEBUG_MODE] Contact found (contact_id: ${contact.contact_id}) but no phone number in contact_methods for userId: ${userId}`, {
              contactMethodsError: contactMethodsError?.message
            });
          }
        } else {
          console.log(`[createMaintenanceRequest] [DEBUG_MODE] No contact found for userId: ${userId} (tried both 'user' and 'client' types)`);
        }
      } catch (err) {
        console.error(`[createMaintenanceRequest] [DEBUG_MODE] Error adding tenant phone to admin_notes:`, {
          error: err.message,
          stack: err.stack,
          userId: userId
        });
      }
    } else {
      console.log('[createMaintenanceRequest] [DEBUG_MODE] Skipping phone lookup:', {
        isDebugMode: isDebugMode(),
        hasUserId: !!userId,
        reason: !isDebugMode() ? 'DEBUG_MODE not enabled' : !userId ? 'no userId' : 'unknown'
      });
    }

    // Create assigned request (normal flow)
    const insertData = {
      unit_id: unitId,
      tenant_user_id: userId,
      description: functionArgs.description,
      priority: functionArgs.priority,
      status: functionArgs.status || 'New',
      assigned_vendor_id: assignedVendorId,
      admin_notes: adminNotes
    };
    
    console.log('[createMaintenanceRequest] [INSERT_DATA] About to insert maintenance request:', {
      unit_id: insertData.unit_id,
      tenant_user_id: insertData.tenant_user_id,
      hasUnitId: !!insertData.unit_id,
      hasTenantUserId: !!insertData.tenant_user_id,
      adminNotesLength: insertData.admin_notes ? insertData.admin_notes.length : 0,
      adminNotesPreview: insertData.admin_notes ? insertData.admin_notes.substring(0, 200) : null,
      hasDebugModePhone: insertData.admin_notes ? insertData.admin_notes.includes('[DEBUG_MODE phone:') : false
    });
    
    const { data: request, error } = await supabase
      .from('maintenance_requests')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('[createMaintenanceRequest] [INSERT_ERROR] Database insert failed:', {
        error: error.message,
        code: error.code,
        details: error.details,
        insertData: {
          unit_id: insertData.unit_id,
          tenant_user_id: insertData.tenant_user_id,
          hasUnitId: !!insertData.unit_id,
          hasTenantUserId: !!insertData.tenant_user_id
        }
      });
      return {
        success: false,
        count: 0,
        error: 'Failed to create maintenance request'
      };
    }
    
    console.log('[createMaintenanceRequest] [INSERT_SUCCESS] Maintenance request created:', {
      request_id: request.request_id,
      unit_id: request.unit_id,
      tenant_user_id: request.tenant_user_id,
      hasUnitId: !!request.unit_id,
      hasTenantUserId: !!request.tenant_user_id,
      adminNotesLength: request.admin_notes ? request.admin_notes.length : 0,
      hasDebugModePhone: request.admin_notes ? request.admin_notes.includes('[DEBUG_MODE phone:') : false
    });
    
    // Verify the record was actually saved correctly by querying it back
    if (request.request_id) {
      const { data: verifyRequest, error: verifyError } = await supabase
        .from('maintenance_requests')
        .select('request_id, unit_id, tenant_user_id')
        .eq('request_id', request.request_id)
        .single();
      
      if (verifyError) {
        console.error('[createMaintenanceRequest] [VERIFY_ERROR] Failed to verify request after insert:', verifyError);
      } else {
        console.log('[createMaintenanceRequest] [VERIFY_SUCCESS] Verified request in database:', {
          request_id: verifyRequest.request_id,
          unit_id: verifyRequest.unit_id,
          tenant_user_id: verifyRequest.tenant_user_id,
          hasUnitId: !!verifyRequest.unit_id,
          hasTenantUserId: !!verifyRequest.tenant_user_id,
          matchesInsert: verifyRequest.tenant_user_id === insertData.tenant_user_id && verifyRequest.unit_id === insertData.unit_id
        });
        
        if (verifyRequest.tenant_user_id !== insertData.tenant_user_id || verifyRequest.unit_id !== insertData.unit_id) {
          console.error('[createMaintenanceRequest] [VERIFY_MISMATCH] Database values do not match insert values!', {
            inserted: { unit_id: insertData.unit_id, tenant_user_id: insertData.tenant_user_id },
            inDatabase: { unit_id: verifyRequest.unit_id, tenant_user_id: verifyRequest.tenant_user_id }
          });
        }
      }
    }

    return {
      success: true,
      request_id: request.request_id,
      count: 1,
      priority: functionArgs.priority,
      description: functionArgs.description,
      is_unassigned: false,
      message: `I've created a maintenance request for you (Priority: ${functionArgs.priority}). A vendor will be assigned to your request and will contact you soon.`
    };
  } catch (error) {
    console.error('[createMaintenanceRequest] Error:', error);
    return {
      success: false,
      count: 0,
      error: 'Error creating maintenance request'
    };
  }
}

/**
 * Use AI to intelligently match maintenance issues to vendor capabilities
 */
async function aiMatchVendor(issueDescription, vendorKeywords, vendorDescription, openai) {
  try {
    const vendorCapabilities = [
      ...(vendorKeywords || []),
      vendorDescription || ''
    ].filter(Boolean).join(', ');

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a maintenance request matching assistant. Determine if a vendor can handle a maintenance issue based on their capabilities. Return only "yes" or "no".'
        },
        {
          role: 'user',
          content: `Maintenance issue: "${issueDescription}"

Vendor capabilities: "${vendorCapabilities}"

Can this vendor handle this issue? Answer only "yes" or "no".`
        }
      ],
      temperature: 0.1,
      max_tokens: 10
    });

    const answer = response.choices[0].message.content?.toLowerCase().trim();
    return answer === 'yes';
  } catch (error) {
    console.error('[aiMatchVendor] Error:', error);
    return false;
  }
}

/**
 * Score vendor match quality (0-1) based on issue description and vendor capabilities
 * Returns score and relevant keywords that matched
 */
async function scoreVendorMatch(issueDescription, vendorKeywords, vendorDescription, openai) {
  try {
    const vendorCapabilities = [
      ...(vendorKeywords || []),
      vendorDescription || ''
    ].filter(Boolean).join(', ');

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a maintenance request matching assistant. Score how well a vendor matches a maintenance issue on a scale of 0.0 to 1.0, where 1.0 is a perfect match and 0.0 is no match. Also identify the specific keywords or capabilities that match. Return ONLY a valid JSON object with "score" (number) and "matchedKeywords" (array of strings). Do not include any other text.'
        },
        {
          role: 'user',
          content: `Maintenance issue: "${issueDescription}"

Vendor capabilities: "${vendorCapabilities}"

Score this match and identify matching keywords. Return ONLY valid JSON: {"score": 0.0-1.0, "matchedKeywords": ["keyword1", "keyword2"]}`
        }
      ],
      temperature: 0.1,
      max_tokens: 200
    });

    const content = response.choices[0].message.content?.trim();
    if (!content) return { score: 0, matchedKeywords: [] };
    
    // Try to extract JSON from the response (might have extra text)
    let jsonContent = content;
    // Look for JSON object in the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonContent = jsonMatch[0];
    }
    
    try {
      const result = JSON.parse(jsonContent);
      return {
        score: Math.max(0, Math.min(1, result.score || 0)),
        matchedKeywords: Array.isArray(result.matchedKeywords) ? result.matchedKeywords : []
      };
    } catch (parseError) {
      // If JSON parsing fails, fall back to simple keyword matching
      console.warn('[scoreVendorMatch] Failed to parse JSON response, using fallback:', parseError);
      const issueLower = (issueDescription || '').toLowerCase();
      const matchedKeywords = (vendorKeywords || []).filter(kw => 
        issueLower.includes(kw.toLowerCase()) || kw.toLowerCase().includes(issueLower)
      );
      return {
        score: matchedKeywords.length > 0 ? 0.5 : 0,
        matchedKeywords: matchedKeywords
      };
    }
  } catch (error) {
    console.error('[scoreVendorMatch] Error:', error);
    // Fallback to simple keyword matching
    const issueLower = (issueDescription || '').toLowerCase();
    const matchedKeywords = (vendorKeywords || []).filter(kw => 
      issueLower.includes(kw.toLowerCase()) || kw.toLowerCase().includes(issueLower)
    );
    return {
      score: matchedKeywords.length > 0 ? 0.5 : 0,
      matchedKeywords: matchedKeywords
    };
  }
}


/**
 * Get responsible person's phone number for a property
 * Searches in order: PM manager, company admin, global admin, property owner
 * @param {Object} supabase - Supabase client
 * @param {number} propertyId - Property ID
 * @param {boolean} returnOwnerOnly - If true, only return property owner's phone number
 * @returns {Object|null} - Object with phone number, name, and role, or null if not found
 */
export async function getResponsiblePersonPhone(supabase, propertyId, returnOwnerOnly = false) {
  try {
    if (!propertyId) {
      return null;
    }

    // Get property information
    const { data: property, error: propError } = await supabase
      .from('properties')
      .select('property_id, pmc_id, landlord_id')
      .eq('property_id', propertyId)
      .single();

    if (propError || !property) {
      console.error('[getResponsiblePersonPhone] Error fetching property:', propError);
      return null;
    }

    // If only owner is requested, skip to owner lookup
    if (!returnOwnerOnly) {
      // 1. Try to find manager at PM company
      if (property.pmc_id) {
        const { data: managers, error: managerError } = await supabase
          .from('users')
          .select('user_id, role')
          .eq('pmc_id', property.pmc_id)
          .eq('role', 'manager')
          .limit(1);

        if (!managerError && managers && managers.length > 0) {
          const manager = managers[0];
          const phone = await getPhoneForUser(supabase, manager.user_id);
          if (phone) {
            const contact = await getContactForUser(supabase, manager.user_id);
            return {
              phone,
              name: contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : 'Property Manager',
              role: 'manager',
              type: 'pm_manager'
            };
          }
        }
      }

      // 2. Try to find company admin
      if (property.pmc_id) {
        const { data: companyAdmins, error: adminError } = await supabase
          .from('users')
          .select('user_id, role')
          .eq('pmc_id', property.pmc_id)
          .eq('role', 'company_admin')
          .limit(1);

        if (!adminError && companyAdmins && companyAdmins.length > 0) {
          const admin = companyAdmins[0];
          const phone = await getPhoneForUser(supabase, admin.user_id);
          if (phone) {
            const contact = await getContactForUser(supabase, admin.user_id);
            return {
              phone,
              name: contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : 'Company Admin',
              role: 'company_admin',
              type: 'company_admin'
            };
          }
        }
      }

      // 3. Try to find global admin
      const { data: globalAdmins, error: globalAdminError } = await supabase
        .from('users')
        .select('user_id, role')
        .eq('role', 'global_admin')
        .limit(1);

      if (!globalAdminError && globalAdmins && globalAdmins.length > 0) {
        const globalAdmin = globalAdmins[0];
        const phone = await getPhoneForUser(supabase, globalAdmin.user_id);
        if (phone) {
          const contact = await getContactForUser(supabase, globalAdmin.user_id);
          return {
            phone,
            name: contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : 'Global Admin',
            role: 'global_admin',
            type: 'global_admin'
          };
        }
      }
    }

    // 4. Get property owner (landlord) phone number
    if (property.landlord_id) {
      console.log('[getResponsiblePersonPhone] Looking up landlord:', { landlordId: property.landlord_id });
      const { data: landlord, error: landlordError } = await supabase
        .from('landlords')
        .select('landlord_id')
        .eq('landlord_id', property.landlord_id)
        .single();

      if (landlordError) {
        console.error('[getResponsiblePersonPhone] Error fetching landlord:', landlordError);
      } else if (!landlord) {
        console.log('[getResponsiblePersonPhone] Landlord not found:', { landlordId: property.landlord_id });
      } else {
        // Get contact for landlord
        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .select('contact_id, first_name, last_name')
          .eq('contactable_id', landlord.landlord_id)
          .eq('contactable_type', 'landlord')
          .limit(1)
          .maybeSingle();

        if (contactError) {
          console.error('[getResponsiblePersonPhone] Error fetching landlord contact:', contactError);
        } else if (!contact) {
          console.log('[getResponsiblePersonPhone] No contact found for landlord:', { landlordId: landlord.landlord_id });
        } else {
          // Get phone number for landlord contact - check multiple method types (case-insensitive)
          const { data: contactMethods, error: methodError } = await supabase
            .from('contact_methods')
            .select('value, method_type')
            .eq('contact_id', contact.contact_id)
            .in('method_type', ['phone', 'Phone', 'cell', 'Cell', 'mobile', 'Mobile', 'CELL', 'MOBILE'])
            .limit(10);

          if (methodError) {
            console.error('[getResponsiblePersonPhone] Error fetching landlord contact methods:', methodError);
          } else if (!contactMethods || contactMethods.length === 0) {
            console.log('[getResponsiblePersonPhone] No phone contact methods found for landlord:', { 
              landlordId: landlord.landlord_id, 
              contactId: contact.contact_id 
            });
          } else {
            console.log('[getResponsiblePersonPhone] Found landlord phone:', { 
              landlordId: landlord.landlord_id,
              phone: contactMethods[0].value,
              methodType: contactMethods[0].method_type
            });
            return {
              phone: contactMethods[0].value,
              name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Property Owner',
              role: 'landlord',
              type: 'property_owner'
            };
          }
        }
      }
    } else {
      console.log('[getResponsiblePersonPhone] Property has no landlord_id:', { propertyId });
    }

    return null;
  } catch (error) {
    console.error('[getResponsiblePersonPhone] Error:', error);
    return null;
  }
}

/**
 * Helper function to get phone number for a user
 */
async function getPhoneForUser(supabase, userId) {
  try {
    // Get contact for user
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('contactable_id', userId)
      .eq('contactable_type', 'user')
      .limit(1)
      .maybeSingle();

    if (contactError || !contact) {
      return null;
    }

    // Get phone number - check multiple method types (case-insensitive)
    const { data: contactMethods, error: methodError } = await supabase
      .from('contact_methods')
      .select('value, method_type')
      .eq('contact_id', contact.contact_id)
      .in('method_type', ['phone', 'Phone', 'cell', 'Cell', 'mobile', 'Mobile', 'CELL', 'MOBILE'])
      .limit(10);

    if (methodError || !contactMethods || contactMethods.length === 0) {
      return null;
    }

    // Return the first phone number found
    return contactMethods[0].value;
  } catch (error) {
    console.error('[getPhoneForUser] Error:', error);
    return null;
  }
}

/**
 * Helper function to get contact info for a user
 */
async function getContactForUser(supabase, userId) {
  try {
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('first_name, last_name')
      .eq('contactable_id', userId)
      .eq('contactable_type', 'user')
      .limit(1)
      .maybeSingle();

    if (error || !contact) {
      return null;
    }

    return contact;
  } catch (error) {
    console.error('[getContactForUser] Error:', error);
    return null;
  }
}

