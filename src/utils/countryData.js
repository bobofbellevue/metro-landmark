/**
 * Country data utility with country codes, phone codes, and flag emojis
 * Supports international addresses and phone numbers
 */

// Country data with ISO codes, phone codes, and flag emojis
export const countries = [
  { code: 'US', name: 'United States', phoneCode: '1', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', phoneCode: '1', flag: '🇨🇦' },
  { code: 'MX', name: 'Mexico', phoneCode: '52', flag: '🇲🇽' },
  { code: 'GB', name: 'United Kingdom', phoneCode: '44', flag: '🇬🇧' },
  { code: 'AU', name: 'Australia', phoneCode: '61', flag: '🇦🇺' },
  { code: 'CN', name: 'China', phoneCode: '86', flag: '🇨🇳' },
  { code: 'IN', name: 'India', phoneCode: '91', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', phoneCode: '81', flag: '🇯🇵' },
  { code: 'DE', name: 'Germany', phoneCode: '49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', phoneCode: '33', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', phoneCode: '39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', phoneCode: '34', flag: '🇪🇸' },
  { code: 'BR', name: 'Brazil', phoneCode: '55', flag: '🇧🇷' },
  { code: 'RU', name: 'Russia', phoneCode: '7', flag: '🇷🇺' },
  { code: 'KR', name: 'South Korea', phoneCode: '82', flag: '🇰🇷' },
  { code: 'NL', name: 'Netherlands', phoneCode: '31', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', phoneCode: '46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', phoneCode: '47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', phoneCode: '45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', phoneCode: '358', flag: '🇫🇮' },
  { code: 'PL', name: 'Poland', phoneCode: '48', flag: '🇵🇱' },
  { code: 'IE', name: 'Ireland', phoneCode: '353', flag: '🇮🇪' },
  { code: 'CH', name: 'Switzerland', phoneCode: '41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', phoneCode: '43', flag: '🇦🇹' },
  { code: 'BE', name: 'Belgium', phoneCode: '32', flag: '🇧🇪' },
  { code: 'PT', name: 'Portugal', phoneCode: '351', flag: '🇵🇹' },
  { code: 'GR', name: 'Greece', phoneCode: '30', flag: '🇬🇷' },
  { code: 'NZ', name: 'New Zealand', phoneCode: '64', flag: '🇳🇿' },
  { code: 'SG', name: 'Singapore', phoneCode: '65', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', phoneCode: '852', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', phoneCode: '886', flag: '🇹🇼' },
  { code: 'TH', name: 'Thailand', phoneCode: '66', flag: '🇹🇭' },
  { code: 'MY', name: 'Malaysia', phoneCode: '60', flag: '🇲🇾' },
  { code: 'PH', name: 'Philippines', phoneCode: '63', flag: '🇵🇭' },
  { code: 'ID', name: 'Indonesia', phoneCode: '62', flag: '🇮🇩' },
  { code: 'VN', name: 'Vietnam', phoneCode: '84', flag: '🇻🇳' },
  { code: 'ZA', name: 'South Africa', phoneCode: '27', flag: '🇿🇦' },
  { code: 'EG', name: 'Egypt', phoneCode: '20', flag: '🇪🇬' },
  { code: 'SA', name: 'Saudi Arabia', phoneCode: '966', flag: '🇸🇦' },
  { code: 'AE', name: 'United Arab Emirates', phoneCode: '971', flag: '🇦🇪' },
  { code: 'IL', name: 'Israel', phoneCode: '972', flag: '🇮🇱' },
  { code: 'TR', name: 'Turkey', phoneCode: '90', flag: '🇹🇷' },
  { code: 'AR', name: 'Argentina', phoneCode: '54', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', phoneCode: '56', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', phoneCode: '57', flag: '🇨🇴' },
  { code: 'PE', name: 'Peru', phoneCode: '51', flag: '🇵🇪' },
  { code: 'VE', name: 'Venezuela', phoneCode: '58', flag: '🇻🇪' },
];

// Get country by code
export const getCountryByCode = (code) => {
  return countries.find(c => c.code === code) || countries[0]; // Default to US
};

// Get country by phone code
export const getCountryByPhoneCode = (phoneCode) => {
  return countries.find(c => c.phoneCode === phoneCode) || countries[0];
};

// Search countries by name (case-insensitive)
export const searchCountries = (searchTerm) => {
  if (!searchTerm) return countries;
  const term = searchTerm.toLowerCase();
  return countries.filter(c => 
    c.name.toLowerCase().includes(term) || 
    c.code.toLowerCase().includes(term)
  );
};

// US States
export const usStates = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' },
];

// Canadian Provinces
export const canadianProvinces = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

// Get provinces/states for a country
export const getRegionsForCountry = (countryCode) => {
  if (countryCode === 'US') return usStates;
  if (countryCode === 'CA') return canadianProvinces;
  return [];
};

// Validate US ZIP code (5 digits or 5+4 format)
export const validateUSZipCode = (zip) => {
  if (!zip) return { valid: false, message: '' };
  const zipRegex = /^\d{5}(-\d{4})?$/;
  const valid = zipRegex.test(zip);
  return {
    valid,
    message: valid ? '' : 'ZIP code must be 5 digits or 5+4 format (e.g., 12345 or 12345-6789)'
  };
};

// Validate Canadian postal code (A1A 1A1 format)
export const validateCanadianPostalCode = (postal) => {
  if (!postal) return { valid: false, message: '' };
  const postalRegex = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
  const valid = postalRegex.test(postal);
  return {
    valid,
    message: valid ? '' : 'Postal code must be in format A1A 1A1'
  };
};

// Format Canadian postal code (A1A 1A1)
export const formatCanadianPostalCode = (postal) => {
  if (!postal) return '';
  // Remove spaces and hyphens, convert to uppercase
  const cleaned = postal.replace(/[\s-]/g, '').toUpperCase();
  if (cleaned.length === 6) {
    return `${cleaned.substring(0, 3)} ${cleaned.substring(3)}`;
  }
  return postal.toUpperCase();
};

// Format US ZIP code
export const formatUSZipCode = (zip) => {
  if (!zip) return '';
  const cleaned = zip.replace(/\D/g, '');
  if (cleaned.length === 5) {
    return cleaned;
  } else if (cleaned.length === 9) {
    return `${cleaned.substring(0, 5)}-${cleaned.substring(5)}`;
  }
  return zip;
};

