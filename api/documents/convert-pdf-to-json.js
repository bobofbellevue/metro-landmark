/* eslint-env node */
import OpenAI from 'openai';

/**
 * Vercel serverless function to convert PDF rental application to JSON Schema
 * Uses OpenAI Vision API on images converted from PDF on client side
 * 
 * POST /api/documents/convert-pdf-to-json
 * 
 * Body (JSON):
 * - pdfBase64: Base64 encoded PDF file
 * 
 * Response:
 * {
 *   success: boolean,
 *   data?: Object,  // Extracted JSON schema
 *   error?: string,
 *   model?: string,
 *   usage?: Object
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    // Check for API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (!apiKey) {
      console.error('OpenAI API key not found in environment variables');
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable in Vercel.'
      });
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey
    });

    // Handle file upload - expect base64 images (PDF converted to images on client)
    let images;
    
    if (!req.body) {
      return res.status(400).json({
        success: false,
        error: 'Request body is missing.'
      });
    }
    
    if (req.body && req.body.images && Array.isArray(req.body.images)) {
      images = req.body.images;
      if (images.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No images provided. PDF must be converted to images first.'
        });
      }
      // Validate that all images are base64 strings
      for (const img of images) {
        if (!img || typeof img !== 'string' || !img.startsWith('data:image/')) {
          return res.status(400).json({
            success: false,
            error: 'All images must be base64 encoded image data URLs (data:image/...)'
          });
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Provide images array with base64 encoded images (PDF converted to images on client).'
      });
    }

    console.log(`\n=== API REQUEST LOG ===`);
    console.log(`Received ${images.length} image(s) from client`);
    if (req.body.batchInfo) {
      console.log(`Batch info:`, JSON.stringify(req.body.batchInfo, null, 2));
      console.log(`This is batch ${req.body.batchInfo.batchNumber} of ${req.body.batchInfo.totalBatches}`);
      console.log(`Page range: ${req.body.batchInfo.pageRange}`);
    } else {
      console.log(`Single request (no batching)`);
    }
    console.log(`Image data sizes: ${images.map((img, idx) => `Image ${idx + 1}: ${Math.round(img.length / 1024)}KB`).join(', ')}`);
    console.log(`Total payload size: ~${Math.round(JSON.stringify(req.body).length / 1024)}KB`);

    // Use OpenAI Vision API on the images
    // Try gpt-4o first (better vision capabilities), fallback to gpt-4-turbo
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const visionModel = model.includes('o1') ? 'gpt-4o' : (model.includes('gpt-4') ? model : 'gpt-4o'); // o1 doesn't support vision, use gpt-4o for vision tasks
    
    const systemMessage = `Extract the form structure from rental application or lease form images. Create a JSON Schema describing all input fields.

**FIELD LIST FIRST (positions are refined in a later measurement pass):**
- Include a "position" object when you can, but prioritize correct field names/types/descriptions
- If you include positions: use 2x image PIXELS from the TOP-LEFT (typical x 100–1200, y 80–1500)
- Do NOT invent a vertical column (same x for every field with evenly stepped y)
- Do NOT multiply guessed PDF points by 2 — omit position rather than invent a grid

CRITICAL - COMPLETENESS REQUIREMENT:
- You MUST extract ALL fields from the ENTIRE form, from top to bottom, including every page
- Extract fields at the very bottom: application fees, signatures, dates, agreements, etc.
- If you cannot complete the extraction, you MUST report an error in your response
- Do NOT stop partway through - continue until you have extracted every input field on every page
- The form is incomplete if you stop before reaching signature/agreement sections at the bottom

WHAT TO EXTRACT:
- Extract fields that require user input: blanks (___), text boxes, checkboxes, dropdowns, radio buttons
- Brackets/braces/parentheses are fields only when clearly indicating input (e.g., {Date}, [choose one: A/B/C])
- Visual indicators: blank lines, input boxes, labels followed by spaces/underscores
- DO NOT extract: informational text, descriptive paragraphs, or entities mentioned in text
- CRITICAL: DO NOT create fields for paragraphs that are purely informational with no input fields (e.g., "ATTORNEYS' FEES", "SMOKE DETECTOR", "LEAD-BASED PAINT" paragraphs that just describe legal requirements)
- CRITICAL: DO NOT extract signing-related fields: signatures, initials (Tenant_Initials, Lessor_Initials, etc.), notary public information, dates of signing, witness information, or any fields related to document execution/signing
- CRITICAL: Initials are part of signing - skip ALL fields with "Initial" or "Initials" in the name (e.g., "Tenant_Initials", "Lessor_Initials", "Applicant_Initials")

SECTION AND FIELD ORDERING:
- PRESERVE EXACT document order (top to bottom, left to right) - this is critical
- When you see section headers (like "Current Address", "Previous Address", "Residence History", etc.), USE THOSE EXACT NAMES as category names or include them in field names
- Group related fields into logical categories based on section headers when present
- Within each category/section, list fields in the EXACT order they appear in the document
- If same field appears multiple times in different sections, keep ALL occurrences (they belong to different sections)
- CRITICAL: Pay attention to section headers and preserve them. For example:
  * If you see "Current Address" followed by fields, use "Current_Address" as the category name or prefix fields with "Current_Address_"
  * If you see "Previous Address" followed by fields, use "Previous_Address" as the category name or prefix fields with "Previous_Address_"
  * Do NOT ignore section headers or merge sections that are clearly separate

FIELD ORDERING RULES (CRITICAL - READ THIS CAREFULLY):
- Read fields EXACTLY like reading text in a book: left to right, then move to the next line and read left to right again
- Imagine drawing a line from left to right across each row of fields - fields are ordered by where they appear along that line
- When you see fields in a row: read them left to right in the exact order they appear horizontally
- After finishing a row, move to the next row below and read left to right again
- CRITICAL: Do NOT skip ahead to fields in lower rows, even if they seem related
- CRITICAL: Do NOT group fields by semantic meaning (e.g., don't group "Year" with "State" just because they're both short or both registration-related)
- CRITICAL: Do NOT reorder fields based on what makes logical sense - use ONLY the visual reading order
- Example for vehicles: If the form shows:
  Row 1: [Make] [Model] [Year]
  Row 2: [Color] [License Plate] [State]
  The JSON order MUST be: Make, Model, Year, Color, License Plate, State
  NOT: Make, Model, Color, License Plate, Year, State (this is WRONG - Year is in Row 1, so it comes before Row 2 fields)
- The field order in JSON must match the order you would read them if you were reading the form like a book: left to right, line by line

MULTIPLE APPLICANTS / CO-APPLICANTS:
- CRITICAL: When you see sections like "Second Applicant", "Co-Applicant", "Additional Applicant", or similar, these represent SEPARATE PEOPLE
- Structure multiple applicants as an ARRAY, not as additional fields on the first applicant
- Each applicant should have their own complete set of fields (First Name, Middle Initial, Last Name, Date of Birth, etc.)
- Do NOT prefix fields with "Second_" or "Co-Applicant_" - instead, create an array structure
- Example structure:
  * If form has "Applicant" section and "Second Applicant" section:
    "Applicants": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "First_Name": { "type": "string", "required": true, "description": "First name" },
          "Middle_Initial": { "type": "string", "required": false, "description": "Middle initial" },
          "Last_Name": { "type": "string", "required": true, "description": "Last name" }
        }
      }
    }
- If the form uses labels like "Second Applicant" or "Co-Applicant", recognize these as separate people, not additional fields for the first applicant
- Each applicant section should be treated as a separate entity with their own complete field set

FIELD ANALYSIS:
- Date fields with "___ / ___" pattern = MM/YYYY format (create separate Month/Year fields, type "string")
- "From...To" date ranges = create separate From and To fields
- Address fields: If "Address" is followed by "Unit" and "City/State/Zip", first field is street address only
- Employment sections: Extract employer fields AND supervisor fields separately (don't merge)
- Use natural descriptions: "Date of application submission" not "Date of application filling"

FIELD TYPES:
- string: text inputs, MM/YYYY date fields
- date: full dates only (MM/DD/YYYY format)
- number: numeric values
- boolean: checkboxes/radio buttons
- array: repeating items (vehicles, pets, references, multiple applicants)
- object: complex structures
- enum: dropdowns with visible options

CHECKBOX GROUPS - CRITICAL (APPLIES TO ALL FORMS):
- When you see multiple checkboxes on a line, create a separate boolean field for each checkbox
- Each checkbox represents a separate yes/no question and must be its own boolean field
- Field type MUST be "boolean" for checkboxes, NOT "array", "string", or "object"
- Place checkbox fields directly in the appropriate category as top-level fields, NOT nested in objects or arrays
- Any series of blank underlines represents a field that must be extracted - determine the field type based on context
- If blank underlines appear after checkboxes, they typically indicate an "other" option requiring both a boolean field and a string description field
- Extract every checkbox and every blank underline field - do not skip any
- Field names should be descriptive, based on the actual form text and context
- Use clear, unambiguous descriptions that logically match the field name

ALTERNATIVE CHECKBOXES WITH CONDITIONAL FIELDS - CRITICAL (READ CAREFULLY):
- When you see instructions like "Check one" or "(Check one)" followed by options marked with letters (a., b., etc.), these are ALTERNATIVE checkboxes
- Section numbers (3., 4., etc.) indicate separate sections. Subsection markers (a., b., etc.) indicate alternatives within a section
- CRITICAL EXAMPLE - LEASE TERM SELECTION:
  * If you see: "3. TERM (Check one). [ ] a. LEASE. This Agreement is for a term of ______________ commencing on _____________. This Agreement shall end at midnight on __________________________________________. [ ] b. MONTH-TO-MONTH. This Agreement is for a month-to-month tenancy commencing on _____."
  * You MUST create ALL of these fields:
    1. "Term_Lease" (boolean) - "Whether lease term is a fixed lease (not month-to-month)"
    2. "Term_Month_To_Month" (boolean) - "Whether lease term is month-to-month"
    3. "Term_Lease_Length" (string) - "Length of the lease term (e.g., '6 months', '12 months', '18 months', '2 years') - ONLY applicable if Term_Lease is selected"
    4. "Term_Lease_Start_Date" (date) - "Start date of the lease term - ONLY applicable if Term_Lease is selected"
    5. "Term_Lease_End_Date" (date) - "End date of the lease term - ONLY applicable if Term_Lease is selected"
    6. "Term_Month_To_Month_Start_Date" (date) - "Start date of the month-to-month tenancy - ONLY applicable if Term_Month_To_Month is selected"
  * DO NOT assume the lease term length is "one year" or "12 months" - it is a variable field that the user will fill in
  * DO NOT create a single "Term_Start_Date" field - create separate fields for each alternative path
  * The descriptions should clearly indicate which checkbox option each field applies to
- GENERAL RULE: When alternative checkboxes have different fields associated with them:
  * Create separate fields for EACH alternative path
  * Name fields to indicate which alternative they belong to (e.g., "Term_Lease_Start_Date" vs "Term_Month_To_Month_Start_Date")
  * Include in the description which checkbox option the field applies to
  * Extract ALL fields from ALL alternatives - do not skip any
- Pay attention to section numbering (3., 4., etc.) and subsection markers (a., b., etc.) to identify alternatives
- Read the ENTIRE paragraph/section to capture ALL fields and checkboxes - do not stop at the first checkbox or field

DESCRIPTION CLARITY - CRITICAL:
- Descriptions must be clear, unambiguous, and logically consistent with the field name
- Read the form text carefully to understand what the checkbox means
- Example: "Tenant shall pay all utilities when due except: [ ] water"
  - This means: if checked, water is EXCLUDED from tenant's responsibility (landlord pays)
  - Field name: "Water_Paid_by_Landlord" or "Water_Excluded_from_Tenant_Responsibility"
  - Description: "Water paid by landlord (yes/no)" or "Water excluded from tenant's responsibility (yes/no)"
  - DO NOT write contradictory descriptions like "utilities not included in rent" (ambiguous)
- When in doubt, rephrase to be explicit: "If checked, [condition] is true/false"
- Avoid phrases that could be interpreted multiple ways
- Test your description: does it clearly explain what happens when the checkbox is checked?

DESCRIPTIONS - CLARITY AND CONSISTENCY:
- Use natural, professional language
- Be specific: "Date of application submission" not "Date of application filling"
- Descriptions MUST be logically consistent with the field name
- Read the form text carefully to understand what the checkbox/field means
- For checkboxes, clearly state what happens when checked (true) vs unchecked (false)
- Avoid ambiguous phrases that could be interpreted multiple ways
- Example of BAD description: "List of utilities not included in the rent" (ambiguous - does this mean tenant pays or landlord pays?)
- Example of GOOD description: "Water paid by landlord (yes/no)" (clear - if checked, landlord pays)
- When the form says "Tenant shall pay all utilities when due except: [ ] water", the checkbox means:
  - If checked: water is EXCLUDED from tenant's responsibility (landlord pays)
  - Field name should reflect this: "Water_Paid_by_Landlord" or "Water_Excluded_from_Tenant_Responsibility"
  - Description should match: "Water paid by landlord (yes/no)" or "Water excluded from tenant's responsibility (yes/no)"
- Test your description: does it clearly explain what the field represents without ambiguity?

EXTRACTION PATTERNS:
- Multiple blanks in one sentence = separate fields for each blank
- "From...To" patterns = separate From and To fields
- Repeating sections (vehicles, pets, references) = use array type
- Extract ALL fields that appear - don't assume what should exist
- Complete the entire form - don't stop partway through
- CRITICAL: Read each paragraph/section to its END - do not stop after extracting the first field or checkbox
- CRITICAL EXAMPLE - RENT PAYMENT LOCATION:
  * If you see: "Rent shall be paid [ ] to Lessor's Broker at the address shown below [ ] to Lessor at the address shown below."
  * You MUST create TWO checkbox fields (NOT string fields, NOT a single field):
    1. "Rent_Pay_To_Broker" (boolean) - "Whether rent is paid to Lessor's Broker"
    2. "Rent_Pay_To_Lessor" (boolean) - "Whether rent is paid to Lessor"
  * These are alternative checkboxes - the user selects one or the other
  * DO NOT create a string field for payment location - these are checkboxes
- GENERAL EXAMPLE - COMPLETE PARAGRAPH EXTRACTION:
  * "4. RENT. The rent is ____________ per month, payable in advance, on or before the [ ] first day [ ] ______ day of each month commencing on the first month of the term. Rent shall be paid [ ] to Lessor's Broker at the address shown below [ ] to Lessor at the address shown below."
  * Extract ALL fields: Rent_Amount (string), Rent_Due_Date (string), Rent_Pay_First_Day (boolean), Rent_Pay_Other_Day (boolean), Rent_Pay_To_Broker (boolean), Rent_Pay_To_Lessor (boolean)
  * DO NOT stop after extracting Rent_Amount and Rent_Due_Date - continue to the end of the paragraph
  * DO NOT skip the payment location checkboxes at the end
- DO NOT make assumptions about field values (e.g., don't assume lease term is "one year" unless explicitly stated)

FIELD POSITIONS (optional in this pass — a later per-page measurement overwrites them):
- Prefer accurate field names/types/descriptions over guessed coordinates
- If you include position: 2x image PIXELS, origin TOP-LEFT (US Letter ≈ 1224×1584)
- Never invent a vertical column (same x, evenly stepped y)
- Never convert or multiply guessed PDF points

OUTPUT FORMAT:
Return JSON Schema with categories as top-level keys. Each field MUST have:
1. type (string, date, number, boolean, array, object, enum)
2. description (natural language string)
3. position (optional object with page, x, y in 2x image pixels from top-left)

Example field structure (2x image PIXELS from top-left — NOT PDF points, NOT a vertical column):
{
  "Category_Name": {
    "Field_Name": {
      "type": "string",
      "description": "Description of the field",
      "position": {
        "page": 0,
        "x": 380,
        "y": 246
      }
    }
  }
}

CRITICAL POSITION RULES:
- Measure each blank independently from the page image. Different blanks have different X and Y.
- NEVER invent a neat column like x=250 for every field with y stepping by 50 — that is wrong and will be rejected.
- Typical 2x US Letter values: x roughly 100–1200, y roughly 80–1500 (pixels from top-left).

DO NOT include a "required" property - field requirements will be determined by the user.

CRITICAL JSON FORMATTING RULES:
- All string values must be properly quoted and escaped
- If a description contains quotes, escape them with backslash: "description": "This is a \"quoted\" word"
- Boolean values must be true/false (not "true"/"false" strings)
- All property names must be in double quotes
- No trailing commas
- All strings must be properly terminated (every opening quote must have a closing quote)

Example structure (adapt field names; positions are illustrative 2x PIXEL coords with real spread):
{
  "Application_Information": {
    "Date_of_Application": {
      "type": "date",
      "description": "Date of application submission",
      "position": {
        "page": 0,
        "x": 920,
        "y": 188
      }
    }
  },
  "Applicants": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "First_Name": {
          "type": "string",
          "description": "First name",
          "position": {
            "page": 0,
            "x": 210,
            "y": 312
          }
        },
        "Middle_Initial": {
          "type": "string",
          "description": "Middle initial",
          "position": {
            "page": 0,
            "x": 540,
            "y": 312
          }
        },
        "Last_Name": {
          "type": "string",
          "description": "Last name",
          "position": {
            "page": 0,
            "x": 780,
            "y": 312
          }
        },
        "Date_of_Birth": {
          "type": "date",
          "description": "Date of birth",
          "position": {
            "page": 0,
            "x": 210,
            "y": 368
          }
        },
        "Driver_License_State_of_Issue": {
          "type": "string",
          "description": "State of issue of the driver's license",
          "position": {
            "page": 0,
            "x": 860,
            "y": 368
          }
        }
      }
    }
  },
  "Property_Details": {
    "Property_Address": {
      "type": "string",
      "description": "Street address",
      "position": {
        "page": 0,
        "x": 340,
        "y": 512
      }
    }
  }
}

IMPORTANT: 
- The example above shows PATTERNS, not required fields. Extract only what's actually on the form.
- Field names should match the form labels.
- If there are multiple applicants (Second Applicant, Co-Applicant, etc.), structure them as an array in "Applicants", not as separate fields with "Second_" prefixes.
- Each applicant in the array should have their own complete set of fields.`;

    console.log(`Using model: ${visionModel}`);
    console.log(`System prompt length: ${systemMessage.length} characters`);

    // Build user message with all images
    const batchContext = req.body.batchInfo 
      ? `This is batch ${req.body.batchInfo.batchNumber} of ${req.body.batchInfo.totalBatches} (pages ${req.body.batchInfo.pageRange}). Extract fields from these pages.`
      : '';
    
    const userContent = [
      {
        type: 'text',
        text: `${batchContext} Extract ALL form input fields from these ${images.length} page(s), including fields at the very bottom of the form (application fees, signatures, etc.). Return a JSON Schema with fields in EXACT document order. Only extract actual input fields, not informational text. CRITICAL: You MUST extract every field from every page. If you cannot complete the extraction, report an error. Do NOT stop partway through - the form is incomplete without signature/agreement sections.

Include field names, types, and descriptions for every input blank. Positions may be approximate; a dedicated measurement pass will remeasure blanks from each page image. Do NOT invent a same-x vertical column of coordinates.`
      },
      ...images.map((img, idx) => ({
        type: 'image_url',
        image_url: {
          url: img
        }
      }))
    ];

    console.log(`User message text: "${userContent[0].text.substring(0, 200)}..."`);
    console.log(`Sending ${images.length} image(s) to ${visionModel} Vision API...`);
    console.log(`Total content items: ${userContent.length} (1 text + ${images.length} images)`);
    const response = await openai.chat.completions.create({
      model: visionModel,
      messages: [
        {
          role: 'system',
          content: systemMessage
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,  // Low temperature for consistent, deterministic extraction
      max_tokens: 4096  // Maximum supported by model
    });

    // Parse JSON with error handling
    let extractedJSON;
    try {
      extractedJSON = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      // Try to fix common JSON issues
      console.warn('JSON parse error, attempting to fix...');
      let content = response.choices[0].message.content;
      
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        content = jsonMatch[1];
      }
      
      // Try to fix common issues
      content = content
        .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Quote unquoted keys
        .replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*([,}])/g, ': "$1"$2') // Quote unquoted string values
        // Fix boolean strings: "required": "true" -> "required": true
        .replace(/:\s*"true"\s*([,}])/g, ': true$1')
        .replace(/:\s*"false"\s*([,}])/g, ': false$1')
        // Fix boolean strings in arrays/objects: "true", "false" -> true, false
        .replace(/,\s*"true"\s*([,}\]])/g, ', true$1')
        .replace(/,\s*"false"\s*([,}\]])/g, ', false$1')
        .replace(/\[\s*"true"\s*([,}\]])/g, '[ true$1')
        .replace(/\[\s*"false"\s*([,}\]])/g, '[ false$1')
        // Note: String termination fixes are handled in the aggressive fix step below
      
      try {
        extractedJSON = JSON.parse(content);
        console.log('Successfully fixed and parsed JSON');
      } catch (retryError) {
        // If still failing, try a more aggressive fix for boolean strings
        console.warn('First fix attempt failed, trying more aggressive boolean fix...');
        try {
          // More aggressive: replace all "true" and "false" strings that appear after colons
          content = content.replace(/:\s*"true"/g, ': true');
          content = content.replace(/:\s*"false"/g, ': false');
          extractedJSON = JSON.parse(content);
          console.log('Successfully fixed JSON with aggressive boolean conversion');
        } catch (aggressiveError) {
          // Try one more time with string escaping fix
          console.warn('Aggressive fix failed, trying string escaping fix...');
          try {
            // Fix unescaped quotes in string values by finding string patterns and escaping internal quotes
            // Match: "key": "value with "quotes" here"
            // Strategy: Find all ": "..." patterns and escape quotes inside the value
            content = content.replace(/:\s*"([^"]*)"([,}\]]|$)/g, (match, value, ending) => {
              // If value contains unescaped quotes, escape them
              if (value.includes('"') && !value.includes('\\"')) {
                const escaped = value.replace(/"/g, '\\"');
                return `: "${escaped}"${ending}`;
              }
              return match;
            });
            
            // Also handle multiline strings and special characters
            content = content
              .replace(/:\s*"([^"]*?)\n([^"]*?)"/g, ': "$1\\n$2"') // Fix newlines in strings
              .replace(/:\s*"([^"]*?)\r([^"]*?)"/g, ': "$1\\r$2"') // Fix carriage returns
              .replace(/:\s*"([^"]*?)\t([^"]*?)"/g, ': "$1\\t$2"'); // Fix tabs
            
            extractedJSON = JSON.parse(content);
            console.log('Successfully fixed JSON with string escaping fix');
          } catch (stringFixError) {
            // If still failing, ask GPT-4 to fix it
            console.warn('Could not fix JSON automatically, asking GPT-4 to fix...');
            const fixResponse = await openai.chat.completions.create({
              model: visionModel,
              messages: [
                {
                  role: 'system',
                  content: 'You are a JSON repair assistant. Fix the invalid JSON and return only valid JSON. Ensure: 1) All boolean values are true/false (not "true"/"false" strings), 2) All property names are quoted, 3) All string values are properly quoted and escaped (escape quotes with \\"), 4) No trailing commas, 5) All strings are properly terminated.'
                },
                {
                  role: 'user',
                  content: `Fix this invalid JSON and return only valid JSON. The error is: ${parseError.message}. Pay special attention to: boolean values (true/false not "true"/"false"), properly escaped quotes in strings, and terminated strings:\n\n${response.choices[0].message.content.substring(0, 10000)}`
                }
              ],
              response_format: { type: 'json_object' },
              temperature: 0.2,  // Low temperature for consistent JSON repair
              max_tokens: 4096  // Maximum supported by model
            });
            
            try {
              extractedJSON = JSON.parse(fixResponse.choices[0].message.content);
              console.log('Successfully fixed JSON with GPT-4');
            } catch (finalError) {
              // Last resort: try to extract just the valid part
              console.error('All repair attempts failed. Error details:', {
                original: parseError.message,
                aggressive: aggressiveError.message,
                stringFix: stringFixError.message,
                final: finalError.message,
                contentLength: content.length,
                preview: content.substring(Math.max(0, 20820 - 100), 20820 + 100)
              });
              throw new Error(`Failed to parse JSON after all repair attempts: ${finalError.message}\nOriginal error: ${parseError.message}\nContent preview around error: ${content.substring(Math.max(0, 20820 - 200), 20820 + 200)}...`);
            }
          }
        }
      }
    }
    
    // Post-process: Fix any remaining boolean strings in the parsed JSON
    function fixBooleanStrings(obj) {
      if (Array.isArray(obj)) {
        return obj.map(item => fixBooleanStrings(item));
      } else if (obj !== null && typeof obj === 'object') {
        const fixed = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value === 'true') {
            fixed[key] = true;
          } else if (value === 'false') {
            fixed[key] = false;
          } else if (typeof value === 'object') {
            fixed[key] = fixBooleanStrings(value);
          } else {
            fixed[key] = value;
          }
        }
        return fixed;
      }
      return obj;
    }
    
    extractedJSON = fixBooleanStrings(extractedJSON);

    console.log('Successfully extracted JSON schema');
    const fieldCount = Object.keys(extractedJSON).reduce((sum, cat) => {
      return sum + (typeof extractedJSON[cat] === 'object' ? Object.keys(extractedJSON[cat] || {}).length : 0);
    }, 0);
    console.log(`Extracted ${fieldCount} fields across ${Object.keys(extractedJSON).length} categories`);
    console.log(`Categories: ${Object.keys(extractedJSON).join(', ')}`);
    
    // Log detailed field information for debugging
    console.log(`\n=== FIELD DETAILS ===`);
    for (const [category, fields] of Object.entries(extractedJSON)) {
      if (typeof fields === 'object' && fields !== null) {
        console.log(`\nCategory: ${category} (${Object.keys(fields).length} fields)`);
        for (const [fieldName, fieldDef] of Object.entries(fields)) {
          if (typeof fieldDef === 'object' && fieldDef !== null) {
            const required = fieldDef.required !== undefined ? fieldDef.required : false;
            const description = fieldDef.description || '(no description)';
            const type = fieldDef.type || 'unknown';
            console.log(`  - ${fieldName}: type=${type}, required=${required}, description="${description}"`);
          }
        }
      }
    }
    console.log(`\n=== END FIELD DETAILS ===`);
    
    // Log specific issues to watch for
    console.log(`\n=== QUALITY CHECKS ===`);
    let issuesFound = [];
    let hasSignatureFields = false;
    let hasFeeFields = false;
    
    // Check for Date_of_Application required status
    for (const [category, fields] of Object.entries(extractedJSON)) {
      if (typeof fields === 'object' && fields !== null) {
        // Check for signature and fee fields
        if (category.toLowerCase().includes('signature') || category.toLowerCase().includes('fee')) {
          if (category.toLowerCase().includes('signature')) hasSignatureFields = true;
          if (category.toLowerCase().includes('fee')) hasFeeFields = true;
        }
        
        for (const [fieldName, fieldDef] of Object.entries(fields)) {
          // Check for signature/fee fields
          if (fieldName.toLowerCase().includes('signature') || fieldName.toLowerCase().includes('fee')) {
            if (fieldName.toLowerCase().includes('signature')) hasSignatureFields = true;
            if (fieldName.toLowerCase().includes('fee')) hasFeeFields = true;
          }
          
          if (fieldName.includes('Date_of_Application') || fieldName.includes('Application_Date')) {
            if (fieldDef.required === false) {
              issuesFound.push(`⚠️  ${category}.${fieldName} is marked as optional but should likely be required`);
            }
          }
          // Check for awkward descriptions
          if (fieldDef.description && fieldDef.description.toLowerCase().includes('filling')) {
            issuesFound.push(`⚠️  ${category}.${fieldName} has awkward description: "${fieldDef.description}"`);
          }
          // Check for date fields that might need MM/YYYY format (pattern-based check)
          if (fieldDef.type === 'date' && (fieldName.includes('Start') || fieldName.includes('End') || fieldName.includes('Residence') || fieldName.includes('Employment'))) {
            // If it's a date field but the form might have used MM/YYYY pattern, flag for review
            issuesFound.push(`ℹ️  ${category}.${fieldName} is type "date" - verify if form uses MM/YYYY format (should be separate Month/Year fields)`);
          }
          // Check for "Check one" fields that should be required
          if ((fieldName.includes('Convicted') || fieldName.includes('Bankruptcy')) && fieldDef.type === 'boolean') {
            if (fieldDef.required === false) {
              issuesFound.push(`⚠️  ${category}.${fieldName} is boolean but marked optional - if form says "(Check one)", should be required`);
            }
          }
          // Check for address fields that might need context
          if (fieldName.includes('Address') && !fieldName.includes('Unit') && !fieldName.includes('City')) {
            // Check if followed by unit/city fields in same category
            const fieldKeys = Object.keys(fields);
            const currentIndex = fieldKeys.indexOf(fieldName);
            const hasUnitAfter = fieldKeys.slice(currentIndex + 1).some(k => k.includes('Unit'));
            const hasCityAfter = fieldKeys.slice(currentIndex + 1).some(k => k.includes('City') || k.includes('Zip'));
            if (hasUnitAfter || hasCityAfter) {
              if (!fieldDef.description || (!fieldDef.description.toLowerCase().includes('street') && !fieldDef.description.toLowerCase().includes('address'))) {
                issuesFound.push(`ℹ️  ${category}.${fieldName} appears to be street address (followed by unit/city) - verify description`);
              }
            }
          }
        }
      }
    }
    
    // Check for multiple applicants incorrectly structured
    const hasSecondApplicantFields = Object.keys(extractedJSON).some(cat => 
      typeof extractedJSON[cat] === 'object' && extractedJSON[cat] !== null &&
      Object.keys(extractedJSON[cat]).some(field => 
        field.includes('Second_') || field.includes('Co_Applicant') || field.includes('Additional_Applicant')
      )
    );
    const hasApplicantsArray = Object.keys(extractedJSON).some(cat => {
      const catData = extractedJSON[cat];
      return catData && typeof catData === 'object' && 
             (catData.type === 'array' || (catData.items && catData.items.type === 'object'));
    });
    
    if (hasSecondApplicantFields && !hasApplicantsArray) {
      issuesFound.push(`⚠️  Found "Second_" or "Co-Applicant" fields but no Applicants array - multiple applicants should be structured as an array, not as additional fields`);
    }
    
    // Check for completeness
    if (!hasSignatureFields) {
      issuesFound.push(`⚠️  No signature fields found - form may be incomplete (check if extraction stopped too early)`);
    }
    if (!hasFeeFields) {
      issuesFound.push(`ℹ️  No application fee fields found - verify if form has fee section`);
    }
    
    if (issuesFound.length > 0) {
      console.log(`Found ${issuesFound.length} potential issue(s):`);
      issuesFound.forEach(issue => console.log(`  ${issue}`));
    } else {
      console.log(`✓ No obvious issues detected`);
    }
    console.log(`=== END QUALITY CHECKS ===\n`);
    
    console.log(`Token usage: ${JSON.stringify(response.usage)}`);
    
    // Check for field positions in extracted JSON
    let fieldPositionCount = 0;
    let totalFieldCount = 0;
    let sampleFieldWithPosition = null;
    
    function checkPositions(obj, path = '') {
      if (obj && typeof obj === 'object') {
        if (Array.isArray(obj)) {
          obj.forEach((item, idx) => checkPositions(item, `${path}[${idx}]`));
        } else {
          // Check if this is a field definition
          if (obj.type && (obj.type === 'string' || obj.type === 'date' || obj.type === 'number' || obj.type === 'boolean')) {
            totalFieldCount++;
            if (obj.position && typeof obj.position === 'object') {
              if (typeof obj.position.page === 'number' && 
                  typeof obj.position.x === 'number' && 
                  typeof obj.position.y === 'number') {
                fieldPositionCount++;
                if (!sampleFieldWithPosition) {
                  sampleFieldWithPosition = {
                    path,
                    type: obj.type,
                    position: obj.position
                  };
                }
              }
            }
          }
          // Continue traversing
          Object.entries(obj).forEach(([key, value]) => {
            checkPositions(value, path ? `${path}.${key}` : key);
          });
        }
      }
    }
    
    checkPositions(extractedJSON);
    
    console.log(`📍 [FIELD POSITIONS] Analysis:`, {
      totalFields: totalFieldCount,
      fieldsWithPositions: fieldPositionCount,
      percentage: totalFieldCount > 0 ? ((fieldPositionCount / totalFieldCount) * 100).toFixed(1) + '%' : 'N/A',
      sampleField: sampleFieldWithPosition
    });
    
    if (fieldPositionCount === 0 && totalFieldCount > 0) {
      console.warn(`⚠️ [FIELD POSITIONS] WARNING: No field positions found in extracted JSON!`, {
        totalFields: totalFieldCount,
        categories: Object.keys(extractedJSON)
      });
    }

    let positionQuality = null;
    try {
      const { analyzeTemplatePositionQuality } = await import(
        '../../src/utils/template-position-quality.js'
      );
      positionQuality = analyzeTemplatePositionQuality(extractedJSON);
      if (positionQuality.synthetic) {
        console.warn(
          `⚠️ [FIELD POSITIONS] Synthetic vertical column detected: ${positionQuality.reason}`,
          positionQuality.sample
        );
      }
    } catch (qualityError) {
      console.warn(
        '[FIELD POSITIONS] Could not analyze position quality:',
        qualityError?.message || qualityError
      );
    }
    
    console.log(`=== END API REQUEST LOG ===\n`);

    return res.status(200).json({
      success: true,
      data: extractedJSON,
      model: visionModel,
      method: 'vision',
      usage: response.usage,
      position_quality: positionQuality,
    });

  } catch (error) {
    console.error('PDF conversion error:', error);
    console.error('Error name:', error.name);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      errorName: error.name,
      stack: process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV ? error.stack : undefined
    });
  }
}
