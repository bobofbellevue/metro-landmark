/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import {
  generateRenewalDocument,
  resolveLeaseTemplate,
} from '../../../utils/document-generator.js';
import {
  addDaysToWorkflowDate,
  isCompleteWorkflowDate,
  suggestRenewalEndDate,
  todayWorkflowDate,
} from '../../../src/utils/workflow-date.js';
import {
  buildRenewalLeaseInsert,
  collectOriginalLeaseClientIds,
} from '../../../src/utils/renewal-lease-record.js';
import { stripInternalIdFieldsFromDocumentData } from '../../../src/utils/template-field-filter.js';

/**
 * Vercel serverless function to generate lease renewal documents
 * and create a new lease record for the renewed term.
 *
 * POST /api/documents/generate/renewal
 *
 * Body:
 * - lease_id: Integer (original lease to renew)
 * - new_start_date: String (ISO date, optional, defaults to after current lease end)
 * - new_end_date: String (ISO date, optional)
 * - new_monthly_rent: Number (optional, can update rent)
 * - document_data: Object (optional template field edits from Renewal Terms)
 * - create_lease: Boolean (default true — insert a new leases row)
 * - template_id: Integer (optional, will use default if not provided)
 * - user_id: Integer (user generating the document)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing',
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let {
      lease_id,
      new_start_date,
      new_end_date,
      new_monthly_rent,
      template_id,
      user_id,
      document_data,
      create_lease = true,
    } = req.body;

    if (user_id) {
      if (typeof user_id === 'string' && user_id.includes('-')) {
        console.warn(
          '[Generate Renewal] Received UUID instead of integer user_id:',
          user_id
        );
        user_id = null;
      } else {
        const parsedUserId = parseInt(user_id, 10);
        if (Number.isNaN(parsedUserId)) {
          console.warn('[Generate Renewal] Invalid user_id format:', user_id);
          user_id = null;
        } else {
          user_id = parsedUserId;
        }
      }
    }

    if (!lease_id) {
      return res.status(400).json({
        success: false,
        error: 'lease_id is required',
      });
    }

    const { data: originalLease, error: originalLeaseError } = await supabase
      .from('leases')
      .select(
        `
        *,
        lease_clients(
          client_id,
          clients(client_id)
        )
      `
      )
      .eq('lease_id', lease_id)
      .single();

    if (originalLeaseError || !originalLease) {
      return res.status(404).json({
        success: false,
        error: 'Lease not found',
      });
    }

    const cleanedDocumentData = stripInternalIdFieldsFromDocumentData(
      document_data && typeof document_data === 'object' ? document_data : {}
    );

    const renewalData = {
      new_start_date,
      new_end_date,
      new_monthly_rent,
      document_data: cleanedDocumentData,
    };

    const {
      pdfBytes,
      diagnostics: renderDiagnostics,
      documentData: finalDocumentData,
      renewalStartDate: generatedStart,
      renewalEndDate: generatedEnd,
      newMonthlyRent: generatedRent,
      template: resolvedTemplate,
    } = await generateRenewalDocument(
      lease_id,
      template_id,
      supabase,
      renewalData
    );
    console.log('[RENDER_DIAG] /api/documents/generate/renewal', renderDiagnostics);

    let renewalStartDate = generatedStart || new_start_date || '';
    if (!isCompleteWorkflowDate(renewalStartDate)) {
      renewalStartDate = isCompleteWorkflowDate(originalLease.end_date)
        ? addDaysToWorkflowDate(originalLease.end_date, 1)
        : todayWorkflowDate();
    }

    let renewalEndDate = generatedEnd || new_end_date || '';
    if (!isCompleteWorkflowDate(renewalEndDate)) {
      renewalEndDate = suggestRenewalEndDate(
        renewalStartDate,
        originalLease.start_date,
        originalLease.end_date
      );
    }

    const monthlyRent =
      generatedRent != null && generatedRent !== ''
        ? Number(generatedRent)
        : new_monthly_rent != null && new_monthly_rent !== ''
          ? Number(new_monthly_rent)
          : Number(originalLease.monthly_rent_amount);

    let templateId =
      template_id ||
      resolvedTemplate?.template_id ||
      originalLease.template_id ||
      null;
    if (!templateId) {
      const resolved = await resolveLeaseTemplate(supabase, null);
      templateId = resolved?.template_id || null;
    }

    const documentPayload = stripInternalIdFieldsFromDocumentData(
      finalDocumentData && typeof finalDocumentData === 'object'
        ? finalDocumentData
        : cleanedDocumentData
    );

    let newLeaseId = null;
    let leaseCreateError = null;

    if (create_lease !== false) {
      try {
        const insertPayload = buildRenewalLeaseInsert(originalLease, {
          start_date: renewalStartDate,
          end_date: renewalEndDate || null,
          monthly_rent_amount: monthlyRent,
          date_of_agreement: todayWorkflowDate(),
          template_id: templateId,
          document_data: documentPayload,
          status: 'active',
        });

        const { data: newLease, error: leaseError } = await supabase
          .from('leases')
          .insert([insertPayload])
          .select()
          .single();

        if (leaseError) throw leaseError;
        newLeaseId = newLease.lease_id;

        const clientIds = collectOriginalLeaseClientIds(originalLease);
        if (clientIds.length > 0) {
          const { error: leaseClientsError } = await supabase
            .from('lease_clients')
            .insert(
              clientIds.map((client_id) => ({
                lease_id: newLeaseId,
                client_id,
              }))
            );
          if (leaseClientsError) {
            await supabase.from('leases').delete().eq('lease_id', newLeaseId);
            throw leaseClientsError;
          }
        }
      } catch (err) {
        console.error('[Generate Renewal] Failed to create renewed lease:', err);
        leaseCreateError = err.message || 'Failed to create renewed lease record';
      }
    }

    const documentLeaseId = newLeaseId || lease_id;
    const fileName = `lease_renewal_${documentLeaseId}_${Date.now()}.pdf`;
    const storagePath = `documents/lease/${documentLeaseId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      if (newLeaseId) {
        await supabase.from('lease_clients').delete().eq('lease_id', newLeaseId);
        await supabase.from('leases').delete().eq('lease_id', newLeaseId);
      }
      return res.status(500).json({
        success: false,
        error: `Upload failed: ${uploadError.message}`,
      });
    }

    const { data: documentRow, error: dbError } = await supabase
      .from('documents')
      .insert({
        lease_id: documentLeaseId,
        document_name: renewalEndDate
          ? `Lease Renewal (${renewalStartDate} – ${renewalEndDate})`
          : 'Lease Renewal',
        file_name: fileName,
        storage_path: storagePath,
        file_type: 'application/pdf',
        file_size: pdfBytes.length,
        mime_type: 'application/pdf',
        uploaded_by_user_id: user_id || null,
        document_type: 'lease_renewal',
        metadata: {
          template_id: templateId,
          generated_at: new Date().toISOString(),
          renewal_start_date: renewalStartDate,
          renewal_end_date: renewalEndDate,
          original_lease_id: lease_id,
          new_lease_id: newLeaseId,
          render: renderDiagnostics,
        },
      })
      .select()
      .single();

    if (dbError) {
      await supabase.storage.from('documents').remove([storagePath]);
      if (newLeaseId) {
        await supabase.from('lease_clients').delete().eq('lease_id', newLeaseId);
        await supabase.from('leases').delete().eq('lease_id', newLeaseId);
      }
      return res.status(500).json({
        success: false,
        error: `Database error: ${dbError.message}`,
      });
    }

    if (newLeaseId && documentPayload && Object.keys(documentPayload).length) {
      await supabase
        .from('leases')
        .update({
          document_data: documentPayload,
          template_id: templateId,
        })
        .eq('lease_id', newLeaseId);
    }

    return res.status(200).json({
      success: true,
      document_id: documentRow.document_id,
      file_path: storagePath,
      renewal_start_date: renewalStartDate,
      renewal_end_date: renewalEndDate,
      original_lease_id: lease_id,
      new_lease_id: newLeaseId,
      lease_created: Boolean(newLeaseId),
      lease_create_error: leaseCreateError,
      render: renderDiagnostics,
    });
  } catch (error) {
    console.error('Renewal generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}
