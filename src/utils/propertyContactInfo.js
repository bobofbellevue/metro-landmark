import { supabase } from '../lib/supabase.js';

/**
 * Get contact information for a property
 * Priority: Manager > PM Company > Owner
 * @param {number} propertyId - Property ID
 * @returns {Promise<Object|null>} - Object with name, phone, email, and type, or null if not found
 */
export async function getPropertyContactInfo(propertyId) {
  if (!propertyId) {
    return null;
  }

  try {
    // Get property information
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

    // 1. Try to find manager directly assigned to property (highest priority)
    if (property.manager_id) {
      const { data: manager, error: managerError } = await supabase
        .from('users')
        .select('user_id, role, email')
        .eq('user_id', property.manager_id)
        .eq('role', 'manager')
        .maybeSingle();

      if (managerError) {
        console.error('[getPropertyContactInfo] Error fetching property manager:', managerError);
      } else if (manager) {
        const contactInfo = await getContactInfoForUser(manager.user_id);
        
        const result = {
          name: contactInfo?.name || 'Property Manager',
          phone: contactInfo?.phone || null,
          email: manager.email || contactInfo?.email || null,
          type: 'manager',
          role: 'Property Manager'
        };
        return result;
      }
    }

    // 2. Try to find manager at PM company (fallback if no direct assignment)
    if (property.pmc_id) {
      const { data: managers, error: managerError } = await supabase
        .from('users')
        .select('user_id, role, email')
        .eq('pmc_id', property.pmc_id)
        .eq('role', 'manager')
        .limit(1);

      if (managerError) {
        console.error('[getPropertyContactInfo] Error fetching managers:', managerError);
      } else if (managers && managers.length > 0) {
        const manager = managers[0];
        const contactInfo = await getContactInfoForUser(manager.user_id);
        
        const result = {
          name: contactInfo?.name || 'Property Manager',
          phone: contactInfo?.phone || null,
          email: manager.email || contactInfo?.email || null,
          type: 'manager',
          role: 'Property Manager'
        };
        return result;
      }

      // 2. Try to find PM company contact info (only if no manager was found)
      const { data: pmCompany, error: pmcError } = await supabase
        .from('pm_companies')
        .select('pmc_id, company_name')
        .eq('pmc_id', property.pmc_id)
        .single();

      if (pmcError) {
        console.error('[getPropertyContactInfo] Error fetching PM company:', pmcError);
      } else if (pmCompany) {
        // Check if PM company has contact info
        const { data: pmContact, error: pmContactError } = await supabase
          .from('contacts')
          .select('contact_id, first_name, last_name')
          .eq('contactable_id', pmCompany.pmc_id)
          .eq('contactable_type', 'pm_company')
          .maybeSingle();

        if (!pmContactError && pmContact) {
          const { data: contactMethods } = await supabase
            .from('contact_methods')
            .select('method_type, value')
            .eq('contact_id', pmContact.contact_id);

          const phone = contactMethods?.find(m => 
            m.method_type?.toLowerCase() === 'phone' || 
            m.method_type?.toLowerCase() === 'cell' ||
            m.method_type?.toLowerCase() === 'mobile'
          )?.value || null;

          const email = contactMethods?.find(m => 
            m.method_type?.toLowerCase() === 'email'
          )?.value || null;

          const result = {
            name: pmCompany.company_name || 'PM Company',
            phone: phone,
            email: email,
            type: 'pm_company',
            role: 'PM Company'
          };
          return result;
        } else {
          // Return company name even without contact info
          const result = {
            name: pmCompany.company_name || 'PM Company',
            phone: null,
            email: null,
            type: 'pm_company',
            role: 'PM Company'
          };
          return result;
        }
      }
    }

    // 3. Get property owner (landlord) contact info
    if (property.landlord_id) {
      const { data: landlord, error: landlordError } = await supabase
        .from('landlords')
        .select('landlord_id, user_id, users!landlords_user_id_fkey(email)')
        .eq('landlord_id', property.landlord_id)
        .single();

      if (landlordError) {
        console.error('[getPropertyContactInfo] Error fetching landlord:', landlordError);
      } else if (landlord) {
        // Get contact for landlord
        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .select('contact_id, first_name, last_name, middle_name')
          .eq('contactable_id', landlord.landlord_id)
          .eq('contactable_type', 'landlord')
          .maybeSingle();

        if (!contactError && contact) {
          const { data: contactMethods } = await supabase
            .from('contact_methods')
            .select('method_type, value')
            .eq('contact_id', contact.contact_id);

          const phone = contactMethods?.find(m => 
            m.method_type?.toLowerCase() === 'phone' || 
            m.method_type?.toLowerCase() === 'cell' ||
            m.method_type?.toLowerCase() === 'mobile'
          )?.value || null;

          const email = contactMethods?.find(m => 
            m.method_type?.toLowerCase() === 'email'
          )?.value || landlord.users?.email || null;

          // Format name with period for single-letter middle names
          const first = contact.first_name || '';
          const last = contact.last_name || '';
          const middle = contact.middle_name ? (contact.middle_name.length === 1 ? ` ${contact.middle_name}.` : ` ${contact.middle_name}`) : '';
          const name = `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim() || 'Property Owner';

          const result = {
            name: name,
            phone: phone,
            email: email,
            type: 'owner',
            role: 'Property Owner'
          };
          return result;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('[getPropertyContactInfo] Error:', error);
    return null;
  }
}

/**
 * Helper function to get contact info for a user
 */
async function getContactInfoForUser(userId) {
  try {
    // Try to get contact from user contactable_type
    const { data: userContact, error: userContactError } = await supabase
      .from('contacts')
      .select('contact_id, first_name, last_name, middle_name')
      .eq('contactable_id', userId)
      .eq('contactable_type', 'user')
      .maybeSingle();

    if (!userContactError && userContact) {
      const { data: contactMethods } = await supabase
        .from('contact_methods')
        .select('method_type, value')
        .eq('contact_id', userContact.contact_id);

      const phone = contactMethods?.find(m => 
        m.method_type?.toLowerCase() === 'phone' || 
        m.method_type?.toLowerCase() === 'cell' ||
        m.method_type?.toLowerCase() === 'mobile'
      )?.value || null;

      const email = contactMethods?.find(m => 
        m.method_type?.toLowerCase() === 'email'
      )?.value || null;

      // Format name with period for single-letter middle names
      const first = userContact.first_name || '';
      const last = userContact.last_name || '';
      const middle = userContact.middle_name ? (userContact.middle_name.length === 1 ? ` ${userContact.middle_name}.` : ` ${userContact.middle_name}`) : '';
      const name = `${first}${middle} ${last}`.replace(/\s+/g, ' ').trim();

      return { name, phone, email };
    }

    return null;
  } catch (error) {
    console.error('[getContactInfoForUser] Error:', error);
    return null;
  }
}

