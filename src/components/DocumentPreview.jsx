import { useState, useEffect, useCallback } from 'react';
import { X, Download, Loader2 } from 'lucide-react';

/**
 * DocumentPreview component for previewing documents in a modal
 * 
 * Props:
 * - document: Object (document object with document_id, file_name, file_type, etc.)
 * - isOpen: Boolean
 * - onClose: Function
 * - onDownload: Function (optional, callback when download is clicked)
 */
export default function DocumentPreview({ document, isOpen, onClose, onDownload }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadPreview = useCallback(async () => {
    if (!document) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/documents/${document.document_id}/download`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load document');
      }

      setPreviewUrl(result.url);
    } catch (err) {
      console.error('Error loading preview:', err);
      setError(err.message || 'Failed to load document preview');
    } finally {
      setLoading(false);
    }
  }, [document]);

    useEffect(() => {
        if (isOpen && document) {
            loadPreview();
        } else {
            if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    }

    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [isOpen, document, loadPreview, previewUrl]);

  const handleDownload = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
    onDownload?.(document);
  };

  if (!isOpen || !document) return null;

  const isPDF = document.file_type === 'application/pdf' || document.file_name?.toLowerCase().endsWith('.pdf');
  const isImage = document.file_type?.startsWith('image/') || 
    /\.(jpg|jpeg|png|gif|webp)$/i.test(document.file_name || '');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-75">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">{document.file_name}</h3>
            <div className="mt-1 text-sm text-gray-500 space-x-4">
              <span>Type: {document.document_type || 'N/A'}</span>
              {document.file_size && (
                <span>Size: {formatFileSize(document.file_size)}</span>
              )}
              {document.uploaded_at && (
                <span>Uploaded: {formatDate(document.uploaded_at)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
              title="Download"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 bg-gray-100">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
                <p className="text-gray-600">Loading document...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-red-600 mb-4">{error}</p>
                <button
                  onClick={loadPreview}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : previewUrl ? (
            <div className="flex justify-center">
              {isPDF ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-full min-h-[600px] border border-gray-300 rounded"
                  title="Document Preview"
                />
              ) : isImage ? (
                <img
                  src={previewUrl}
                  alt={document.file_name}
                  className="max-w-full h-auto rounded shadow-lg"
                />
              ) : (
                <div className="text-center p-8">
                  <p className="text-gray-600 mb-4">Preview not available for this file type.</p>
                  <button
                    onClick={handleDownload}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Download to View
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer with metadata */}
        {document.metadata && Object.keys(document.metadata).length > 0 && (
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Metadata</h4>
            <div className="text-xs text-gray-600 space-y-1">
              {document.metadata.processing_status && (
                <p>Processing Status: {document.metadata.processing_status}</p>
              )}
              {document.metadata.extraction_confidence && (
                <p>Extraction Confidence: {Math.round(document.metadata.extraction_confidence)}%</p>
              )}
              {document.is_signed && document.signed_at && (
                <p>Signed: {formatDate(document.signed_at)}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

