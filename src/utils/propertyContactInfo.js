import { supabase } from '../lib/supabase.js';
import { resolveNoticeQuestionsContact } from './notice-questions-contact.js';

function typeFromRole(role) {
  if (role === 'Property Manager') return 'manager';
  if (role === 'Property Management Company') return 'pm_company';
  if (role === 'Landlord') return 'owner';
  return 'contact';
}

/**
 * Get contact information for a property.
 * Priority: assigned property manager → PM company office → landlord (self-managed only).
 * @param {number} propertyId - Property ID
 * @returns {Promise<Object|null>} - Object with name, phone, email, type, and role
 */
export async function getPropertyContactInfo(propertyId) {
  if (!propertyId) {
    return null;
  }

  try {
    const { data: property, error: propError } = await supabase
      .from('properties')
      .select('property_id, pmc_id, landlord_id, manager_id')
      .eq('property_id', propertyId)
      .single();

    if (propError) {
      console.error('[getPropertyContactInfo] Error fetching property:', propError);
      return null;
    }

    if (!property) {
      return null;
    }

    const contact = await resolveNoticeQuestionsContact(supabase, property);
    if (!contact?.name) return null;

    return {
      name: contact.name,
      phone: contact.phone || null,
      email: contact.email || null,
      type: typeFromRole(contact.role),
      role: contact.role,
    };
  } catch (error) {
    console.error('[getPropertyContactInfo] Error:', error);
    return null;
  }
}
