/**
 * Deterministic mapping of lease/renewal values onto a template_data schema.
 * Mirrors the string-matching fallback used by Fill Lease (LeasesPage).
 */

const SCHEMA_META_KEYS = new Set([
  'type',
  'description',
  'position',
  'items',
  'properties',
  'required',
  'format',
  'enum',
  'default',
  'title',
]);

/**
 * Deep-merge plain objects (overlay wins). Arrays/primitives replace.
 * @param {object} base
 * @param {object} overlay
 * @returns {object}
 */
export function deepMergeObjects(base = {}, overlay = {}) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMergeObjects(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeFieldToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_\s-]/g, '');
}

/**
 * Prefer exact token matches. Allow contains-matching only for longer tokens
 * so short variations like "rent" / "date" / "end" do not hit unrelated fields.
 */
function tokensMatchField(fieldToken, variation) {
  if (!fieldToken || !variation) return false;
  if (fieldToken === variation) return true;
  if (variation.length >= 6 && fieldToken.includes(variation)) return true;
  if (fieldToken.length >= 6 && variation.includes(fieldToken)) return true;
  return false;
}

function setNestedProperty(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Find a template field path by name / description variations.
 * Prefers exact token matches over contains-matches so "security_deposit"
 * does not land on Security_Deposit_Bank before Security_Deposit_Amount.
 * @param {object} templateData
 * @param {string[]} fieldNameVariations
 * @returns {{ path: string }|null}
 */
export function findTemplateField(templateData, fieldNameVariations) {
  if (!templateData || typeof templateData !== 'object') return null;

  const variations = (fieldNameVariations || [])
    .map(normalizeFieldToken)
    .filter(Boolean);
  if (!variations.length) return null;

  const exactHits = [];
  const softHits = [];

  const search = (obj, path = '') => {
    for (const [key, value] of Object.entries(obj || {})) {
      if (SCHEMA_META_KEYS.has(key)) continue;

      const currentPath = path ? `${path}.${key}` : key;
      const keyToken = normalizeFieldToken(key);
      const descToken = normalizeFieldToken(value?.description);
      const isFieldDef =
        value && typeof value === 'object' && !Array.isArray(value) && value.type;

      if (isFieldDef) {
        for (const variation of variations) {
          if (keyToken === variation || descToken === variation) {
            exactHits.push({ path: currentPath, variationLen: variation.length });
            break;
          }
          if (tokensMatchField(keyToken, variation) || tokensMatchField(descToken, variation)) {
            softHits.push({ path: currentPath, variationLen: variation.length });
            break;
          }
        }
        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        search(value, currentPath);
      }
    }
  };

  search(templateData);

  const pickBest = (hits) => {
    if (!hits.length) return null;
    hits.sort((a, b) => b.variationLen - a.variationLen);
    return { path: hits[0].path };
  };

  return pickBest(exactHits) || pickBest(softHits);
}

/**
 * Map common lease/renewal values into a nested object matching template_data paths.
 * @param {object|null|undefined} templateData
 * @param {object} values
 * @returns {object}
 */
export function mapLeaseLikeDataToTemplate(templateData, values = {}) {
  if (!templateData || typeof templateData !== 'object') return {};

  const mapped = {};

  const assign = (variations, value) => {
    if (value === null || value === undefined || value === '') return;
    const field = findTemplateField(templateData, variations);
    if (field) {
      setNestedProperty(mapped, field.path, value);
    }
  };

  assign(
    [
      'Agreement Date',
      'Agreement_Date',
      'Date of Agreement',
      'date_of_agreement',
      'Date of the agreement',
      'Lease Date',
      'Contract Date',
      'renewal_date',
    ],
    values.date_of_agreement
  );

  assign(
    [
      'Start Date',
      'start_date',
      'Term_Lease_Start_Date',
      'Lease Start',
      'lease_start_date',
      'Commencement Date',
      'Move In Date',
      'renewal_start_date',
    ],
    values.start_date
  );

  assign(
    [
      'End Date',
      'end_date',
      'Lease End',
      'lease_end_date',
      'Termination Date',
      'Expiration Date',
      'renewal_end_date',
      'shall end at midnight on',
      'Agreement shall end',
    ],
    values.end_date
  );

  assign(
    [
      'Monthly Rent',
      'monthly_rent',
      'monthly_rent_amount',
      'Rent Amount',
      'Monthly Payment',
      'rentamount',
    ],
    values.monthly_rent_amount
  );

  assign(
    [
      'Security Deposit Amount',
      'security_deposit_amount',
      'Security_Deposit_Amount',
      'Security Deposit',
      'security_deposit',
    ],
    values.security_deposit_amount
  );

  assign(
    [
      'Pet Deposit',
      'pet_deposit',
      'pet_deposit_amount',
      'Pet Fee',
    ],
    values.pet_deposit_amount
  );

  assign(
    [
      'Lessor',
      'lessor',
      'Landlord',
      'landlord',
      'Owner',
      'owner',
      'Lessor Name',
      'lessor_name',
      'Landlord Name',
      'landlord_name',
      'Property Owner',
    ],
    values.landlord_name
  );

  assign(
    [
      'Tenant',
      'tenant',
      'Tenants',
      'tenants',
      'Tenant Name',
      'tenant_name',
      'tenant_names',
      'Lessee',
      'lessee',
      'Lessee Name',
      'Resident',
      'Residents',
      'primary_tenant_name',
    ],
    values.tenant_names
  );

  assign(
    [
      'Property Known As',
      'Property Address',
      'property_address',
      'Address',
      'Premises',
      'Property Location',
      'Rental Property Address',
    ],
    values.property_address
  );

  assign(
    ['Property Name', 'property_name', 'Building Name'],
    values.property_name
  );

  assign(
    ['Unit', 'unit', 'Unit Number', 'unit_number', 'Apartment', 'Apt'],
    values.unit_number
  );

  assign(
    [
      'County',
      'county',
      'County of Jurisdiction',
      'County_of_Jurisdiction',
      'county_of_jurisdiction',
      'Jurisdiction County',
    ],
    values.property_county || values.county
  );

  assign(
    [
      'Rent Due Date',
      'Rent_Due_Date',
      'rent_due_date',
      'Due Date',
      'due_date',
      'Rent Payment Date',
      'Payment Due Date',
    ],
    values.rent_due_date
  );

  assign(
    [
      'Lease Term',
      'Lease_Term',
      'lease_term',
      'Term',
      'Lease Duration',
      'Rental Period',
      'Tenancy Term',
    ],
    values.lease_term
  );

  assign(
    [
      'Pets Allowed',
      'Pets_Allowed',
      'pets_allowed',
      'Pet Policy',
      'Allow Pets',
      'Pets',
      'pets',
    ],
    values.pets_allowed != null ? values.pets_allowed : values.pets
  );

  assign(
    [
      'Dependent Names',
      'dependent_names',
      'Dependents',
      'Occupants',
      'Additional Occupants',
    ],
    values.dependent_names
  );

  assign(
    [
      'Other Fee',
      'other_fee',
      'other_fee_amount',
      'Additional Fee',
      'Other Charges',
    ],
    values.other_fee_amount
  );

  // Notice-specific fields
  assign(
    [
      'Current Rent',
      'current_rent',
      'Current Monthly Rent',
      'Old Rent',
      'Previous Rent',
    ],
    values.current_rent
  );

  assign(
    [
      'New Rent',
      'new_rent',
      'New Monthly Rent',
      'Increased Rent',
    ],
    values.new_rent
  );

  assign(
    [
      'Effective Date',
      'effective_date',
      'Notice Effective Date',
      'Date Effective',
    ],
    values.effective_date
  );

  assign(
    [
      'Notice Type',
      'notice_type',
      'Type of Notice',
    ],
    values.notice_type
  );

  assign(
    [
      'Percent Increase',
      'percent_increase',
      'Increase Percent',
      'Rent Increase Percent',
    ],
    values.percent_increase != null ? String(values.percent_increase) : ''
  );

  assign(
    [
      'Questions Contact',
      'Contact Name',
      'Property Manager',
      'Manager Name',
      'pmc_name',
    ],
    values.questions_contact_name || values.pmc_name
  );

  return mapped;
}
