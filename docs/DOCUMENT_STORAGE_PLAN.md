# Document Storage & Application Processing Plan

## Overview

This document outlines the architecture and implementation strategy for integrating document storage and processing capabilities into the Salish Landmark property management system, with a focus on rental applications.

## Implementation Status

### ✅ Implemented (Current)

**PDF to JSON Schema Conversion** - For template import functionality:
- **Technology**: OpenAI Vision API (direct SDK) with pdf-parse fallback
- **Implementation**: 
  - Client-side: `pdfjs-dist` converts PDF pages to images
  - Server-side: `api/documents/convert-pdf-to-json.js` uses OpenAI Vision API
  - Fallback: `utils/pdf-to-json.js` uses `pdf-parse` for text-based extraction
- **Purpose**: Extract form structure from PDF templates to create JSON schemas
- **Status**: ✅ Fully implemented and in use
- **See**: `docs/VERCEL_PDF_IMPORT.md` for setup instructions

### 🚧 Future Development (Not Yet Implemented)

- Document storage system (Supabase Storage integration)
- Flexible application schema (JSONB field_data)
- Document processing pipeline (extracting data from filled forms)
- OCR capabilities (Tesseract.js or cloud services)
- Applicant portal and electronic signatures
- Advanced AI-powered extraction

---

## 1. Document Reading & Understanding

### ✅ Chosen Implementation: OpenAI Vision API with Text Fallback

**Decision**: We implemented a hybrid approach using OpenAI Vision API as primary method with pdf-parse as fallback.

**Current Implementation**:
- **Primary**: OpenAI Vision API (GPT-4-turbo) via direct OpenAI SDK
  - PDFs converted to images on client using `pdfjs-dist`
  - Images sent to OpenAI Vision API for structure extraction
  - Returns JSON schema of form fields
- **Fallback**: `pdf-parse` for text-based extraction
  - Used when vision approach fails or for text-only PDFs
  - Extracts text and sends to OpenAI for analysis

**Libraries Used**:
- `pdfjs-dist` (v5.4.394) - Client-side PDF to image conversion
- `openai` (v6.8.1) - Direct OpenAI SDK (not Vercel AI SDK)
- `pdf-parse` - Text extraction fallback
- `canvas` - Server-side image processing (if needed)

**Files**:
- `api/documents/convert-pdf-to-json.js` - Main serverless function
- `utils/pdf-to-json.js` - Utility with both vision and text methods
- `src/utils/pdf-to-json-client.js` - Client-side PDF to image conversion

**Why This Approach**:
- ✅ High accuracy for form structure extraction
- ✅ Handles both native PDFs and scanned documents (via vision)
- ✅ No additional cloud service dependencies (beyond OpenAI)
- ✅ Cost-effective for template import use case (~$0.01-0.03 per template)
- ✅ Works well with Vercel serverless functions

### Alternative Options (Not Chosen, Available for Future)

For reference, here are the other options that were considered:

#### Option A: **pdf-parse + Tesseract.js** (Not Chosen)
**Best for**: PDF text extraction and OCR on scanned documents

**Status**: ❌ Not implemented - We chose OpenAI Vision API instead

**Libraries**:
- `pdf-parse` - Extracts text from PDFs with native text layers (✅ Used as fallback)
- `tesseract.js` - OCR for scanned PDFs/images (❌ Not implemented)
- `pdf-lib` - PDF manipulation (for signatures, form filling) (❌ Not implemented)

**Pros**:
- Open source, free
- Works well with filled PDF forms
- Good for native text PDFs
- Can extract form field values

**Cons**:
- OCR accuracy varies
- May need additional parsing logic for different form layouts
- Slower processing for OCR

**Note**: We use `pdf-parse` as a fallback, but not Tesseract.js. OpenAI Vision API provides better OCR accuracy.

#### Option B: **Azure Form Recognizer / AWS Textract** (Not Chosen)
**Best for**: Production-grade accuracy with various form types

**Status**: ❌ Not implemented - Reserved for future Phase 6 if higher accuracy needed

**Services**: 
- **Microsoft Azure Form Recognizer** / Document Intelligence
- **AWS Textract** (similar capabilities)

**Vercel Integration**: ✅ **Fully compatible** - These services provide REST APIs that work perfectly with Vercel serverless functions. Simply make HTTP requests from your `/api/` route handlers.

**Note**: This option remains available for future implementation if we need higher accuracy for filled form extraction (beyond template structure extraction).

**Implementation Example**:
```javascript
// api/documents/process.js (Vercel serverless function)
export default async function handler(req, res) {
  const formData = new FormData();
  formData.append('file', req.body.file);
  
  // Call Azure Form Recognizer API
  const response = await fetch(
    'https://your-endpoint.cognitiveservices.azure.com/formrecognizer/...',
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_FORM_RECOGNIZER_KEY
      },
      body: formData
    }
  );
  
  const extractedData = await response.json();
  // Process and store in database
}
```

**Pros**:
- High accuracy (especially for structured forms)
- Supports custom models trained on your forms
- Handles signatures, checkboxes, tables
- Can extract key-value pairs automatically
- Works seamlessly with Vercel serverless functions
- Pay-per-use pricing model

**Cons**:
- Requires cloud service account (Azure or AWS)
- Costs per page processed (~$1.50 per 1,000 pages)
- External API dependency (but reliable)
- Requires API key management (use Vercel environment variables)

**Vercel Setup**:
1. Add API keys to Vercel environment variables (Dashboard → Settings → Environment Variables)
2. Call APIs from serverless functions in `/api/` directory
3. Process asynchronously for long-running operations
4. Consider using Vercel Cron Jobs or webhooks for background processing

**Complete Vercel Implementation Example**:
```javascript
// api/documents/process-azure.js
import { FormRecognizerClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get file from Supabase Storage (uploaded via separate endpoint)
    const { fileUrl } = req.body;
    
    // Initialize Azure client
    const client = new FormRecognizerClient(
      process.env.AZURE_FORM_RECOGNIZER_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_FORM_RECOGNIZER_KEY)
    );
    
    // Process document (async - may take longer than function timeout)
    const poller = await client.beginRecognizeContentFromUrl(fileUrl);
    const pages = await poller.pollUntilDone();
    
    // Extract structured data
    const extractedData = extractFields(pages);
    
    return res.status(200).json({ success: true, data: extractedData });
  } catch (error) {
    console.error('Azure processing error:', error);
    return res.status(500).json({ error: 'Processing failed', details: error.message });
  }
}

// For long-running operations, trigger async job:
// 1. Start processing and return job ID immediately
// 2. Poll job status from frontend
// 3. Or use webhook callback from Azure
```

#### Option C: **Vercel AI SDK + OpenAI Vision API** (Partially Chosen)
**Best for**: Understanding varied, unstructured application formats

**Status**: ⚠️ Similar approach chosen, but using direct OpenAI SDK instead of Vercel AI SDK

**What We Implemented**: Direct OpenAI SDK with Vision API (not Vercel AI SDK)
- We use `openai` package directly instead of `@ai-sdk/openai`
- Same Vision API capabilities, but without Vercel AI SDK wrapper
- Simpler implementation for our use case

**Vercel AI SDK Alternative** (Available for future):
```javascript
// Future option: Using Vercel AI SDK
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';

export default async function handler(req, res) {
  const documentImage = req.body.documentBase64;
  
  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: applicationSchema,
    prompt: `Extract rental application data from this document image: ${documentImage}`,
  });
  
  // object contains structured application data
}
```

**Pros of Our Current Approach**:
- ✅ Excellent at understanding context
- ✅ Can handle completely unstructured documents
- ✅ Natural language understanding
- ✅ Simpler implementation (direct SDK)
- ✅ Lower dependency count

**Cons**:
- More expensive per document (~$0.01-0.03 per document)
- Requires API key management (use Vercel env vars)
- Potential privacy concerns (data sent to AI provider)

**Note**: Vercel AI SDK could be adopted in the future for structured output extraction if needed.

### ✅ Current Implementation Strategy

**What We Built** (Template Import):
```javascript
// Current implementation flow:
1. User uploads PDF template → Client converts to images (pdfjs-dist)
2. Images sent to serverless function → OpenAI Vision API
3. GPT-4 analyzes form structure → Returns JSON schema
4. Schema stored in template_data (JSONB) for form configuration
```

**Implementation Files**:
- `api/documents/convert-pdf-to-json.js` - Main serverless function
- `utils/pdf-to-json.js` - Utility with vision/text methods
- `src/utils/pdf-to-json-client.js` - Client-side PDF conversion

### 🚧 Future Implementation Strategy (Not Yet Built)

**For Document Processing** (extracting data from filled forms):
```javascript
// Future document processing pipeline:
1. Upload document → Store in Supabase Storage
2. Detect document type (PDF, image, etc.)
3. Extract text/data:
   - Primary: OpenAI Vision API (current approach)
   - Fallback: pdf-parse for text extraction
   - Future: Tesseract.js for OCR if needed
4. Parse structured data using:
   - Form field mapping (using template schema)
   - AI/ML model (for unknown formats)
5. Store extracted data in flexible schema (JSONB field_data)
6. Associate original document with extracted data
```

**Future Phases**:
1. **Phase 1**: Basic document storage (Supabase Storage)
2. **Phase 2**: Flexible application schema (JSONB field_data)
3. **Phase 3**: Document processing pipeline (extract filled form data)
4. **Phase 4**: OCR capabilities (Tesseract.js or cloud services)
5. **Phase 5**: Applicant portal and electronic signatures
6. **Phase 6**: Advanced processing (Azure/AWS if higher accuracy needed)

---

## 2. Document Storage Strategy

### Recommended: **Hybrid Approach - Supabase Storage + Database References**

Since you're already using Supabase, leverage **Supabase Storage** for files with database references.

#### Architecture

```
┌─────────────────┐
│   Documents      │  →  Supabase Storage (S3-compatible)
│   (PDFs, Images) │      - Original application PDFs
│                  │      - Scanned documents
│                  │      - Signed documents
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  Database       │  →  PostgreSQL (Supabase)
│  - References   │      - File metadata
│  - Metadata     │      - Storage paths
│  - Extracted    │      - Extracted field data
│    Field Data   │      - Associations
└─────────────────┘
```

#### Implementation Details

**Supabase Storage Buckets**:
```
storage/
  ├── applications/        # Rental application documents
  │   ├── {application_id}/
  │   │   ├── original.pdf
  │   │   └── signed.pdf (if different)
  ├── leases/             # Lease documents
  ├── maintenance/        # Maintenance documentation
  └── general/            # Other documents
```

**Database Tables**:
```sql
-- Documents table
CREATE TABLE documents (
  document_id SERIAL PRIMARY KEY,
  documentable_id INTEGER NOT NULL,  -- Links to application, lease, etc.
  documentable_type VARCHAR(50) NOT NULL,  -- 'application', 'lease', etc.
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,  -- Path in Supabase Storage
  file_type VARCHAR(50),  -- 'application/pdf', 'image/png', etc.
  file_size BIGINT,  -- in bytes
  mime_type VARCHAR(100),
  uploaded_by_user_id INTEGER REFERENCES users(user_id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  document_type VARCHAR(100),  -- 'application_form', 'id', 'proof_of_income', etc.
  is_signed BOOLEAN DEFAULT false,
  signed_at TIMESTAMP,
  metadata JSONB  -- Additional metadata (extraction confidence, processing status, etc.)
);

-- Index for efficient queries
CREATE INDEX idx_documents_documentable ON documents(documentable_id, documentable_type);
CREATE INDEX idx_documents_type ON documents(document_type);
```

**Why This Approach?**
- ✅ **Cost-effective**: Supabase Storage is affordable (similar to S3 pricing)
- ✅ **Integrated**: Works seamlessly with your existing Supabase setup
- ✅ **Scalable**: Handles large files efficiently
- ✅ **Secure**: Built-in access control and RLS (Row Level Security)
- ✅ **CDN-ready**: Supabase can serve files via CDN
- ✅ **Backup-friendly**: Database references allow easy backup/restore

**Alternative Considerations**:

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Supabase Storage** ✅ | Integrated, cost-effective, secure | Vendor lock-in | **Recommended** |
| **AWS S3** | Industry standard, very scalable | Additional service, cost | Good for scale |
| **Database BLOB** | Simple, all-in-one | Poor performance, DB bloat | ❌ Not recommended |
| **Local File System** | Simple | Not scalable, backup issues | ❌ Not for production |

---

## 3. Flexible Application Schema (Key-Value Storage)

### Recommended: **EAV (Entity-Attribute-Value) Pattern + JSONB Hybrid**

For rental applications with varying fields, we'll use a hybrid approach:

1. **Common fields** in structured columns (for performance)
2. **Variable fields** in JSONB (for flexibility)
3. **Field definitions** table (for form configuration)

#### Database Schema

```sql
-- Application form templates (defines what fields exist)
CREATE TABLE application_form_templates (
  template_id SERIAL PRIMARY KEY,
  landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE SET NULL,
  property_id INTEGER REFERENCES properties(property_id) ON DELETE SET NULL,
  template_name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  form_config JSONB NOT NULL,  -- Defines all fields, validation rules, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Example form_config structure:
-- {
--   "fields": [
--     {"name": "first_name", "label": "First Name", "type": "text", "required": true},
--     {"name": "annual_income", "label": "Annual Income", "type": "number", "required": true},
--     {"name": "pets", "label": "Do you have pets?", "type": "boolean", "required": false},
--     {"name": "references", "label": "References", "type": "array", "fields": [...]}
--   ],
--   "sections": [...],
--   "validation": {...}
-- }

-- Applications with flexible data storage
CREATE TABLE applications (
  application_id SERIAL PRIMARY KEY,
  applicant_id INTEGER REFERENCES applicants(applicant_id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(unit_id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES application_form_templates(template_id) ON DELETE SET NULL,
  
  -- Common fields (for performance and common queries)
  status VARCHAR(50) DEFAULT 'pending',  -- pending, approved, rejected, withdrawn
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  notes TEXT,  -- Admin notes
  
  -- Flexible field storage (all form-specific data)
  field_data JSONB NOT NULL DEFAULT '{}',  -- All extracted/entered form data
  
  -- Metadata
  submission_method VARCHAR(50),  -- 'manual_entry', 'pdf_upload', 'portal', 'api'
  processing_status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, error
  processing_error TEXT,
  extraction_confidence DECIMAL(5,2),  -- 0-100, if extracted from document
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient queries and search
CREATE INDEX idx_applications_applicant ON applications(applicant_id);
CREATE INDEX idx_applications_unit ON applications(unit_id);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_field_data ON applications USING GIN(field_data);  -- JSONB GIN index for fast queries

-- Application documents junction (links documents to applications)
-- Already have documents table above, but create explicit junction if needed
-- (Actually, documents table handles this via documentable_id/type)

-- Example queries with JSONB:
-- Find applications with annual income > $50,000
SELECT * FROM applications 
WHERE (field_data->>'annual_income')::numeric > 50000;

-- Find applications with pets
SELECT * FROM applications 
WHERE field_data->>'has_pets' = 'true';

-- Full-text search across all fields
SELECT * FROM applications 
WHERE field_data::text ILIKE '%search term%';
```

#### Example Field Data Structure

```json
{
  "personal_information": {
    "first_name": "John",
    "last_name": "Doe",
    "middle_name": "Michael",
    "date_of_birth": "1990-05-15",
    "ssn": "***-**-1234",  // Partially masked for security
    "phone": "+1-555-123-4567",
    "email": "john.doe@email.com"
  },
  "address": {
    "current_address": {
      "street": "123 Main St",
      "city": "Seattle",
      "state": "WA",
      "zip": "98101",
      "years_at_address": 3
    },
    "previous_address": { ... }
  },
  "employment": {
    "employer_name": "Tech Corp",
    "job_title": "Software Engineer",
    "annual_income": 95000,
    "years_employed": 2.5,
    "supervisor_name": "Jane Smith",
    "supervisor_phone": "+1-555-987-6543",
    "supervisor_email": "jane.smith@techcorp.com"
  },
  "references": [
    {
      "name": "Previous Landlord",
      "relationship": "landlord",
      "phone": "+1-555-111-2222",
      "years_known": 2
    },
    {
      "name": "Personal Reference",
      "relationship": "friend",
      "phone": "+1-555-333-4444",
      "years_known": 5
    }
  ],
  "additional_info": {
    "has_pets": true,
    "pet_count": 2,
    "pet_types": ["dog", "cat"],
    "smoking": false,
    "vehicles": 1,
    "parking_needed": true,
    "move_in_date": "2024-06-01",
    "lease_duration_preference": "12 months"
  },
  "signatures": {
    "applicant_signature": {
      "signed": true,
      "signed_at": "2024-03-15T10:30:00Z",
      "signature_method": "electronic",  // or "physical"
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0..."
    },
    "co_applicant_signature": { ... }
  },
  "metadata": {
    "extracted_fields": ["first_name", "last_name", "email", ...],  // Fields auto-extracted
    "manually_entered_fields": ["notes", "special_requests"],  // Fields entered by admin
    "extraction_confidence": 87.5,
    "form_version": "1.2",
    "submission_id": "app_abc123xyz"
  }
}
```

#### Benefits of This Approach

1. **Flexible**: Can store any field structure without schema changes
2. **Searchable**: JSONB indexes allow fast queries on nested data
3. **Performant**: Common fields in columns, variable fields in JSONB
4. **Type-safe**: Can validate against form template
5. **Versionable**: Form templates can evolve without data migration
6. **Searchable**: Full-text search across all fields

---

## Vercel-Specific Implementation Patterns

### Pattern 1: Direct API Processing (Fast Documents)
Use for documents that process quickly (< 10s):
```javascript
// api/documents/upload-and-process.js
export default async function handler(req, res) {
  // 1. Upload to Supabase Storage
  // 2. Process immediately
  // 3. Return results
}
```

### Pattern 2: Async Job Queue (Long-Running)
Use for documents that may exceed function timeout:
```javascript
// api/documents/upload.js - Returns immediately
export default async function handler(req, res) {
  // 1. Upload to Supabase Storage
  // 2. Create job record in database
  // 3. Trigger background processing (webhook/cron)
  // 4. Return job ID immediately
}

// api/documents/process-background.js - Called via webhook or cron
export default async function handler(req, res) {
  // 1. Get pending jobs from database
  // 2. Process each document
  // 3. Update database with results
  // 4. Notify frontend (webhook or polling)
}
```

### Pattern 3: Vercel Edge Functions (Fast Response)
Use for lightweight processing that needs low latency:
```javascript
// api/documents/extract-quick.edge.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Fast, lightweight extraction
  // Limited to edge runtime capabilities
}
```

### Recommended Pattern for This Project
**Hybrid Approach**:
- Small PDFs (< 2MB): Process synchronously in serverless function
- Large PDFs or OCR needed: Upload → Queue → Process → Notify
- Use Supabase Realtime or polling to update frontend when processing completes

## Implementation Roadmap

### ✅ Completed: PDF Template Import
- [x] PDF to JSON schema conversion (OpenAI Vision API)
- [x] Client-side PDF to image conversion (pdfjs-dist)
- [x] Serverless function for template import (`api/documents/convert-pdf-to-json.js`)
- [x] Text-based fallback (pdf-parse)
- [x] Template schema storage in database (template_data JSONB)

### 🚧 Phase 1: Basic Document Storage (Not Yet Implemented)
- [ ] Set up Supabase Storage buckets
- [ ] Create `documents` table
- [ ] Create API endpoints for file upload
- [ ] Frontend file upload component
- [ ] Basic document listing/viewing

### 🚧 Phase 2: Flexible Application Schema (Not Yet Implemented)
- [ ] Create `application_form_templates` table
- [ ] Create `applications` table with JSONB field_data
- [ ] Create template management UI
- [ ] Update application creation to use flexible schema
- [ ] Add JSONB indexes for performance

### 🚧 Phase 3: Document Processing - Basic (Not Yet Implemented)
- [x] Integrate `pdf-parse` for text extraction (✅ Already done as fallback)
- [ ] Create document processing pipeline (for filled forms, not just templates)
- [ ] Build form field mapping system
- [ ] Extract common fields from filled PDFs
- [ ] Store extracted data in field_data JSONB

### 🚧 Phase 4: Document Processing - Advanced (Not Yet Implemented)
- [ ] Integrate OCR (Tesseract.js) for scanned PDFs (or continue using OpenAI Vision)
- [ ] Add document type detection
- [ ] Implement confidence scoring
- [ ] Create admin review interface for extracted data
- [ ] Add manual correction workflow

### 🚧 Phase 5: Portal & Electronic Signatures (Not Yet Implemented)
- [ ] Build applicant portal for form submission
- [ ] Integrate electronic signature library
- [ ] Generate PDF forms from templates
- [ ] Store signed documents
- [ ] Email notifications

### 🚧 Phase 6: Advanced Processing (Future)
- [ ] Evaluate Azure Form Recognizer integration (if higher accuracy needed)
- [ ] Train custom models for specific form types
- [ ] Add AI-powered field extraction (enhance current OpenAI approach)
- [ ] Implement automatic form matching

---

## Technology Stack Summary

### ✅ Currently Installed Packages

```json
{
  "dependencies": {
    // ✅ Implemented - Document Processing
    "openai": "^6.8.1",           // Direct OpenAI SDK (Vision API)
    "pdfjs-dist": "^5.4.394",     // Client-side PDF to image conversion
    "pdf-parse": "^1.1.1",        // Text extraction fallback
    "canvas": "^3.2.0",           // Server-side image processing (if needed)
    
    // ✅ Already have:
    "@supabase/supabase-js": "^2.75.0",  // For storage (future)
    "postgres": "^3.4.7"                 // Database
  }
}
```

### 🚧 Future Packages (Not Yet Installed)

```json
{
  "dependencies": {
    // Future - OCR (if needed beyond OpenAI Vision)
    "tesseract.js": "^5.0.0",
    
    // Future - PDF manipulation
    "pdf-lib": "^1.17.1",
    
    // Future - Vercel AI SDK (optional alternative)
    "ai": "^3.0.0",              // Vercel AI SDK
    "@ai-sdk/openai": "^1.0.0",  // OpenAI provider
    
    // Note: For Vercel serverless functions, use built-in FormData
    // No multer needed - Vercel handles file uploads differently
  }
}
```

**Important Vercel Considerations**:
- **Function Timeouts**: Hobby plan = 10s, Pro = 60s, Enterprise = up to 900s
- **File Size Limits**: Max 4.5MB request body (use Supabase Storage for larger files)
- **Memory Limits**: Hobby = 1024MB, Pro = 3008MB per function
- **Cold Starts**: Consider edge functions for faster response times

**For Large File Processing**:
1. Upload file to Supabase Storage first
2. Trigger async processing via:
   - Vercel Cron Jobs (for scheduled processing)
   - Webhook from Supabase Storage trigger
   - Queue system (consider Vercel's integration with Upstash or similar)

### Supabase Storage Setup

```javascript
// Supabase storage bucket creation (run once)
// Via Supabase dashboard or API:
// 1. Create bucket: "documents"
// 2. Set policies:
//    - Public read for signed URLs
//    - Authenticated write for uploads
//    - Row Level Security based on document ownership
```

---

## Security Considerations

1. **File Upload Security**:
   - Validate file types and sizes
   - Virus scanning (optional: ClamAV or cloud service)
   - Sanitize file names
   - Limit upload size (e.g., 10MB max)

2. **Data Privacy**:
   - Encrypt sensitive fields (SSN, financial data)
   - Mask sensitive data in logs
   - Audit trail for document access
   - GDPR compliance for document retention

3. **Access Control**:
   - Row Level Security (RLS) in Supabase
   - Role-based document access
   - Signed URLs for document access (time-limited)

---

## Cost Estimates

### Supabase Storage
- First 1GB: Free
- $0.021/GB/month thereafter
- Typical application PDF: ~500KB
- 2,000 applications/month ≈ 1GB ≈ $0.021/month

### Processing Costs (Vercel + Services)

**Processing** (Current Implementation):
- **OpenAI Vision API**: ~$0.01-0.03 per template (GPT-4-turbo with vision)
- **pdf-parse**: Free (used as fallback, runs in serverless function)
- **pdfjs-dist**: Free (client-side, no server cost)

**Future Processing Options**:
- **Tesseract.js**: Free (runs in serverless function, but watch memory/time)
- **Azure Form Recognizer**: $1.50 per 1,000 pages (API calls from Vercel)
- **AWS Textract**: $1.50 per 1,000 pages (API calls from Vercel)

**Vercel Hosting**:
- **Hobby**: Free (10s function timeout, 100GB bandwidth)
- **Pro**: $20/month (60s timeout, better performance)
- **Enterprise**: Custom pricing (up to 900s timeout)

**Current Cost**: ~$0.01-0.03 per template import (OpenAI Vision API). Very cost-effective for template import use case.

---

## Recommended Next Steps

### ✅ Completed
1. ✅ PDF template import functionality (extract form structure from PDFs)
2. ✅ OpenAI Vision API integration
3. ✅ Template schema storage in database

### 🚧 Next Steps (Future Development)

1. **Phase 1**: Implement basic document storage (Supabase Storage)
2. **Phase 2**: Build flexible application schema (JSONB field_data)
3. **Phase 3**: Create document processing pipeline (extract data from filled forms)
4. **Test with sample documents**: Upload and store 10-20 real application PDFs
5. **Design form templates**: Work with stakeholders to define common fields
6. **Build MVP**: Get complete flow working end-to-end (upload → extract → store)

---

## Questions to Resolve

1. **Maximum file size**: What's the largest document we expect? (Recommendation: 10MB)
2. **Retention policy**: How long should we keep documents? (Legal requirement?)
3. **Backup strategy**: How frequently should documents be backed up?
4. **Form standardization**: Can we standardize on 2-3 form templates, or do we need complete flexibility?
5. **Real-time processing**: Do documents need to be processed immediately, or can we queue them?

---

## References

### ✅ Current Implementation
- [OpenAI Vision API Documentation](https://platform.openai.com/docs/guides/vision)
- [pdfjs-dist Documentation](https://mozilla.github.io/pdf.js/)
- [pdf-parse Documentation](https://github.com/mozilla/pdf.js)
- [Vercel PDF Import Setup](./VERCEL_PDF_IMPORT.md) - Our implementation guide

### 🚧 Future Development
- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [PostgreSQL JSONB Documentation](https://www.postgresql.org/docs/current/datatype-json.html)
- [Tesseract.js Documentation](https://tesseract.projectnaptha.com/)
- [Azure Form Recognizer](https://azure.microsoft.com/en-us/products/ai-services/form-recognizer)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)

