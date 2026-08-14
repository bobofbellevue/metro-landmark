import { stemmer } from 'stemmer';
import synonyms from 'synonyms';

// Helper to check if an object contains field definitions (not just data)
function isFieldDefinitionObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  // Check if any key has a structure that looks like a field definition
  // (has 'type', 'properties', 'items', 'description', etc.)
  return Object.values(obj).some(val => 
    val && typeof val === 'object' && ('type' in val || 'properties' in val || 'items' in val || 'description' in val)
  );
}

/**
 * Maps imported application data to match the structure of a template.
 * Uses semantic matching to work with any template structure.
 */
export function mapImportedDataToTemplate(importedData, templateData) {
  if (!importedData) return {};
  if (!templateData || Object.keys(templateData).length === 0) return importedData;

  const mappedData = {};
  const templateCategories = Object.keys(templateData);

  const normalize = (str) =>
    str
      .toLowerCase()
      .replace(/^\d+[_\-.]?/, '')
      .replace(/[_\-.\s]/g, '')
      .trim();

  const similarity = (str1, str2) => {
    const norm1 = normalize(str1);
    const norm2 = normalize(str2);
    if (norm1 === norm2) return 1.0;
    if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.8;
    
    // Extract keywords from normalized strings (they're already lowercase, no separators)
    // Try to split by common word boundaries or use the whole string as a keyword
    // For strings like "employmentfinancial", try to detect word boundaries
    const extractKeywords = (str) => {
      // Common words that might appear in category/field names
      const commonWords = ['employment', 'financial', 'income', 'residence', 'residential', 'history', 
                          'information', 'applicant', 'property', 'vehicle', 'emergency', 'contact',
                          'personal', 'reference', 'signature', 'application', 'fee', 'name', 'phone',
                          'number', 'address', 'city', 'state', 'zip', 'relationship', 'email'];
      const keywords = [];
      let remaining = str.toLowerCase();
      
      // Try to find common words first
      for (const word of commonWords) {
        if (remaining.includes(word)) {
          keywords.push(word);
          remaining = remaining.replace(word, '');
        }
      }
      
      // Split remaining by common separators and add significant parts
      const remainingParts = remaining.split(/[_\-\s]+/).filter(p => p.length > 2);
      keywords.push(...remainingParts);
      
      return keywords.length > 0 ? keywords : [str.toLowerCase()]; // Fallback to whole string
    };
    
    const keywords1 = extractKeywords(norm1);
    const keywords2 = extractKeywords(norm2);
    
    // Extract root words (stems) for each keyword
    const stems1 = keywords1.map(k => stemmer(k));
    const stems2 = keywords2.map(k => stemmer(k));
    
    // Check for exact keyword matches
    const commonKeywords = keywords1.filter((k) => keywords2.includes(k));
    
    // Check for root word matches (e.g., "employer", "employment", "employee" all stem to "employ")
    const commonStems = stems1.filter((s) => stems2.includes(s));
    
    // Check for synonym matches (e.g., "other" and "additional")
    const getSynonyms = (word) => {
      try {
        const syns = synonyms(word);
        if (syns && typeof syns === 'object') {
          // Combine all synonyms from all parts of speech
          const allSyns = [];
          if (syns.n) allSyns.push(...syns.n);
          if (syns.v) allSyns.push(...syns.v);
          if (syns.a) allSyns.push(...syns.a);
          if (syns.r) allSyns.push(...syns.r);
          return allSyns.map(s => s.toLowerCase());
        }
      } catch {
        // Library might not have the word, return empty array
      }
      return [];
    };
    
    // Check if any keywords are synonyms
    const synonymMatches = [];
    for (const k1 of keywords1) {
      const syns1 = getSynonyms(k1);
      for (const k2 of keywords2) {
        // Check if k2 is a synonym of k1 or vice versa
        if (syns1.includes(k2.toLowerCase()) || getSynonyms(k2).includes(k1.toLowerCase())) {
          synonymMatches.push({ k1, k2 });
        }
      }
    }
    
    // Prevent false matches: Social_Security_Number should not match Driver_License_Number
    // Both have "Number" but they're different types of numbers
    if ((str1.toLowerCase().includes('social') && str2.toLowerCase().includes('driver')) ||
        (str1.toLowerCase().includes('driver') && str2.toLowerCase().includes('social'))) {
      return 0.0;
    }
    
    // Prevent false matches: Social_Security_Number should not match other "Number" fields
    if (str1.toLowerCase().includes('social') && str2.toLowerCase().includes('number') && 
        !str2.toLowerCase().includes('social')) {
      return 0.0;
    }
    if (str2.toLowerCase().includes('social') && str1.toLowerCase().includes('number') && 
        !str1.toLowerCase().includes('social')) {
      return 0.0;
    }
    
    if (commonKeywords.length > 0) {
      // More generous scoring: base 0.4 + proportional match up to 0.8
      const baseScore = 0.4;
      const matchRatio = commonKeywords.length / Math.max(keywords1.length, keywords2.length);
      let score = baseScore + (matchRatio * 0.4); // Range: 0.4 to 0.8
      
      // Boost score if we also have stem matches beyond exact keyword matches
      if (commonStems.length > commonKeywords.length) {
        const stemBonus = (commonStems.length - commonKeywords.length) / Math.max(keywords1.length, keywords2.length) * 0.2;
        score = Math.min(0.95, score + stemBonus); // Cap at 0.95
      }
      
      // Boost score for synonym matches (e.g., "other" and "additional")
      if (synonymMatches.length > 0) {
        const synonymBonus = synonymMatches.length / Math.max(keywords1.length, keywords2.length) * 0.15;
        score = Math.min(0.95, score + synonymBonus);
      }
      
      return score;
    }
    
    // If no exact keyword matches but we have stem matches, give a moderate score
    if (commonStems.length > 0) {
      const baseScore = 0.35;
      const matchRatio = commonStems.length / Math.max(keywords1.length, keywords2.length);
      let score = baseScore + (matchRatio * 0.3); // Range: 0.35 to 0.65
      
      // Boost for synonym matches even with only stem matches
      if (synonymMatches.length > 0) {
        const synonymBonus = synonymMatches.length / Math.max(keywords1.length, keywords2.length) * 0.2;
        score = Math.min(0.85, score + synonymBonus);
      }
      
      return score;
    }
    
    // If we have synonym matches but no keyword or stem matches, give a moderate score
    if (synonymMatches.length > 0) {
      const baseScore = 0.4;
      const matchRatio = synonymMatches.length / Math.max(keywords1.length, keywords2.length);
      const score = baseScore + (matchRatio * 0.3); // Range: 0.4 to 0.7
      return score;
    }
    
    // Check for partial word matches (e.g., "financial" vs "finance", "income" related concepts)
    const hasPartialMatch = keywords1.some(k1 => 
      keywords2.some(k2 => k1.includes(k2) || k2.includes(k1) || 
        (k1.length > 4 && k2.length > 4 && 
         (k1.substring(0, 4) === k2.substring(0, 4) || 
          k1.substring(k1.length - 4) === k2.substring(k2.length - 4))))
    );
    if (hasPartialMatch) return 0.35;
    
    return 0.0;
  };

  const findBestMatch = (importedCategory) => {
    let bestMatch = null;
    let bestScore = 0;
    
    // Special handling: "Employment_Financial" should match "03_Employment_and_Income", not "05_Financial_Information"
    if (importedCategory === 'Employment_Financial' || importedCategory.toLowerCase().includes('employment')) {
      const employmentCategory = templateCategories.find(c => 
        c.toLowerCase().includes('employment') || c.toLowerCase().includes('income')
      );
      if (employmentCategory) {
        return employmentCategory;
      }
    }
    
    for (const templateCategory of templateCategories) {
      const score = similarity(importedCategory, templateCategory);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = templateCategory;
      }
    }
    // Lower threshold to 0.3 to allow more flexible matching
    // This helps match "Employment_Financial" -> "03_Employment_and_Income"
    if (bestScore > 0.3) {
      return bestMatch;
    } else {
      return null;
    }
  };

  // Define mapNestedObject at function scope so it can be used for both objects and arrays
  const mapNestedObject = (importedObj, templateObj, depth = 0) => {
    if (!importedObj || typeof importedObj !== 'object' || Array.isArray(importedObj)) {
      return importedObj;
    }

    const mapped = {};
    const templateObjFields = templateObj && typeof templateObj === 'object' && !Array.isArray(templateObj)
      ? Object.keys(templateObj)
      : [];
    
    // Process Address fields first, then City_State_Zip can add to them
    // Special handling: If "Address" is a string, convert it to an address object first
    if ('Address' in importedObj && typeof importedObj.Address === 'string' && 
        templateObjFields.some(f => f.toLowerCase().includes('address'))) {
      const addressField = templateObjFields.find(f => 
        f.toLowerCase().includes('address') && !f.toLowerCase().includes('line')
      );
      if (addressField) {
        const addressTemplate = templateObj[addressField];
        if (addressTemplate && typeof addressTemplate === 'object' && 
            (addressTemplate.type === 'object' || addressTemplate.properties)) {
          if (!mapped[addressField]) mapped[addressField] = {};
          const addressLine1Field = addressTemplate.properties ? 
            Object.keys(addressTemplate.properties).find(f => f.toLowerCase().includes('line') && f.toLowerCase().includes('1')) :
            'Address_Line_1';
          mapped[addressField][addressLine1Field || 'Address_Line_1'] = importedObj.Address;
          console.log(`  Converted Address string to address object: "${importedObj.Address}"`);
        }
      }
    }
    
    // Special handling: Split City_State_Zip into separate fields
    // This needs to handle both direct fields and nested address objects
    if ('City_State_Zip' in importedObj || 'City_State_Zip_Code' in importedObj) {
      const cityStateZip = importedObj.City_State_Zip || importedObj.City_State_Zip_Code || '';
      if (typeof cityStateZip === 'string' && cityStateZip.trim()) {
        // Try to parse "City, State Zip" or "City, State ZipCode"
        const match = cityStateZip.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (match) {
          const [, city, state, zip] = match;
          
          // Check if we're in an address context (Employer_Address, Current_Address, etc.)
          const isAddressContext = templateObjFields.some(f => 
            f.toLowerCase().includes('address') && 
            (templateObj[f]?.type === 'object' || templateObj[f]?.properties)
          );
          
          if (isAddressContext) {
            // Find the address field in template
            const addressField = templateObjFields.find(f => 
              f.toLowerCase().includes('address') && 
              (templateObj[f]?.type === 'object' || templateObj[f]?.properties)
            );
            
            if (addressField) {
              const addressTemplate = templateObj[addressField];
              const addressFields = addressTemplate?.properties ? 
                Object.keys(addressTemplate.properties) : 
                (addressTemplate && typeof addressTemplate === 'object' ? Object.keys(addressTemplate) : []);
              
              const cityField = addressFields.find(f => 
                f.toLowerCase().includes('city') && !f.toLowerCase().includes('state') && !f.toLowerCase().includes('zip')
              );
              const stateField = addressFields.find(f => 
                f.toLowerCase().includes('state') || f.toLowerCase().includes('province')
              );
              const zipField = addressFields.find(f => 
                f.toLowerCase().includes('zip') || f.toLowerCase().includes('postal')
              );
              
              if (!mapped[addressField]) mapped[addressField] = {};
              if (cityField) mapped[addressField][cityField] = city.trim();
              if (stateField) mapped[addressField][stateField] = state.trim();
              if (zipField) mapped[addressField][zipField] = zip.trim();
            }
          } else {
            // Direct fields (not in address object)
            const cityField = templateObjFields.find(f => 
              f.toLowerCase().includes('city') && !f.toLowerCase().includes('state') && !f.toLowerCase().includes('zip')
            );
            const stateField = templateObjFields.find(f => 
              f.toLowerCase().includes('state') || f.toLowerCase().includes('province')
            );
            const zipField = templateObjFields.find(f => 
              f.toLowerCase().includes('zip') || f.toLowerCase().includes('postal')
            );
            
            if (cityField) mapped[cityField] = city.trim();
            if (stateField) mapped[stateField] = state.trim();
            if (zipField) mapped[zipField] = zip.trim();
          }
        } else {
          // Fallback: try simpler parsing
          const parts = cityStateZip.split(',').map(p => p.trim());
          if (parts.length >= 2) {
            const cityField = templateObjFields.find(f => f.toLowerCase().includes('city'));
            const stateZipField = templateObjFields.find(f => 
              f.toLowerCase().includes('state') || f.toLowerCase().includes('zip')
            );
            if (cityField) mapped[cityField] = parts[0];
            if (stateZipField) mapped[stateZipField] = parts.slice(1).join(', ');
          }
        }
      }
    }

    // Special handling: Check if we have First_Name, Middle_Initial, Last_Name that should combine into a "Name" field
    const hasNameFields = 'First_Name' in importedObj || 'Last_Name' in importedObj;
    const nameTemplateField = templateObjFields.find(f => 
      f.toLowerCase().includes('name') && !f.toLowerCase().includes('first') && !f.toLowerCase().includes('last')
    );

    if (hasNameFields && nameTemplateField) {
      // Combine name fields into a single name string
      const firstName = importedObj.First_Name || '';
      // Format middle initial with period if it's a single letter
      let middleInitial = '';
      if (importedObj.Middle_Initial) {
        const mi = String(importedObj.Middle_Initial).trim();
        middleInitial = mi.length === 1 ? ` ${mi}.` : ` ${mi}`;
      }
      const lastName = importedObj.Last_Name || '';
      const fullName = `${firstName}${middleInitial} ${lastName}`.trim();
      if (fullName) {
        mapped[nameTemplateField] = fullName;
        console.log(`  Combined name fields into "${nameTemplateField}": "${fullName}"`);
      }
    }

    for (const [importedKey, importedVal] of Object.entries(importedObj)) {
      // Skip name fields if we already combined them
      if (hasNameFields && nameTemplateField && 
          (importedKey === 'First_Name' || importedKey === 'Middle_Initial' || importedKey === 'Last_Name')) {
        continue;
      }
      
      // Skip Address if we already processed it as a string
      if (importedKey === 'Address' && typeof importedVal === 'string' && 
          templateObjFields.some(f => f.toLowerCase().includes('address'))) {
        const addressField = templateObjFields.find(f => 
          f.toLowerCase().includes('address') && !f.toLowerCase().includes('line')
        );
        if (addressField && mapped[addressField]) {
          continue; // Already processed
        }
      }
      
      // Skip City_State_Zip if we already processed it (but only if it was actually processed)
      // We need to check if it was in the address context
      const cityStateZipProcessed = (importedKey === 'City_State_Zip' || importedKey === 'City_State_Zip_Code') &&
        templateObjFields.some(f => f.toLowerCase().includes('address')) &&
        templateObjFields.find(f => f.toLowerCase().includes('address') && 
          (templateObj[f]?.type === 'object' || templateObj[f]?.properties));
      if (cityStateZipProcessed && mapped[templateObjFields.find(f => 
        f.toLowerCase().includes('address') && 
        (templateObj[f]?.type === 'object' || templateObj[f]?.properties))]) {
        continue;
      }
      
      // Special handling: Map Dates_of_Employment or Employment_Dates object
      if ((importedKey === 'Dates_of_Employment' || importedKey === 'Employment_Dates') && 
          importedVal && typeof importedVal === 'object' && !Array.isArray(importedVal)) {
        // Check if template has Employment_Dates as an object with From/To fields
        const employmentDatesField = templateObjFields.find(f => 
          f.toLowerCase() === 'employment_dates' || f === 'Employment_Dates'
        );
        
        if (employmentDatesField) {
          // Template has Employment_Dates object - map directly
          const datesTemplate = templateObj[employmentDatesField];
          if (datesTemplate && typeof datesTemplate === 'object') {
            let datesFields = [];
            if (datesTemplate.properties) {
              datesFields = Object.keys(datesTemplate.properties);
            } else if (datesTemplate.type === 'object' && datesTemplate.properties) {
              datesFields = Object.keys(datesTemplate.properties);
            } else {
              // Direct object structure
              datesFields = Object.keys(datesTemplate);
            }
            
            mapped[employmentDatesField] = {};
            if (datesFields.includes('From') && importedVal.From) {
              // Convert "7/25" to "07/2025" format
              const fromDate = String(importedVal.From).trim();
              const parts = fromDate.split('/');
              if (parts.length === 2) {
                const month = parts[0].padStart(2, '0');
                const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
                mapped[employmentDatesField].From = `${month}/${year}`;
              } else {
                mapped[employmentDatesField].From = fromDate;
              }
            }
            if (datesFields.includes('To') && importedVal.To) {
              // Convert "6/25" to "06/2025" format
              const toDate = String(importedVal.To).trim();
              if (toDate) {
                const parts = toDate.split('/');
                if (parts.length === 2) {
                  const month = parts[0].padStart(2, '0');
                  const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
                  mapped[employmentDatesField].To = `${month}/${year}`;
                } else {
                  mapped[employmentDatesField].To = toDate;
                }
              } else {
                mapped[employmentDatesField].To = null;
              }
            }
            continue;
          }
        }
        
        // Fallback: Try to map to separate start/end fields if Employment_Dates object doesn't exist in template
        const startField = templateObjFields.find(f => 
          f.toLowerCase().includes('start') && (f.toLowerCase().includes('month') || f.toLowerCase().includes('employment'))
        );
        const endField = templateObjFields.find(f => 
          f.toLowerCase().includes('end') && (f.toLowerCase().includes('month') || f.toLowerCase().includes('employment'))
        );
        
        if (startField && importedVal.From) {
          // Convert "7/25" to "07/2025" format
          const fromDate = String(importedVal.From).trim();
          if (fromDate) {
            const parts = fromDate.split('/');
            if (parts.length === 2) {
              const month = parts[0].padStart(2, '0');
              const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
              mapped[startField] = `${month}/${year}`;
            } else {
              mapped[startField] = fromDate;
            }
          }
        }
        
        if (endField && importedVal.To) {
          const toDate = String(importedVal.To).trim();
          if (toDate) {
            const parts = toDate.split('/');
            if (parts.length === 2) {
              const month = parts[0].padStart(2, '0');
              const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
              mapped[endField] = `${month}/${year}`;
            } else {
              mapped[endField] = toDate;
            }
          }
        }
        
        continue;
      }
      
      // Special handling: Map Dates_of_Residence object
      if (importedKey === 'Dates_of_Residence' && importedVal && typeof importedVal === 'object' && !Array.isArray(importedVal)) {
        // Check if template has Dates_of_Residence as an object with From/To fields
        const datesOfResidenceField = templateObjFields.find(f => 
          f.toLowerCase() === 'dates_of_residence' || f === 'Dates_of_Residence'
        );
        
        if (datesOfResidenceField) {
          // Template has Dates_of_Residence object - map directly
          const datesTemplate = templateObj[datesOfResidenceField];
          // Check multiple possible template structures
          if (datesTemplate && typeof datesTemplate === 'object') {
            let datesFields = [];
            if (datesTemplate.properties) {
              datesFields = Object.keys(datesTemplate.properties);
            } else if (datesTemplate.type === 'object' && datesTemplate.properties) {
              datesFields = Object.keys(datesTemplate.properties);
            } else {
              // Direct object structure (like in the template: Dates_of_Residence: { From: {...}, To: {...} })
              datesFields = Object.keys(datesTemplate);
            }
            
            mapped[datesOfResidenceField] = {};
            if (datesFields.includes('From') && importedVal.From) {
              // Convert "6/23" to "06/2023" format if needed
              const fromDate = String(importedVal.From).trim();
              const parts = fromDate.split('/');
              if (parts.length === 2) {
                const month = parts[0].padStart(2, '0');
                const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
                mapped[datesOfResidenceField].From = `${month}/${year}`;
              } else {
                mapped[datesOfResidenceField].From = fromDate;
              }
            }
            if (datesFields.includes('To') && importedVal.To) {
              // Convert "8/25" to "08/2025" format if needed
              const toDate = String(importedVal.To).trim();
              const parts = toDate.split('/');
              if (parts.length === 2) {
                const month = parts[0].padStart(2, '0');
                const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
                mapped[datesOfResidenceField].To = `${month}/${year}`;
              } else {
                mapped[datesOfResidenceField].To = toDate;
              }
            }
            continue;
          }
        }
        
        // Fallback: Try to map to separate start/end fields if Dates_of_Residence object doesn't exist in template
        const startField = templateObjFields.find(f => 
          (f.toLowerCase().includes('start') || f.toLowerCase().includes('begin')) && 
          (f.toLowerCase().includes('month') || f.toLowerCase().includes('residence'))
        ) || templateObjFields.find(f => f.toLowerCase() === 'residence_start_month');
        const endField = templateObjFields.find(f => 
          (f.toLowerCase().includes('end') || f.toLowerCase().includes('finish')) && 
          (f.toLowerCase().includes('month') || f.toLowerCase().includes('residence'))
        ) || templateObjFields.find(f => f.toLowerCase() === 'residence_end_month');
        
        if (startField && importedVal.From) {
          const fromDate = String(importedVal.From).trim();
          if (fromDate) {
            const parts = fromDate.split('/');
            if (parts.length === 2) {
              const month = parts[0].padStart(2, '0');
              const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
              mapped[startField] = `${month}/${year}`;
            } else {
              mapped[startField] = fromDate;
            }
          }
        }
        
        if (endField && importedVal.To) {
          const toDate = String(importedVal.To).trim();
          if (toDate) {
            const parts = toDate.split('/');
            if (parts.length === 2) {
              const month = parts[0].padStart(2, '0');
              const year = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
              mapped[endField] = `${month}/${year}`;
            } else {
              mapped[endField] = toDate;
            }
          }
        }
        
        continue;
      }
      
      // Special handling: Map Financial_Accounts -> Bank_Accounts
      if (importedKey === 'Financial_Accounts' && Array.isArray(importedVal)) {
        const bankAccountsField = templateObjFields.find(f => 
          f.toLowerCase().includes('bank') && f.toLowerCase().includes('account')
        );
        if (bankAccountsField) {
          mapped[bankAccountsField] = importedVal;
          continue;
        }
      }
      
      // Special handling: Map Other_Sources_of_Income or Other_Income -> Additional_Income
      if ((importedKey === 'Other_Sources_of_Income' || importedKey === 'Other_Income')) {
        const additionalIncomeField = templateObjFields.find(f => 
          f.toLowerCase().includes('additional') && f.toLowerCase().includes('income')
        );
        if (additionalIncomeField) {
          if (Array.isArray(importedVal)) {
            // Map array items: Source -> Income_Type, Amount -> Monthly_Amount
            mapped[additionalIncomeField] = importedVal.map(item => {
              if (typeof item === 'object' && item !== null) {
                return {
                  Income_Type: item.Source || item.Income_Type || '',
                  Monthly_Amount: item.Amount || item.Monthly_Amount || ''
                };
              }
              return item;
            });
          } else if (typeof importedVal === 'object' && importedVal !== null) {
            // Handle single object: convert to array
            mapped[additionalIncomeField] = [{
              Income_Type: importedVal.Source || importedVal.Income_Type || '',
              Monthly_Amount: importedVal.Amount || importedVal.Monthly_Amount || ''
            }];
          }
          continue;
        }
      }

      // Pass context for better matching (parent field name or category)
      const context = Object.keys(templateObj).join(' ').toLowerCase();
      const mappedKey = findBestFieldMatch(importedKey, templateObjFields, context);
      
      // Special handling: If "Address" is a string and template has an "Address" object field, convert it
      if (importedKey.toLowerCase() === 'address' && typeof importedVal === 'string' && 
          templateObjFields.some(f => f.toLowerCase().includes('address'))) {
        const addressField = templateObjFields.find(f => 
          f.toLowerCase().includes('address') && !f.toLowerCase().includes('line')
        );
        if (addressField) {
          const addressTemplate = templateObj[addressField];
          if (addressTemplate && typeof addressTemplate === 'object' && 
              (addressTemplate.type === 'object' || addressTemplate.properties)) {
            // Initialize address object if it doesn't exist
            if (!mapped[addressField]) mapped[addressField] = {};
            
            // Set Address_Line_1
            const addressLine1Field = addressTemplate.properties ? 
              Object.keys(addressTemplate.properties).find(f => f.toLowerCase().includes('line') && f.toLowerCase().includes('1')) :
              'Address_Line_1';
            mapped[addressField][addressLine1Field || 'Address_Line_1'] = importedVal;
            
            continue;
          }
        }
      }
      
      // If the value is a nested object and we have a template for it, recurse
      if (importedVal && typeof importedVal === 'object' && !Array.isArray(importedVal)) {
        // Check if templateObj[mappedKey] exists and is an object (not a field definition)
        const templateFieldDef = templateObj?.[mappedKey];
        let templateSubObj = null;
        
        // Handle different template structures:
        // 1. If it's a direct object (like Current_Employment: { Employer_Name: {...} })
        if (templateFieldDef && typeof templateFieldDef === 'object' && !Array.isArray(templateFieldDef)) {
          // Check if it has 'type' property (field definition) or 'properties' (object definition)
          if (templateFieldDef.type === 'object' || templateFieldDef.properties) {
            // It's a field definition with object type - use the properties
            templateSubObj = templateFieldDef.properties || templateFieldDef;
          } else if (!templateFieldDef.type && !templateFieldDef.properties) {
            // It's a direct object structure (like Current_Employment: { Employer_Name: {...} })
            templateSubObj = templateFieldDef;
          }
        }
        
        // Debug: Log when we're looking for Current_Employment specifically
        if (templateSubObj && typeof templateSubObj === 'object' && !Array.isArray(templateSubObj)) {
          mapped[mappedKey] = mapNestedObject(importedVal, templateSubObj, depth + 1);
        } else {
          // No template structure - check if template expects a primitive value
          // Check if field expects currency, string, number, or boolean (not object/array)
          const expectsPrimitive = !templateFieldDef || 
            (templateFieldDef.type && 
             ['string', 'number', 'boolean', 'currency', 'date', 'time'].includes(templateFieldDef.type)) ||
            (!templateFieldDef.type && 
             !templateFieldDef.properties && 
             !isFieldDefinitionObject(templateFieldDef));
          
          if (expectsPrimitive) {
            // Template expects a primitive, but we have an object
            // Try to convert to a meaningful string representation
            const objKeys = Object.keys(importedVal);
            if (objKeys.length === 0) {
              mapped[mappedKey] = '';
              console.log(`  ⚠️ Converted empty object "${importedKey}" to empty string for field "${mappedKey}"`);
            } else if (objKeys.length === 1) {
              // Single property - use its value
              const singleVal = importedVal[objKeys[0]];
              // If the single value is also an object, convert it
              if (singleVal && typeof singleVal === 'object' && !Array.isArray(singleVal)) {
                mapped[mappedKey] = Object.entries(singleVal)
                  .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                  .join(', ');
                console.log(`  ⚠️ Converted nested object "${importedKey}" to string for field "${mappedKey}": "${mapped[mappedKey]}"`);
              } else {
                mapped[mappedKey] = singleVal;
                console.log(`  ✅ Extracted single value from object "${importedKey}" -> "${mappedKey}": "${mapped[mappedKey]}"`);
              }
            } else {
              // Multiple properties - create a formatted string
              const formatted = objKeys.map(key => {
                const val = importedVal[key];
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                  return `${key}: ${JSON.stringify(val)}`;
                }
                return `${key}: ${val}`;
              }).join(', ');
              mapped[mappedKey] = formatted;
              console.log(`  ⚠️ Converted object "${importedKey}" to string for field "${mappedKey}": "${formatted}"`);
            }
          } else {
            // Template might accept an object, keep it as-is
            mapped[mappedKey] = importedVal;
            console.log(`  ℹ️ Keeping object "${importedKey}" as-is for field "${mappedKey}" (template accepts object)`);
          }
        }
      } else {
        // Primitive value or array
        // Ensure we're not accidentally assigning an object when a primitive is expected
        if (typeof importedVal === 'object' && importedVal !== null && !Array.isArray(importedVal)) {
          const templateFieldDef = templateObj?.[mappedKey];
          const expectsPrimitive = templateFieldDef && 
            templateFieldDef.type && 
            ['string', 'number', 'boolean', 'currency', 'date', 'time'].includes(templateFieldDef.type);
          
          if (expectsPrimitive) {
            // This shouldn't happen, but handle it gracefully
            console.log(`  ⚠️ WARNING: Field "${mappedKey}" expects primitive but got object. Converting...`);
            console.log(`  Object keys: [${Object.keys(importedVal).join(', ')}]`);
            const objKeys = Object.keys(importedVal);
            if (objKeys.length === 1) {
              const singleVal = importedVal[objKeys[0]];
              // If the single value is also an object, convert it to string
              if (singleVal && typeof singleVal === 'object' && !Array.isArray(singleVal)) {
                mapped[mappedKey] = JSON.stringify(singleVal);
              } else {
                mapped[mappedKey] = singleVal;
              }
              console.log(`  Converted to: "${mapped[mappedKey]}"`);
            } else if (objKeys.length === 0) {
              mapped[mappedKey] = '';
            } else {
              // Try to find a meaningful value (e.g., "Amount", "Value", "Total")
              const amountKey = objKeys.find(k => 
                k.toLowerCase().includes('amount') || 
                k.toLowerCase().includes('value') || 
                k.toLowerCase().includes('total')
              );
              if (amountKey) {
                mapped[mappedKey] = importedVal[amountKey];
              } else {
                mapped[mappedKey] = JSON.stringify(importedVal);
              }
              console.log(`  Converted to: "${mapped[mappedKey]}"`);
            }
          } else {
            mapped[mappedKey] = importedVal;
          }
        } else {
          mapped[mappedKey] = importedVal;
        }
      }
    }

    return mapped;
  };

  const findBestFieldMatch = (importedField, templateFields, context = '') => {
    let bestMatch = importedField;
    let bestScore = 0;
    
    // Debug logging for employment-related fields
    const isEmploymentRelated = importedField.toLowerCase().includes('employ') || 
                                 importedField.toLowerCase().includes('income') ||
                                 context.toLowerCase().includes('employment');
    
    // Context-aware matching: if we're in an address context, "Address" should match "Address Line 1"
    const isAddressContext = context.toLowerCase().includes('address');
    const isEmploymentContext = context.toLowerCase().includes('employment') || context.toLowerCase().includes('employer');
    const isDateContext = context.toLowerCase().includes('date') || context.toLowerCase().includes('employment');
    
    for (const templateField of templateFields) {
      let score = similarity(importedField, templateField);
      
      // Context-aware boosts
      if (isAddressContext && importedField.toLowerCase() === 'address' && 
          (templateField.toLowerCase().includes('address') && templateField.toLowerCase().includes('line'))) {
        score = Math.max(score, 0.5); // Boost for Address -> Address Line 1
      }
      
      if (isEmploymentContext) {
        // Employer -> Employer Name
        if (importedField.toLowerCase() === 'employer' && templateField.toLowerCase().includes('employer') && 
            templateField.toLowerCase().includes('name')) {
          score = Math.max(score, 0.6);
        }
        // Position_Title -> Job Title
        if ((importedField.toLowerCase().includes('position') || importedField.toLowerCase().includes('title')) &&
            (templateField.toLowerCase().includes('job') || templateField.toLowerCase().includes('title'))) {
          score = Math.max(score, 0.5);
        }
        // Monthly_Income -> Monthly Gross Income
        if (importedField.toLowerCase().includes('income') && templateField.toLowerCase().includes('income') &&
            templateField.toLowerCase().includes('gross')) {
          score = Math.max(score, 0.5);
        }
      }
      
      if (isDateContext) {
        // From -> Start Month, To -> End Month
        if (importedField.toLowerCase() === 'from' && 
            (templateField.toLowerCase().includes('start') || templateField.toLowerCase().includes('begin'))) {
          score = Math.max(score, 0.5);
        }
        if (importedField.toLowerCase() === 'to' && 
            (templateField.toLowerCase().includes('end') || templateField.toLowerCase().includes('finish'))) {
          score = Math.max(score, 0.5);
        }
      }
      
      // Supervisor_Name -> Supervisor Name (exact match with underscore)
      if (importedField.toLowerCase().replace(/_/g, ' ') === templateField.toLowerCase().replace(/_/g, ' ')) {
        score = Math.max(score, 0.9);
      }
      
      if (bestScore < score) {
        bestScore = score;
        bestMatch = templateField;
      }
    }
    
    // Use a higher threshold to prevent false matches
    // But be more lenient for employment-related fields
    const threshold = isEmploymentRelated ? 0.3 : 0.4;
    
    if (bestScore > threshold) {
      return bestMatch;
    }
    return importedField;
  };

  for (const [importedCategory, importedValue] of Object.entries(importedData)) {
    const templateCategory = findBestMatch(importedCategory);
    if (templateCategory) {
      
      // Special handling: If template category itself is an array definition (e.g., "Applicants": { "type": "array", "items": {...} })
      const templateCategoryDef = templateData[templateCategory];
      if (templateCategoryDef && typeof templateCategoryDef === 'object' && !Array.isArray(templateCategoryDef) && 
          templateCategoryDef.type === 'array' && templateCategoryDef.items) {
        if (Array.isArray(importedValue)) {
          const templateItemsObj = templateCategoryDef.items.properties || templateCategoryDef.items;
          mappedData[templateCategory] = importedValue.map((item, index) => {
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                const mappedItem = mapNestedObject(item, templateItemsObj, 1);
              return mappedItem;
            }
            return item;
          });
        } else {
          // If imported value is not an array, wrap it
          mappedData[templateCategory] = [importedValue];
        }
        continue;
      }
      
      if (!mappedData[templateCategory]) mappedData[templateCategory] = {};
      const templateFields =
        templateData[templateCategory] &&
        typeof templateData[templateCategory] === 'object' &&
        !Array.isArray(templateData[templateCategory])
          ? Object.keys(templateData[templateCategory])
          : [];
      if (typeof importedValue === 'object' && importedValue !== null && !Array.isArray(importedValue)) {
        // Special handling: If Current_Address is a string, convert it to an object with Address_Line_1
        if (importedCategory === 'Residence_History' && importedValue.Current_Address && 
            typeof importedValue.Current_Address === 'string') {
          importedValue.Current_Address = {
            Address_Line_1: importedValue.Current_Address
          };
          // Also move Unit_No or Current_Unit_No to Address_Line_2 if present
          if (importedValue.Unit_No) {
            importedValue.Current_Address.Address_Line_2 = importedValue.Unit_No;
          } else if (importedValue.Current_Unit_No) {
            importedValue.Current_Address.Address_Line_2 = importedValue.Current_Unit_No;
          }
          // Move City_State_Zip_Code into Current_Address object so it gets processed correctly
          if (importedValue.City_State_Zip_Code) {
            importedValue.Current_Address.City_State_Zip_Code = importedValue.City_State_Zip_Code;
          }
        } else if (importedCategory === 'Residence_History' && importedValue.Current_Address && 
                   typeof importedValue.Current_Address === 'object' && !Array.isArray(importedValue.Current_Address)) {
          // Current_Address is already an object, but ensure Unit_No is added if present
          if (importedValue.Unit_No && !importedValue.Current_Address.Address_Line_2) {
            importedValue.Current_Address.Address_Line_2 = importedValue.Unit_No;
          } else if (importedValue.Current_Unit_No && !importedValue.Current_Address.Address_Line_2) {
            importedValue.Current_Address.Address_Line_2 = importedValue.Current_Unit_No;
          }
          // Move City_State_Zip_Code into Current_Address object if not already there
          if (importedValue.City_State_Zip_Code && !importedValue.Current_Address.City_State_Zip_Code) {
            importedValue.Current_Address.City_State_Zip_Code = importedValue.City_State_Zip_Code;
          }
        }
        
        // Special handling: Map Financial_Accounts to Bank_Accounts array
        if (importedCategory === 'Employment_Financial' && importedValue.Financial_Accounts && 
            Array.isArray(importedValue.Financial_Accounts)) {
          // This will be handled in the nested mapping, but ensure it maps correctly
        }
        
        // Special handling: Map Other_Sources_of_Income to Additional_Income array
        if (importedCategory === 'Employment_Financial' && importedValue.Other_Sources_of_Income && 
            Array.isArray(importedValue.Other_Sources_of_Income)) {
          // This will be handled in the nested mapping
        }
        
        // Recursively map nested objects to preserve structure
        // mapNestedObject is now defined at function scope above

        const mappedCategoryData = mapNestedObject(importedValue, templateData[templateCategory], 0);
        mappedData[templateCategory] = { ...mappedData[templateCategory], ...mappedCategoryData };
      } else if (Array.isArray(importedValue)) {
        // Find the array field in template (e.g., "Personal_References", "Previous_Addresses", "Vehicles")
        const arrayField =
          templateFields.find(
            (f) => templateData[templateCategory][f]?.type === 'array' || templateData[templateCategory][f]?.items
          ) || templateFields.find(f => f.toLowerCase().includes(importedCategory.toLowerCase().replace(/s$/, ''))) || 
          templateFields[0] || importedCategory;
        
        // If array items have structure, map each item recursively
        const arrayTemplate = templateData[templateCategory][arrayField];
        if (arrayTemplate && arrayTemplate.items && typeof arrayTemplate.items === 'object') {
          // Use the full mapNestedObject function for proper handling of all special cases
          const templateItemsObj = arrayTemplate.items.properties || arrayTemplate.items;
          mappedData[templateCategory][arrayField] = importedValue.map((item, index) => {
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
              const mappedItem = mapNestedObject(item, templateItemsObj, 1);
              return mappedItem;
            }
            return item;
          });
        } else {
          mappedData[templateCategory][arrayField] = importedValue;
        }
      } else {
        const targetField =
          templateFields.length > 0 ? findBestFieldMatch(importedCategory, templateFields) : importedCategory;
        mappedData[templateCategory][targetField] = importedValue;
      }
    } else {
      // No category match - try to map to Additional Information section
      // Handle fields like "Smoking_Information", "Eviction_History", "Bankruptcy_History", etc.
      const additionalInfoCategory = '10_Additional_Information_and_Consents';
      if (templateData[additionalInfoCategory]) {
        if (!mappedData[additionalInfoCategory]) mappedData[additionalInfoCategory] = {};
        
        // Map specific fields to their locations in Additional Information
        if (importedCategory === 'Smoking_Information') {
          // Handle both Occupants_Smoke and Smoking_Status
          const smokingValue = importedValue?.Occupants_Smoke ?? importedValue?.Smoking_Status;
          if (smokingValue !== undefined) {
            mappedData[additionalInfoCategory].Smoking_Status = smokingValue;
          }
        } else if (importedCategory === 'Smoking_Status' && typeof importedValue === 'string') {
          // Handle Smoking_Status as a direct string value
          mappedData[additionalInfoCategory].Smoking_Status = importedValue;
        } else if (importedCategory === 'Eviction_History' && importedValue?.Evicted !== undefined) {
          mappedData[additionalInfoCategory].Disclosures = mappedData[additionalInfoCategory].Disclosures || {};
          mappedData[additionalInfoCategory].Disclosures.Eviction_History = 
            importedValue.Evicted === 'Yes' || importedValue.Evicted === true;
        } else if (importedCategory === 'Bankruptcy_History' && importedValue?.Declared_Bankruptcy !== undefined) {
          mappedData[additionalInfoCategory].Disclosures = mappedData[additionalInfoCategory].Disclosures || {};
          mappedData[additionalInfoCategory].Disclosures.Bankruptcy_History = 
            importedValue.Declared_Bankruptcy === 'Yes' || importedValue.Declared_Bankruptcy === true;
        } else if (importedCategory === 'Application_Fee') {
          // Handle both object format (Application_Fee: { Amount: "50" }) and string format (Application_Fee: "50")
          const feeAmount = typeof importedValue === 'object' && importedValue !== null 
            ? importedValue.Amount 
            : importedValue;
          if (feeAmount !== undefined && feeAmount !== null) {
            mappedData[additionalInfoCategory].Application_Metadata = mappedData[additionalInfoCategory].Application_Metadata || {};
            mappedData[additionalInfoCategory].Application_Metadata.Application_Fee_Amount = feeAmount;
          }
        } else if (importedCategory === 'Application_Details' && typeof importedValue === 'object' && importedValue !== null) {
          // Handle Application_Details.Application_Fee
          if (importedValue.Application_Fee !== undefined && importedValue.Application_Fee !== null) {
            const feeAmount = typeof importedValue.Application_Fee === 'object' && importedValue.Application_Fee !== null
              ? importedValue.Application_Fee.Amount 
              : importedValue.Application_Fee;
            if (feeAmount !== undefined && feeAmount !== null) {
              mappedData[additionalInfoCategory].Application_Metadata = mappedData[additionalInfoCategory].Application_Metadata || {};
              mappedData[additionalInfoCategory].Application_Metadata.Application_Fee_Amount = feeAmount;
            }
          }
        } else {
          // Fallback: store in mappedData as-is
          mappedData[importedCategory] = importedValue;
        }
      } else {
        mappedData[importedCategory] = importedValue;
      }
    }
  }

  return mappedData;
}

/**
 * Normalizes date strings in application data to MM-DD-YYYY format.
 * Converts various date formats (MM/DD/YYYY, M/D/YY, etc.) to MM-DD-YYYY.
 */
export function normalizeDates(data) {
  const parseDateString = (val) => {
    if (typeof val !== 'string') return val;
    const cleaned = val.trim().replace(/\s*[/-]\s*/g, (match) => match.trim());
    const match = cleaned.match(/^(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})$/);
    if (!match) {
      return val;
    }
    let [, m, d, y] = match;
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    let year = parseInt(y, 10);
    if (y.length === 2) year = year >= 50 ? 1900 + year : 2000 + year;
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return val;
    }
    
    // Format as MM-DD-YYYY
    const formatted = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${year}`;
    return formatted;
  };

  const recurse = (val) => {
    if (Array.isArray(val)) return val.map(recurse);
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = recurse(v);
      return out;
    }
    if (typeof val === 'string') return parseDateString(val);
    return val;
  };
  return recurse(data);
}

