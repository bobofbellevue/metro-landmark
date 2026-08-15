/**
 * Whom tenants should call with questions about a notice or property.
 *
 * Priority:
 * 1. Property manager assigned to the property (person + contact info)
 * 2. PM company with no assigned PM (company name + office contact)
 * 3. Landlord, only when the property is self-managed (no PM and no PMC)
 */
import { formatPersonDisplayName } from './lease-display.js';

/**
 * Format full name with period after middle initial.
 * @param {string} firstName
 * @param {string} middleName
 * @param {string} lastName
 * @returns {string}
 */
function formatFullName(firstName, middleName, lastName) {
  if (!firstName || !lastName) return '';
  let name = firstName;
  if (middleName) {
    const middleInitial = middleName.charAt(0).toUpperCase();
    name += ` ${middleInitial}.`;
  }
  name += ` ${lastName}`;
  return name.trim();
}

/**
 * Normalize contact_methods into phone, email, and display lines.
 * @param {Array<{ method_type?: string, value?: string }>|null|undefined} methods
 * @param {{ email?: string|null }} [extras]
 * @returns {{ phone: string|null, email: string|null, lines: string[] }}
 */
export function normalizeContactMethods(methods, extras = {}) {
  const list = (methods || []).filter((m) => (m.value || '').trim());
  let email =
    list.find((m) => (m.method_type || '').toLowerCase() === 'email')?.value ||
    extras.email ||
    null;
  const phoneTypes = ['phone', 'cell', 'mobile', 'telephone', 'work', 'home', 'office'];
  let phone =
    list.find((m) => {
      const t = (m.method_type || '').toLowerCase();
      return phoneTypes.some((p) => t === p || t.includes(p));
    })?.value || null;

  if (!phone) {
    phone =
      list.find((m) => (m.method_type || '').toLowerCase() !== 'email')?.value ||
      null;
  }

  const lines = [];
  const seen = new Set();
  for (const m of list) {
    const type = (m.method_type || '').trim();
    const value = (m.value || '').trim();
    if (!value) continue;
    const key = `${type.toLowerCase()}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lower = type.toLowerCase();
    const pretty =
      lower === 'email'
        ? 'Email'
        : ['phone', 'telephone'].includes(lower)
          ? 'Phone'
          : type
            ? type.charAt(0).toUpperCase() + type.slice(1)
            : 'Phone';
    lines.push(`${pretty}: ${value}`);
  }
  if (email && !lines.some((l) => l.toLowerCase().startsWith('email:'))) {
    lines.push(`Email: ${email}`);
  }

  return { phone, email, lines };
}

/**
 * @param {object} supabase
 * @param {number|null|undefined} contactId
 * @returns {Promise<object[]>}
 */
async function fetchMethodsForContactId(supabase, contactId) {
  if (!contactId) return [];
  const { data } = await supabase
    .from('contact_methods')
    .select('method_type, value')
    .eq('contact_id', contactId);
  return data || [];
}

/**
 * First matching contacts row. Uses limit(1) — maybeSingle() returns null
 * when more than one row exists.
 * @param {object} supabase
 * @param {string} contactableType
 * @param {number} contactableId
 * @param {string} [columns]
 */
async function fetchFirstContact(
  supabase,
  contactableType,
  contactableId,
  columns = 'contact_id, first_name, middle_name, last_name'
) {
  if (!contactableType || !contactableId) return null;
  const { data, error } = await supabase
    .from('contacts')
    .select(columns)
    .eq('contactable_type', contactableType)
    .eq('contactable_id', contactableId)
    .limit(1);
  if (error) {
    console.error(
      '[RENDER_DIAG] contact lookup failed:',
      error.message || error,
      { contactableType, contactableId, code: error.code }
    );
    return null;
  }
  return data?.[0] || null;
}

/**
 * Build the display name used elsewhere as landlord.formatted_name.
 * Prefer contact first+last (landlords.landlord_name does not exist).
 * @param {{ landlord_name?: string|null }|null|undefined} landlord
 * @param {{ first_name?: string, middle_name?: string, last_name?: string }|null|undefined} contact
 * @param {string|null|undefined} emailFallback
 * @returns {string}
 */
export function formatLandlordFormattedName(
  landlord,
  contact = null,
  emailFallback = null
) {
  const fromContact = formatFullName(
    contact?.first_name,
    contact?.middle_name,
    contact?.last_name
  );
  if (fromContact) return fromContact;

  const partial = formatPersonDisplayName({
    first_name: contact?.first_name,
    middle_name: contact?.middle_name,
    last_name: contact?.last_name,
  });
  if (partial) return partial;

  const company = (landlord?.landlord_name || '').trim();
  if (company) return company;

  return (emailFallback || '').trim();
}

/**
 * Merge missing phone/email/lines from a fallback contact onto a primary contact.
 * @param {object|null} primary
 * @param {object|null} fallback
 */
export function enrichContactInfo(primary, fallback) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;
  const phone = primary.phone || fallback.phone || null;
  const email = primary.email || fallback.email || null;

  const lines = [...(primary.contact_lines || [])];
  const hasPhoneLine = lines.some((l) => {
    const lower = l.toLowerCase();
    return (
      lower.startsWith('phone:') ||
      lower.startsWith('cell:') ||
      lower.startsWith('mobile:')
    );
  });
  const hasEmailLine = lines.some((l) => l.toLowerCase().startsWith('email:'));

  if (!hasPhoneLine) {
    if (phone) {
      lines.push(`Phone: ${phone}`);
    } else {
      for (const fl of fallback.contact_lines || []) {
        const lower = fl.toLowerCase();
        if (
          lower.startsWith('phone:') ||
          lower.startsWith('cell:') ||
          lower.startsWith('mobile:')
        ) {
          lines.push(fl);
          break;
        }
      }
    }
  }
  if (!hasEmailLine) {
    if (email) {
      lines.push(`Email: ${email}`);
    } else {
      for (const fl of fallback.contact_lines || []) {
        if (fl.toLowerCase().startsWith('email:')) {
          lines.push(fl);
          break;
        }
      }
    }
  }

  return {
    ...primary,
    phone,
    email,
    contact_lines: lines,
  };
}

/**
 * Load phone/email + display name for a users row (manager / staff contact).
 * @param {object} supabase
 * @param {{ user_id: number, email?: string|null }} user
 * @param {string} roleLabel
 */
export async function contactFromUser(supabase, user, roleLabel) {
  const contact = await fetchFirstContact(supabase, 'user', user.user_id);
  const methods = await fetchMethodsForContactId(supabase, contact?.contact_id);
  const picked = normalizeContactMethods(methods, { email: user.email || null });

  const name =
    formatPersonDisplayName({
      first_name: contact?.first_name,
      middle_name: contact?.middle_name,
      last_name: contact?.last_name,
      email: picked.email,
    }) || roleLabel;

  return {
    role: roleLabel,
    name,
    phone: picked.phone,
    email: picked.email,
    contact_lines: picked.lines,
  };
}

/**
 * Resolve PMC company name + office contact methods.
 * @param {object} supabase
 * @param {number} pmcId
 */
export async function contactFromPmc(supabase, pmcId) {
  const { data: pmc } = await supabase
    .from('pm_companies')
    .select('pmc_id, company_name')
    .eq('pmc_id', pmcId)
    .maybeSingle();

  if (!pmc?.company_name) return null;

  const pmcContact = await fetchFirstContact(
    supabase,
    'pm_company',
    pmc.pmc_id,
    'contact_id'
  );
  const methods = await fetchMethodsForContactId(supabase, pmcContact?.contact_id);
  const picked = normalizeContactMethods(methods);

  return {
    role: 'Property Management Company',
    name: pmc.company_name,
    phone: picked.phone,
    email: picked.email,
    contact_lines: picked.lines,
  };
}

/**
 * Load landlord contact row(s) the same way lease fill / landlord UI does.
 * @param {object} supabase
 * @param {{ landlord_id: number, user_id?: number|null }} landlord
 */
async function fetchLandlordContactRow(supabase, landlord) {
  const byLandlordId = await fetchFirstContact(
    supabase,
    'landlord',
    landlord.landlord_id
  );
  if (byLandlordId) return byLandlordId;

  if (landlord.user_id) {
    const byUserAsLandlord = await fetchFirstContact(
      supabase,
      'landlord',
      landlord.user_id
    );
    if (byUserAsLandlord) return byUserAsLandlord;

    const byUser = await fetchFirstContact(supabase, 'user', landlord.user_id);
    if (byUser) return byUser;
  }

  return null;
}

/**
 * Resolve landlord name and phone/email.
 * Names live on contacts. Do not select landlords.manager_id — that column
 * was dropped (managers are assigned on properties).
 * Landlord mailing address is PMC-internal and must not appear on notices.
 * @param {object} supabase
 * @param {number} landlordId
 */
export async function contactFromLandlord(supabase, landlordId) {
  if (!landlordId) return null;

  const { data: landlord, error: landlordError } = await supabase
    .from('landlords')
    .select('landlord_id, user_id')
    .eq('landlord_id', landlordId)
    .maybeSingle();

  if (landlordError) {
    console.error(
      '[RENDER_DIAG] contactFromLandlord landlord lookup failed:',
      landlordError.message || landlordError,
      { landlordId, code: landlordError.code, details: landlordError.details }
    );
    return null;
  }
  if (!landlord) return null;

  let userEmail = null;
  if (landlord.user_id) {
    const { data: landlordUser } = await supabase
      .from('users')
      .select('email')
      .eq('user_id', landlord.user_id)
      .maybeSingle();
    userEmail = landlordUser?.email || null;
  }

  const contact = await fetchLandlordContactRow(supabase, landlord);
  const methods = await fetchMethodsForContactId(supabase, contact?.contact_id);
  const picked = normalizeContactMethods(methods, { email: userEmail });

  const name = formatLandlordFormattedName(landlord, contact, picked.email);
  if (!name) return null;

  return {
    role: 'Landlord',
    name,
    phone: picked.phone,
    email: picked.email,
    contact_lines: picked.lines,
  };
}

/**
 * True when the property has no assigned PM and no PM company.
 * @param {{ manager_id?: number|null, pmc_id?: number|null }|null|undefined} property
 */
export function isOwnerManagedProperty(property) {
  return !property?.manager_id && !property?.pmc_id;
}

/**
 * Resolve whom tenants should contact with questions.
 * Priority: assigned property manager → PM company office → landlord (self-managed only).
 * @param {object} supabase
 * @param {{ manager_id?: number|null, pmc_id?: number|null, landlord_id?: number|null }|null} property
 * @param {number|null|undefined} leaseLandlordId
 */
export async function resolveNoticeQuestionsContact(
  supabase,
  property,
  leaseLandlordId = null
) {
  if (!property && !leaseLandlordId) return null;

  const pmcContact = property?.pmc_id
    ? await contactFromPmc(supabase, property.pmc_id)
    : null;

  if (property?.manager_id) {
    const { data: manager } = await supabase
      .from('users')
      .select('user_id, email, role')
      .eq('user_id', property.manager_id)
      .maybeSingle();

    if (manager) {
      const pm = await contactFromUser(supabase, manager, 'Property Manager');
      return enrichContactInfo(pm, pmcContact);
    }
  }

  if (pmcContact) {
    return pmcContact;
  }

  if (!isOwnerManagedProperty(property)) {
    return null;
  }

  const landlordId =
    property?.landlord_id ||
    property?.building_owner_landlord_id ||
    leaseLandlordId ||
    null;

  return contactFromLandlord(supabase, landlordId);
}

/**
 * Body lines for the "whom to call" block on a notice.
 * @param {object|null|undefined} questionsContact
 * @param {{ pmc_name?: string, landlord_name?: string }} [fallbacks]
 * @returns {string[]}
 */
export function buildQuestionsContactLines(
  questionsContact = null,
  fallbacks = {}
) {
  const qc = questionsContact;
  const name = ((qc && qc.name) || fallbacks.pmc_name || fallbacks.landlord_name || '').trim();
  if (!name) return [];

  const role = (qc && qc.role) || '';
  const lines = [
    'If you have any questions about this notice, please contact:',
    role ? `${role}: ${name}` : name,
  ];

  const contactLines =
    Array.isArray(qc?.contact_lines) && qc.contact_lines.length > 0
      ? qc.contact_lines
      : [
          qc?.phone ? `Phone: ${qc.phone}` : null,
          qc?.email ? `Email: ${qc.email}` : null,
        ].filter(Boolean);
  for (const contactLine of contactLines) {
    lines.push(contactLine);
  }

  return lines;
}
