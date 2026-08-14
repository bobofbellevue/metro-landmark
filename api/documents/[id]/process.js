/* eslint-env node */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

/**
 * Vercel serverless function to process filled forms and extract data
 * 
 * POST /api/documents/:id/process
 * 
 * Body (optional):
 * - template_id: Integer (template to use for extraction)
 * 
 * Response:
 * {
 *   success: boolean,
 *   extracted_data?: Object,
 *   confidence?: number,
 *   error?: string
 * }
 */
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
    // Initialize Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
    });

    if (!openai.apiKey) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured'
      });
    }

    // Get document ID
    const { id } = req.query;
    const { template_id } = req.body || {};

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Document ID is required'
      });
    }

    // Get document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('document_id', id)
      .single();

    if (docError || !document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Update processing status
    await supabase
      .from('documents')
      .update({ 
        metadata: { ...document.metadata, processing_status: 'processing' }
      })
      .eq('document_id', id);

    // Download file from storage (use storage_path, fall back to file_path for backward compatibility)
    const storagePath = document.storage_path || document.file_path;
    if (!storagePath) {
      return res.status(500).json({
        success: false,
        error: 'Document is missing storage path information'
      });
    }
    
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (downloadError) {
      await supabase
        .from('documents')
        .update({ 
          metadata: { ...document.metadata, processing_status: 'error', processing_error: downloadError.message }
        })
        .eq('document_id', id);
      return res.status(500).json({
        success: false,
        error: `Failed to download document: ${downloadError.message}`
      });
    }

    // Convert file to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${document.mime_type};base64,${base64}`;

    // Validate document is a filled form type
    const filledFormTypes = ['filled_application', 'filled_lease', 'application', 'lease'];
    const isFilledForm = document.document_type && filledFormTypes.some(type => 
      document.document_type.toLowerCase().includes(type.toLowerCase())
    );

    if (!isFilledForm) {
      await supabase
        .from('documents')
        .update({ 
          metadata: { ...document.metadata, processing_status: 'error', processing_error: 'Document is not a filled form type' }
        })
        .eq('document_id', id);
      return res.status(400).json({
        success: false,
        error: 'Document must be a filled form type (filled_application, filled_lease, etc.)'
      });
    }

    // Identify appropriate template if not provided
    let template = null;
    let selectedTemplateId = template_id;
    
    if (!selectedTemplateId) {
      // Determine template type from document_type
      let templateType = 'Application';
      if (document.document_type && document.document_type.toLowerCase().includes('lease')) {
        templateType = 'Lease';
      }

      // Find default template for this type
      const { data: defaultTemplate, error: templateError } = await supabase
        .from('templates')
        .select('template_id, template_data, template_type')
        .eq('template_type', templateType)
        .eq('is_default', true)
        .order('template_level', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!templateError && defaultTemplate) {
        selectedTemplateId = defaultTemplate.template_id;
        template = defaultTemplate.template_data;
      } else {
        // Try to find any template of this type
        const { data: anyTemplate } = await supabase
          .from('templates')
          .select('template_id, template_data, template_type')
          .eq('template_type', templateType)
          .order('template_level', { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (anyTemplate) {
          selectedTemplateId = anyTemplate.template_id;
          template = anyTemplate.template_data;
        }
      }
    } else {
      // Get template if provided
      const { data: templateData, error: templateError } = await supabase
        .from('templates')
        .select('template_data, template_type')
        .eq('template_id', selectedTemplateId)
        .single();

      if (!templateError && templateData) {
        template = templateData.template_data;
      }
    }

    // Convert file to images if needed (for Vision API)
    // Note: Vision API can handle PDFs, but for better results we should convert to images
    // For now, we'll use the file directly - the Vision API will handle PDFs
    let images = [];
    if (document.mime_type === 'application/pdf') {
      // For PDFs, use the base64 data URL directly
      // The Vision API can process PDFs, though images work better
      // In production, consider converting PDFs to images first for better accuracy
      images = [dataUrl];
    } else if (document.mime_type && document.mime_type.startsWith('image/')) {
      images = [dataUrl];
    } else {
      await supabase
        .from('documents')
        .update({ 
          metadata: { ...(document.metadata || {}), processing_status: 'error', processing_error: 'Unsupported file type for processing' }
        })
        .eq('document_id', id);
      return res.status(400).json({
        success: false,
        error: 'Only PDF and image files can be processed'
      });
    }

    // Use OpenAI Vision API to extract data
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const visionModel = model.includes('o1') ? 'gpt-4o' : (model.includes('gpt-4') ? model : 'gpt-4o');

    const systemMessage = `You are a document processing assistant specialized in extracting DATA VALUES from filled rental application and lease forms.

Your task is to:
1. Analyze the provided filled form image(s)
2. Extract ALL field values that are filled in
3. Return the extracted data as JSON matching the form structure

CRITICAL INSTRUCTIONS:
- Extract actual VALUES from filled fields (not the field definitions)
- Match field names to the template schema structure when provided
- Group related fields logically using the same category names as the template
- For empty fields, use null or omit them
- Preserve data types (strings, numbers, dates, booleans)
- For dates, preserve the format as written (MM/DD/YYYY, MM/YYYY, etc.) - do NOT convert to ISO format
- For currency/numbers, extract as numbers (not strings) when possible
- For checkboxes, extract as boolean (true if checked, false if unchecked)
- Return confidence score (0-100) for the extraction quality
- Be thorough - extract every visible field value

${template ? `Use this template structure as a guide for organizing the extracted data. Match field names and categories to the template:\n${JSON.stringify(template, null, 2)}` : 'Organize fields into logical categories (e.g., Applicant_Information, Employment_Financial, etc.)'}

Return JSON in this format:
{
  "extracted_data": {
    "category_name": {
      "field_name": "extracted_value"
    }
  },
  "confidence": 85,
  "extracted_fields": ["field1", "field2", ...]
}`;

    const userContent = [
      {
        type: 'text',
        text: `Extract all filled field values from this ${document.document_type || 'filled form'}. ${template ? 'Match the field names and structure to the provided template schema.' : 'Return the extracted data as JSON organized by categories.'}`
      },
      ...images.map(img => ({
        type: 'image_url',
        image_url: {
          url: img
        }
      }))
    ];

    console.log(`Processing document ${id} with ${visionModel} Vision API...`);

    const response = await openai.chat.completions.create({
      model: visionModel,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      temperature: 0.2  // Low temperature for consistent extraction
    });

    // Parse extracted data
    let extractionResult;
    try {
      extractionResult = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks
      let content = response.choices[0].message.content;
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        extractionResult = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error(`Failed to parse extraction result: ${parseError.message}`);
      }
    }

    const extractedData = extractionResult.extracted_data || extractionResult;
    const confidence = extractionResult.confidence || 85;

    // Store extracted data based on document type and linked entity
    // For application documents, they're linked via tenant_user_id
    // We need to find the application by matching tenant_user_id and document_type
    const isApplicationDoc = document.document_type && (
      document.document_type.includes('application') || 
      document.document_type.includes('rental')
    );
    
    if (isApplicationDoc && document.tenant_user_id) {
      // Find the application for this user
      // Get client_id from user_id
      const { data: client } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', document.tenant_user_id)
        .single();
      
      if (client) {
        // Find the most recent application for this client
        // If document has unit_id, use that to find the specific application
        let applicationQuery = supabase
          .from('client_applications')
          .select('application_id')
          .eq('client_id', client.client_id)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (document.unit_id) {
          applicationQuery = applicationQuery.eq('unit_id', document.unit_id);
        }
        
        const { data: application, error: appError } = await applicationQuery.single();
        
        if (!appError && application) {
          // Update client_applications with field_data
          const { error: updateError } = await supabase
            .from('client_applications')
            .update({
              field_data: extractedData,
              processing_status: 'completed',
              extraction_confidence: confidence,
              template_id: selectedTemplateId || null,
              updated_at: new Date().toISOString()
            })
            .eq('application_id', application.application_id);

          if (updateError) {
            console.error('Error updating client_applications:', updateError);
            // Continue anyway - we'll update document metadata
          }
        }
      }
    } else if (document.document_type && document.document_type.includes('lease') && document.lease_id) {
      // For leases, we might store in a different table in the future
      // For now, just update document metadata
      console.log('Lease document processing - storing in document metadata only');
    }

    // Update document metadata
    await supabase
      .from('documents')
      .update({
        metadata: {
          ...(document.metadata || {}),
          processing_status: 'completed',
          extraction_confidence: confidence,
          extracted_fields: extractionResult.extracted_fields || [],
          template_id: selectedTemplateId || null
        }
      })
      .eq('document_id', id);

    return res.status(200).json({
      success: true,
      extracted_data: extractedData,
      confidence,
      extracted_fields: extractionResult.extracted_fields || [],
      usage: response.usage
    });

  } catch (error) {
    console.error('Document processing error:', error);

    // Update document with error status
    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseKey = 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
      
      const { id } = req.query;
      const { data: document } = await supabase
        .from('documents')
        .select('metadata')
        .eq('document_id', id)
        .single();

      if (document) {
        await supabase
          .from('documents')
          .update({
            metadata: {
              ...document.metadata,
              processing_status: 'error',
              processing_error: error.message
            }
          })
          .eq('document_id', id);
      }
    } catch (updateError) {
      console.error('Failed to update error status:', updateError);
    }

    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

