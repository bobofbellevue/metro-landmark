/**
 * Address Normalization Utility
 * 
 * Normalizes addresses for flexible matching, handling variations like:
 * - "Avenue" vs "Ave" vs "Av"
 * - "Southeast" vs "SE" vs "S.E."
 * - "Street" vs "St" vs "Str"
 * - Case insensitivity
 * - Extra whitespace
 */

// Common street type abbreviations
const STREET_TYPE_ABBREVIATIONS = {
  'avenue': ['ave', 'av', 'avn'],
  'street': ['st', 'str', 'stree'],
  'road': ['rd'],
  'boulevard': ['blvd', 'boul', 'boulevarde'],
  'drive': ['dr', 'drv'],
  'lane': ['ln'],
  'court': ['ct', 'crt'],
  'place': ['pl', 'plc'],
  'circle': ['cir', 'circ'],
  'parkway': ['pkwy', 'pky'],
  'highway': ['hwy', 'hiway'],
  'terrace': ['ter', 'terr'],
  'trail': ['trl', 'tr'],
  'way': ['wy'],
  'north': ['n', 'n.'],
  'south': ['s', 's.'],
  'east': ['e', 'e.'],
  'west': ['w', 'w.'],
  'northeast': ['ne', 'n.e.', 'northeast'],
  'northwest': ['nw', 'n.w.', 'northwest'],
  'southeast': ['se', 's.e.', 'southeast'],
  'southwest': ['sw', 's.w.', 'southwest']
};

// US State abbreviations mapping
const STATE_ABBREVIATIONS = {
  'alabama': ['al', 'ala'],
  'alaska': ['ak', 'alas'],
  'arizona': ['az', 'ariz'],
  'arkansas': ['ar', 'ark'],
  'california': ['ca', 'cal', 'calif'],
  'colorado': ['co', 'col', 'colo'],
  'connecticut': ['ct', 'conn'],
  'delaware': ['de', 'del'],
  'florida': ['fl', 'fla'],
  'georgia': ['ga'],
  'hawaii': ['hi'],
  'idaho': ['id'],
  'illinois': ['il', 'ill'],
  'indiana': ['in', 'ind'],
  'iowa': ['ia'],
  'kansas': ['ks', 'kan'],
  'kentucky': ['ky', 'ken'],
  'louisiana': ['la'],
  'maine': ['me'],
  'maryland': ['md'],
  'massachusetts': ['ma', 'mass'],
  'michigan': ['mi', 'mich'],
  'minnesota': ['mn', 'minn'],
  'mississippi': ['ms', 'miss'],
  'missouri': ['mo'],
  'montana': ['mt', 'mont'],
  'nebraska': ['ne', 'neb'],
  'nevada': ['nv', 'nev'],
  'new hampshire': ['nh'],
  'new jersey': ['nj'],
  'new mexico': ['nm'],
  'new york': ['ny'],
  'north carolina': ['nc'],
  'north dakota': ['nd'],
  'ohio': ['oh'],
  'oklahoma': ['ok', 'okla'],
  'oregon': ['or', 'ore'],
  'pennsylvania': ['pa', 'penn'],
  'rhode island': ['ri'],
  'south carolina': ['sc'],
  'south dakota': ['sd'],
  'tennessee': ['tn', 'tenn'],
  'texas': ['tx', 'tex'],
  'utah': ['ut'],
  'vermont': ['vt'],
  'virginia': ['va'],
  'washington': ['wa', 'wash'],
  'west virginia': ['wv'],
  'wisconsin': ['wi', 'wis'],
  'wyoming': ['wy', 'wyo']
};

/**
 * Normalize a street type (e.g., "Avenue" -> "Ave", "SE" -> "Southeast")
 * @param {string} streetType - The street type to normalize
 * @returns {string} - Normalized street type
 */
function normalizeStreetType(streetType) {
  if (!streetType) return '';
  
  const lower = streetType.toLowerCase().trim();
  
  // Check if it's already a full form
  if (STREET_TYPE_ABBREVIATIONS[lower]) {
    return lower;
  }
  
  // Check if it's an abbreviation
  for (const [fullForm, abbreviations] of Object.entries(STREET_TYPE_ABBREVIATIONS)) {
    if (abbreviations.includes(lower)) {
      return fullForm;
    }
  }
  
  // Return as-is if not found
  return lower;
}

/**
 * Normalize a state name (e.g., "Michigan" -> "mi", "MI" -> "mi", "Mich." -> "mi")
 * @param {string} state - The state to normalize
 * @returns {string} - Normalized state abbreviation (lowercase)
 */
function normalizeState(state) {
  if (!state) return '';
  
  const lower = state.toLowerCase().trim().replace(/\./g, '');
  
  // Check if it's already a full state name
  if (STATE_ABBREVIATIONS[lower]) {
    return STATE_ABBREVIATIONS[lower][0]; // Return the standard abbreviation
  }
  
  // Check if it's an abbreviation
  for (const [, abbreviations] of Object.entries(STATE_ABBREVIATIONS)) {
    if (abbreviations.includes(lower)) {
      return abbreviations[0]; // Return the standard abbreviation
    }
  }
  
  // Return as-is if not found (might be a non-US state or already normalized)
  return lower;
}

/**
 * Normalize an address string for flexible matching
 * @param {string} address - Address string to normalize
 * @returns {string} - Normalized address
 */
export function normalizeAddressString(address) {
  if (!address) return '';
  
  // Convert to lowercase and trim
  let normalized = address.toLowerCase().trim();
  
  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Fix split house numbers and street numbers
  // Handles cases like:
  // - "23 20" -> "2320" (concatenation for split house numbers)
  // - "100 61st" -> "161st" (addition for spoken numbers like "a hundred sixty first")
  // - "100 61" -> "161" (addition when followed by street name)
  // - "1 6 1 32" -> "16132" (grid system: street number + house digits)
  // - "1 61 32" -> "16132" (grid system with combined street number)
  // - "100 61 32" -> "16132" (grid system with "a hundred sixty one thirty two")
  
  // Pattern 1: Handle grid system house numbers with multiple number groups
  // Examples: "1 6 1 32", "1 61 32", "100 61 32", "1 6 1 3 2" -> "16132"
  // This handles addresses where the house number is based on the crossing street
  // Pattern matches 3-5 number groups at the start of the address
  const gridSystemPattern = /^((?:\d+\s+){2,4}\d+)(\s|$)/;
  const gridMatch = normalized.match(gridSystemPattern);
  if (gridMatch) {
    const numberGroups = gridMatch[1].trim().split(/\s+/);
    if (numberGroups.length >= 3 && numberGroups.length <= 5) {
      // Try to intelligently combine the numbers
      let combined = '';
      let i = 0;
      
      // Process groups, handling round hundreds specially
      while (i < numberGroups.length) {
        const num = parseInt(numberGroups[i]);
        const nextNum = i + 1 < numberGroups.length ? parseInt(numberGroups[i + 1]) : null;
        
        // If we have a round hundred (100, 200, etc.) followed by a number < 100,
        // add them (e.g., "100 61" -> "161")
        if (num % 100 === 0 && num >= 100 && nextNum !== null && nextNum < 100 && nextNum > 0) {
          combined += (num + nextNum).toString();
          i += 2; // Skip both numbers
        } 
        // If we have a single digit followed by a 2-digit number (like "1 61"),
        // concatenate them (e.g., "1" + "61" -> "161")
        else if (numberGroups[i].length === 1 && nextNum !== null && nextNum < 100 && nextNum >= 10) {
          combined += numberGroups[i] + numberGroups[i + 1];
          i += 2;
        }
        // Otherwise, just concatenate the current number
        else {
          combined += numberGroups[i];
          i++;
        }
      }
      
      // Only apply if the result is a reasonable house number (3-6 digits)
      // and we actually combined something (not just one number)
      if (combined.length >= 3 && combined.length <= 6 && numberGroups.length > 1) {
        normalized = normalized.replace(gridSystemPattern, combined + gridMatch[2]);
      }
    }
  }
  
  // Pattern 2: Handle "100 61st" -> "161st" (number + ordinal with suffix)
  normalized = normalized.replace(/^(\d+)\s+(\d+)(st|nd|rd|th)\b/i, (match, num1, num2, suffix) => {
    const n1 = parseInt(num1);
    const n2 = parseInt(num2);
    // If first number is a round hundred (100, 200, etc.) and second is < 100, likely addition
    // e.g., "100 61st" = "161st" (one hundred sixty-first)
    if (n1 % 100 === 0 && n1 >= 100 && n2 < 100 && n2 > 0) {
      const sum = n1 + n2;
      return sum + suffix.toLowerCase();
    }
    return match;
  });
  
  // Pattern 3: Handle "100 61" at start of address (likely addition, not concatenation)
  // Only if followed by a street name (not another number)
  normalized = normalized.replace(/^(\d+)\s+(\d+)(\s+[a-z])/i, (match, num1, num2, after) => {
    const n1 = parseInt(num1);
    const n2 = parseInt(num2);
    // If first number is a round hundred and second is < 100, likely addition
    // e.g., "100 61 Maple" = "161 Maple" (one hundred sixty-first street)
    if (n1 % 100 === 0 && n1 >= 100 && n2 < 100 && n2 > 0) {
      return (n1 + n2) + after;
    }
    return match;
  });
  
  // Pattern 4: Handle simple concatenation for split house numbers (e.g., "23 20" -> "2320")
  // This is for cases where voice-to-text splits numbers like "twenty three twenty" into "23 20"
  // Only merge if both numbers are short (likely a split house number, not separate components)
  // Skip if we already processed it as a grid system number above
  if (!gridMatch || gridMatch[1].split(/\s+/).length < 3) {
    normalized = normalized.replace(/^(\d+)\s+(\d+)(\s|$)/, (match, num1, num2, after) => {
      const n1 = parseInt(num1);
      const n2 = parseInt(num2);
      // Don't merge if we already handled it as addition above
      // Only merge if both are short (1-4 digits) and not a round hundred case
      if (num1.length <= 4 && num2.length <= 4 && !(n1 % 100 === 0 && n1 >= 100 && n2 < 100)) {
        return num1 + num2 + after;
      }
      return match;
    });
  }
  
  // Remove common punctuation
  normalized = normalized.replace(/[.,;:]/g, '');
  
  // Normalize street type abbreviations
  // Match patterns like "123 Main St", "123 Main Street", "123 Main St."
  const streetTypePattern = /\b(avenue|ave|av|street|st|str|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|way|wy)\b\.?/gi;
  normalized = normalized.replace(streetTypePattern, (match) => {
    const withoutPeriod = match.replace(/\./g, '').trim();
    return normalizeStreetType(withoutPeriod);
  });
  
  // Normalize directional abbreviations
  // Match patterns like "N", "N.", "North", "NE", "N.E.", "Northeast"
  const directionalPattern = /\b(north|n|south|s|east|e|west|w|northeast|ne|northwest|nw|southeast|se|southwest|sw)\b\.?/gi;
  normalized = normalized.replace(directionalPattern, (match) => {
    const withoutPeriod = match.replace(/\./g, '').trim();
    return normalizeStreetType(withoutPeriod);
  });
  
  // Normalize state abbreviations (at the end of address or after city)
  // Match state names/abbreviations that might appear after city
  const statePattern = /\b([a-z]{2,})\b(?!\s*(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|way|wy|north|south|east|west|northeast|northwest|southeast|southwest))/gi;
  normalized = normalized.replace(statePattern, (match, statePart) => {
    const normalizedState = normalizeState(statePart);
    return normalizedState !== statePart.toLowerCase() ? normalizedState : match;
  });
  
  return normalized.trim();
}

/**
 * Normalize an address object for flexible matching
 * @param {Object} address - Address object with address_line_1, city, etc.
 * @returns {Object} - Normalized address object
 */
export function normalizeAddress(address) {
  if (!address) return {};
  
  return {
    address_line_1: normalizeAddressString(address.address_line_1 || ''),
    address_line_2: normalizeAddressString(address.address_line_2 || ''),
    city: normalizeAddressString(address.city || ''),
    state_province_region: normalizeState(address.state_province_region || ''),
    postal_code: (address.postal_code || '').replace(/\s+/g, '').toUpperCase(), // Remove spaces, uppercase
    country: normalizeAddressString(address.country || '')
  };
}

/**
 * Check if two addresses match (flexible matching)
 * @param {Object|string} address1 - First address (object or string)
 * @param {Object|string} address2 - Second address (object or string)
 * @returns {boolean} - True if addresses match
 */
export function addressesMatch(address1, address2) {
  if (!address1 || !address2) return false;
  
  // If both are strings, normalize and compare
  if (typeof address1 === 'string' && typeof address2 === 'string') {
    return normalizeAddressString(address1) === normalizeAddressString(address2);
  }
  
  // If one is string and one is object, convert string to object
  if (typeof address1 === 'string') {
    address1 = { address_line_1: address1 };
  }
  if (typeof address2 === 'string') {
    address2 = { address_line_1: address2 };
  }
  
  const norm1 = normalizeAddress(address1);
  const norm2 = normalizeAddress(address2);
  
  // Compare key fields
  if (norm1.address_line_1 && norm2.address_line_1) {
    if (norm1.address_line_1 !== norm2.address_line_1) return false;
  }
  
  if (norm1.city && norm2.city) {
    if (norm1.city !== norm2.city) return false;
  }
  
  if (norm1.postal_code && norm2.postal_code) {
    if (norm1.postal_code !== norm2.postal_code) return false;
  }
  
  return true;
}

/**
 * Create a search-friendly version of an address for database queries
 * @param {Object|string} address - Address to create search string from
 * @returns {string} - Search-friendly address string
 */
export function createAddressSearchString(address) {
  if (!address) return '';
  
  if (typeof address === 'string') {
    return normalizeAddressString(address);
  }
  
  const normalized = normalizeAddress(address);
  const parts = [
    normalized.address_line_1,
    normalized.city,
    normalized.state_province_region,
    normalized.postal_code
  ].filter(Boolean);
  
  return parts.join(' ');
}

