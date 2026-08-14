/* eslint-env node */
/**
 * Vercel serverless function to convert DOC files to images
 * DOC files (older Word format) need server-side conversion
 * Uses CloudConvert API to convert DOC -> PDF -> images
 * 
 * POST /api/documents/convert-doc-to-images
 * 
 * Body (JSON):
 * - file: DOC file (base64 encoded)
 * - fileName: Optional filename
 * 
 * Response:
 * {
 *   success: boolean,
 *   images?: Array<string>,  // Base64 encoded images
 *   error?: string
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
    // Check environment variable first (for better error messages)
    const cloudConvertApiKey = process.env.CLOUDCONVERT_API_KEY;
    
    if (!cloudConvertApiKey || cloudConvertApiKey.trim() === '') {
      console.error('CLOUDCONVERT_API_KEY environment variable check:', {
        exists: !!process.env.CLOUDCONVERT_API_KEY,
        length: process.env.CLOUDCONVERT_API_KEY ? process.env.CLOUDCONVERT_API_KEY.length : 0,
        isVercel: !!process.env.VERCEL,
        nodeEnv: process.env.NODE_ENV
      });
      return res.status(500).json({
        success: false,
        error: 'CloudConvert API key not configured. Please set CLOUDCONVERT_API_KEY in Vercel environment variables (Settings → Environment Variables). Get a free API key at cloudconvert.com. After adding the variable, you may need to redeploy your Vercel project.'
      });
    }

    // Get file from request
    let fileBuffer;
    let fileName = 'document.doc';

    if (!req.body.file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided.'
      });
    }

    // Extract base64 data and filename
    let base64Data;
    if (typeof req.body.file === 'string') {
      if (req.body.file.startsWith('data:')) {
        base64Data = req.body.file.split(',')[1];
      } else {
        // Assume it's already base64 without data URL prefix
        base64Data = req.body.file;
      }
      fileName = req.body.fileName || 'document.doc';
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid file format. Expected base64 encoded file.'
      });
    }

    // cloudConvertApiKey already checked at the top of try block

    // Use CloudConvert API v2 to convert DOC to PDF
    // CloudConvert v2 API workflow: Create job with import/export tasks
    const jobResponse = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cloudConvertApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tasks: {
          'import-file': {
            operation: 'import/base64',
            file: base64Data,
            filename: fileName
          },
          'convert-doc': {
            operation: 'convert',
            input: 'import-file',
            output_format: 'pdf',
            input_format: 'doc'
          },
          'export-pdf': {
            operation: 'export/url',
            input: 'convert-doc'
          }
        }
      })
    });

    if (!jobResponse.ok) {
      const errorText = await jobResponse.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch (e) {
        errorDetails = errorText;
      }
      console.error('CloudConvert API error:', {
        status: jobResponse.status,
        statusText: jobResponse.statusText,
        error: errorDetails,
        hasApiKey: !!cloudConvertApiKey,
        apiKeyLength: cloudConvertApiKey ? cloudConvertApiKey.length : 0
      });
      throw new Error(`CloudConvert API error (${jobResponse.status}): ${JSON.stringify(errorDetails)}`);
    }

    const jobResult = await jobResponse.json();
    
    // CloudConvert API v2 returns job data in a 'data' property
    const jobData = jobResult.data || jobResult;
    const jobId = jobData.id;
    
    if (!jobId) {
      console.error('CloudConvert job creation failed - no job ID:', jobResult);
      throw new Error(`CloudConvert job creation failed: ${JSON.stringify(jobResult)}`);
    }
    
    console.log('CloudConvert job created:', jobId);

    // Wait for job to complete
    let downloadUrl = null;
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 60 seconds for conversion

    while (!downloadUrl && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${cloudConvertApiKey}`
        }
      });

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        throw new Error(`Failed to check job status: ${statusResponse.statusText} - ${errorText}`);
      }

      const statusResult = await statusResponse.json();
      
      // CloudConvert API v2 returns job data in a 'data' property
      const statusData = statusResult.data || statusResult;
      const jobStatus = statusData.status;
      const tasks = statusData.tasks || [];
      
      if (jobStatus === 'finished') {
        // Get the export task result
        const exportTask = tasks.find(
          task => task.operation === 'export/url' && task.status === 'finished'
        );
        if (exportTask?.result?.files?.[0]?.url) {
          downloadUrl = exportTask.result.files[0].url;
          console.log('CloudConvert conversion completed, download URL:', downloadUrl.substring(0, 50) + '...');
          break;
        }
      } else if (jobStatus === 'error') {
        console.error('CloudConvert job error:', statusData);
        throw new Error(`Conversion failed: ${statusData.message || JSON.stringify(statusData)}`);
      } else if (jobStatus === 'waiting' || jobStatus === 'processing') {
        // Job is still processing, continue waiting
        if (attempts % 5 === 0) {
          console.log(`CloudConvert job ${jobId} status: ${jobStatus} (attempt ${attempts}/${maxAttempts})`);
        }
      }
      
      attempts++;
    }

    if (!downloadUrl) {
      throw new Error('Conversion timeout - job did not complete in time');
    }

    // Download the converted PDF and return it as base64 for client-side conversion
    // Vercel serverless functions have issues with pdfjs-dist + canvas, so we'll
    // let the client handle PDF to image conversion (which already works)
    const pdfResponse = await fetch(downloadUrl);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download converted PDF: ${pdfResponse.statusText}`);
    }
    const pdfBuffer = await pdfResponse.arrayBuffer();
    
    // Convert PDF buffer to base64
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    return res.status(200).json({
      success: true,
      pdfBase64: pdfDataUrl,
      // Return as PDF for client-side conversion
      needsClientConversion: true
    });

  } catch (error) {
    console.error('DOC conversion error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to convert DOC file',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

