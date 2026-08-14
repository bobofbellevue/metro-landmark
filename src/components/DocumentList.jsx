import { useState, useEffect } from 'react';
import { Loader2, FileText, CheckCircle, XCircle, AlertCircle, PenTool, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * DocumentList component for displaying and managing documents
 * 
 * Props:
 * - leaseId: Integer (optional, ID of the lease to filter documents)
 * - tenantUserId: Integer (optional, user_id from clients table for application documents)
 * - noticeId: Integer (optional, ID of the legal notice)
 * - propertyId: Integer (optional, ID of the property)
 * - unitId: Integer (optional, ID of the unit)
 * - onDocumentClick: Function (optional, callback when document is clicked)
 * - showActions: Boolean (default true, show download/delete actions)
 * - onReviewExtraction: Function (optional, callback to open extraction review)
 * - onSignDocument: Function (optional, callback when sign is clicked - receives document object)
 * - onRegenerate: Function (optional, callback when regenerate is clicked - receives document object)
 * - userId: Integer (optional, current user ID for signing)
 * - userRole: String (optional, current user role for signing)
 */
export default function DocumentList({
  leaseId,
  tenantUserId,
  noticeId,
  propertyId,
  unitId,
  onDocumentClick,
  showActions = true,
  onReviewExtraction,
  onSignDocument,
  onRegenerate,
  userId,
  userRole
}) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState('');
  const [regeneratingDocs, setRegeneratingDocs] = useState(new Set());
  const [signatures, setSignatures] = useState({}); // document_id -> signatures array
  const [signatureStatuses, setSignatureStatuses] = useState({}); // document_id -> status object

  useEffect(() => {
    if (leaseId || tenantUserId || noticeId || propertyId || unitId) {
      loadDocuments();
    }
  }, [leaseId, tenantUserId, noticeId, propertyId, unitId]);

  // Load signature information for documents
  useEffect(() => {
    if (documents.length > 0) {
      loadSignatureInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents]);

  const loadDocuments = async () => {
    setLoading(true);
    setError(null);

    try {
      // Build query parameters from entity-specific props
      let queryParams = [];
      if (leaseId) queryParams.push(`lease_id=${leaseId}`);
      if (tenantUserId) queryParams.push(`tenant_user_id=${tenantUserId}`);
      if (noticeId) queryParams.push(`notice_id=${noticeId}`);
      if (propertyId) queryParams.push(`property_id=${propertyId}`);
      if (unitId) queryParams.push(`unit_id=${unitId}`);
      
      const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
      
      console.log('[DocumentList] loadDocuments: Loading documents with params:', {
        leaseId,
        tenantUserId,
        noticeId,
        propertyId,
        unitId,
        queryString
      });
      
      const response = await fetch(`/api/documents/list${queryString}`);
      const result = await response.json();

      console.log('[DocumentList] loadDocuments: API response:', {
        success: result.success,
        documentCount: result.documents?.length || 0,
        error: result.error,
        documents: result.documents?.map(d => ({
          document_id: d.document_id,
          document_type: d.document_type,
          tenant_user_id: d.tenant_user_id,
          lease_id: d.lease_id,
          notice_id: d.notice_id,
          property_id: d.property_id,
          unit_id: d.unit_id
        })) || []
      });

      if (!result.success) {
        // Check if it's a schema/column error - handle gracefully
        if (result.error && result.error.includes('does not exist')) {
          console.warn('[DocumentList] Document columns may not exist in schema, showing empty list');
          setDocuments([]);
          setLoading(false);
          return;
        }
        throw new Error(result.error || 'Failed to load documents');
      }

      setDocuments(result.documents || []);
    } catch (err) {
      // Check if it's a schema/column error - handle gracefully
      if (err.message && err.message.includes('does not exist')) {
        console.warn('[DocumentList] Document columns may not exist in schema, showing empty list');
        setDocuments([]);
        setError(null); // Don't show error for schema issues
      } else {
        console.error('[DocumentList] ❌ Error loading documents:', err);
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadSignatureInfo = async () => {
    const signaturePromises = documents.map(async (doc) => {
      try {
        // Get signatures
        const sigResponse = await fetch(`/api/documents/${doc.document_id}/signatures`);
        const sigResult = await sigResponse.json();
        
        // Get signature status
        const statusResponse = await fetch(`/api/documents/${doc.document_id}/signature-status`);
        const statusResult = await statusResponse.json();

        return {
          documentId: doc.document_id,
          signatures: sigResult.success ? sigResult.signatures : [],
          status: statusResult.success ? statusResult : null
        };
      } catch (err) {
        console.error(`Error loading signature info for document ${doc.document_id}:`, err);
        return {
          documentId: doc.document_id,
          signatures: [],
          status: null
        };
      }
    });

    const results = await Promise.all(signaturePromises);
    const signaturesMap = {};
    const statusesMap = {};

    results.forEach(({ documentId, signatures: sigs, status }) => {
      signaturesMap[documentId] = sigs;
      statusesMap[documentId] = status;
    });

    setSignatures(signaturesMap);
    setSignatureStatuses(statusesMap);
  };

  const handleDownload = async (documentId, fileName) => {
    setActionError('');
    try {
      const response = await fetch(`/api/documents/${documentId}/download`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get download URL');
      }

      // Open download URL in new tab
      window.open(result.url, '_blank');
    } catch (err) {
      console.error('Download error:', err);
      setActionError(`Failed to download document: ${err.message}`);
    }
  };

  const handleDelete = async (documentId) => {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }

    setActionError('');
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE'
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete document');
      }

      // Reload documents
      loadDocuments();
    } catch (err) {
      console.error('Delete error:', err);
      setActionError(`Failed to delete document: ${err.message}`);
    }
  };

  const getProcessingStatus = (doc) => {
    const metadata = doc.metadata || {};
    return metadata.processing_status || 'pending';
  };

  const getProcessingStatusBadge = (status, confidence) => {
    switch (status) {
      case 'completed':
        return (
          <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Processed {confidence ? `(${Math.round(confidence)}%)` : ''}
          </span>
        );
      case 'processing':
        return (
          <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Processing...
          </span>
        );
      case 'error':
        return (
          <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            Error
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Pending
          </span>
        );
    }
  };

  const isFilledForm = (doc) => {
    const filledFormTypes = ['filled_application', 'filled_lease', 'application', 'lease'];
    return doc.document_type && filledFormTypes.some(type => 
      doc.document_type.toLowerCase().includes(type.toLowerCase())
    );
  };

  const isGeneratedDocument = (doc) => {
    return doc.metadata?.generated_type || 
           (doc.document_type && (
             doc.document_type.includes('generated') ||
             doc.document_type.includes('lease') && doc.metadata?.template_id
           ));
  };

  const handleRegenerate = async (document) => {
    if (!onRegenerate) {
      // If no callback provided, handle regeneration directly
      if (!confirm('Are you sure you want to regenerate this document? This will create a new version.')) {
        return;
      }

      setRegeneratingDocs(prev => new Set([...prev, document.document_id]));
      setActionError('');

      try {
        const docType = document.metadata?.generated_type || 
                       (document.document_type?.includes('lease') ? 'lease' : null);
        
        if (!docType || docType !== 'lease') {
          setActionError('Regeneration is only available for generated lease documents.');
          return;
        }

        const leaseId = document.lease_id;
        if (!leaseId) {
          setActionError('Cannot regenerate: missing lease ID.');
          return;
        }

        // Use userId prop (integer from users table)
        // The uploaded_by_user_id field expects an integer user_id, not a UUID
        const currentUserId = userId || null;

        const response = await fetch('/api/documents/generate/lease', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            lease_id: leaseId,
            template_id: document.metadata?.template_id,
            user_id: currentUserId
          })
        });

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Failed to regenerate document');
        }

        // Reload documents
        loadDocuments();
      } catch (err) {
        console.error('Regenerate error:', err);
        setActionError(`Failed to regenerate document: ${err.message}`);
      } finally {
        setRegeneratingDocs(prev => {
          const next = new Set(prev);
          next.delete(document.document_id);
          return next;
        });
      }
    } else {
      // Use callback if provided
      onRegenerate(document);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Error loading documents: {error}</p>
        <button
          onClick={loadDocuments}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center p-8 text-gray-500">
        <p>No documents found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
          {actionError}
          <button
            onClick={() => setActionError('')}
            className="ml-2 text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {documents.map((doc) => (
        <div
          key={doc.document_id}
          className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <h3
                  className="font-medium text-gray-900 cursor-pointer hover:text-blue-600"
                  onClick={() => onDocumentClick?.(doc)}
                >
                  {doc.file_name}
                </h3>
                {doc.is_signed && (
                  <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                    Signed
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm text-gray-500 space-y-1">
                <p>Type: {doc.document_type || 'N/A'}</p>
                <p>Size: {formatFileSize(doc.file_size || 0)}</p>
                <p>Uploaded: {formatDate(doc.uploaded_at || doc.created_at)}</p>
                {doc.is_signed && doc.signed_at && (
                  <p>Signed: {formatDate(doc.signed_at)}</p>
                )}
                {/* Signature status */}
                {signatureStatuses[doc.document_id] && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-gray-600">
                      Signatures: {signatureStatuses[doc.document_id].signatures_count || 0} / {signatureStatuses[doc.document_id].required_signatures || 1}
                    </p>
                    {signatures[doc.document_id] && signatures[doc.document_id].length > 0 && (
                      <div className="text-xs text-gray-500">
                        {signatures[doc.document_id].slice(0, 2).map((sig, idx) => {
                          const signer = sig.signer || {};
                          const name = signer.first_name && signer.last_name 
                            ? `${signer.first_name} ${signer.last_name}`
                            : signer.email || 'Unknown';
                          return (
                            <p key={idx}>
                              {name} ({sig.signer_role}) - {formatDate(sig.signed_at)}
                            </p>
                          );
                        })}
                        {signatures[doc.document_id].length > 2 && (
                          <p>+{signatures[doc.document_id].length - 2} more</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* Processing status */}
                {isFilledForm(doc) && (
                  <div className="mt-2">
                    {getProcessingStatusBadge(
                      getProcessingStatus(doc),
                      doc.metadata?.extraction_confidence
                    )}
                  </div>
                )}
              </div>
            </div>
            {showActions && (
              <div className="flex flex-col gap-2 ml-4">
                <div className="flex gap-2 flex-wrap">
                  {/* Sign Document button - show if document is PDF and onSignDocument callback provided */}
                  {onSignDocument && doc.file_type === 'application/pdf' && (
                    <button
                      onClick={() => onSignDocument(doc)}
                      className="px-3 py-1 text-sm text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded flex items-center gap-1"
                      title="Sign Document"
                    >
                      <PenTool className="w-4 h-4" />
                      {doc.is_signed ? 'Re-sign' : 'Sign'}
                    </button>
                  )}
                  {isFilledForm(doc) && getProcessingStatus(doc) === 'completed' && onReviewExtraction && (
                    <button
                      onClick={() => onReviewExtraction(doc)}
                      className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded flex items-center gap-1"
                      title="Review Extraction"
                    >
                      <FileText className="w-4 h-4" />
                      Review
                    </button>
                  )}
                  {isGeneratedDocument(doc) && (
                    <button
                      onClick={() => handleRegenerate(doc)}
                      disabled={regeneratingDocs.has(doc.document_id)}
                      className="px-3 py-1 text-sm text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded flex items-center gap-1 disabled:opacity-50"
                      title="Regenerate Document"
                    >
                      {regeneratingDocs.has(doc.document_id) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      Regenerate
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(doc.document_id, doc.file_name)}
                    className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                    title="Download"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(doc.document_id)}
                    className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                    title="Delete"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

