# Vercel PDF Form Import Setup

## Overview
The PDF-to-JSON conversion feature runs on Vercel serverless functions, keeping your OpenAI API key secure on the server side.

## Setup

### 1. Vercel Environment Variables
Add the following environment variables in your Vercel project settings:

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add the following:

```
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4-turbo
```

> **Security:** Never commit real API keys. If a key was ever pasted into this doc, revoke it in the OpenAI dashboard and create a new one (see `docs/SECRET_ROTATION_CHECKLIST.md`).

**Important**: 
- These variables are automatically available to serverless functions
- No `VITE_` prefix needed (that's only for client-side variables)
- The API key stays secure on the server
- Apply to all environments (Production, Preview, Development)

### 2. How It Works

1. User clicks "Import PDF Form" button on the Templates tab
2. User selects a PDF file from their local drive
3. PDF is converted to base64 and sent to Vercel serverless function
4. Serverless function (`/api/documents/convert-pdf-to-json`):
   - Extracts text from PDF using `pdf-parse`
   - Sends text to OpenAI GPT-4 API
   - GPT-4 analyzes the form structure and generates a JSON schema
   - Returns the schema to the client
5. The resulting JSON schema is displayed in the template data field
6. User can review/edit the schema before saving
7. Template is saved to the database with `template_data` as JSONB

## Architecture

```
Browser (Client)
    ↓ (PDF file → base64)
Vercel Serverless Function (/api/documents/convert-pdf-to-json)
    ↓ (PDF buffer)
PDF Text Extraction (pdf-parse)
    ↓ (extracted text)
OpenAI GPT-4 API
    ↓ (JSON schema)
Browser (Client)
    ↓ (user review/edit)
Database (template_data JSONB)
```

## Features

- **Server-side processing**: OpenAI API key stays secure
- **No local server required**: Everything runs on Vercel
- **Automatic schema generation**: Extracts form structure with field types, descriptions, and enums
- **Date field detection**: Automatically identifies date fields and sets type to "date"
- **Enum detection**: Detects dropdown/select fields and includes enum arrays
- **Error handling**: Graceful error handling with user-friendly messages
- **Auto-naming**: Template name is auto-filled from PDF filename

## Usage

1. Navigate to Administration > Templates
2. Click "Import PDF Form"
3. Fill in template metadata (name, type, level, etc.)
4. Click "Import PDF Form" button next to "Template Data (JSON)" label
5. Select your PDF file
6. Wait for conversion (may take 30-60 seconds)
7. Review the generated JSON schema
8. Click "Import PDF Form" to save

## API Endpoint

**POST** `/api/documents/convert-pdf-to-json`

### Request Body (JSON)
```json
{
  "pdfBase64": "data:application/pdf;base64,JVBERi0xLjQK...",
  "schemaPath": null
}
```

### Response
```json
{
  "success": true,
  "data": {
    "Property_Details": {
      "Property_Address": {
        "type": "string",
        "required": false,
        "description": "Full address of the property"
      },
      ...
    },
    ...
  },
  "model": "gpt-4-turbo",
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801
  }
}
```

## Troubleshooting

### "OpenAI API key not configured" error
- Make sure `OPENAI_API_KEY` is set in Vercel environment variables
- Redeploy your application after adding the variable
- Check that the variable is available in the correct environment (Production/Preview/Development)

### PDF conversion fails
- Check Vercel function logs in the dashboard
- Ensure the PDF is not password-protected
- Try a different PDF file
- Check your OpenAI API quota/limits
- Verify the serverless function timeout is sufficient (default is 10s, can be increased to 60s)

### Slow conversion
- Large PDFs may take longer to process
- Network latency affects API response time
- Vercel serverless functions have a 10s timeout on Hobby plan (60s on Pro)
- Consider using Vercel Pro plan for longer timeouts if needed

### Function timeout
If conversions are timing out:
1. Upgrade to Vercel Pro plan (60s timeout)
2. Or optimize the PDF (reduce size/pages)
3. Or implement async processing with webhooks

## Local Development

For local development, you can use the dev server:

```bash
npm run dev:api
```

This runs the Express server on `http://localhost:3000` which mimics the Vercel serverless function behavior.

## Security Notes

- ✅ OpenAI API key is never exposed to the client
- ✅ All processing happens server-side
- ✅ CORS is configured for your domain
- ✅ File size limits can be configured in Vercel settings

