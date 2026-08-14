import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { images, template } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Images array is required' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
    });

    if (!openai.apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    // Determine which model to use for text processing (not vision)
    const model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
    const textModel = model.includes('o1') ? 'gpt-4-turbo' : model; // Use text model, not vision

    // PASS 1: Run OCR on all images using OpenAI Vision API
    // Vision API handles both printed text AND handwriting much better than Tesseract
    console.log(`Running OCR on ${images.length} image(s) using OpenAI Vision API...`);
    const ocrTexts = [];
    const visionModel = 'gpt-4o'; // Use vision model for OCR
    
    try {
      for (let i = 0; i < images.length; i++) {
        const imageData = images[i];
        // Ensure image data is in the correct format (remove data URL prefix if present)
        const base64Image = imageData.includes(',') ? imageData.split(',')[1] : imageData;
        const mimeType = imageData.includes('data:image/') 
          ? imageData.match(/data:image\/([^;]+)/)?.[1] || 'png'
          : 'png';
        
        console.log(`Processing page ${i + 1}/${images.length}...`);
        
        // Use OpenAI Vision API to extract text from image
        // This handles both printed text and handwriting
        const visionResponse = await openai.chat.completions.create({
          model: visionModel,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Extract ALL text from this form image, including both printed labels and handwritten text. Format the output to clearly distinguish field labels from field values by placing brackets around field values.\n\nFORMATTING RULES:\n- Place square brackets [ ] around each field VALUE\n- If a field is blank or empty, use empty brackets []\n- Keep field LABELS outside brackets\n- Example format: "First Name [Ram] Middle Initial [] Last Name [Srinagar]"\n- This makes it clear what is a label vs a value, and when fields are blank\n\nCHECKBOX FORMATTING (CRITICAL):\n- Checkboxes may appear BEFORE or AFTER the choice text\n- If checkboxes appear BEFORE: "Do you have pets? [] Yes [X] No" means Yes is unchecked, No is checked\n- If checkboxes appear AFTER: "Do you have pets? Yes [X] No []" means Yes is checked, No is unchecked\n- Preserve the EXACT order as it appears in the form - do NOT reorder checkboxes and text\n- Use [X] for checked boxes and [] for unchecked boxes\n- Keep the checkbox and its associated choice text together in the order they appear\n- Example: If form shows "[] Yes [X] No", extract it as "[] Yes [X] No" (NOT "Yes [X] No []")\n\nFor handwritten text, read each character carefully with attention to letter shapes:\n- Letters with DESCENDERS (extend below the baseline): y, g, q, j, p\n- Letters that stay ABOVE the baseline: a, m, n, r, u, v, w, x, z, and all uppercase letters\n\nPay special attention to distinguish:\n- "a" (stays above line) vs "y" (has descender)\n- "m" (stays above line) vs "y" (has descender) - if a letter clearly stays above the baseline, it is NOT "y"\n- "r" vs "n" (both stay above line but have different shapes)\n- "Ram" has letters that stay above the line - do not confuse "m" with "y"\n\nIMPORTANT: Do NOT normalize or "correct" names to English conventions. Foreign names, non-English names, and names from various cultures are COMMON and VALID throughout the US. Extract names exactly as written, even if they seem unusual or non-English. Include all handwritten text exactly as written, even if it is difficult to read. Do not add any commentary, corrections, or formatting beyond the bracket notation.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/${mimeType};base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 4096,
          temperature: 0 // Use 0 temperature for consistent, accurate text extraction
        });
        
        const extractedText = visionResponse.choices[0].message.content.trim();
        ocrTexts.push({
          page: i + 1,
          text: extractedText
        });
        console.log(`OCR completed for page ${i + 1}/${images.length} (${extractedText.length} characters)`);
      }
    } catch (ocrError) {
      console.error('OCR error:', ocrError);
      // If OCR fails, return error - we can't proceed without text extraction
      return res.status(500).json({
        error: 'OCR processing failed',
        details: ocrError.message || 'Failed to process images with OCR'
      });
    }
    
    // Combine all OCR text
    const fullOcrText = ocrTexts.map((page) => `=== PAGE ${page.page} ===\n${page.text}`).join('\n\n');
    console.log(`OCR extracted ${fullOcrText.length} characters of text`);
    // Log full OCR text for debugging
    console.log('OCR text sample:', fullOcrText);

    const systemMessage = `You are a document processing assistant specialized in extracting DATA VALUES from filled rental application and lease forms.

Your task is to:
1. Parse the provided OCR-extracted text from a filled form
2. Extract ALL field values that are filled in
3. Return the extracted data as JSON matching the form structure

IMPORTANT: You are working with OCR-extracted text, not images. The text has already been extracted from the form by OCR. Your job is to parse this text and structure it into JSON. Extract dates, numbers, and names EXACTLY as they appear in the OCR text.

CRITICAL: Extract values EXACTLY as they appear in the OCR text. Do NOT normalize, correct, or modify any values. Do NOT add values that are not present in the OCR text.

RULES:

1. EXTRACT EXACTLY AS WRITTEN IN OCR TEXT - NO ADDITIONS:
   - The OCR text uses BRACKET NOTATION to distinguish field labels from values: "First Name [Ram] Middle Initial [] Last Name [Srinagar]"
   - Values are inside square brackets [ ]. Empty brackets [] mean the field is blank/null.
   - Field labels are outside brackets. Extract ONLY the values inside brackets.
   - For NAMES: Extract exactly as they appear inside the brackets in the OCR text. DO NOT "correct" or "normalize" names to English conventions. Foreign names, non-English names, and names from various cultures are COMMON and VALID throughout the US. Extract names exactly as written, even if they seem unusual or non-English. DO NOT add middle initials, middle names, or any other data that is not explicitly present in brackets for that field.
   - For MIDDLE INITIALS: CRITICAL - If the OCR text shows "Middle Initial []" (empty brackets with nothing inside), this means the field is BLANK. Set it to null. DO NOT look elsewhere in the document. DO NOT copy a middle initial from another person's section (like references, emergency contacts, supervisors, etc.). Only extract a middle initial if it appears inside brackets with actual text like "Middle Initial [J]". 
   - EXAMPLE: "First Name [Ram] Middle Initial [] Last Name [Srinagar]" means:
     * First_Name = "Ram"
     * Middle_Initial = null (empty brackets = blank field)
     * Last_Name = "Srinagar"
   - Many people do not have middle names/initials - empty brackets [] are valid, normal, and common. DO NOT fill them with data from other people or sections.
   - PAY ATTENTION TO HANDWRITING: When reading handwritten names inside brackets, pay careful attention to letter shapes. Letters with descenders (y, g, q, j, p) extend below the baseline, while letters like a, m, n, r stay above it. If a letter clearly stays above the baseline, it is NOT "y". For example, "[Ram]" has letters that stay above the line - do not confuse "m" with "y" to make "Ray" or add letters that aren't there.
   - For NUMBERS: Extract exactly as they appear in the OCR text. DO NOT use placeholders like "555". DO NOT "correct" numbers.
   - For DATES: Extract dates exactly as they appear in the OCR text. Preserve the format (e.g., "2/14/1987", "2 / 14 / 1987", "02/14/1987"). Do NOT normalize, pad, or reorder digits. If the OCR text shows "2/14/1987", extract it as "2/14/1987" (or exactly as written).
   - For SOCIAL SECURITY NUMBERS: Extract exactly as they appear in the OCR text.
   - CRITICAL: If a field is blank or shows "___" in the OCR text, set it to null. DO NOT fill blank fields with data from other sections or persons.
   - For CHECKBOXES: CRITICAL - Checkboxes may appear BEFORE or AFTER the choice text in the OCR output. Preserve the exact order as shown.
     * If OCR shows "[] Yes [X] No" (checkbox before text), this means: Yes is unchecked ([]), No is checked ([X])
     * If OCR shows "Yes [X] No []" (checkbox after text), this means: Yes is checked ([X]), No is unchecked ([])
     * Extract the checked value based on which checkbox has [X], NOT based on the position of the checkbox relative to the text
     * Example: "Do you have pets? [] Yes [X] No" should extract as: pets = "No" (because [X] is next to "No")
     * Example: "Do you have pets? Yes [X] No []" should extract as: pets = "Yes" (because [X] is next to "Yes")
     * DO NOT reorder or assume checkbox position - use the [X] marker to determine which choice is selected

2. FIELD EXTRACTION - MATCH FIELDS TO THEIR CORRECT SECTIONS:
   - CRITICAL: This document contains MULTIPLE PEOPLE, each with their own information sections
   - Each person has similar fields (First_Name, Middle_Initial, Last_Name, Phone_Number, etc.) but these belong to DIFFERENT PEOPLE
   - Realize that multiple people may be mentioned in the document (Applicant, References, Emergency Contacts, Landlords, Supervisors, etc.)
   - Each of these people may have similar fields for names, phone numbers, and more
   - Be EXTREMELY careful not to copy the value from one person to another
   - Some fields may be legitimately empty, especially middle names/middle initials, which many people do not have
   - DO NOT mix up fields from different sections - each section belongs to a different person or entity
   - CRITICAL: Match fields to sections based on PROXIMITY and CONTEXT in the OCR text
   - Look for section headers/labels in the OCR text (e.g., "Applicant Information", "Employment", "References", "Emergency Contact", etc.)
   - Extract fields ONLY from the section they belong to - do NOT extract from reference sections, emergency contact sections, or other unrelated parts
   - Examples: "Applicant_Information" has First_Name, Middle_Initial, Last_Name for the APPLICANT (at the top of the form)
   - "Emergency_Contact" has First_Name, Middle_Initial, Last_Name for the EMERGENCY CONTACT (different person, different section)
   - "References" section contains names of references - DO NOT use these as applicant names or copy their middle initials
   - When extracting a field, make sure it goes into the CORRECT section based on the section header/label AND its position in the form
   - REQUIRED APPLICANT FIELDS (keep in APPLICANT section - usually at the top):
     * First_Name, Middle_Initial (MUST be null if blank or shows "___" in OCR - many people don't have middle names), Last_Name, Date_of_Birth, Social_Security_Number, Email_Address, Phone_Number
   - EMPTY FIELDS: If a field is blank or shows "___" in the OCR text, set it to null. DO NOT copy values from other sections. DO NOT infer or guess values. DO NOT add middle initials from reference sections or other people's information.
   - CRITICAL ANTI-HALLUCINATION RULE: Only extract data that is explicitly present in the OCR text for the specific field and section. If you don't see it written in the Applicant section, do NOT add it, even if you see similar data elsewhere in the document. Remember: empty fields are normal and valid - do not fill them with data from other people.
   - DO NOT extract applicant information from reference sections, emergency contact sections, or landlord sections
   - Extract ALL fields including Email_Address, Phone_Number, and all contact information
   - For EMAIL ADDRESSES: Extract exactly as written - DO NOT "correct" or "normalize"
   - Group related fields logically (e.g., Applicant_Information, Employment_Financial, etc.)
   - For empty fields, use null or omit them
   - Preserve data types (strings, numbers, dates, booleans)
   - Use field names that match common form field names (First_Name, Last_Name, Email_Address, Phone_Number, Date_of_Birth, Social_Security_Number, etc.)
   - Be thorough - extract all filled fields from all sections, but keep them in their correct sections

${template ? `Use this template structure as a guide for organizing the extracted data:\n${JSON.stringify(template, null, 2)}` : ''}

Return JSON in this format (extract values EXACTLY as they appear in the OCR text):
{
  "Applicant_Information": {
    "First_Name": "John",
    "Last_Name": "Doe",
    "Email_Address": "john@example.com",
    "Phone_Number": "206-555-1234",
    "Date_of_Birth": "2/14/1987",
    "Social_Security_Number": "123-45-6789"
  },
  "Employment_Financial": {
    "Current_Employer": "Company Name",
    "Monthly_Income": 5000
  }
}

REMEMBER: Extract EXACTLY as written in the OCR text - do not normalize, correct, or modify values.`;

    // PASS 2: Use LLM to structure the OCR text into JSON
    const userContent = `Extract all filled field values from this OCR-extracted text from a filled rental application form.

CRITICAL INSTRUCTIONS:
1. The OCR text uses BRACKET NOTATION: Values are inside square brackets [ ]. Empty brackets [] mean the field is BLANK/NULL.
2. Extract values EXACTLY as they appear inside brackets in the OCR text. Do not normalize, correct, or modify any values.
3. DO NOT add any values that are not present inside brackets. If you see "Middle Initial []" (empty brackets), set it to null - the field is blank.
4. EXAMPLE: "First Name [Ram] Middle Initial [] Last Name [Srinagar]" means:
   - First_Name = "Ram" (from inside brackets)
   - Middle_Initial = null (empty brackets = blank field - DO NOT fill this)
   - Last_Name = "Srinagar" (from inside brackets)
5. CHECKBOXES - CRITICAL: Checkboxes may appear BEFORE or AFTER the choice text. Use the [X] marker to determine which choice is selected, NOT the position.
   - If OCR shows "Do you have pets? [] Yes [X] No" (checkbox before text): Yes is unchecked ([]), No is checked ([X]) → extract pets = "No"
   - If OCR shows "Do you have pets? Yes [X] No []" (checkbox after text): Yes is checked ([X]), No is unchecked ([]) → extract pets = "Yes"
   - The [X] marker indicates which choice is selected - find the [X] and extract the choice text immediately next to it (before or after)
   - DO NOT reorder checkboxes - preserve the exact order as shown in OCR text
   - DO NOT assume checkboxes always come after text - they may come before
6. REALIZE THAT MULTIPLE PEOPLE ARE MENTIONED IN THIS DOCUMENT: Each person (Applicant, References, Emergency Contacts, Landlords, Supervisors, etc.) has their own information with similar fields (names, phone numbers, etc.). Be EXTREMELY careful not to copy values from one person to another.
7. Some fields may be legitimately empty, especially middle names/middle initials, which many people do not have. If you see "Middle Initial []" (empty brackets), set it to null - do NOT fill it with data from another person or section.
8. DO NOT copy middle initials, names, or any data from reference sections, emergency contact sections, supervisor sections, or other people's information into the Applicant section.
9. Match fields to their CORRECT sections based on section headers and proximity in the text.
10. DO NOT extract applicant information from reference sections, emergency contact sections, or other unrelated parts.
11. Look for section headers like "Applicant Information", "Employment", "References", "Emergency Contact", etc.
12. Extract fields only from the section they belong to based on context and position.
13. If Middle_Initial shows "[]" (empty brackets) in the Applicant section, set it to null - do NOT look for it elsewhere in the document. Remember: empty brackets [] mean the field is blank - this is normal and valid.

OCR EXTRACTED TEXT:
${fullOcrText}

Extract ALL fields including Email_Address, Phone_Number, and all contact information. Return the extracted data as JSON with actual values. Be thorough and extract every field that has been filled in, but ensure each field is placed in its correct section.`;

    console.log(`Structuring OCR text using ${textModel}...`);

    const response = await openai.chat.completions.create({
      model: textModel,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      temperature: 0.1
    });

    let extractedData;
    try {
      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content);
      // Handle both wrapped and unwrapped formats
      extractedData = parsed.extracted_data || parsed;

      // Post-process to ensure middle initials do not get invented
      if (extractedData?.Applicant_Information) {
        const mi = extractedData.Applicant_Information.Middle_Initial;
        if (!mi || mi === '[]' || mi === 'null' || mi === '___' || mi === 'N/A' || mi === '-') {
          extractedData.Applicant_Information.Middle_Initial = null;
        }
      }
    } catch (parseError) {
      console.error('Error parsing extracted data:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse extracted data',
        details: parseError.message 
      });
    }

    console.log(`Successfully extracted data with ${Object.keys(extractedData).length} categories`);

    return res.status(200).json({
      success: true,
      data: extractedData
    });

  } catch (error) {
    console.error('Error extracting form values:', error);
    return res.status(500).json({
      error: error.message || 'Failed to extract form values',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
