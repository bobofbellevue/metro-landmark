import OpenAI from 'openai';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const WEEKENDS = ['saturday', 'sunday'];
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PLACEHOLDER_PHONE_REGEX = /(555[-.\s]?123[-.\s]?4567|123[-.\s]?456[-.\s]?7890)/;

const STATE_ABBREVIATIONS = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
  'washington dc': 'DC'
};

const normalizeStateAbbreviation = (value = '') => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const lookup = STATE_ABBREVIATIONS[trimmed.toLowerCase()];
  return lookup || trimmed;
};

const decodeHtmlEntities = (text = '') => {
  if (!text) return '';
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2019;/gi, '\'')
    .replace(/&#x2013;/gi, '–')
    .replace(/&#x2014;/gi, '—');
};

const cleanDescription = (text = '') => {
  if (!text) return '';
  const withoutMarkers = text.replace(/===\s*PAGE:[^=]+===/gi, ' ');
  return decodeHtmlEntities(withoutMarkers).replace(/\s+/g, ' ').trim();
};

const SERVICE_SUFFIX_REGEX = /\s+(service|services)\s*$/i;

const cleanServiceLabel = (label = '') => {
  if (!label) return '';
  return label.replace(SERVICE_SUFFIX_REGEX, '').trim();
};


const formatPhoneNumber = (value = '') => {
  if (!value) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }
  // Validate: US phone numbers cannot start with 0 or 1 in area code
  if (digits.length === 10) {
    // Area code cannot start with 0 or 1
    if (digits[0] === '0' || digits[0] === '1') {
      return null; // Invalid phone number
    }
    // Exchange code cannot start with 0 or 1
    if (digits[3] === '0' || digits[3] === '1') {
      return null; // Invalid phone number
    }
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value.trim();
};

const createBusinessHoursSkeleton = (existing = {}) => {
  const skeleton = {};
  DAY_NAMES.forEach(day => {
    skeleton[day] = {
      open: existing?.[day]?.open || '',
      close: existing?.[day]?.close || '',
      closed: typeof existing?.[day]?.closed === 'boolean' ? existing[day].closed : true
    };
  });
  return skeleton;
};

const convertTo24Hour = (timeStr = '') => {
  if (!timeStr) return '';
  const normalized = timeStr.trim().toLowerCase().replace(/\./g, '');
  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!match) return '';
  let hours = parseInt(match[1], 10);
  const minutes = match[2] || '00';
  const period = match[3];
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
};

const extractDaysFromFragment = (fragment = '') => {
  const days = new Set();
  if (!fragment) return [];
  const upper = fragment.toUpperCase();

  const addDays = (list) => list.forEach(day => days.add(day));

  if (/\bWEEKDAYS?\b/.test(upper) || /\bMON(?:DAY)?\s*(?:-|TO|THRU|THROUGH)\s*FRI(?:DAY)?\b/.test(upper) || /\bM\s*[-–]\s*F\b/.test(upper)) {
    addDays(WEEKDAYS);
  }
  if (/\bWEEKENDS?\b/.test(upper) || /\bSAT(?:URDAY)?\s*(?:AND|&|\/)\s*SUN(?:DAY)?\b/.test(upper)) {
    addDays(WEEKENDS);
  }
  if (/\bDAILY\b/.test(upper) || /\bEVERY\s+DAY\b/.test(upper) || /\b7\s+DAYS\b/.test(upper)) {
    addDays(DAY_NAMES);
  }

  const singleDayPatterns = [
    { day: 'monday', regex: /\bMON(?:DAY)?\b/ },
    { day: 'tuesday', regex: /\bTUE(?:S|SDAY)?\b/ },
    { day: 'wednesday', regex: /\bWED(?:NESDAY)?\b/ },
    { day: 'thursday', regex: /\bTHU(?:R|RSDAY|RS)?\b/ },
    { day: 'friday', regex: /\bFRI(?:DAY)?\b/ },
    { day: 'saturday', regex: /\bSAT(?:URDAY)?\b/ },
    { day: 'sunday', regex: /\bSUN(?:DAY)?\b/ }
  ];

  singleDayPatterns.forEach(({ day, regex }) => {
    if (regex.test(upper)) {
      days.add(day);
    }
  });

  return Array.from(days);
};

const extractEmergencyOnlyDays = (text = '') => {
  const segments = text.split(/[,.;\n]+/);
  const emergencyDays = new Set();
  segments.forEach(segment => {
    if (!/emergency|after hours|answering service|24\/7|24-7/i.test(segment)) return;
    const days = extractDaysFromFragment(segment);
    if (days.length === 0 && /weekend/i.test(segment)) {
      WEEKENDS.forEach(day => emergencyDays.add(day));
    } else {
      days.forEach(day => emergencyDays.add(day));
    }
  });
  return Array.from(emergencyDays);
};

const parseBusinessHoursFromText = (text = '') => {
  if (!text) return { hours: {}, availableForEmergencies: false, note: '' };
  const normalized = text
    .replace(/\r/g, ' ')
    .replace(/a\.m\./gi, 'am')
    .replace(/p\.m\./gi, 'pm');

  const hours = {};
  const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))([^.;\n]*)/gi;
  let match;

  while ((match = timeRangeRegex.exec(normalized)) !== null) {
    const daySection = (match[3] || '').split(/[,;]+/)[0];
    const days = extractDaysFromFragment(daySection);
    if (!days.length) continue;

    const open = convertTo24Hour(match[1]);
    const close = convertTo24Hour(match[2]);

    days.forEach(day => {
      hours[day] = { open, close, closed: false };
    });
  }

  const emergencyDays = extractEmergencyOnlyDays(normalized);
  emergencyDays.forEach(day => {
    hours[day] = { open: '', close: '', closed: true };
  });

  const availableForEmergencies = /emergency|after hours|answering service|24\/7|24-7/i.test(normalized);
  const note = extractBusinessHoursNote(normalized);

  return { hours, availableForEmergencies, note };
};

const mergeBusinessHours = (existing, fallbackHours) => {
  const merged = createBusinessHoursSkeleton(existing);
  Object.entries(fallbackHours || {}).forEach(([day, value]) => {
    if (!merged[day]) {
      merged[day] = { open: '', close: '', closed: true };
    }
    if (!merged[day].open && value.open) {
      merged[day].open = value.open;
    }
    if (!merged[day].close && value.close) {
      merged[day].close = value.close;
    }
    if (typeof value.closed === 'boolean') {
      merged[day].closed = value.closed;
    } else if (value.open || value.close) {
      merged[day].closed = false;
    }
  });
  return merged;
};

const stripHtmlTags = (html = '') => {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Extract key sections from HTML before truncation to ensure important content is included
 * This is especially important for single-page sites where all content is on the home page
 */
const extractKeySections = (html = '') => {
  if (!html || html.length <= 50000) return ''; // Only needed for large pages
  
  const sections = [];
  
  // Extract contact section - look for contact-related keywords
  const contactKeywords = ['contact', 'phone', 'tel:', 'email', 'address', 'call us', 'reach us', 'get in touch', 'head office', 'inquiries'];
  const contactPattern = new RegExp(`(?:<[^>]+>)?[^<]*(?:${contactKeywords.join('|')})[^<]*(?:<[^>]+>)?[^<]{0,2000}`, 'gi');
  const contactMatches = [];
  let match;
  while ((match = contactPattern.exec(html)) !== null && contactMatches.length < 5) {
    const start = Math.max(0, match.index - 1000);
    const end = Math.min(html.length, match.index + match[0].length + 3000);
    const section = html.substring(start, end);
    // Only include if it contains actual contact info (phone, email, or address pattern)
    // Improved phone pattern to catch more formats including (XXX) XXX-XXXX
    if (/\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(section) || 
        /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(section) ||
        /\b(?:p\.?\s*o\.?\s*box|street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?)\b/i.test(section)) {
      contactMatches.push(section);
    }
  }
  if (contactMatches.length > 0) {
    const contactSection = '\n\n=== CONTACT SECTION ===\n' + contactMatches.join('\n\n');
    sections.push(contactSection);
    console.log(`[Vendor Find] Extracted ${contactMatches.length} contact section(s), total length: ${contactSection.length}`);
  } else {
    console.log(`[Vendor Find] No contact sections found with phone/email/address patterns`);
  }
  
  // Extract about section - look for about-related keywords
  const aboutKeywords = ['about us', 'about', 'who we are', 'our story', 'established', 'since'];
  const aboutPattern = new RegExp(`(?:<[^>]+>)?[^<]*(?:${aboutKeywords.join('|')})[^<]*(?:<[^>]+>)?[^<]{0,3000}`, 'gi');
  const aboutMatches = [];
  let aboutMatch;
  while ((aboutMatch = aboutPattern.exec(html)) !== null && aboutMatches.length < 3) {
    const start = Math.max(0, aboutMatch.index - 500);
    const end = Math.min(html.length, aboutMatch.index + aboutMatch[0].length + 2500);
    aboutMatches.push(html.substring(start, end));
  }
  if (aboutMatches.length > 0) {
    sections.push('\n\n=== ABOUT SECTION ===\n' + aboutMatches.join('\n\n'));
    console.log(`[Vendor Find] Extracted ${aboutMatches.length} about section(s)`);
  }
  
  // Extract services section - look for services-related keywords
  const servicesKeywords = ['services', 'what we do', 'our services', 'we offer', 'we provide'];
  const servicesPattern = new RegExp(`(?:<[^>]+>)?[^<]*(?:${servicesKeywords.join('|')})[^<]*(?:<[^>]+>)?[^<]{0,4000}`, 'gi');
  const servicesMatches = [];
  let servicesMatch;
  while ((servicesMatch = servicesPattern.exec(html)) !== null && servicesMatches.length < 3) {
    const start = Math.max(0, servicesMatch.index - 500);
    const end = Math.min(html.length, servicesMatch.index + servicesMatch[0].length + 3500);
    servicesMatches.push(html.substring(start, end));
  }
  if (servicesMatches.length > 0) {
    sections.push('\n\n=== SERVICES SECTION ===\n' + servicesMatches.join('\n\n'));
    console.log(`[Vendor Find] Extracted ${servicesMatches.length} services section(s)`);
  }
  
  const result = sections.join('\n');
  console.log(`[Vendor Find] Total key sections extracted: ${result.length} bytes`);
  return result;
};

const isMalformedDescription = (text = '') => {
  if (!text) return false;
  
  // Check for CSS comments and autoprefixer patterns
  if (/\/\*[\s\S]*?\*\//.test(text) || /autoprefixer|ignore next/i.test(text)) {
    return true;
  }
  
  // Detect CSS-like patterns
  const cssPatterns = [
    /\.\w+\s*\{/g,  // CSS class selectors
    /#[a-fA-F0-9]{3,6}/g,  // Hex colors
    /:\s*(inherit|none|auto|100%|0px|transparent)/gi,  // CSS values
    /padding|margin|height|width|background|color|font-size|display|position/gi,  // CSS properties
    /@media|@keyframes|@import/gi,  // CSS at-rules
    /-webkit-|-moz-|-ms-|-o-/gi,  // CSS vendor prefixes
    /z-index:\s*\d+/gi,  // z-index values
    /min-height|max-height|min-width|max-width/gi,  // CSS min/max properties
    /overflow:\s*(hidden|auto|scroll)/gi,  // CSS overflow values
  ];
  
  // Count CSS-like patterns
  let cssPatternCount = 0;
  cssPatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      cssPatternCount += matches.length;
    }
  });
  
  // If more than 2 CSS patterns found, likely malformed
  if (cssPatternCount > 2) return true;
  
  // Check for very long strings without spaces (likely CSS)
  const longWords = text.match(/\S{50,}/g);
  if (longWords && longWords.length > 2) return true;
  
  // Check for excessive curly braces (CSS blocks)
  const braceCount = (text.match(/\{/g) || []).length;
  if (braceCount > 3) return true;
  
  // Check for CSS property:value patterns
  if (/[a-z-]+:\s*[^;]+;/.test(text) && text.length < 200) {
    return true; // Short text with CSS property:value is likely CSS
  }
  
  return false;
};

const extractDescriptionFromContent = (html = '') => {
  if (!html) return '';
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (metaMatch && metaMatch[1]) {
    const desc = metaMatch[1].trim();
    if (!isMalformedDescription(desc)) {
      return desc;
    }
  }
  const firstParagraph = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (firstParagraph && firstParagraph[1]) {
    const paragraphText = stripHtmlTags(firstParagraph[1]);
    if (paragraphText.length > 40 && !isMalformedDescription(paragraphText)) {
      return paragraphText;
    }
  }
  const plain = stripHtmlTags(html);
  const sentences = plain.split(/(?<=[.?!])\s+/).filter(Boolean);
  const candidate = sentences.find(sentence =>
    sentence.length > 40 &&
    !/cookie|privacy|javascript|copyright/i.test(sentence) &&
    !isMalformedDescription(sentence)
  );
  return candidate || '';
};

const extractServicesFromContent = () => {
  // Services should be extracted by inference (OpenAI) only, not by hard-coded keywords
  return [];
};

const SERVICE_AREA_PATTERNS = [
  /serv(?:ing|ice areas?)[:\s-]+([^.\n]+)/gi,
  /areas?\s+we\s+serve[:\s-]+([^.\n]+)/gi,
  /service\s+area(?:\s+includes)?[:\s-]+([^.\n]+)/gi,
  /our\s+coverage\s+(?:areas?|region)[:\s-]+([^.\n]+)/gi,
  /we\s+(?:extend\s+our\s+)?services?\s+(?:to|throughout)\s+([^.\n]+)/gi,
  /we\s+serve\s+(?:the\s+whole\s+)?([^.\n!?]+?)(?:\s+area)?[!?.]?/gi,
  /areas?\s+served[:\s-]+([^.\n]+)/gi,
  /serv(?:ing|ice)\s+(?:the\s+whole\s+)?([^.\n!?]+?)(?:\s+area)?[!?.]?/gi
];

const splitLocations = (segment = '') => {
  if (!segment) return [];
  
  // Clean up common prefixes
  let cleaned = segment
    .replace(/^(including|the|whole|entire)\s+/i, '')
    .trim();
  
  // Handle phrases like "the whole Puget Sound Area" - extract the area name
  // Remove trailing "Area" if it's part of a region name (but keep it if it's a standalone word)
  cleaned = cleaned.replace(/\s+area$/i, ' Area');
  
  // Split by common delimiters
  const parts = cleaned
    .split(/,|&| and /i)
    .map(part => part.trim())
    .filter(part => part.length > 1 && /[a-z]/i.test(part));
  
  return parts;
};

const extractServiceAreasFromContent = (html = '') => {
  if (!html) return [];
  const text = stripHtmlTags(html);
  const results = new Set();
  SERVICE_AREA_PATTERNS.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      splitLocations(match[1]).forEach(loc => results.add(loc));
    }
  });
  return Array.from(results);
};

const extractAllPhoneNumbers = (html = '') => {
  const results = {
    fromStructuredData: [],
    fromHtml: [],
    all: []
  };
  
  if (!html) return results;
  
  // First, try to extract from structured data (JSON-LD)
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const jsonText = match[1].trim();
      if (!jsonText) continue;
      const parsed = JSON.parse(jsonText);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object') {
          const phone = candidate.telephone || candidate.phone || candidate.phoneNumber;
          if (phone && typeof phone === 'string') {
            const cleaned = phone.trim();
            if (cleaned) {
              results.fromStructuredData.push(cleaned);
              results.all.push({ source: 'structured-data', value: cleaned });
            }
          }
        }
      }
    } catch {
      // Ignore JSON parse errors and continue
    }
  }
  
  // Then, extract all phone numbers from HTML
  // Use word boundaries and context to avoid false positives (like filenames, CSS values)
  const phonePatterns = [
    { pattern: /(?:tel|phone|call)[:\s]*\(?(\d{3})\)?\s*[-.\s]?(\d{3})[-.\s]?(\d{4})/gi, name: 'tel:phone:call' },
    { pattern: /\((\d{3})\)\s*(\d{3})[-.\s]?(\d{4})/g, name: 'formatted' },
    { pattern: /\b(\d{3})[-.\s](\d{3})[-.\s](\d{4})\b/g, name: 'dashed' } // Word boundaries to avoid filenames
  ];
  
  // For digits-only, check context to avoid false positives
  const digitsOnlyPattern = /\b(\d{10})\b/g;
  let digitsMatch;
  while ((digitsMatch = digitsOnlyPattern.exec(html)) !== null) {
    const digits = digitsMatch[0];
    const areaCode = parseInt(digits.substring(0, 3), 10);
    const exchange = parseInt(digits.substring(3, 6), 10);
    
    // Reject numbers that are clearly not phone numbers (like CSS values, timestamps, etc.)
    // Phone numbers in US/Canada:
    // - Area code: 200-999 (cannot start with 0 or 1)
    // - Exchange: 200-999 (cannot start with 0 or 1)
    // - Reject numbers like 2147483648 (2^31, common CSS value)
    if (areaCode < 200 || areaCode > 999 || exchange < 200 || exchange > 999) {
      continue;
    }
    
    // Check context to avoid filenames and CSS values
    const before = html.substring(Math.max(0, digitsMatch.index - 30), digitsMatch.index);
    const after = html.substring(digitsMatch.index + 10, Math.min(html.length, digitsMatch.index + 40));
    const context = (before + digitsMatch[0] + after).toLowerCase();
    
    // Skip if it looks like a filename, CSS value, or part of a longer number
    if (context.includes('.png') || context.includes('.jpg') || context.includes('aspect-ratio') || 
        context.includes('dsc_') || context.includes('file') || context.includes('url(') ||
        context.includes('z-index') || context.includes('width') || context.includes('height') ||
        context.includes('max-width') || context.includes('min-width') ||
        context.match(/[\d.]{2,}/)) {
      continue;
    }
    
    const phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (!results.fromHtml.some(p => p.replace(/\D/g, '') === digits)) {
      results.fromHtml.push(phone);
      results.all.push({ source: 'html-digits-only', value: phone, raw: digitsMatch[0], context: context.substring(0, 60) });
    }
  }
  
  for (const { pattern, name } of phonePatterns) {
    let phoneMatch;
    // Reset regex lastIndex to avoid issues with global regex
    pattern.lastIndex = 0;
    while ((phoneMatch = pattern.exec(html)) !== null) {
      let phone = phoneMatch[0];
      // Reconstruct if captured in groups
      if (phoneMatch[1] && phoneMatch[2] && phoneMatch[3]) {
        phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`;
      }
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 10) {
        // Check for duplicates
        if (!results.fromHtml.some(p => p.replace(/\D/g, '') === digits)) {
          results.fromHtml.push(phone);
          results.all.push({ source: `html-${name}`, value: phone, raw: phoneMatch[0] });
        }
      }
    }
  }
  
  return results;
};

const extractPhoneFromContent = (html = '') => {
  if (!html) return '';
  
  const allPhones = extractAllPhoneNumbers(html);
  
  // Filter out placeholders
  const validPhones = allPhones.all
    .map(item => item.value)
    .filter(phone => !PLACEHOLDER_PHONE_REGEX.test(phone));
  
  // Return the first non-placeholder phone number found
  // Prefer formatted numbers (with parentheses) over unformatted
  const formatted = validPhones.find(p => /\(/.test(p));
  return formatted || validPhones[0] || '';
};

const extractEmailFromContent = (html = '') => {
  if (!html) return '';
  
  // First, try to extract from structured data (JSON-LD)
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const jsonText = match[1].trim();
      if (!jsonText) continue;
      const parsed = JSON.parse(jsonText);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object') {
          const email = candidate.email || candidate.emailAddress || candidate.contactPoint?.email;
          if (email && typeof email === 'string') {
            const cleaned = email.trim();
            if (cleaned && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
              return cleaned;
            }
          }
        }
      }
    } catch {
      // Ignore JSON parse errors and continue
    }
  }
  
  // Then, extract from HTML - look for mailto links and email patterns
  const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const emails = new Set();
  let emailMatch;
  while ((emailMatch = emailPattern.exec(html)) !== null) {
    const email = emailMatch[0].toLowerCase().trim();
    // Filter out common false positives
    if (!email.includes('example.com') && 
        !email.includes('test@') && 
        !email.includes('placeholder@') &&
        !email.includes('your-email@') &&
        email.length > 5) {
      emails.add(email);
    }
  }
  
  // Prefer emails from mailto links
  const mailtoPattern = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  let mailtoMatch;
  while ((mailtoMatch = mailtoPattern.exec(html)) !== null) {
    const email = mailtoMatch[1].toLowerCase().trim();
    if (email && !email.includes('example.com') && !email.includes('test@')) {
      return email;
    }
  }
  
  // Return first valid email found
  return Array.from(emails)[0] || '';
};

const extractAddressFromContent = (html = '') => {
  if (!html) return null;
  const text = stripHtmlTags(html);
  
  // Try PO Box pattern first (P.O. Box, PO Box, P.O Box, etc.)
  const poBoxMatch = text.match(/(P\.?\s*O\.?\s*Box\s+\d+),\s*([A-Za-z.'\s]+),\s*([A-Za-z.'\s]{2,})\s*(\d{5}(?:-\d{4})?)/i);
  if (poBoxMatch) {
    const normalizedState = normalizeStateAbbreviation(poBoxMatch[3]);
    return {
      address_line_1: poBoxMatch[1].trim(),
      city: poBoxMatch[2].trim(),
      state_province_region: normalizedState,
      postal_code: poBoxMatch[4].trim()
    };
  }
  
  // Try regular street address pattern
  const match = text.match(/(\d{2,5}\s+[A-Za-z0-9.,' ]+),\s*([A-Za-z.'\s]+),\s*([A-Za-z.'\s]{2,})\s*(\d{5}(?:-\d{4})?)/);
  if (!match) return null;
  const normalizedState = normalizeStateAbbreviation(match[3]);
  return {
    address_line_1: match[1].trim(),
    city: match[2].trim(),
    state_province_region: normalizedState,
    postal_code: match[4].trim()
  };
};

const extractStructuredDataAddress = (html = '') => {
  if (!html) return null;
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const jsonText = match[1].trim();
      if (!jsonText) continue;
      const parsed = JSON.parse(jsonText);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object') {
          const address = candidate.address || candidate.Address;
          if (address) {
            return {
              address_line_1: address.streetAddress || '',
              city: address.addressLocality || '',
              state_province_region: normalizeStateAbbreviation(address.addressRegion || ''),
              postal_code: address.postalCode || '',
              country: address.addressCountry || ''
            };
          }
        }
      }
    } catch {
      // Ignore JSON parse errors and continue
    }
  }
  return null;
};

const BUSINESS_HOURS_NOTE_REGEXES = [
  /(Saturday[^.\n]{0,100}by appointment[^.\n]*)/i,
  /(Sunday[^.\n]{0,100}by appointment[^.\n]*)/i,
  /(weekend[^.\n]{0,120}by appointment[^.\n]*)/i,
  /(by appointment[^.\n]{0,160})/i
];

const extractBusinessHoursNote = (source = '') => {
  if (!source) return '';
  const text = stripHtmlTags(source);
  for (const regex of BUSINESS_HOURS_NOTE_REGEXES) {
    const match = text.match(regex);
    if (match && match[0]) {
      return match[0].replace(/\s+/g, ' ').trim();
    }
  }
  return '';
};

const filterServiceAreasByState = (areas = [], state = '') => {
  const normalizedState = normalizeStateAbbreviation(state);
  if (!normalizedState) return areas;
  return areas.filter(area => {
    const stateMatch = area.match(/,\s*([A-Z]{2})$/);
    if (stateMatch && stateMatch[1].toUpperCase() !== normalizedState) {
      return false;
    }
    return true;
  });
};

const validateServiceArea = (area = '') => {
  if (!area || typeof area !== 'string') return false;
  
  const trimmed = area.trim();
  if (!trimmed) return false;
  
  // Reject HTML entities (like #8217; or &#8217;)
  if (/[#&]\d+;/.test(trimmed)) return false;
  
  // Reject entries with more than 3 words (excluding state abbreviation)
  // Split by spaces and commas, then filter out empty strings
  const parts = trimmed.split(/[\s,]+/).filter(p => p.length > 0);
  // Remove state abbreviation if present (last part if it's 2 uppercase letters)
  const words = parts.length > 1 && /^[A-Z]{2}$/.test(parts[parts.length - 1])
    ? parts.slice(0, -1)
    : parts;
  if (words.length > 3) return false;
  
  // Reject entries that look like sentences or phrases
  // Common patterns that indicate it's not a location name
  const sentencePatterns = [
    /\b(for|with|and|or|the|a|an)\s+\d+/i, // "for Over 20 Years" (removed "over" as it appears in city names)
    /\b(operated|owned|serving|providing|offering|specializing)/i, // "operated electrical"
    /\b(years?|experience|company|business)\b/i, // "20 Years", "company" (removed "service/services" as they can appear in city names)
    /\b(electrical\s+needs|contracting\s+needs)/i, // "Electrical Needs" (more specific pattern)
    /^[^A-Z]/, // Starts with lowercase (likely part of a sentence)
    /\b(is|are|was|were|has|have|will|would|can|could|should|may|might)\b/i, // Common verbs
    /\b(professionally|trained|licensed|show\s+up|job\s+done|properly|pride|being|salesmen|success|depends|satisfaction|charge|competitive|rates|offer|free|estimates)\b/i // Business description phrases (removed single words that appear in city names)
  ];
  
  for (const pattern of sentencePatterns) {
    if (pattern.test(trimmed)) return false;
  }
  
  // Reject entries that are mostly lowercase (likely part of a sentence)
  // Unless it contains known location words like "valley", "county", etc.
  const lowerCaseRatio = (trimmed.match(/[a-z]/g) || []).length / trimmed.replace(/[^a-zA-Z]/g, '').length;
  if (lowerCaseRatio > 0.7 && !/\b(valley|county|city|town|village|borough|mill|ford|park|beach|lake|river|hill|mount|point|bay|harbor|harbour)\b/i.test(trimmed)) {
    return false;
  }
  
  return true;
};

const DEFAULT_ADDRESS = {
  address_line_1: null,
  city: null,
  state_province_region: null,
  postal_code: null,
  country: null
};

const DEFAULT_PERSONAL_NAME = {
  first_name: null,
  middle_name: null,
  last_name: null
};

const TASK_SYSTEM_PROMPT = 'You extract specific pieces of vendor information from raw HTML content of website pages. The content you receive is HTML markup - look for text within HTML tags, not the tags themselves. Carefully examine all provided pages from start to finish. Look in headers, footers, navigation menus, contact sections, and body text. Extract information that appears in the content. Be thorough and extract all relevant information you find. Only return null or empty arrays if you cannot find the information after careful examination. Never invent or create placeholder data like "123 Main St", "Anytown, CA", or "(123) 456-7890" - these are examples, not real data.';

const runExtractionTask = async (openai, task, sharedContext) => {
  const userPrompt = `${task.instructions}

Return JSON with this exact shape:
${task.schema}

Website context:
${sharedContext}`;

  // eslint-disable-next-line no-undef
  const temperature = (typeof process !== 'undefined' && process.env && process.env.OPENAI_TEMPERATURE ? parseFloat(process.env.OPENAI_TEMPERATURE) : null) ?? task.temperature ?? 0.3;

  try {
    // Available models: 'gpt-4o-mini' (default, fast/cheap), 'gpt-4o' (better quality), 'gpt-4-turbo' (high quality), 'gpt-4' (legacy)
    // eslint-disable-next-line no-undef
    const modelName = (typeof process !== 'undefined' && process.env ? process.env.OPENAI_MODEL : null) || 'gpt-4o-mini';
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: TASK_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: temperature,
      max_tokens: task.maxTokens ?? 900
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);
    
    // Log extraction results for debugging
    console.log(`[Vendor Find] [TASK ${task.name}] Extraction result:`, JSON.stringify(parsed, null, 2).substring(0, 500));
    
    return parsed;
  } catch (error) {
    console.error(`[TASK ${task.name}] Extraction failed:`, error);
    return null;
  }
};





export default async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check for required environment variables
  // eslint-disable-next-line no-undef
  const apiKey = typeof process !== 'undefined' && process.env ? process.env.OPENAI_API_KEY : null;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error: OpenAI API key is missing' });
  }

  try {
    const { website } = req.body;

    if (!website) {
      return res.status(400).json({ error: 'Website URL is required' });
    }

    const openai = new OpenAI({
      // eslint-disable-next-line no-undef
      apiKey: typeof process !== 'undefined' && process.env ? process.env.OPENAI_API_KEY : apiKey
    });

    // Normalize URL
    let websiteUrl = website.trim();
    if (!websiteUrl.startsWith('http://') && !websiteUrl.startsWith('https://')) {
      // Try HTTPS first, but note that some sites only support HTTP
      websiteUrl = `https://${websiteUrl}`;
    }
    console.log(`[Vendor Find] Processing website: ${websiteUrl}`);

    // Fetch website content from multiple pages
    const fetchPage = async (url, timeout = 10000) => {
      try {
        console.log(`[Vendor Find] Fetching page: ${url}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // Try with more realistic browser headers to avoid bot detection
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
          'DNT': '1',
          'Referer': baseUrl // Add referer to make request look more legitimate
        };
        
        const response = await fetch(url, {
          headers: headers,
          signal: controller.signal,
          redirect: 'follow'
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.log(`[Vendor Find] HTTP error for ${url}: ${response.status} ${response.statusText}`);
          // For 403 errors, log response headers to help debug blocking
          if (response.status === 403) {
            const headers = {};
            response.headers.forEach((value, key) => {
              headers[key] = value;
            });
            console.log(`[Vendor Find] 403 Forbidden response headers:`, JSON.stringify(headers, null, 2));
          }
          return null;
        }

        const content = await response.text();
        console.log(`[Vendor Find] Successfully fetched ${url}, content length: ${content.length}`);
        
        // Strip CSS and scripts first to get cleaner content for extraction
        // This prevents extracting CSS code as content
        const cleanedContent = content
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<!--[\s\S]*?-->/g, ' ');
        
        // For large pages, extract key sections (contact, about, services) before truncating
        // This ensures important content is included even if it's later in the HTML
        let processedContent = cleanedContent;
        if (cleanedContent.length > 50000) {
          console.log(`[Vendor Find] Page is large (${cleanedContent.length} bytes), extracting key sections...`);
          const keySections = extractKeySections(cleanedContent);
          
          if (keySections.length > 0) {
            // Key sections found - prioritize them and include as much as possible
            // Take a smaller initial chunk (15KB) to make room for key sections
            const initialContent = cleanedContent.substring(0, 15000);
            const combined = initialContent + keySections;
            // Allow up to 120KB when key sections are present (they're more important than generic content)
            // This ensures we capture all the extracted contact/about/services sections
            processedContent = combined.length > 120000 
              ? combined.substring(0, 120000) + '... [truncated]' 
              : combined;
            console.log(`[Vendor Find] Processed content length: ${processedContent.length} bytes (initial: ${initialContent.length}, key sections: ${keySections.length}, key sections included: ${Math.min(keySections.length, processedContent.length - initialContent.length)})`);
          } else {
            // No key sections found, use standard truncation
            processedContent = cleanedContent.length > 50000 
              ? cleanedContent.substring(0, 50000) + '... [truncated]' 
              : cleanedContent;
            console.log(`[Vendor Find] No key sections found, using standard truncation: ${processedContent.length} bytes`);
          }
        } else {
          // Small page, just use cleaned content
          processedContent = cleanedContent;
        }
        
        // Limit each page to 50KB to allow for more content while still supporting multiple pages
        // This helps capture phone numbers, services, and other info that might be later in the HTML
        return processedContent;
      } catch (error) {
        console.error(`[Vendor Find] Error fetching ${url}:`, error.message || error);
        return null;
      }
    };

    // Extract base URL
    const urlObj = new URL(websiteUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    const originalPath = urlObj.pathname;
    
    // Common page paths to check
    const commonPages = [
      '', // home page
      '/contact',
      '/contact-us',
      '/about',
      '/about-us',
      '/services',
      '/hours',
      '/business-hours',
      '/location',
      '/locations'
    ];

    // If the original URL has a path (not just the base URL), include it and its sub-pages
    // This handles cases like https://www.acehandymanservices.com/offices/east-king-county
    // We'll check both the original path and common pages relative to it (e.g., /offices/east-king-county/contact)
    let pagesToCheck = [];
    
    if (originalPath && originalPath !== '/') {
      // Add the original path first (highest priority)
      pagesToCheck.push(originalPath);
      
      // Add common pages relative to the original path (e.g., /offices/east-king-county/contact)
      const originalPathPages = commonPages
        .filter(p => p !== '') // Exclude empty string (home page)
        .map(p => `${originalPath}${p}`);
      pagesToCheck.push(...originalPathPages);
      
      // Also add common pages at base URL (in case they don't have sub-pages)
      pagesToCheck.push(...commonPages.filter(p => p !== ''));
    } else {
      // No original path, just use common pages
      pagesToCheck = commonPages;
    }

    // Fetch initial pages in parallel
    const initialPagesToFetch = pagesToCheck.slice(0, 8); // Increased limit to include more pages
    const initialPageUrls = initialPagesToFetch.map(path => {
      if (path === originalPath && originalPath && originalPath !== '/') {
        // Use the original full URL for the original path
        return { path: originalPath, url: websiteUrl };
      }
      // Check if this is a path relative to original path or a base URL path
      if (originalPath && originalPath !== '/' && path.startsWith(originalPath)) {
        // This is a sub-page of the original path
        return { path: path, url: `${baseUrl}${path}` };
      }
      // Base URL path
      return {
        path: path || 'home',
        url: path ? `${baseUrl}${path}` : websiteUrl
      };
    });
    
    const initialPagePromises = initialPageUrls.map(({ url, path }) => 
      fetchPage(url).then(content => ({ content, path, url }))
    );

    const initialPageResults = await Promise.all(initialPagePromises);
    
    // Extract links from fetched pages to discover additional pages
    const discoveredUrls = new Set();
    const fetchedUrls = new Set(initialPageUrls.map(p => p.url));
    
    initialPageResults.forEach(({ content }) => {
      if (content) {
        // Extract all href attributes from anchor tags
        const linkMatches = content.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
        linkMatches.forEach(match => {
          const hrefMatch = match.match(/href=["']([^"']+)["']/i);
          if (hrefMatch && hrefMatch[1]) {
            let href = hrefMatch[1];
            // Skip external links, mailto, tel, javascript, anchors
            if (href.startsWith('http://') || href.startsWith('https://')) {
              try {
                const hrefUrl = new URL(href);
                if (hrefUrl.host === urlObj.host) {
                  // Same domain, add it
                  discoveredUrls.add(href);
                }
              } catch {
                // Invalid URL, skip
              }
            } else if (href.startsWith('/')) {
              // Absolute path on same domain
              discoveredUrls.add(`${baseUrl}${href}`);
            } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
              // Relative path
              try {
                const fullUrl = new URL(href, baseUrl);
                if (fullUrl.host === urlObj.host) {
                  discoveredUrls.add(fullUrl.href);
                }
              } catch {
                // Invalid URL, skip
              }
            }
          }
        });
      }
    });
    
    // Filter out already fetched URLs and limit to reasonable number
    const additionalUrls = Array.from(discoveredUrls)
      .filter(url => !fetchedUrls.has(url))
      .slice(0, 10); // Limit to 10 additional pages to avoid timeout
    
    // Fetch additional pages discovered from links
    const additionalPagePromises = additionalUrls.map(url => {
      const path = new URL(url).pathname || 'discovered';
      return fetchPage(url).then(content => ({ content, path, url }));
    });
    
    const additionalPageResults = await Promise.all(additionalPagePromises);
    
    // Combine initial and additional page results
    const pageResults = [...initialPageResults, ...additionalPageResults];
    
    // Combine all page contents
    let websiteContent = '';
    let fetchError = null;
    const fetchedPages = [];
    const fetchedPageUrls = [];
    
    pageResults.forEach(({ content, path, url }) => {
      if (content) {
        const pageName = path;
        websiteContent += `\n\n=== PAGE: ${pageName} ===\n${content}`;
        fetchedPages.push(pageName);
        fetchedPageUrls.push(url);
      }
    });
    
    // If HTTPS failed and we normalized to HTTPS, try HTTP as fallback
    if (!websiteContent && websiteUrl.startsWith('https://') && !website.startsWith('http://') && !website.startsWith('https://')) {
      console.log(`[Vendor Find] HTTPS failed, trying HTTP fallback for ${website}`);
      const httpUrl = `http://${website}`;
      const httpUrlObj = new URL(httpUrl);
      const httpBaseUrl = `${httpUrlObj.protocol}//${httpUrlObj.host}`;
      
      const httpPageUrls = initialPagesToFetch.map(path => ({
        path: path || 'home',
        url: path ? `${httpBaseUrl}${path}` : httpUrl
      }));
      
      const httpPagePromises = httpPageUrls.map(({ url, path }) => 
        fetchPage(url).then(content => ({ content, path, url }))
      );
      
      const httpPageResults = await Promise.all(httpPagePromises);
      const httpSuccessCount = httpPageResults.filter(r => r.content).length;
      
      if (httpSuccessCount > 0) {
        console.log(`[Vendor Find] HTTP fallback succeeded, fetched ${httpSuccessCount} pages`);
        websiteUrl = httpUrl;
        initialPageResults.splice(0, initialPageResults.length, ...httpPageResults);
        pageResults.splice(0, pageResults.length, ...httpPageResults);
        
        websiteContent = '';
        fetchedPages.length = 0;
        fetchedPageUrls.length = 0;
        
        pageResults.forEach(({ content, path, url }) => {
          if (content) {
            const pageName = path;
            websiteContent += `\n\n=== PAGE: ${pageName} ===\n${content}`;
            fetchedPages.push(pageName);
            fetchedPageUrls.push(url);
          }
        });
      }
    }

    if (!websiteContent) {
      fetchError = 'Could not fetch any pages from the website';
      console.error(`[Vendor Find] Failed to fetch any content from ${websiteUrl}`);
      console.error(`[Vendor Find] Initial pages fetched: ${initialPageResults.filter(r => r.content).length}/${initialPageResults.length}`);
      console.error(`[Vendor Find] Additional pages fetched: ${additionalPageResults.filter(r => r.content).length}/${additionalPageResults.length}`);
      
      // Check if all requests returned 403 - this indicates server blocking
      const all403 = initialPageResults.every(r => !r.content);
      if (all403) {
        console.error(`[Vendor Find] All requests returned 403 Forbidden - website is blocking requests`);
        fetchError = 'Website is blocking automated requests (403 Forbidden). This website may have bot protection enabled. You may need to enter vendor information manually.';
      }
    } else {
      console.log(`[Vendor Find] Successfully fetched content from ${fetchedPages.length} pages: ${fetchedPages.join(', ')}`);
      console.log(`[Vendor Find] Total content length: ${websiteContent.length}`);
      
      // Strip CSS and scripts to reduce noise while keeping HTML structure
      // This helps models focus on actual content rather than CSS/JS
      websiteContent = websiteContent
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
      
      // Limit total content to 200KB to accommodate larger per-page limits when key sections are present
      // This ensures we don't lose important extracted sections
      if (websiteContent.length > 200000) {
        websiteContent = websiteContent.substring(0, 200000) + '... [content truncated]';
      }
    }


    // Check if contact info patterns exist in content (for debugging)
    if (websiteContent) {
      const phoneMatches = websiteContent.match(/\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g);
      const emailMatches = websiteContent.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
      console.log(`[Vendor Find] Content analysis: phone patterns found: ${phoneMatches ? phoneMatches.length : 0}, email patterns found: ${emailMatches ? emailMatches.length : 0}`);
      if (phoneMatches && phoneMatches.length > 0) {
        console.log(`[Vendor Find] Sample phone numbers in content: ${phoneMatches.slice(0, 3).join(', ')}`);
      }
      if (emailMatches && emailMatches.length > 0) {
        console.log(`[Vendor Find] Sample emails in content: ${emailMatches.slice(0, 3).join(', ')}`);
      }
    }

    const sharedContext = `Base URL: ${websiteUrl}
${fetchedPages.length > 0 ? `Fetched pages: ${fetchedPages.join(', ')}` : ''}
${fetchError ? `Note: ${fetchError}. Use any available information.` : ''}

Website content from multiple pages:
${websiteContent || 'No content available - website could not be fetched'}`;

    const extractionTasks = [
      {
        name: 'company',
        instructions: `Extract company information. Look for: (1) Company name in headers, titles, or prominent headings. (2) Description paragraph explaining what the company does - check home page, About page, or meta descriptions. Do not use the company name as the description. (3) Email address in contact sections, footers, or contact forms. (4) Mentions of "24/7", "emergency service", "after hours" for emergency availability. (5) Notes about hours like "by appointment" or "hours vary". (6) Personal name if an owner, founder, or main contact is prominently mentioned. (7) Job title if mentioned (e.g., "owner", "Owner", "founder", "manager", etc.). Note that "owner" (in any case: "owner", "Owner", "OWNER") is a valid job title and should be extracted. If found in lowercase, it will be capitalized to "Owner"; if already capitalized, preserve the capitalization. IMPORTANT: Only warn about CAPTCHA if the content explicitly contains CAPTCHA-related text (like "verify you are human", "captcha", "challenge", etc.) or if it's clearly a CAPTCHA verification page. Do not warn about CAPTCHA just because content is short or minimal - short content may be a redirect page or minimal HTML, not necessarily a CAPTCHA. Return null for missing fields.`,
        schema: `{
  "company_name": "string or null",
  "description": "string or null",
  "email": "string or null",
  "available_for_emergencies": true or false or null,
  "business_hours_note": "string or null",
  "job_title": "string or null",
  "personal_name": {
    "first_name": "string or null",
    "middle_name": "string or null",
    "last_name": "string or null"
  },
  "warnings": ["array of warning strings"]
}`,
        maxTokens: 1000
      },
      {
        name: 'contact',
        instructions: `Extract contact information from the HTML content. Phone: Look in page headers, footers, "Call us" buttons, contact pages, navigation menus, and paragraph tags. Find the main business phone (not fax). Phone may appear as "(XXX) XXX-XXXX", "XXX-XXX-XXXX", "XXX.XXX.XXXX", or as plain digits like "XXXXXXXXXX". Be thorough - phone numbers can appear in many places including JavaScript variables, data attributes, and hidden elements. Address: Look on Contact or About pages, in footers, or contact sections. Address may be on one line or multiple lines. Extract street address (including PO Box addresses like "P.O. Box 300", "PO Box 300", "P.O Box 300"), city, state/province, postal code, and country if present. IMPORTANT: Do NOT skip PO Box addresses - if a PO Box is the only address available, extract it. PO Box addresses are valid business addresses and should be recorded. If only a partial address is available (e.g., just city, state, and postal code without a street address), extract and provide the available partial address information. IMPORTANT: Only extract information that actually appears in the HTML content. Do not create placeholder addresses like "123 Main St, Anytown, CA" or placeholder phones like "(123) 456-7890". If you cannot find real contact information, return null for all fields.`,
        schema: `{
  "phone": "string or null",
  "address": {
    "address_line_1": "string or null",
    "city": "string or null",
    "state_province_region": "string or null",
    "postal_code": "string or null",
    "country": "string or null"
  },
  "warnings": ["array of warning strings"]
}`,
        maxTokens: 800
      },
      {
        name: 'services',
        instructions: `Extract all services the company offers. Return each service as a short keyword or phrase. Remove "service" or "services" from the end (e.g., "Plumbing repair services" becomes "Plumbing repair").`,
        schema: `{
  "services": ["array of service keywords"],
  "warnings": ["array of warning strings"]
}`,
        maxTokens: 800
      },
      {
        name: 'serviceAreas',
        instructions: `Extract all service areas (cities, counties, states, regions, areas) mentioned anywhere on the website. Look on Contact pages, About pages, Service pages, or in paragraph text. Service areas may be listed as bullet points, comma-separated lists, or mentioned in sentences like "We serve the whole Puget Sound Area!" or "Serving all of King County". Split comma-separated lists into individual locations. IMPORTANT: For cities and counties, extract only the city or county name without the state abbreviation (e.g., extract "Detroit" not "Detroit, MI", extract "King County" not "King County, WA"). For regions or areas mentioned in phrases like "Puget Sound Area", "Greater Seattle Area", "Metro Area", extract the area name (e.g., "Puget Sound Area", "Greater Seattle Area"). States should be extracted as-is. Any mention of a city, county, region, or area name should be included. Return an empty array only if no locations are mentioned.`,
        schema: `{
  "service_areas": ["array of location strings"],
  "warnings": ["array of warning strings"]
}`,
        maxTokens: 800
      },
      {
        name: 'businessHours',
        instructions: `Extract business hours from Contact pages, Hours pages, About pages, or anywhere operating hours are mentioned. Look for statements like "8:00 am - 5:00 pm Monday-Friday" or "Open M-F 8am-5pm". Convert all times to 24-hour HH:MM format (e.g., "08:00" for 8 AM, "17:00" for 5 PM). For day ranges like "M-F" or "Monday-Friday", apply the same times to each day in the range. If a day is closed or not mentioned, set "closed": true and open/close to null. If weekends only mention "emergency service" or "answering service", mark those days closed but set available_for_emergencies to true. Capture any prose notes about hours (e.g., "by appointment", "hours vary"). If no hours are found, return all days with closed: true.`,
        schema: `{
  "business_hours": {
    "monday": {"open": "HH:MM or null", "close": "HH:MM or null", "closed": true or false},
    "tuesday": {"open": "HH:MM or null", "close": "HH:MM or null", "closed": true or false},
    "wednesday": {"open": "HH:MM or null", "close": "HH:MM or null", "closed": true or false},
    "thursday": {"open": "HH:MM or null", "close": "HH:MM or null", "closed": true or false},
    "friday": {"open": "HH:MM or null", "close": "HH:MM or null", "closed": true or false},
    "saturday": {"open": "HH:MM or null", "close": "HH:MM or null", "closed": true or false},
    "sunday": {"open": "HH:MM or null", "close": "HH:MM or null", "closed": true or false}
  },
  "available_for_emergencies": true or false or null,
  "business_hours_note": "string or null",
  "warnings": ["array of warning strings"]
}`,
        maxTokens: 900
      }
    ];

    // Skip extraction if no content was fetched to avoid wasting API calls
    let taskResults = [];
    if (!websiteContent) {
      console.log(`[Vendor Find] Skipping extraction tasks - no content available (website may be blocking requests)`);
      // Return empty results for all tasks
      taskResults = extractionTasks.map(() => null);
      
      // If there's a fetch error (like 403), return it to the user
      if (fetchError) {
        return res.status(200).json({
          success: false,
          error: fetchError,
          data: {
            company_name: null,
            description: null,
            email: null,
            phone: null,
            address: DEFAULT_ADDRESS,
            services: [],
            service_areas: [],
            business_hours: createBusinessHoursSkeleton(),
            business_hours_note: null,
            available_for_emergencies: null,
            job_title: null,
            personal_name: DEFAULT_PERSONAL_NAME,
            warnings: [fetchError]
          },
          website_url: websiteUrl
        });
      }
    } else {
      console.log(`[Vendor Find] Starting extraction tasks for ${websiteUrl}`);
      taskResults = await Promise.all(
        extractionTasks.map(task => runExtractionTask(openai, task, sharedContext))
      );
      console.log(`[Vendor Find] Extraction tasks completed, results:`, taskResults.map((r, i) => ({ task: extractionTasks[i].name, hasData: !!r })));
    }

    const taskMap = extractionTasks.reduce((acc, task, index) => {
      acc[task.name] = taskResults[index] || null;
      return acc;
    }, {});

    // Log raw task results for debugging
    console.log(`[Vendor Find] Raw task results:`, {
      company: taskMap.company ? { 
        hasCompanyName: !!taskMap.company.company_name,
        hasDescription: !!taskMap.company.description,
        hasEmail: !!taskMap.company.email,
        companyName: taskMap.company.company_name,
        email: taskMap.company.email
      } : null,
      contact: taskMap.contact ? {
        hasPhone: !!taskMap.contact.phone,
        hasAddress: !!taskMap.contact.address,
        phone: taskMap.contact.phone,
        address: taskMap.contact.address
      } : null,
      services: taskMap.services ? {
        servicesCount: Array.isArray(taskMap.services.services) ? taskMap.services.services.length : 0,
        services: taskMap.services.services
      } : null
    });

    const companyInfo = taskMap.company || {};
    const contactInfo = taskMap.contact || {};
    const servicesInfo = taskMap.services || {};
    const serviceAreasInfo = taskMap.serviceAreas || {};
    const hoursInfo = taskMap.businessHours || {};

    const mergedWarnings = [
      ...(companyInfo.warnings || []),
      ...(contactInfo.warnings || []),
      ...(servicesInfo.warnings || []),
      ...(serviceAreasInfo.warnings || []),
      ...(hoursInfo.warnings || [])
    ].filter(Boolean);

    const businessHoursFromTask = hoursInfo.business_hours || {};

    // Process job_title: normalize "owner" to "Owner" (handles any case)
    let jobTitle = companyInfo.job_title || null;
    if (jobTitle && jobTitle.toLowerCase() === 'owner') {
      jobTitle = 'Owner'; // Capitalize if found in lowercase, mixed case, or uppercase
    }

    const extractedData = {
      company_name: companyInfo.company_name || null,
      description: companyInfo.description || null,
      email: companyInfo.email || null,
      phone: contactInfo.phone || null,
      address: { ...DEFAULT_ADDRESS, ...(contactInfo.address || {}) },
      services: Array.isArray(servicesInfo.services) ? servicesInfo.services.filter(Boolean) : [],
      service_areas: Array.isArray(serviceAreasInfo.service_areas) ? serviceAreasInfo.service_areas.filter(Boolean) : [],
      business_hours: createBusinessHoursSkeleton(businessHoursFromTask),
      business_hours_note: companyInfo.business_hours_note || hoursInfo.business_hours_note || null,
      available_for_emergencies: companyInfo.available_for_emergencies ?? hoursInfo.available_for_emergencies ?? null,
      job_title: jobTitle,
      personal_name: { ...DEFAULT_PERSONAL_NAME, ...(companyInfo.personal_name || {}) },
      warnings: mergedWarnings
    };

    if (extractedData.description) {
      extractedData.description = cleanDescription(extractedData.description);
      // Check for malformed descriptions (CSS code, etc.)
      if (isMalformedDescription(extractedData.description)) {
        extractedData.description = null;
      } else if (extractedData.description?.toLowerCase().trim() === extractedData.company_name?.toLowerCase().trim()) {
        extractedData.description = null;
      }
    }

    extractedData.services = extractedData.services.map(cleanServiceLabel).filter(Boolean);
    extractedData.service_areas = extractedData.service_areas
      .map(area => decodeHtmlEntities(area.trim()))
      .map(area => {
        // Remove state abbreviation if present (e.g., "City, ST" -> "City")
        // Also handle counties (e.g., "King County, WA" -> "King County")
        return area.replace(/,\s*[A-Z]{2}$/i, '').trim();
      })
      .filter(Boolean)
      .filter(validateServiceArea);

    if (extractedData.business_hours_note) {
      extractedData.business_hours_note = decodeHtmlEntities(extractedData.business_hours_note).replace(/\s+/g, ' ').trim();
    }

    const hasBusinessHours = extractedData.business_hours && Object.keys(extractedData.business_hours).length > 0;
    const allClosed = hasBusinessHours && Object.values(extractedData.business_hours).every(day =>
      day && day.closed === true && !day.open && !day.close
    );

    if (websiteContent && (!hasBusinessHours || allClosed)) {
      const fallbackHoursInfo = parseBusinessHoursFromText(websiteContent);
      if (Object.keys(fallbackHoursInfo.hours).length > 0) {
        extractedData.business_hours = mergeBusinessHours(extractedData.business_hours, fallbackHoursInfo.hours);
      }
      if (fallbackHoursInfo.availableForEmergencies) {
        extractedData.available_for_emergencies = true;
      }
      if (fallbackHoursInfo.note && !extractedData.business_hours_note) {
        extractedData.business_hours_note = fallbackHoursInfo.note;
      }
    }

    if (websiteContent) {
      if (!extractedData.description) {
        const fallbackDescription = extractDescriptionFromContent(websiteContent);
        if (fallbackDescription) {
          const cleaned = cleanDescription(fallbackDescription);
          // Don't use description if it's malformed or just the company name
          if (cleaned && !isMalformedDescription(cleaned) && cleaned.toLowerCase().trim() !== extractedData.company_name?.toLowerCase().trim()) {
            extractedData.description = cleaned;
          }
        }
      } else if (extractedData.description && extractedData.description.toLowerCase().trim() === extractedData.company_name?.toLowerCase().trim()) {
        // Try fallback if description is just company name
        const fallbackDescription = extractDescriptionFromContent(websiteContent);
        if (fallbackDescription) {
          const cleaned = cleanDescription(fallbackDescription);
          if (cleaned && !isMalformedDescription(cleaned) && cleaned.toLowerCase().trim() !== extractedData.company_name?.toLowerCase().trim()) {
            extractedData.description = cleaned;
          } else {
            extractedData.description = null;
          }
        } else {
          extractedData.description = null;
        }
      } else if (extractedData.description && isMalformedDescription(extractedData.description)) {
        // If current description is malformed, try fallback
        const fallbackDescription = extractDescriptionFromContent(websiteContent);
        if (fallbackDescription) {
          const cleaned = cleanDescription(fallbackDescription);
          if (cleaned && !isMalformedDescription(cleaned) && cleaned.toLowerCase().trim() !== extractedData.company_name?.toLowerCase().trim()) {
            extractedData.description = cleaned;
          } else {
            extractedData.description = null;
          }
        } else {
          extractedData.description = null;
        }
      }

      const fallbackServices = extractServicesFromContent(websiteContent);
      if (fallbackServices.length > 0) {
        const serviceSet = new Set((extractedData.services || []).map(service => cleanServiceLabel(service)));
        fallbackServices.forEach(service => {
          const cleaned = cleanServiceLabel(service);
          if (cleaned && !serviceSet.has(cleaned)) {
            serviceSet.add(cleaned);
            extractedData.services.push(cleaned);
          }
        });
      }

      const structuredAddress = extractStructuredDataAddress(websiteContent);
      if (structuredAddress) {
        extractedData.address = { ...(extractedData.address || {}), ...structuredAddress };
      }
      const stateHint = extractedData.address?.state_province_region || structuredAddress?.state_province_region;

      const fallbackServiceAreas = extractServiceAreasFromContent(websiteContent);
      if (fallbackServiceAreas.length > 0) {
        const existingAreas = new Set((extractedData.service_areas || []).map(area => area.toLowerCase()));
        const mergedAreas = [...(extractedData.service_areas || [])];
        fallbackServiceAreas.forEach(area => {
          let normalized = decodeHtmlEntities(area.trim());
          if (!normalized) return;
          
          // Remove state abbreviation if present (e.g., "City, ST" -> "City", "County, ST" -> "County")
          normalized = normalized.replace(/,\s*[A-Z]{2}$/i, '').trim();
          // Also handle full state names after comma (e.g., "City, Washington" -> "City")
          normalized = normalized.replace(/,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/i, '').trim();
          
          // Skip if it's just a state abbreviation (e.g., "MI" or "MI, MI")
          if (normalized.length <= 3 && /^[A-Z]{2,3}$/i.test(normalized)) {
            return;
          }
          
          if (!validateServiceArea(normalized)) return;
          if (!existingAreas.has(normalized.toLowerCase())) {
            existingAreas.add(normalized.toLowerCase());
            mergedAreas.push(normalized);
          }
        });
        extractedData.service_areas = mergedAreas;
      }

      if (stateHint && extractedData.service_areas?.length) {
        extractedData.service_areas = filterServiceAreasByState(extractedData.service_areas, stateHint);
      }

      if (!extractedData.phone || PLACEHOLDER_PHONE_REGEX.test(extractedData.phone)) {
        console.log(`[Vendor Find] Trying fallback phone extraction...`);
        const fallbackPhone = extractPhoneFromContent(websiteContent);
        if (fallbackPhone) {
          console.log(`[Vendor Find] Fallback phone extraction found: ${fallbackPhone}`);
          extractedData.phone = fallbackPhone;
        } else {
          console.log(`[Vendor Find] Fallback phone extraction found nothing`);
        }
      }

      if (extractedData.phone) {
        const formatted = formatPhoneNumber(extractedData.phone);
        if (formatted === null) {
          extractedData.phone = null;
        } else {
          extractedData.phone = formatted;
        }
      }

      // Fallback email extraction if not found by OpenAI
      if (!extractedData.email) {
        console.log(`[Vendor Find] Trying fallback email extraction...`);
        const fallbackEmail = extractEmailFromContent(websiteContent);
        if (fallbackEmail) {
          console.log(`[Vendor Find] Fallback email extraction found: ${fallbackEmail}`);
          extractedData.email = fallbackEmail;
        } else {
          console.log(`[Vendor Find] Fallback email extraction found nothing`);
        }
      }

      if (!extractedData.business_hours_note) {
        const hoursNote = extractBusinessHoursNote(websiteContent);
        if (hoursNote) {
          extractedData.business_hours_note = hoursNote;
        }
      }

      if ((!extractedData.address || !extractedData.address.address_line_1) && websiteContent) {
        const fallbackAddress = extractAddressFromContent(websiteContent);
        if (fallbackAddress) {
          extractedData.address = { ...(extractedData.address || {}), ...fallbackAddress };
        }
      }

      if (extractedData.address?.state_province_region) {
        extractedData.address.state_province_region = normalizeStateAbbreviation(extractedData.address.state_province_region);
      }

      // If no service areas found but we have a PO Box address with a city, use the city as a service area
      if ((!extractedData.service_areas || extractedData.service_areas.length === 0) && 
          extractedData.address?.address_line_1 && 
          extractedData.address?.city &&
          /P\.?\s*O\.?\s*Box/i.test(extractedData.address.address_line_1)) {
        console.log(`[Vendor Find] No service areas found, but PO Box address has city "${extractedData.address.city}" - using city as service area`);
        extractedData.service_areas = [extractedData.address.city];
      }
    }

    console.log(`[Vendor Find] Final extracted data for ${websiteUrl}:`, {
      hasCompanyName: !!extractedData.company_name,
      hasDescription: !!extractedData.description,
      hasEmail: !!extractedData.email,
      hasPhone: !!extractedData.phone,
      hasAddress: !!extractedData.address?.address_line_1,
      servicesCount: extractedData.services?.length || 0,
      serviceAreasCount: extractedData.service_areas?.length || 0,
      hasBusinessHours: !!extractedData.business_hours,
      warningsCount: extractedData.warnings?.length || 0
    });

    return res.status(200).json({
      success: true,
      data: extractedData,
      website_url: websiteUrl
    });

  } catch (error) {
    console.error('Error in vendor find API:', error);
    return res.status(500).json({ 
      error: 'Failed to extract vendor information',
      message: error.message 
    });
  }
};


