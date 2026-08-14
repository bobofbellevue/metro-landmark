# Document Storage & Processing Implementation Plan

## Overview

This plan outlines the implementation of document storage and processing capabilities for the Salish Landmark property management system. The system already supports PDF template import (blank forms converted to JSON schemas stored in `templates.template_data` JSONB). This plan extends that capability to handle filled documents, document generation, and electronic signatures.

## Current Implementation Status

### ✅ Already Implemented

1. **Template Import System**:
   - PDF to JSON schema conversion using OpenAI Vision API
   - Templates stored in `templates` table with `template_data` JSONB column
   - Supports both Application and Lease template types
   - Template management UI exists
   - See `docs/VERCEL_PDF_IMPORT.md` for details

2. **Template Storage**:
   - `templates` table with `template_data` JSONB (already exists)
   - Template types: 'Application', 'Lease'
   - Template levels: 'system', 'company', 'landlord'

### 🚧 Not Yet Implemented

- Document storage system (file storage)
- Processing filled forms (extracting data from completed documents)
- Document generation (creating PDFs from templates with data)
- Electronic signatures
- Document management UI

---

## Implementation Phases

### Phase 1: Document Storage System

**Goal**: Store uploaded documents (filled applications, signed leases, notices, etc.) in Supabase Storage with database references.

**What to Build**:

1. **Database Schema**:
   ```sql
   CREATE TABLE documents (
     document_id SERIAL PRIMARY KEY,
     documentable_id INTEGER NOT NULL,  -- Links to application, lease, notice, etc.
     documentable_type VARCHAR(50) NOT NULL,  -- 'application', 'lease', 'legal_notice', etc.
     file_name VARCHAR(255) NOT NULL,
     file_path TEXT NOT NULL,  -- Path in Supabase Storage
     file_type VARCHAR(50),  -- 'application/pdf', 'image/png', etc.
     file_size BIGINT,  -- in bytes
     mime_type VARCHAR(100),
     uploaded_by_user_id INTEGER REFERENCES users(user_id),
     uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     document_type VARCHAR(100),  -- 'filled_application', 'signed_lease', 'rent_increase_notice', etc.
     is_signed BOOLEAN DEFAULT false,
     signed_at TIMESTAMP,
     signed_by_user_id INTEGER REFERENCES users(user_id),
     signature_metadata JSONB,  -- IP address, user agent, timestamp, signature method
     metadata JSONB,  -- Additional metadata (extraction confidence, processing status, etc.)
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   CREATE INDEX idx_documents_documentable ON documents(documentable_id, documentable_type);
   CREATE INDEX idx_documents_type ON documents(document_type);
   CREATE INDEX idx_documents_signed ON documents(is_signed, signed_at);
   ```

2. **Supabase Storage Setup**:
   - Create storage buckets: `documents/` (single bucket with folder structure)
   - Folder structure: `documents/{documentable_type}/{documentable_id}/{file_name}`
   - Configure Row Level Security (RLS) policies
   - Set up signed URLs for secure document access (time-limited)

3. **API Endpoints** (Vercel serverless functions):
   - `POST /api/documents/upload` - Upload documents to Supabase Storage
   - `GET /api/documents/:id` - Retrieve document metadata
   - `GET /api/documents/:id/download` - Get signed URL for document download
   - `DELETE /api/documents/:id` - Delete document and storage file
   - `GET /api/documents?documentable_type=X&documentable_id=Y` - List documents for an entity

4. **Frontend Components**:
   - File upload component with drag-and-drop support
   - Document listing/viewing interface
   - Document preview (for PDFs and images)
   - File type validation and size limits (recommend 10MB max)

5. **Security**:
   - Validate file types (PDF, images, documents)
   - Sanitize file names
   - Implement access control based on user roles
   - Use signed URLs for secure document access

**Reference**: `docs/DOCUMENT_STORAGE_PLAN.md` section "Document Storage Strategy"

---

### Phase 2: Filled Form Processing

**Goal**: Extract data from filled application and lease forms using existing template schemas.

**What to Build**:

1. **Processing Pipeline**:
   - Use existing OpenAI Vision API approach (same as template import)
   - Match uploaded filled form to appropriate template
   - Extract field values using template schema as guide
   - Store extracted data in appropriate table

2. **Database Schema Updates**:
   ```sql
   -- For applications (if not already exists with field_data)
   -- Add field_data JSONB column to store extracted form data
   ALTER TABLE application_units 
   ADD COLUMN IF NOT EXISTS field_data JSONB DEFAULT '{}';
   
   -- Add processing metadata
   ALTER TABLE application_units
   ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'pending',
   ADD COLUMN IF NOT EXISTS processing_error TEXT,
   ADD COLUMN IF NOT EXISTS extraction_confidence DECIMAL(5,2),
   ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES templates(template_id);

   CREATE INDEX IF NOT EXISTS idx_application_units_field_data 
   ON application_units USING GIN(field_data);
   ```

3. **API Endpoints**:
   - `POST /api/documents/:id/process` - Trigger document processing
   - `GET /api/documents/:id/processing-status` - Check processing status
   - `POST /api/documents/:id/extract` - Manually trigger extraction

4. **Processing Logic**:
   - Upload filled form → Store in documents table
   - Identify template type (Application or Lease)
   - Use OpenAI Vision API to extract field values
   - Map extracted values to template schema
   - Store in `field_data` JSONB column
   - Link document to application/lease record

5. **Admin Review Interface**:
   - UI for reviewing extracted data
   - Allow manual correction of extracted fields
   - Track which fields were auto-extracted vs manually entered
   - Show confidence scores

**Note**: Uses existing `api/documents/convert-pdf-to-json.js` pattern, but extracts values instead of schema structure.

---

### Phase 3: Document Generation

**Goal**: Generate PDF documents (leases, renewals, notices) from templates with populated data.

**What to Build**:

1. **PDF Generation Library**:
   - Use `pdf-lib` for PDF creation and manipulation
   - Generate PDFs from template schemas stored in `templates.template_data`
   - Populate fields with data from database records

2. **Document Types to Support**:
   - **Leases**: Generate from lease template with tenant/property data
   - **Lease Renewals**: Generate renewal documents
   - **Legal Notices**:
     - Rent increase notices
     - Eviction process notices
     - Other legal notices as needed

3. **API Endpoints**:
   - `POST /api/documents/generate/lease` - Generate lease document
   - `POST /api/documents/generate/renewal` - Generate renewal document
   - `POST /api/documents/generate/notice` - Generate legal notice
   - All endpoints return document_id for the generated PDF

4. **Generation Logic**:
   - Select appropriate template based on type and level (system/company/landlord)
   - Fetch data from database (lease details, tenant info, property info, etc.)
   - Map data to template schema
   - Generate PDF using pdf-lib
   - Store generated PDF in Supabase Storage
   - Create document record in `documents` table
   - Link to appropriate entity (lease_id, etc.)

5. **Frontend Components**:
   - "Generate Document" buttons in relevant pages (Leases, etc.)
   - Document preview before generation
   - Download generated documents
   - Regenerate with updated data

**Reference**: `docs/DOCUMENT_STORAGE_PLAN.md` for PDF generation patterns

---

### Phase 4: Electronic Signatures

**Goal**: Support electronic signatures for managers, landlords, tenants, and applicants on generated documents.

**What to Build**:

1. **Signature Library**:
   - Use `pdf-lib` for adding signatures to PDFs
   - Use `signature_pad` or similar for signature capture UI
   - Store signature images/metadata

2. **Database Schema Updates**:
   ```sql
   -- Add signature tracking to documents table (already included in Phase 1)
   -- Additional table for signature records
   CREATE TABLE document_signatures (
     signature_id SERIAL PRIMARY KEY,
     document_id INTEGER NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
     signer_user_id INTEGER NOT NULL REFERENCES users(user_id),
     signer_role VARCHAR(50) NOT NULL,  -- 'manager', 'landlord', 'tenant', 'applicant'
     signature_image TEXT,  -- Base64 encoded signature image
     signature_method VARCHAR(50) DEFAULT 'electronic',  -- 'electronic', 'physical'
     signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     ip_address INET,
     user_agent TEXT,
     metadata JSONB  -- Additional signature metadata
   );

   CREATE INDEX idx_document_signatures_document ON document_signatures(document_id);
   CREATE INDEX idx_document_signatures_signer ON document_signatures(signer_user_id);
   ```

3. **Signature Workflow**:
   - Document generated → Sent to signers
   - Each signer views document and adds signature
   - Signature captured via UI (draw, type, or upload image)
   - Signature added to PDF using pdf-lib
   - Updated PDF stored in Supabase Storage
   - Signature record created in `document_signatures` table
   - Document marked as signed when all required signatures collected

4. **API Endpoints**:
   - `POST /api/documents/:id/sign` - Add signature to document
   - `GET /api/documents/:id/signatures` - Get all signatures for document
   - `GET /api/documents/:id/signature-status` - Check if document is fully signed

5. **Frontend Components**:
   - Signature capture component (draw, type, or upload)
   - Document signing interface
   - Signature status indicators
   - "Sign Document" buttons in relevant pages
   - Signature history/viewing

6. **Access Control**:
   - Managers can sign on behalf of company
   - Landlords can sign their own documents
   - Tenants can sign documents related to their leases
   - Applicants can sign their application documents
   - Enforce role-based signing permissions

7. **Email Notifications**:
   - Notify signers when document is ready for signature
   - Notify all parties when document is fully signed
   - Send signed document copies to all parties

**Reference**: `docs/DOCUMENT_STORAGE_PLAN.md` section "Portal & Electronic Signatures"

---

### Phase 5: Document Management UI

**Goal**: Complete UI for managing all documents across the system.

**What to Build**:

1. **Document List Views**:
   - Documents by type (applications, leases, notices)
   - Documents by entity (all documents for a lease, application, etc.)
   - Search and filter capabilities
   - Sort by date, type, status, etc.

2. **Document Actions**:
   - View/download documents
   - Delete documents (with permissions)
   - Regenerate documents
   - Re-sign documents if needed
   - Upload additional documents

3. **Integration Points**:
   - Documents tab in Applications page
   - Documents tab in Leases page
   - Documents section in Tenant portal
   - Documents section in Applicant portal
   - Admin document management page

4. **Status Indicators**:
   - Signed/unsigned status
   - Processing status (for filled forms)
   - Signature completion status
   - Document type badges

---

## Implementation Order & Dependencies

1. **Phase 1** (Document Storage) - Foundation, no dependencies
2. **Phase 2** (Filled Form Processing) - Depends on Phase 1
3. **Phase 3** (Document Generation) - Depends on Phase 1, uses existing templates
4. **Phase 4** (Electronic Signatures) - Depends on Phase 1 and Phase 3
5. **Phase 5** (Document Management UI) - Depends on all previous phases

---

## Technology Stack

### Already Installed
- `openai` (v6.8.1) - For document processing
- `pdfjs-dist` (v5.4.394) - Client-side PDF handling
- `pdf-parse` - Text extraction
- `@supabase/supabase-js` - Storage and database

### To Install
- `pdf-lib` - PDF generation and signature manipulation
- `signature_pad` or similar - Signature capture UI

---

## Key Differences from Original Plan

1. **Removed**: Template processing (already implemented)
2. **Removed**: Separate application_form_templates table (using existing `templates` table)
3. **Removed**: OCR with Tesseract.js (OpenAI Vision API handles this)
4. **Removed**: Azure/AWS form recognizer (not needed with current approach)
5. **Added**: Document generation for leases and notices
6. **Expanded**: Electronic signatures for all user types (not just applicants)
7. **Simplified**: Focus on practical implementation vs. theoretical options

---

## Future Enhancements (Optional)

- Automatic form matching (suggest template for uploaded form)
- Batch document processing
- Document versioning
- Advanced OCR if OpenAI Vision API insufficient
- Integration with external document services
- Document templates for additional notice types

---

## References

- `docs/DOCUMENT_STORAGE_PLAN.md` - Detailed architecture and patterns
- `docs/VERCEL_PDF_IMPORT.md` - Current template import implementation
- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [pdf-lib Documentation](https://pdf-lib.js.org/)
- [OpenAI Vision API Documentation](https://platform.openai.com/docs/guides/vision)

