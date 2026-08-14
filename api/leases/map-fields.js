/* eslint-env node */
import OpenAI from 'openai';

/**
 * Vercel serverless function to intelligently map lease data to template fields using LLM
 * 
 * POST /api/leases/map-fields
 * 
 * Body (JSON):
 * - mappingData: Object containing lease, property, landlord, application, tenants
 * - templateData: Object containing the template structure
 * 
 * Response:
 * {
 *   success: boolean,
 *   mappedFields?: Object,
 *   error?: string
 * }
 */

// Format date as MM-DD-YYYY
function formatDateMMDDYYYY(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}-${day}-${year}`;
}

// Format full name with period after middle initial
function formatFullName(first_name, middle_name, last_name) {
  if (!first_name || !last_name) return '';
  let name = first_name;
  if (middle_name) {
    // Use first character of middle name with period
    const middleInitial = middle_name.charAt(0).toUpperCase();
    name += ` ${middleInitial}.`;
  }
  name += ` ${last_name}`;
  return name.trim();
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  try {
    const { mappingData, templateData } = req.body;

    if (!mappingData || !templateData) {
      return res.status(400).json({
        success: false,
        error: 'mappingData and templateData are required'
      });
    }

    // Check for API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'OPENAI_API_KEY not configured'
      });
    }

    const openai = new OpenAI({
      apiKey: apiKey
    });

    // Determine which model to use
    const model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
    const textModel = model.includes('o1') ? 'gpt-4-turbo' : model;

    // Prepare comprehensive data summary for LLM
    console.log('[map-fields] Preparing data summary. Landlord data:', {
      exists: !!mappingData.landlord,
      landlord_id: mappingData.landlord?.landlord_id,
      landlord_name: mappingData.landlord?.landlord_name,
      formatted_name: mappingData.landlord?.formatted_name,
      has_contacts: !!mappingData.landlord?.contacts,
      contacts: mappingData.landlord?.contacts,
      full_landlord: mappingData.landlord
    });
    
    const dataSummary = {
      lease: {
        date_of_agreement: mappingData.lease?.date_of_agreement ? formatDateMMDDYYYY(mappingData.lease.date_of_agreement) : null,
        start_date: mappingData.lease?.start_date ? formatDateMMDDYYYY(mappingData.lease.start_date) : null,
        end_date: mappingData.lease?.end_date ? formatDateMMDDYYYY(mappingData.lease.end_date) : null,
        monthly_rent_amount: mappingData.lease?.monthly_rent_amount,
        security_deposit_amount: mappingData.lease?.security_deposit_amount,
        pet_deposit_amount: mappingData.lease?.pet_deposit_amount,
        pets: mappingData.lease?.pets
      },
      property: {
        property_name: mappingData.property?.property_name,
        address: mappingData.property?.address ? {
          address_line_1: mappingData.property.address.address_line_1,
          address_line_2: mappingData.property.address.address_line_2,
          city: mappingData.property.address.city,
          state_province_region: mappingData.property.address.state_province_region,
          postal_code: mappingData.property.address.postal_code
        } : null,
        county_of_jurisdiction: mappingData.property?.county_of_jurisdiction,
        city_of_jurisdiction: mappingData.property?.city_of_jurisdiction
      },
      landlord: mappingData.landlord ? (() => {
        // Calculate formatted_name first
        let formattedName = '';
        if (mappingData.landlord.formatted_name && mappingData.landlord.formatted_name.trim()) {
          formattedName = mappingData.landlord.formatted_name;
        } else {
          // Calculate from contacts or use landlord_name
          const contact = Array.isArray(mappingData.landlord.contacts) && mappingData.landlord.contacts.length > 0
            ? mappingData.landlord.contacts[0]
            : mappingData.landlord.contacts;
          
          if (contact?.first_name && contact?.last_name) {
            // Format with period after middle initial
            formattedName = formatFullName(contact.first_name, contact.middle_name, contact.last_name);
          } else {
            formattedName = mappingData.landlord.landlord_name || '';
          }
        }
        
        return {
          landlord_id: mappingData.landlord.landlord_id,
          // Use formatted_name as landlord_name if landlord_name is undefined/empty
          landlord_name: mappingData.landlord.landlord_name || formattedName,
          // Handle contacts - it might be an array or object
          contact: Array.isArray(mappingData.landlord.contacts) && mappingData.landlord.contacts.length > 0
            ? {
                first_name: mappingData.landlord.contacts[0].first_name,
                last_name: mappingData.landlord.contacts[0].last_name,
                middle_name: mappingData.landlord.contacts[0].middle_name
              }
            : mappingData.landlord.contacts && typeof mappingData.landlord.contacts === 'object'
            ? {
                first_name: mappingData.landlord.contacts.first_name,
                last_name: mappingData.landlord.contacts.last_name,
                middle_name: mappingData.landlord.contacts.middle_name
              }
            : null,
          // Pre-formatted name for easy mapping to "Lessor" field
          formatted_name: formattedName
        };
      })() : null,
      tenants: mappingData.tenants?.map(t => ({
        first_name: t.first_name,
        last_name: t.last_name,
        middle_name: t.middle_name,
        email: t.email
      })) || [],
      application: mappingData.application?.field_data ? 
        (typeof mappingData.application.field_data === 'string' 
          ? JSON.parse(mappingData.application.field_data) 
          : mappingData.application.field_data) : null
    };

    const systemMessage = `You are an intelligent field mapping assistant specialized in mapping lease data to template fields.

Your task is to:
1. Analyze the provided lease data (from database and rental applications)
2. Understand the template structure and field names
3. Intelligently map data to template fields based on semantic meaning, not just exact string matches
4. Handle synonyms and related terms using the comprehensive synonym list provided below
5. Calculate derived values when needed (e.g., lease term from dates, rent due date from start date)
6. Return a JSON object with the mapped fields in the same structure as the template

CRITICAL SYNONYM MAPPINGS (USE THESE EXACTLY):
- "Lessor" = "Landlord" = "Owner" = "Property Owner" = "Lessor Name" = "Landlord Name" = "Owner Name"
  → Map from (in priority order):
    1. landlord.formatted_name (if not empty)
    2. landlord.contact.first_name + " " + landlord.contact.middle_name (if present) + " " + landlord.contact.last_name (if both first_name and last_name available)
    3. landlord.landlord_name (ALWAYS use this as final fallback if nothing else is available)
  → CRITICAL: If landlord data exists above, you MUST map "Lessor" fields - NEVER leave them blank or empty
  → If formatted_name is empty but landlord_name exists, use landlord_name
- "Tenant" = "Lessee" = "Resident" = "Tenants" = "Lessees" = "Residents" = "Tenant Name" = "Lessee Name"
  → Map from: tenants array (combine first_name, middle_name, last_name)
- "Property Known As" = "Property Address" = "Address" = "Premises" = "Property Location" = "Rental Property Address"
  → Map from: property.address (combine address_line_1, city, state, postal_code)
- "County" = "County of Jurisdiction" = "Jurisdiction County"
  → Map from: property.county_of_jurisdiction
- "Rent" = "Monthly Rent" = "Rent Amount" = "Monthly Payment" = "Rental Amount"
  → Map from: lease.monthly_rent_amount
- "Security Deposit" = "Deposit" = "Security"
  → Map from: lease.security_deposit_amount
- "Agreement Date" = "Date of Agreement" = "Lease Date" = "Contract Date"
  → Map from: lease.date_of_agreement
- "Start Date" = "Lease Start" = "Commencement Date" = "Move In Date"
  → Map from: lease.start_date
- "End Date" = "Lease End" = "Termination Date" = "Expiration Date"
  → Map from: lease.end_date
- "Lease Term" = "Term" = "Lease Duration" = "Rental Period" = "Tenancy Term"
  → Calculate from: start_date and end_date (e.g., "12 months", "1 year and 6 months", "Month-to-Month" if no end_date)
- "Rent Due Date" = "Due Date" = "Rent Payment Date" = "Payment Due Date"
  → Calculate from: start_date and convert to ordinal word (e.g., day 1 = "first", day 15 = "fifteenth", last day of month = "last", day 23 = "twenty-third")
- "Pets Allowed" = "Pet Policy" = "Allow Pets" = "Pets"
  → Map from: lease.pets or application.field_data.has_pets or application.field_data.pets_allowed

MAPPING RULES:
- ALWAYS check for "Lessor" fields and map them from landlord data - this is CRITICAL
- Use semantic understanding for all field names
- Calculate "Lease Term" from start_date and end_date (e.g., "12 months", "1 year and 6 months", "Month-to-Month")
- Calculate "Rent Due Date" from start_date and convert to ordinal word:
  * Day 1 = "first"
  * Last day of month = "last" (varies by month: 28, 29, 30, or 31)
  * Other days = ordinal words (e.g., 15 = "fifteenth", 23 = "twenty-third", 31 = "thirty-first")
- "Pets Allowed" should be a boolean or yes/no based on lease.pets or application field_data
- FORMAT DATES AS MM-DD-YYYY (e.g., "12-21-2025" not "2025-12-21" or "12/21/2025")
- FORMAT NAMES: Include a period after middle initial (e.g., "Bob B. Bellevue" not "Bob B Bellevue")
- Preserve the nested structure of the template (categories and subcategories)

IMPORTANT:
- Only map fields where you have data available
- Use null or omit fields where data is not available
- Maintain the exact nested structure of the template
- Return ONLY the mapped fields, not the entire template structure
- Use the field names exactly as they appear in the template

Template structure:
${JSON.stringify(templateData, null, 2)}

Available data:
${JSON.stringify(dataSummary, null, 2)}

CRITICAL REMINDER ABOUT LESSOR FIELD:
- "Lessor" is a legal term that means the same as "Landlord" or "Owner"
- If landlord data exists above, you MUST map it to any "Lessor" field in the template
- Use the EXACT values from the landlord data provided - DO NOT invent, guess, or use names from your training data
- Priority: landlord.formatted_name → landlord.contact (first_name + middle_name + last_name) → landlord.landlord_name
- DO NOT return the literal string "landlord_name" - return the ACTUAL VALUE from landlord.landlord_name
- DO NOT leave "Lessor" fields blank if landlord data is provided
- Copy values exactly as they appear in the data - do not modify, abbreviate, or hallucinate

Return a JSON object with mapped fields in this format:
{
  "Category_Name": {
    "Field_Name": "mapped_value"
  }
}`;

    const userMessage = `Map the available lease data to the template fields. 

CRITICAL - LESSOR FIELD MAPPING (READ CAREFULLY):
If the template contains ANY field with "Lessor" in the name (e.g., "Lessor", "Lessor Name", "Lessor_Name", etc.), you MUST map it from the landlord data provided in the "Available data" section above.

"Lessor" is a legal term meaning the same as "Landlord" or "Owner". 

IMPORTANT: You MUST use the EXACT values from the "Available data" section. DO NOT invent, guess, or hallucinate names. DO NOT use names from your training data. ONLY use the values provided in the data above.

Use this EXACT priority order to find the value:
1. Check landlord.formatted_name - if it exists and is not empty, use that EXACT value
2. If formatted_name is empty/missing, check landlord.contact.first_name and landlord.contact.last_name - if both exist, combine them as: first_name + " " + middle_name (if present) + " " + last_name (with spaces between)
3. If contact name is empty/missing, use landlord.landlord_name - this should ALWAYS be present if landlord data exists

CRITICAL RULES:
- DO NOT return the literal string "landlord_name" or "formatted_name" - return the ACTUAL VALUE
- DO NOT invent names like "Bob R. Bellman" or "Sam Odle" - ONLY use what's in the data
- DO NOT return empty string ""
- DO NOT return null
- DO NOT omit the field
- Copy the EXACT value from the data - do not modify, abbreviate, or change it

Example: If landlord.landlord_name = "Bob B. Bellevue", return "Bob B. Bellevue" (exact match, no changes)

Other field mappings:
- "Tenant" = "Lessee" = "Resident" → Map from tenants array
- "Property Known As" = "Property Address" → Map from property.address
- "County" → Map from property.county_of_jurisdiction
- "Lease Term" → Calculate from start_date and end_date
- "Rent Due Date" → Convert start_date to ordinal word (e.g., "first", "fifteenth", "last", "twenty-third")
- "Pets Allowed" → Determine from lease.pets or application data

FORMATTING REQUIREMENTS:
- All dates must be formatted as MM-DD-YYYY (e.g., "12-21-2025")
- All names with middle initials must include a period after the initial (e.g., "Bob B. Bellevue")

Return the mapped fields as JSON.`;

    console.log('[map-fields] Calling OpenAI for intelligent field mapping...');
    console.log('[map-fields] Template categories:', Object.keys(templateData || {}));
    console.log('[map-fields] Landlord data summary for Lessor mapping:', {
      exists: !!dataSummary.landlord,
      landlord_id: dataSummary.landlord?.landlord_id,
      landlord_name: dataSummary.landlord?.landlord_name,
      formatted_name: dataSummary.landlord?.formatted_name,
      formatted_name_length: dataSummary.landlord?.formatted_name?.length || 0,
      has_contact: !!dataSummary.landlord?.contact,
      contact_first_name: dataSummary.landlord?.contact?.first_name,
      contact_middle_name: dataSummary.landlord?.contact?.middle_name,
      contact_last_name: dataSummary.landlord?.contact?.last_name,
      contact_name: dataSummary.landlord?.contact ? 
        `${dataSummary.landlord.contact.first_name || ''} ${dataSummary.landlord.contact.middle_name || ''} ${dataSummary.landlord.contact.last_name || ''}`.trim().replace(/\s+/g, ' ') : null,
      full_landlord_summary: dataSummary.landlord
    });

    const response = await openai.chat.completions.create({
      model: textModel,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Very low temperature to prevent hallucinations and ensure exact value mapping
      max_tokens: 4000
    });

    // Parse the mapped fields
    let mappedFields;
    try {
      const content = response.choices[0].message.content;
      mappedFields = JSON.parse(content);
      console.log('[map-fields] Successfully mapped fields:', Object.keys(mappedFields));
      
      // Log the Lessor value specifically for debugging
      if (mappedFields.Lease_Rental_Agreement?.Lessor) {
        console.log('[map-fields] Lessor value returned by LLM:', mappedFields.Lease_Rental_Agreement.Lessor);
        console.log('[map-fields] Expected Lessor value (from data):', {
          formatted_name: dataSummary.landlord?.formatted_name,
          landlord_name: dataSummary.landlord?.landlord_name,
          contact_first_name: dataSummary.landlord?.contact?.first_name,
          contact_middle_name: dataSummary.landlord?.contact?.middle_name,
          contact_last_name: dataSummary.landlord?.contact?.last_name,
          contact_name: dataSummary.landlord?.contact ? 
            `${dataSummary.landlord.contact.first_name || ''} ${dataSummary.landlord.contact.middle_name || ''} ${dataSummary.landlord.contact.last_name || ''}`.trim().replace(/\s+/g, ' ') : null
        });
      }
      
      // Post-process to fix common LLM errors for Lessor field
      if (dataSummary.landlord) {
        // Calculate the correct Lessor value once
        let correctLessorValue = '';
        if (dataSummary.landlord.formatted_name && dataSummary.landlord.formatted_name.trim()) {
          correctLessorValue = dataSummary.landlord.formatted_name;
        } else if (dataSummary.landlord.contact?.first_name && dataSummary.landlord.contact?.last_name) {
          // Format with period after middle initial
          correctLessorValue = formatFullName(
            dataSummary.landlord.contact.first_name,
            dataSummary.landlord.contact.middle_name,
            dataSummary.landlord.contact.last_name
          );
        } else {
          correctLessorValue = dataSummary.landlord.landlord_name || '';
        }
        
        // Check all categories for Lessor fields
        for (const categoryKey in mappedFields) {
          const category = mappedFields[categoryKey];
          if (typeof category === 'object' && category !== null) {
            // Check for any field with "Lessor" in the name
            for (const fieldKey in category) {
              if (fieldKey.toLowerCase().includes('lessor')) {
                const lessorValue = category[fieldKey];
                
                // If LLM returned literal string "landlord_name" or similar, replace with actual value
                if (lessorValue === 'landlord_name' || 
                    lessorValue === 'formatted_name' || 
                    lessorValue === 'landlord.landlord_name' || 
                    lessorValue === 'landlord.formatted_name' ||
                    lessorValue === '' ||
                    lessorValue === null) {
                  console.warn(`[map-fields] LLM returned invalid value for ${categoryKey}.${fieldKey}: "${lessorValue}", replacing with actual value`);
                  category[fieldKey] = correctLessorValue;
                  console.log(`[map-fields] Corrected ${categoryKey}.${fieldKey} value:`, correctLessorValue);
                }
              }
            }
          }
        }
      }
    } catch (parseError) {
      console.error('[map-fields] Error parsing LLM response:', parseError);
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        mappedFields = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error(`Failed to parse LLM response: ${parseError.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      mappedFields: mappedFields,
      usage: response.usage
    });

  } catch (error) {
    console.error('[map-fields] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to map fields using LLM'
    });
  }
}

