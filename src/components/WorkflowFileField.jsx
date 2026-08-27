import { useState } from 'react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import DocumentUpload from './DocumentUpload.jsx';
import {
  PROOF_OF_SERVICE_ACCEPT,
  PROOF_OF_SERVICE_DOCUMENT_TYPE,
  isAllowedProofOfServiceFile,
  normalizeProofOfServiceFiles,
  proofOfServiceFileLabel,
} from '../utils/proof-of-service-file.js';

function FileChip({ file, onPreview, onRemove }) {
  const fileLabel = proofOfServiceFileLabel(file);
  const mime = file?.mime_type || '';
  const isImage = mime.startsWith('image/');
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {file?.document_id && onPreview ? (
          <button
            type="button"
            onClick={() => onPreview(file)}
            className="flex min-w-0 items-center gap-2 text-left"
            title="View"
          >
            <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="truncate text-sm text-indigo-600 hover:text-indigo-800 hover:underline">
              {fileLabel}
            </span>
          </button>
        ) : (
          <>
            <Icon className="h-4 w-4 shrink-0 text-gray-500" />
            <p className="truncate text-sm text-gray-800">{fileLabel}</p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex shrink-0 items-center gap-1 text-sm text-gray-600 hover:text-red-600"
      >
        <X className="h-4 w-4" />
        Remove
      </button>
    </div>
  );
}

/**
 * Workflow field for uploading proof images or PDFs.
 */
export default function WorkflowFileField({
  value,
  onChange,
  onPreview,
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
  multiple = false,
}) {
  const [uploadError, setUploadError] = useState('');
  const files = normalizeProofOfServiceFiles(value);
  const showUploader = multiple || files.length === 0;

  const handleSuccess = (result) => {
    setUploadError('');
    const nextFile = {
      document_id: result.document_id,
      file_name: result.file_name,
      mime_type: result.mime_type,
      file_path: result.file_path,
    };
    if (multiple) {
      onChange?.([...files, nextFile]);
    } else {
      onChange?.(nextFile);
    }
  };

  const handleError = (err) => {
    const message = err?.message || 'Upload failed';
    setUploadError(message);
  };

  const removeAt = (index) => {
    setUploadError('');
    if (!multiple) {
      onChange?.(null);
      return;
    }
    const next = files.filter((_, i) => i !== index);
    onChange?.(next);
  };

  return (
    <div className="space-y-2">
      {files.map((file, index) => (
        <FileChip
          key={file.document_id || `${file.file_name || 'file'}-${index}`}
          file={file}
          onPreview={onPreview}
          onRemove={() => removeAt(index)}
        />
      ))}
      {showUploader ? (
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
          compact
          multiple={multiple}
          onUploadSuccess={handleSuccess}
          onUploadError={handleError}
        />
      ) : null}
      {description && showUploader ? (
        <p className="text-xs text-gray-500">{description}</p>
      ) : null}
      {(error || uploadError) && (
        <p className="text-sm text-red-600">{error || uploadError}</p>
      )}
    </div>
  );
}
