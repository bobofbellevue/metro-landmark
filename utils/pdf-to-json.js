import OpenAI from 'openai';
// Use legacy build for Node.js compatibility (for vision approach)
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, Image } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Register canvas Image for pdfjs-dist (if using vision approach)
if (typeof global !== 'undefined') {
  global.Image = Image;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure pdfjs worker for Node.js (legacy build)
// In Node.js, we don't need to set workerSrc - it will run in the main thread
// The worker is primarily for browser environments to avoid blocking the UI
// For Node.js, we can just not set it or use an empty string
if (typeof pdfjsLib.GlobalWorkerOptions !== 'undefined') {
  // Don't set workerSrc - let it run in main thread for Node.js
  // Setting to empty string or null might work, but not setting it is safest
}

/**
 * Convert PDF to images (base64 encoded)
 * @param {Buffer|Uint8Array} pdfBuffer - PDF file buffer
 * @returns {Promise<string[]>} Array of base64 encoded images
 */
async function pdfToImages(pdfBuffer) {
  // Convert Buffer to Uint8Array if needed (pdfjs-dist requires Uint8Array)
  const pdfData = Buffer.isBuffer(pdfBuffer) 
    ? new Uint8Array(pdfBuffer) 
    : pdfBuffer;
  
  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const images = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality

    // Create canvas using node-canvas
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    // Render PDF page to canvas
    // pdfjs-dist needs the canvas context directly
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };

    await page.render(renderContext).promise;

    // Convert canvas to base64 image
    const imageData = canvas.toDataURL('image/png');
    images.push(imageData);
  }

  return images;
}

/**
 * Convert PDF rental application to JSON Schema using GPT-4 (text-based extraction)
 * This extracts the FORM STRUCTURE (schema definition) not the data values
 * @param {Buffer|string} pdfInput - PDF file buffer or file path
 * @param {string} schemaPath - Optional path to JSON schema file (if provided, will try to match structure)
 * @param {boolean} extractAllFields - If true, extract ALL fields from PDF regardless of schema (default: true)
 * @param {boolean} outputSchema - If true, output schema definitions instead of data values (default: true)
 * @returns {Promise<Object>} Extracted JSON schema structure
 * 
 * Note: This function uses OpenAI Vision API exclusively. pdf-parse fallback has been removed.
 */
export async function convertPDFToJSON(pdfInput, schemaPath = null, extractAllFields = true, outputSchema = true) {
  try {
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
    });

    if (!openai.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    // Load PDF
    let pdfBuffer;
    if (Buffer.isBuffer(pdfInput)) {
      pdfBuffer = pdfInput;
    } else if (typeof pdfInput === 'string') {
      pdfBuffer = fs.readFileSync(pdfInput);
    } else {
      throw new Error('pdfInput must be a Buffer or file path string');
    }

    // Load JSON schema (optional - used as a structural template for organizing fields)
    let schema = null;
    let schemaStructure = null;
    if (schemaPath) {
      const schemaContent = fs.readFileSync(schemaPath, 'utf8');
      schema = JSON.parse(schemaContent);
      
      // Extract just the category structure (top-level keys) for organizing
      schemaStructure = Object.keys(schema).reduce((acc, key) => {
        acc[key] = {
          description: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          // Extract field names from this category for reference
          knownFields: extractFieldNames(schema[key])
        };
        return acc;
      }, {});
    }

    // Try gpt-4o first (better vision capabilities), fallback to gpt-4-turbo
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const visionModel = model.includes('o1') ? 'gpt-4o' : (model.includes('gpt-4') ? model : 'gpt-4o'); // o1 doesn't support vision, use gpt-4o for vision tasks

    // Use OpenAI Vision API (only method)
    console.log('Converting PDF to images...');
    const images = await pdfToImages(pdfBuffer);
    console.log(`Converted ${images.length} page(s) to images`);
    return await convertWithVision(openai, images, schema, schemaStructure, visionModel, extractAllFields, outputSchema);
  } catch (error) {
    console.error('Error converting PDF to JSON:', error);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

/**
 * Extract field names from a schema object recursively
 */
function extractFieldNames(obj, prefix = '') {
  const fields = [];
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      // If it has a 'type' property, it's a field definition
      if (value && typeof value === 'object' && 'type' in value) {
        fields.push(prefix ? `${prefix}.${key}` : key);
      } else if (typeof value === 'object') {
        // Recursively extract from nested objects
        fields.push(...extractFieldNames(value, prefix ? `${prefix}.${key}` : key));
      }
    }
  }
  return fields;
}

/**
 * Convert using GPT-4 Vision API
 */
async function convertWithVision(openai, images, schema, schemaStructure, model, extractAllFields = true, outputSchema = true) {
    let systemMessage;
    
    if (extractAllFields) {
      // Extract ALL fields from the PDF, structure intelligently using schema categories
      let structureGuidance = '';
      if (schemaStructure) {
        structureGuidance = `\n\nUse these category names to organize the extracted fields (but extract ALL fields, even if they don't fit these categories):
${Object.entries(schemaStructure).map(([cat, info]) => `- "${cat}": ${info.description}`).join('\n')}

If you find fields that don't fit into these categories, create new appropriate categories or add them to the most relevant existing category.`;
      }
      
      if (outputSchema) {
        // Output schema definitions, not data values
        systemMessage = `You are a document processing assistant specialized in extracting rental application FORM STRUCTURE from PDF forms.

CRITICAL - COMPLETENESS REQUIREMENT:
- You MUST extract ALL fields from the ENTIRE form, from top to bottom, including every page
- Extract fields at the very bottom: application fees, signatures, dates, agreements, etc.
- If you cannot complete the extraction, you MUST report an error in your response
- Do NOT stop partway through - continue until you have extracted every input field on every page
- The form is incomplete if you stop before reaching signature/agreement sections at the bottom

Your task is to:
1. Analyze the provided PDF form images
2. Identify ONLY fields that are actual form inputs (blanks, checkboxes, dropdowns) that need to be filled in
3. Create a JSON Schema structure that describes the form fields

CRITICAL - Field Extraction Rules:
- ONLY extract fields that are actual form inputs: blank lines (___), text input boxes, checkboxes, dropdown menus, or other interactive elements that require user input
- DO NOT extract fields from informational text, statements, or paragraphs that are just providing information
- DO NOT create fields for entities mentioned in informational text (e.g., if a paragraph says "financed by the Michigan State Housing Development Authority", do NOT create an "Authority" field - this is just informational text, not a blank to fill in)
- Look for visual indicators of form fields: blank lines, input boxes, checkboxes, radio buttons, dropdown arrows, or labels followed by spaces/underscores where data would be entered
- If text is just describing something (like "The property is subject to..."), it is NOT a field - ignore it
- Only extract fields where the document clearly expects the user to fill something in
- CRITICAL: Do NOT create fields for quoted text labels (e.g., "Lessor's Broker", "Tenant", "Property") that appear in the sentence but are NOT followed by a blank. Only create a field if there is an actual blank/underscore AFTER the label
- CRITICAL: One blank = one field. If you see a single blank line/underscore, create only ONE field for it, even if multiple labels appear in the sentence
- CRITICAL: Pay attention to punctuation (commas, periods) and context words (e.g., "in", "at", "for") to identify separate fields. Example: "in _______________ , ____________________ County" = TWO fields (city and county), not one
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
          "First_Name": { "type": "string", "description": "First name" },
          "Middle_Initial": { "type": "string", "description": "Middle initial" },
          "Last_Name": { "type": "string", "description": "Last name" }
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
- Extract every checkbox and every blank underline field - do not skip any
- Field names should be descriptive, based on the actual form text and context

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

${schemaStructure ? '- Organize fields into the provided categories when possible, but do not omit fields that do not fit' : '- Group related fields logically (e.g., personal information, employment, references, etc.)'}
${structureGuidance}

${schema ? `\nReference schema structure (use categories as guide, but extract all fields):\n${JSON.stringify(Object.keys(schema), null, 2)}` : ''}

FIELD POSITION EXTRACTION - CRITICAL (READ CAREFULLY):
- For EACH field, you MUST identify the position where data should be filled in
- CRITICAL: You are viewing IMAGES of the PDF, and you MUST output PIXEL COORDINATES from the image
- CRITICAL: Images are rendered at 2x scale (for better OCR), so coordinates are in image pixels
- CRITICAL: Use the EXACT pixel coordinates from the image - do NOT convert to PDF points

Image Pixel Coordinate System (what you MUST output):
- Units: Pixels (image pixels, not PDF points)
- Origin: Top-left corner of the image (0, 0)
- X-axis: Increases to the right (0 = left edge)
- Y-axis: Increases DOWNWARD (0 = top edge, larger Y = lower on page)
- For US Letter at 2x scale: approximately 1224 pixels wide × 1584 pixels tall (612 × 2 × 792 × 2)

Position Guidelines:
- CRITICAL: Position should be where the BASELINE of the text should be drawn, NOT the top of the blank line
- For a blank line (underscore), the baseline is typically where the underscore line is drawn
- Position should be where text will sit on the blank line, which is the baseline position
- CRITICAL: When you see a blank line (underscore), measure the Y coordinate at the CENTER of the underscore line, not at the top
- The underscore line itself represents where the baseline should be - text will sit ON this line
- For checkboxes, position should be the center of the checkbox
- Measure coordinates directly from the image - count pixels from the top-left corner
- X coordinate: Count pixels from the left edge of the image to where the blank/field starts
- Y coordinate: Count pixels from the top edge of the image to where the baseline of the blank/field is

For each field, identify:
  1. The page number (0-indexed, first page is 0)
  2. The X coordinate in pixels (horizontal position from left edge, where blank/underscore starts)
  3. The Y coordinate in pixels (vertical position from top edge, where baseline should be)

Store position as: "position": { "page": 0, "x": 300, "y": 1500 }

Examples (pixel coordinates from 2x scale images):
- Field at top-left: { "page": 0, "x": 100, "y": 100 } (approximately 100px from left, 100px from top)
- Field at top-center: { "page": 0, "x": 612, "y": 100 } (approximately center horizontally, 100px from top)
- Field at middle-left: { "page": 0, "x": 100, "y": 792 } (approximately 100px from left, middle vertically)
- Field at bottom-left: { "page": 0, "x": 100, "y": 1484 } (approximately 100px from left, near bottom)
- Field at bottom-right: { "page": 0, "x": 1124, "y": 1484 } (approximately near right edge, near bottom)

OUTPUT:
Return valid JSON Schema. Each field: type, description (string), and position (page, x, y coordinates). DO NOT include a "required" property - field requirements will be determined by the user.
- Escape quotes in descriptions: "description": "This is a \\"quoted\\" word"
- Booleans: true/false (not "true"/"false")
- No trailing commas
- Complete all fields to the end of the form

Positions must be measured 2x image PIXELS from the top-left of each page image.
NEVER invent a single vertical column (same x, y stepping by 50) — measure each blank.
Example structure (adapt field names; illustrative 2x pixel coords with real spread):
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
  "Property_Details": {
    "Property_Address": {
      "type": "string",
      "description": "Street address (house number, street name, directional)",
      "position": {
        "page": 0,
        "x": 340,
        "y": 256
      }
    },
    "Property_Unit_Number": {
      "type": "string",
      "description": "Unit number or apartment number",
      "position": {
        "page": 0,
        "x": 980,
        "y": 256
      }
    },
    "Property_City_State_Zip": {
      "type": "string",
      "description": "City, state, and zip code",
      "position": {
        "page": 0,
        "x": 340,
        "y": 312
      }
    }
  },
  "Current_Address": {
    "Current_Address_Street": {
      "type": "string",
      "description": "Current street address",
      "position": {
        "page": 0,
        "x": 210,
        "y": 480
      }
    },
    "Current_Address_Unit_Number": {
      "type": "string",
      "description": "Current unit number or apartment number",
      "position": {
        "page": 0,
        "x": 860,
        "y": 480
      }
    },
    "Current_Address_City_State_Zip": {
      "type": "string",
      "description": "Current city, state, and zip code",
      "position": {
        "page": 0,
        "x": 210,
        "y": 536
      }
    }
  },
  "Previous_Address": {
    "Previous_Address_Street": {
      "type": "string",
      "description": "Previous street address",
      "position": {
        "page": 0,
        "x": 210,
        "y": 720
      }
    },
    "Previous_Address_Unit_Number": {
      "type": "string",
      "description": "Previous unit number or apartment number",
      "position": {
        "page": 0,
        "x": 860,
        "y": 720
      }
    },
    "Previous_Address_City_State_Zip": {
      "type": "string",
      "description": "Previous city, state, and zip code",
      "position": {
        "page": 0,
        "x": 210,
        "y": 776
      }
    }
  }
}`;
      } else {
        // Original: output data values
        systemMessage = `You are a document processing assistant specialized in extracting rental application data from PDF forms.

Your task is to:
1. Analyze the provided PDF form images
2. Extract ALL fields and data from the rental application form
3. Structure the data into a well-organized JSON object using the provided category structure

Important instructions:
- Extract EVERY field you find in the form, regardless of whether it matches any expected schema
${schemaStructure ? '- Organize fields into the provided categories when possible, but do not omit fields that do not fit' : '- Group related fields logically (e.g., personal information, employment, references, etc.)'}
- Use descriptive, clear field names based on what you see in the form
- For fields with multiple values or lists, use arrays
- For addresses, structure them as objects with components (street, city, state, zip, etc.)
- For dates, preserve the format found in the form or use ISO format (YYYY-MM-DD)
- For currency/amount fields, extract numeric values (remove dollar signs, commas)
- Include any checkboxes, dropdown selections, or other form field values
- If a field has options (like Property Type: Apartment, Condo, Home, Other), include both the field name and the selected value
- Preserve the original field labels/names from the form when possible
${structureGuidance}

${schema ? `\nReference schema structure (use categories as guide, but extract all fields):\n${JSON.stringify(Object.keys(schema), null, 2)}` : ''}

Return a comprehensive JSON object containing ALL extracted data, organized into the category structure.`;
      }
    } else {
      // Original schema-matching approach
      systemMessage = `You are a document processing assistant specialized in extracting rental application data from PDF forms.

Your task is to:
1. Analyze the provided PDF form images
2. Extract all rental application data from the form
3. Return the data as JSON matching this exact schema structure: ${JSON.stringify(schema, null, 2)}

Important instructions:
- Map form fields intelligently to the schema fields
- If a field is not present in the form, omit it from the JSON (don't include null/empty values)
- Preserve the exact structure and nesting of the schema
- For arrays (like previous_employment, Previous_Addresses, etc.), create array items only if data exists
- For dates, use the format specified in the schema (e.g., "MM/YYYY" for months, "YYYY-MM-DD" for dates)
- For currency fields, extract numeric values only (no dollar signs or commas)
- Be careful with field names - match them exactly to the schema
- If you see "Name" field, try to split into first/last if the schema requires it
- For addresses, structure them according to the schema's address object format

Return ONLY valid JSON matching the schema structure.`;
    }

    const userMessages = images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: image // base64 data URL
      }
    }));

    userMessages.push({
      type: 'text',
      text: `Extract all rental application form structure from these ${images.length} page(s) of the form. Return a JSON Schema that describes all fields found in the form. CRITICAL: You MUST extract every field from every page, including signatures and fees at the bottom. If you cannot complete the extraction, report an error. Only extract fields that are actual form inputs (blanks, checkboxes, dropdowns) that need to be filled in. Do NOT extract fields from informational text or statements.`
    });

  // Call GPT-4 Vision API
  console.log(`Calling ${model} Vision API with ${images.length} page(s)...`);
  const response = await openai.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'system',
        content: systemMessage
      },
      {
        role: 'user',
        content: userMessages
      }
    ],
    response_format: { type: 'json_object' },
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
      .replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*([,}])/g, ': "$1"$2'); // Quote unquoted string values
    
    try {
      extractedJSON = JSON.parse(content);
      console.log('Successfully fixed and parsed JSON');
    } catch (retryError) {
      // If still failing, ask GPT-4 to fix it
      console.warn('Could not fix JSON automatically, asking GPT-4 to fix...');
      const fixResponse = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a JSON repair assistant. Fix the invalid JSON and return only valid JSON.'
          },
          {
            role: 'user',
            content: `Fix this invalid JSON and return only valid JSON:\n\n${response.choices[0].message.content}`
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4096  // Maximum supported by model
      });
      
      try {
        extractedJSON = JSON.parse(fixResponse.choices[0].message.content);
        console.log('Successfully fixed JSON with GPT-4');
      } catch (finalError) {
        throw new Error(`Failed to parse JSON after repair attempts: ${finalError.message}\nOriginal error: ${parseError.message}\nContent preview: ${content.substring(0, 200)}...`);
      }
    }
  }
  
  console.log('Successfully extracted JSON from PDF using Vision API');
  
  // Log position extraction statistics
  let fieldsWithPositions = 0;
  let fieldsWithoutPositions = 0;
  
  for (const [category, fields] of Object.entries(extractedJSON)) {
    if (typeof fields === 'object' && fields !== null && !Array.isArray(fields)) {
      for (const [fieldName, fieldDef] of Object.entries(fields)) {
        if (typeof fieldDef === 'object' && fieldDef !== null && fieldDef.type) {
          if (fieldDef.position && typeof fieldDef.position === 'object') {
            if (typeof fieldDef.position.page === 'number' && 
                typeof fieldDef.position.x === 'number' && 
                typeof fieldDef.position.y === 'number') {
              fieldsWithPositions++;
              console.log(`[Position] ${category}.${fieldName}: page=${fieldDef.position.page}, x=${fieldDef.position.x}, y=${fieldDef.position.y}`);
            } else {
              fieldsWithoutPositions++;
              console.warn(`[Invalid Position] ${category}.${fieldName}:`, fieldDef.position);
            }
          } else {
            fieldsWithoutPositions++;
            console.warn(`[Missing Position] ${category}.${fieldName} - no position data found`);
          }
        }
      }
    }
  }
  
  console.log(`[Position Summary] Fields with positions: ${fieldsWithPositions}, Fields without positions: ${fieldsWithoutPositions}`);

  return {
    success: true,
    data: extractedJSON,
    model: model,
    method: 'vision',
    pages: images.length,
    usage: response.usage
  };
}


/**
 * Convert PDF file path to JSON
 * @param {string} pdfPath - Path to PDF file
 * @param {string} schemaPath - Optional path to schema file
 * @returns {Promise<Object>} Extracted JSON data
 */
export async function convertPDFFileToJSON(pdfPath, schemaPath = null) {
  return convertPDFToJSON(pdfPath, schemaPath);
}

/**
 * Convert PDF buffer to JSON
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} schemaPath - Optional path to schema file
 * @returns {Promise<Object>} Extracted JSON data
 */
export async function convertPDFBufferToJSON(pdfBuffer, schemaPath = null) {
  return convertPDFToJSON(pdfBuffer, schemaPath);
}

