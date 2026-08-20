import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { compressImageFile, isCompressibleImageFile } from '../utils/compress-image.js';

/**
 * DocumentUpload component for uploading documents to Supabase Storage
 * 
 * Props:
 * - leaseId: Integer (optional, ID of the lease this document belongs to)
 * - tenantUserId: Integer (optional, user_id from clients table for application documents)
 * - noticeId: Integer (optional, ID of the legal notice)
 * - propertyId: Integer (optional, ID of the property)
 * - unitId: Integer (optional, ID of the unit)
 * - complianceWorkflowId: Integer (optional, ID of the compliance workflow)
 * - userId: Integer (optional, users.user_id — not the auth UUID)
 * - documentType: String (optional, e.g., 'filled_application', 'signed_lease')
 * - onUploadSuccess: Function (callback when upload succeeds)
 * - onUploadError: Function (callback when upload fails)
 * - maxSize: Number (max file size in MB, default 10)
 * - acceptedTypes: Array (accepted MIME types, default ['application/pdf', 'image/png', 'image/jpeg'])
 * - acceptFile: Function (optional extra file filter)
 */
export default function DocumentUpload({
  leaseId,
  tenantUserId,
  noticeId,
  propertyId,
  unitId,
  complianceWorkflowId,
  userId,
  documentType,
  onUploadSuccess,
  onUploadError,
  maxSize = 10,
  acceptedTypes = ['application/pdf', 'image/png', 'image/jpeg'],
  acceptFile = null,
}) {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;

    // Validate file type (custom predicate handles empty iPhone MIME + extensions)
    const typeAllowed =
      typeof acceptFile === 'function'
        ? acceptFile(file)
        : acceptedTypes.includes(file.type);
    if (!typeAllowed) {
      onUploadError?.(
        new Error(
          `File type ${file.type || file.name || 'unknown'} not allowed. Accepted types: ${acceptedTypes.join(', ')}`
        )
      );
      return;
    }

    setUploading(true);

    let uploadFile = file;
    try {
      if (isCompressibleImageFile(file)) {
        const result = await compressImageFile(file, {
          maxBytes: maxSize * 1024 * 1024,
        });
        uploadFile = result.file || file;
      }
    } catch {
      uploadFile = file;
    }

    const fileSizeMB = uploadFile.size / (1024 * 1024);
    if (fileSizeMB > maxSize) {
      setUploading(false);
      const extra = isCompressibleImageFile(file)
        ? ' This photo could not be compressed below the limit in the browser. Try JPEG or PNG, or a smaller crop.'
        : '';
      onUploadError?.(
        new Error(
          `File size ${fileSizeMB.toFixed(2)}MB exceeds maximum of ${maxSize}MB.${extra}`
        )
      );
      return;
    }

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = reader.result;

          // Get current user — prefer integer users.user_id from AuthContext
          const { data: { user } } = await supabase.auth.getUser();

          // Build upload body with entity-specific fields
          const uploadBody = {
            file: base64Data,
            file_name: uploadFile.name,
            file_type: uploadFile.type,
            mime_type: uploadFile.type,
            document_type: documentType,
            user_id: userId || user?.id || null
          };
          
          // Add entity-specific foreign keys if provided
          if (leaseId) uploadBody.lease_id = leaseId;
          if (tenantUserId) uploadBody.tenant_user_id = tenantUserId;
          if (noticeId) uploadBody.notice_id = noticeId;
          if (propertyId) uploadBody.property_id = propertyId;
          if (unitId) uploadBody.unit_id = unitId;
          if (complianceWorkflowId) {
            uploadBody.compliance_workflow_id = complianceWorkflowId;
          }

          // Upload via API
          const response = await fetch('/api/documents/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(uploadBody)
          });

          const result = await response.json();

          if (!result.success) {
            throw new Error(result.error || 'Upload failed');
          }

          onUploadSuccess?.({
            ...result,
            file_name: uploadFile.name,
            mime_type: uploadFile.type || result.mime_type,
            file_path: result.file_path,
          });
        } catch (error) {
          console.error('Upload error:', error);
          onUploadError?.(error);
        } finally {
          setUploading(false);
        }
      };

      reader.readAsDataURL(uploadFile);
    } catch (error) {
      console.error('File read error:', error);
      onUploadError?.(error);
      setUploading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="w-full">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={[...acceptedTypes, '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif'].join(',')}
          onChange={handleChange}
          disabled={uploading}
        />

        {uploading ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
            <p className="text-gray-600">Uploading...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <svg
              className="w-12 h-12 text-gray-400 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-gray-600 mb-2">
              Drag and drop a file here, or{' '}
              <button
                type="button"
                className="text-blue-600 hover:text-blue-800 underline"
                onClick={() => fileInputRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className="text-sm text-gray-500">
              PDF or image, max {maxSize}MB. Photos are compressed automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

