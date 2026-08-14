/* eslint-env node */
import { createClient } from '@supabase/supabase-js';
import { sendNotification } from '../utils/notification-service.js';

/**
 * Vercel serverless function to initiate lease signing
 * 
 * POST /api/documents/sign-lease
 * 
 * Body:
 * - lease_id: Integer
 * - document_id: Integer (the generated lease document)
 * - user_id: Integer (user initiating the signing - for testing, this is the recipient)
 * 
 * Response:
 * {
 *   success: boolean,
 *   error?: string
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  try {
    // Initialize Supabase client with service role key (bypasses RLS)
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: 'Supabase configuration missing'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { lease_id, document_id, user_id } = req.body;

    if (!lease_id || !document_id) {
      return res.status(400).json({
        success: false,
        error: 'lease_id and document_id are required'
      });
    }

    // Fetch lease with related data
    const { data: lease, error: leaseError } = await supabase
      .from('leases')
      .select(`
        *,
        units!inner(
          *,
          properties!inner(
            *,
            landlords(*)
          )
        ),
        lease_clients(
          *,
          client:clients!inner(
            *,
            users!clients_user_id_fkey(*)
          )
        )
      `)
      .eq('lease_id', lease_id)
      .single();

    if (leaseError || !lease) {
      return res.status(404).json({
        success: false,
        error: 'Lease not found'
      });
    }

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('document_id', document_id)
      .single();

    if (docError || !document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Generate signing URL (this would be a route to sign the document)
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173');
    
    const signUrl = `${baseUrl}/documents/${document_id}/sign`;

    // During testing: send to logged-in user
    // In production: send to manager (if any) or landlord, and all tenants
    const recipients = [];
    
    if (user_id) {
      // Testing mode: send to logged-in user
      recipients.push({
        user_id: user_id,
        role: 'tester'
      });
    } else {
      // Production mode: find manager or landlord
      const property = lease.units?.properties;
      const landlord = property?.landlords;
      
      // TODO: Find property manager from property_managers table
      // For now, use landlord if available
      if (landlord?.user_id) {
        recipients.push({
          user_id: landlord.user_id,
          role: 'landlord'
        });
      }
      
      // Add all tenants
      if (lease.lease_clients) {
        lease.lease_clients.forEach(lc => {
          if (lc.client?.user_id) {
            recipients.push({
              user_id: lc.client.user_id,
              role: 'tenant'
            });
          }
        });
      }
    }

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No recipients found for lease signing'
      });
    }

    // Send notifications to all recipients
    const notificationResults = [];
    for (const recipient of recipients) {
      const result = await sendNotification({
        userId: recipient.user_id,
        notificationType: ['email', 'sms'], // Send both email and text
        category: 'lease',
        subject: `Lease Document Ready for Signature - ${document.document_name || 'Lease Agreement'}`,
        message: `A lease document is ready for your signature. Please review and sign the document.`,
        actionUrl: signUrl,
        actionText: 'Review & Sign Document',
        metadata: {
          lease_id,
          document_id,
          recipient_role: recipient.role
        }
      }, supabase);

      notificationResults.push({
        user_id: recipient.user_id,
        role: recipient.role,
        success: result.success,
        error: result.error
      });
    }

    // Check if any notifications failed
    const failedNotifications = notificationResults.filter(r => !r.success);
    if (failedNotifications.length > 0) {
      console.warn('Some notifications failed:', failedNotifications);
    }

    return res.status(200).json({
      success: true,
      recipients_sent: notificationResults.length,
      recipients: notificationResults
    });

  } catch (error) {
    console.error('Lease signing initiation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
