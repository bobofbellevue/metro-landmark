# Service & Library Choices in Product Completion Plan

This document lists all third-party services, libraries, and technology choices mentioned in the Product Completion Plan and its referenced documents.

---

## 1. Voice AI Platform

### Vapi.ai
- **Location**: Section 1 - Maintenance Voice Bot
- **Purpose**: Voice phone bot functionality for maintenance requests
- **Usage**: Integrate with Vapi.ai platform for voice AI capabilities
- **Cost Target**: ~$0.30-0.60 per phone call (3-5 minutes average)
- **Status**: Not yet implemented

---

## 2. Email Services

### SendGrid (Recommended)
- **Location**: Section 5.1 - Notification Preferences
- **Purpose**: Email notification delivery
- **Usage**: Integrate SendGrid (recommended for Vercel)
- **Status**: Not yet implemented

### AWS SES (Alternative)
- **Location**: Section 5.1 - Notification Preferences
- **Purpose**: Email notification delivery (alternative to SendGrid)
- **Usage**: Integrate AWS SES as alternative email service
- **Status**: Not yet implemented

---

## 3. SMS Services

### Twilio
- **Location**: Section 5.1 - Notification Preferences
- **Purpose**: SMS notification delivery
- **Usage**: Integrate Twilio (optional)
- **Status**: Not yet implemented

---

## 4. AI/ML Services

### OpenAI (GPT-4)
- **Location**: Multiple sections
- **Purpose**: Various AI-powered features
- **Usage**:
  - **Section 4 - Chatbot Lessons System**: Generate lessons using GPT-4
  - **Section 8 - Vendor Finding**: Primary method - Use OpenAI to analyze website HTML/content and extract structured vendor data
  - **Document Storage**: OpenAI Vision API for PDF processing (already implemented)
- **Status**: Partially implemented (Vision API), GPT-4 for lessons not yet implemented

### OpenAI Vision API
- **Location**: Document Storage System (referenced)
- **Purpose**: PDF to JSON schema conversion, document processing
- **Usage**: Already implemented for template import
- **Status**: ✅ Implemented

---

## 5. Web Scraping Libraries

### Puppeteer
- **Location**: Section 8 - Vendor Finding Feature
- **Purpose**: Web scraping for dynamic websites
- **Usage**: Fallback method for vendor finding - Web scraping with Puppeteer for dynamic sites
- **Status**: Not yet implemented

### Playwright
- **Location**: Section 8 - Vendor Finding Feature
- **Purpose**: Web scraping for dynamic websites (alternative to Puppeteer)
- **Usage**: Fallback method for vendor finding - Web scraping with Playwright for dynamic sites
- **Status**: Not yet implemented

### Cheerio
- **Location**: Section 8 - Vendor Finding Feature
- **Purpose**: Web scraping for static HTML websites
- **Usage**: Fallback method for vendor finding - Cheerio for static HTML
- **Status**: Not yet implemented

---

## 6. PDF Processing Libraries

### pdf-lib
- **Location**: Multiple sections
- **Purpose**: PDF generation and manipulation
- **Usage**:
  - **Section 9 - Lease Templates Integration**: Generate PDF using pdf-lib
  - **Document Storage Phase 3**: PDF creation and manipulation for document generation
  - **Document Storage Phase 4**: Adding signatures to PDFs
- **Status**: Not yet implemented

### pdf-parse
- **Location**: Document Storage System (referenced)
- **Purpose**: Text extraction from PDFs
- **Usage**: Already implemented as fallback for PDF text extraction
- **Status**: ✅ Implemented

### pdfjs-dist
- **Location**: Document Storage System (referenced)
- **Purpose**: Client-side PDF to image conversion
- **Usage**: Already implemented for client-side PDF processing
- **Status**: ✅ Implemented

---

## 7. Signature Libraries

### signature_pad
- **Location**: Document Storage Phase 4 (referenced)
- **Purpose**: Signature capture UI
- **Usage**: Use signature_pad or similar for signature capture UI
- **Status**: Not yet implemented

---

## 8. Cloud Services (Not Chosen / Alternatives)

### Azure Form Recognizer / Document Intelligence
- **Location**: Document Storage Plan (referenced, but not chosen)
- **Purpose**: High-accuracy form extraction
- **Usage**: ❌ Not chosen - OpenAI Vision API selected instead
- **Status**: Not implemented (explicitly rejected)

### AWS Textract
- **Location**: Document Storage Plan (referenced, but not chosen)
- **Purpose**: High-accuracy form extraction
- **Usage**: ❌ Not chosen - OpenAI Vision API selected instead
- **Status**: Not implemented (explicitly rejected)

### Tesseract.js
- **Location**: Document Storage Plan (referenced, but not chosen)
- **Purpose**: OCR for scanned PDFs/images
- **Usage**: ❌ Not implemented - OpenAI Vision API provides better OCR accuracy
- **Status**: Not implemented (explicitly rejected)

---

## 9. Third-Party API Services (Mentioned as Alternatives)

### Clearbit
- **Location**: Product Completion Plan Review (mentioned as alternative)
- **Purpose**: Vendor data extraction
- **Usage**: Mentioned as potential third-party API service for vendor finding
- **Status**: Not chosen (OpenAI approach preferred)

### FullContact
- **Location**: Product Completion Plan Review (mentioned as alternative)
- **Purpose**: Vendor data extraction
- **Usage**: Mentioned as potential third-party API service for vendor finding
- **Status**: Not chosen (OpenAI approach preferred)

---

## 10. Platform Services

### Vercel Cron Jobs
- **Location**: Section 5.1 - Notification Preferences
- **Purpose**: Scheduled job processing for notification digests
- **Usage**: Use Vercel Cron Jobs to process digest queue (daily at 8am, weekly on Monday)
- **Status**: Not yet implemented

### Supabase Storage
- **Location**: Section 2 - Document Storage System
- **Purpose**: File storage for documents
- **Usage**: Store uploaded documents in Supabase Storage
- **Status**: Not yet implemented (but Supabase is already in use)

### Supabase Realtime
- **Location**: Section 7 - Audit Logging System
- **Purpose**: Real-time notifications for critical changes
- **Usage**: Real-time notifications via Supabase Realtime (optional)
- **Status**: Not yet implemented

---

## 11. Web Push API
- **Location**: Section 5.1 - Notification Preferences
- **Purpose**: Browser push notifications
- **Usage**: Web Push API via service worker (optional)
- **Status**: Not yet implemented

---

## Summary by Category

### Communication Services
- **Email**: SendGrid (recommended) or AWS SES
- **SMS**: Twilio
- **Voice**: Vapi.ai
- **Push**: Web Push API

### AI/ML Services
- **Primary**: OpenAI (GPT-4, Vision API)
- **Rejected**: Azure Form Recognizer, AWS Textract, Tesseract.js

### Web Scraping
- **Dynamic Sites**: Puppeteer or Playwright
- **Static HTML**: Cheerio

### PDF Processing
- **Generation/Manipulation**: pdf-lib
- **Text Extraction**: pdf-parse (✅ implemented)
- **Client-side**: pdfjs-dist (✅ implemented)

### Signature Capture
- **UI Library**: signature_pad

### Platform Services
- **Scheduling**: Vercel Cron Jobs
- **Storage**: Supabase Storage
- **Realtime**: Supabase Realtime

---

## Implementation Status

### ✅ Already Implemented
- OpenAI Vision API
- pdf-parse
- pdfjs-dist

### 🚧 Not Yet Implemented
- Vapi.ai
- SendGrid / AWS SES
- Twilio
- GPT-4 (for lessons)
- Puppeteer / Playwright / Cheerio
- pdf-lib
- signature_pad
- Vercel Cron Jobs
- Supabase Storage (for documents)
- Supabase Realtime
- Web Push API

### ❌ Explicitly Rejected
- Azure Form Recognizer
- AWS Textract
- Tesseract.js

---

*Last Updated: Based on Product Completion Plan review*

