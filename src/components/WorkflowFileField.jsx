import { useState } from 'react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import DocumentUpload from './DocumentUpload.jsx';
import {
  PROOF_OF_SERVICE_ACCEPT,
  PROOF_OF_SERVICE_DOCUMENT_TYPE,
  isAllowedProofOfServiceFile,
  proofOfServiceFileLabel,
} from '../utils/proof-of-service-file.js';

/**
 * Workflow field for uploading a proof-of-service image or PDF.
 */
export default function WorkflowFileField({
  value,
  onChange,
  error,
  leaseId,
  propertyId,
  unitId,
  workflowId,
  userId,
  documentType = PROOF_OF_SERVICE_DOCUMENT_TYPE,
  acceptedTypes = PROOF_OF_SERVICE_ACCEPT,
  maxSize = 10,
  description,
}) {
  const [uploadError, setUploadError] = useState('');
  const fileLabel = proofOfServiceFileLabel(value);
  const mime = value?.mime_type || '';
  const isImage = mime.startsWith('image/');

  const handleSuccess = (result) => {
    setUploadError('');
    onChange?.({
      document_id: result.document_id,
      file_name: result.file_name,
      mime_type: result.mime_type,
      file_path: result.file_path,
    });
  };

  const handleError = (err) => {
    const message = err?.message || 'Upload failed';
    setUploadError(message);
  };

  return (
    <div className="space-y-2">
      {fileLabel ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex min-w-0 items-center gap-2">
            {isImage ? (
              <ImageIcon className="h-5 w-5 shrink-0 text-gray-500" />
            ) : (
              <FileText className="h-5 w-5 shrink-0 text-gray-500" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-800">{fileLabel}</p>
              <p className="text-xs text-gray-500">Saved to Documents</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setUploadError('');
              onChange?.(null);
            }}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-red-600"
          >
            <X className="h-4 w-4" />
            Remove
          </button>
        </div>
      ) : (
        <DocumentUpload
          leaseId={leaseId}
          propertyId={propertyId}
          unitId={unitId}
          complianceWorkflowId={workflowId}
          userId={userId}
          documentType={documentType}
          maxSize={maxSize}
          acceptedTypes={acceptedTypes}
          acceptFile={isAllowedProofOfServiceFile}
          onUploadSuccess={handleSuccess}
          onUploadError={handleError}
        />
      )}
      {description && !fileLabel && (
        <p className="text-xs text-gray-500">{description}</p>
      )}
      {(error || uploadError) && (
        <p className="text-sm text-red-600">{error || uploadError}</p>
      )}
    </div>
  );
}
