import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import DocumentUpload from './DocumentUpload';
import DocumentList from './DocumentList';
import SignatureCapture from './SignatureCapture';
import FormExtractionReview from './FormExtractionReview';

/**
 * DocumentManagement component - Complete document management UI
 * 
 * Props:
 * - leaseId: Integer (optional, ID of the lease)
 * - tenantUserId: Integer (optional, user_id from clients table for application documents)
 * - noticeId: Integer (optional, ID of the legal notice)
 * - propertyId: Integer (optional, ID of the property)
 * - unitId: Integer (optional, ID of the unit)
 * - userRole: String (for signature permissions)
 * - userId: Integer
 * - applicationId: Integer (optional, for extraction review - application_id from client_applications)
 */
export default function DocumentManagement({
  leaseId,
  tenantUserId,
  noticeId,
  propertyId,
  unitId,
  userRole,
  userId,
  applicationId
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [signingDocument, setSigningDocument] = useState(null);
  const [reviewingDocument, setReviewingDocument] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [signError, setSignError] = useState('');
  const [signSuccess, setSignSuccess] = useState('');
  const [documentError, setDocumentError] = useState('');

  // Refresh documents when entity IDs change
  useEffect(() => {
    console.log('[DocumentManagement] useEffect: Entity IDs changed', {
      leaseId,
      tenantUserId,
      noticeId,
      propertyId,
      unitId,
      applicationId,
      hasAnyId: !!(leaseId || tenantUserId || noticeId || propertyId || unitId)
    });
    
    if (leaseId || tenantUserId || noticeId || propertyId || unitId) {
      console.log('[DocumentManagement] useEffect: Triggering document refresh');
      setRefreshKey(prev => prev + 1);
    } else {
      console.log('[DocumentManagement] useEffect: No entity IDs provided, not refreshing documents');
    }
  }, [leaseId, tenantUserId, noticeId, propertyId, unitId, applicationId]);

  const handleUploadSuccess = (result) => {
    setShowUpload(false);
    setUploadError('');
    setRefreshKey(prev => prev + 1); // Trigger refresh
  };

  const handleUploadError = (error) => {
    console.error('Upload error:', error);
    setUploadError(error.message || 'Upload failed. Please try again.');
  };

  const handleSignDocument = async (signatureImage) => {
    if (!signingDocument || !userId) return;

    setSignError('');
    setSignSuccess('');

    try {
      // Capture IP address and user agent for audit trail
      const ipAddress = await fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => data.ip)
        .catch(() => null);
      
      const userAgent = navigator.userAgent;

      const response = await fetch(`/api/documents/${signingDocument.document_id}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          signature_image: signatureImage,
          signer_user_id: userId,
          signer_role: userRole || 'user',
          signature_position: {
            x: 400,
            y: 100,
            width: 150,
            height: 50,
            pageIndex: 0
          },
          ip_address: ipAddress,
          user_agent: userAgent
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to sign document');
      }

      setSignSuccess('Document signed successfully!');
      setTimeout(() => {
        setSigningDocument(null);
        setSignSuccess('');
        setRefreshKey(prev => prev + 1); // Trigger refresh
      }, 1500);
    } catch (error) {
      console.error('Sign error:', error);
      setSignError(error.message || 'Failed to sign document. Please try again.');
    }
  };

  const handleDocumentClick = (document) => {
    setDocumentError('');
    // Open document in new tab for viewing
    fetch(`/api/documents/${document.document_id}/download`)
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          window.open(result.url, '_blank');
        } else {
          setDocumentError(result.error || 'Failed to open document');
        }
      })
      .catch(err => {
        console.error('Error opening document:', err);
        setDocumentError('Failed to open document. Please try again.');
      });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Documents</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {showUpload ? 'Cancel' : 'Upload Document'}
          </button>
        </div>
      </div>

      {showUpload && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-medium mb-4">Upload Document</h3>
          {uploadError && (
            <div className="mb-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
              {uploadError}
            </div>
          )}
          <DocumentUpload
            leaseId={leaseId}
            tenantUserId={tenantUserId}
            noticeId={noticeId}
            propertyId={propertyId}
            unitId={unitId}
            onUploadSuccess={handleUploadSuccess}
            onUploadError={handleUploadError}
          />
        </div>
      )}

      <DocumentList
        key={refreshKey}
        leaseId={leaseId}
        tenantUserId={tenantUserId}
        noticeId={noticeId}
        propertyId={propertyId}
        unitId={unitId}
        onDocumentClick={handleDocumentClick}
        showActions={true}
        onReviewExtraction={(document) => {
          setReviewingDocument(document);
        }}
        onSignDocument={(document) => {
          setSigningDocument(document);
        }}
        userId={userId}
        userRole={userRole}
      />

      {signingDocument && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              Sign Document: {signingDocument.file_name}
            </h3>
            {signError && (
              <div className="mb-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                {signError}
              </div>
            )}
            {signSuccess && (
              <div className="mb-4 p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md">
                {signSuccess}
              </div>
            )}
            <SignatureCapture
              onSignature={handleSignDocument}
              onCancel={() => {
                setSigningDocument(null);
                setSignError('');
                setSignSuccess('');
              }}
            />
          </div>
        </div>
      )}
      {documentError && (
        <div className="mt-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
          {documentError}
          <button
            onClick={() => setDocumentError('')}
            className="ml-2 text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Extraction Review Modal */}
      {reviewingDocument && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                Review Extracted Data: {reviewingDocument.file_name}
              </h3>
              <button
                onClick={() => setReviewingDocument(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            <FormExtractionReview
              applicationId={applicationId || (tenantUserId ? null : applicationId)}
              documentId={reviewingDocument.document_id}
              onSave={(fieldData) => {
                setReviewingDocument(null);
                setRefreshKey(prev => prev + 1); // Refresh documents
              }}
              onCancel={() => setReviewingDocument(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

