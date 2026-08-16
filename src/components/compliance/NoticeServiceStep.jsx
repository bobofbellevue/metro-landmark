import React, { useState } from 'react';
import { Printer, Mail, Check, AlertCircle, ExternalLink, FileText } from 'lucide-react';
import WorkflowDateInput from '../WorkflowDateInput.jsx';
import WorkflowFileField from '../WorkflowFileField.jsx';
import { readResponseJson } from '../../utils/read-response-json.js';
import {
  NOTICE_SERVICE_METHODS,
  buildGmailComposeUrl,
  buildNoticeEmailPlainText,
  buildNoticeMailto,
  normalizeNoticeServiceMethods,
} from '../../utils/notice-service-workflow.js';
import { PROOF_OF_SERVICE_DOCUMENT_TYPE } from '../../utils/proof-of-service-file.js';

/**
 * Shared Notice Service UI: print/email the generated PDF, then optionally
 * record how it was served — or leave service for later.
 */
export default function NoticeServiceStep({
  workflowData,
  updateField,
  errors = {},
  documentId,
  tenantEmails = [],
  propertyLabel = '',
  noticeKind = 'rent increase',
  leaseId,
  propertyId,
  unitId,
  workflowId,
  userId,
  serviceMethods = NOTICE_SERVICE_METHODS,
  serviceNotes = '',
  preferredMethodIds = [],
}) {
  const [docError, setDocError] = useState('');
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState('');
  const methods = normalizeNoticeServiceMethods(serviceMethods);

  const method = methods.find(
    (m) => m.value === workflowData.served_method
  );
  const needsPrint = !method || method.needsPrint;
  const emailOpts = {
    emails: tenantEmails,
    propertyLabel: propertyLabel || 'the property',
    noticeKind,
  };
  const mailto = buildNoticeMailto(emailOpts);
  const gmailUrl = buildGmailComposeUrl(emailOpts);

  const openPdf = async () => {
    if (!documentId) {
      setDocError('Generate the notice first — there is no PDF to print yet.');
      return;
    }
    setDocError('');
    setOpening(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/download`, {
        credentials: 'include',
      });
      const parsed = await readResponseJson(response);
      const url = parsed.data?.url;
      if (!parsed.ok || !parsed.data?.success || !url) {
        throw new Error(
          parsed.error || parsed.data?.error || 'Could not get a download link'
        );
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setDocError(err.message || 'Could not open the notice PDF');
    } finally {
      setOpening(false);
    }
  };

  const markCopied = (key) => {
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const copyEmailText = async () => {
    const text = buildNoticeEmailPlainText(emailOpts);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      markCopied('emailText');
    } catch {
      setDocError('Could not copy notice email text');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <h4 className="mb-1 font-semibold text-indigo-900">Serve the notice</h4>
        <p className="text-sm text-indigo-800">
          Print a copy for in-person delivery, posting, or mail — or email it
          to the tenant. Then record service below, or choose Service Later if
          you have not served it yet.
        </p>
        {serviceNotes ? (
          <p className="mt-2 text-sm font-medium text-indigo-900">{serviceNotes}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openPdf}
            disabled={opening || !documentId}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            {opening ? 'Opening…' : 'Print / Download PDF'}
          </button>
          {tenantEmails.length > 0 ? (
            <>
              <a
                href={mailto}
                className="inline-flex items-center gap-2 rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50"
              >
                <Mail className="h-4 w-4" />
                Email notice in mail app
              </a>
              <a
                href={gmailUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50"
              >
                <ExternalLink className="h-4 w-4" />
                Open Gmail in browser
              </a>
              <button
                type="button"
                onClick={copyEmailText}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied === 'emailText' ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                {copied === 'emailText' ? 'Copied email text' : 'Copy notice email text'}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-400"
              title="No tenant email on file"
            >
              <Mail className="h-4 w-4" />
              Email notice in mail app
            </button>
          )}
        </div>
        {tenantEmails.length > 0 ? (
          <p className="mt-3 text-xs text-indigo-800">
            Tenant email{tenantEmails.length === 1 ? '' : 's'}:{' '}
            {tenantEmails.join(', ')}. Email notice in mail app needs a desktop
            or phone mail program. If you use Gmail in a browser, use Open Gmail
            in browser or Copy notice email text and paste it into Gmail. Attach
            the downloaded PDF before sending. Emailing may not constitute legal
            service depending on the lease and jurisdiction.
          </p>
        ) : (
          <p className="mt-3 text-xs text-indigo-800">
            No tenant email on file. Download the PDF and send it yourself, or
            use in-person, posting, or first class mail.
          </p>
        )}
        {needsPrint && method && (
          <p className="mt-2 text-xs font-medium text-indigo-900">
            {method.label} usually needs a printed copy. Use Print / Download
            PDF first.
          </p>
        )}
        {method?.compound && (
          <p className="mt-2 text-xs font-medium text-indigo-900">
            This method is two acts (for example posting and mailing). Keep
            proof of both.
          </p>
        )}
        {docError && (
          <div className="mt-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{docError}</span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h4 className="font-semibold text-gray-800">Record service</h4>
        <p className="text-sm text-gray-600">
          Required only if you click Record Service. Service Later saves the
          workflow so you can come back after the notice is actually served.
        </p>

        <WorkflowDateInput
          label="Date Notice Served"
          value={workflowData.served_date || ''}
          onChange={(next) => updateField('served_date', next)}
          error={errors.served_date || ''}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Service Method
          </label>
          <select
            value={workflowData.served_method || ''}
            onChange={(e) => updateField('served_method', e.target.value)}
            className={`w-full rounded-md border px-3 py-2 ${
              errors.served_method ? 'border-red-300' : 'border-gray-300'
            }`}
          >
            <option value="">Select…</option>
            {methods.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
                {preferredMethodIds.includes(option.value) ? ' (typical here)' : ''}
              </option>
            ))}
          </select>
          {errors.served_method && (
            <p className="mt-1 text-sm text-red-600">{errors.served_method}</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Proof of Service
          </label>
          <WorkflowFileField
            value={workflowData.proof_of_service_file || null}
            onChange={(fileMeta) => updateField('proof_of_service_file', fileMeta)}
            error={errors.proof_of_service_file}
            leaseId={leaseId}
            propertyId={propertyId}
            unitId={unitId}
            workflowId={workflowId}
            userId={userId}
            documentType={PROOF_OF_SERVICE_DOCUMENT_TYPE}
            description="Upload a photo or PDF — certified mail receipt, posting photo, email confirmation, or similar."
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Notes (optional)
          </label>
          <textarea
            value={workflowData.proof_of_service || ''}
            onChange={(e) => updateField('proof_of_service', e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            placeholder="Tracking number, who accepted service, etc."
          />
        </div>
      </div>
    </div>
  );
}
