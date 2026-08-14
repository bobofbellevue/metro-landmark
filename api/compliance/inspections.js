/* eslint-env node */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { method } = req;
    const { id } = req.query;

    // GET /api/compliance/inspections or /api/compliance/inspections/:id
    if (method === 'GET') {
      if (id) {
        // Get single inspection
        const { data, error } = await supabase
          .from('property_inspections')
          .select(`
            *,
            lease:leases(*),
            unit:units(*),
            conducted_by:users(*),
            tenant:users(*)
          `)
          .eq('inspection_id', id)
          .single();

        if (error) {
          return res.status(404).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, inspection: data });
      } else {
        // List inspections with filters
        const { lease_id, unit_id, inspection_type } = req.query;
        let query = supabase
          .from('property_inspections')
          .select(`
            *,
            lease:leases(*),
            unit:units(*)
          `)
          .order('inspection_date', { ascending: false });

        if (lease_id) query = query.eq('lease_id', lease_id);
        if (unit_id) query = query.eq('unit_id', unit_id);
        if (inspection_type) query = query.eq('inspection_type', inspection_type);

        const { data, error } = await query;

        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, inspections: data || [] });
      }
    }

    // POST /api/compliance/inspections
    if (method === 'POST') {
      const {
        lease_id,
        unit_id,
        inspection_type,
        inspection_date,
        conducted_by_user_id,
        tenant_present,
        tenant_user_id,
        condition_report,
        photos,
        notes,
        overall_condition
      } = req.body;

      if (!unit_id || !inspection_type || !inspection_date) {
        return res.status(400).json({
          success: false,
          error: 'unit_id, inspection_type, and inspection_date are required'
        });
      }

      const { data, error } = await supabase
        .from('property_inspections')
        .insert({
          lease_id: lease_id || null,
          unit_id,
          inspection_type,
          inspection_date,
          conducted_by_user_id: conducted_by_user_id || null,
          tenant_present: tenant_present || false,
          tenant_user_id: tenant_user_id || null,
          condition_report: condition_report || {},
          photos: photos || [],
          notes: notes || null,
          overall_condition: overall_condition || null
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(201).json({ success: true, inspection: data });
    }

    // PUT /api/compliance/inspections/:id
    if (method === 'PUT') {
      if (!id) {
        return res.status(400).json({ success: false, error: 'Inspection ID required' });
      }

      const {
        inspection_date,
        conducted_by_user_id,
        tenant_present,
        tenant_user_id,
        condition_report,
        photos,
        notes,
        overall_condition,
        tenant_signed,
        tenant_signed_at,
        landlord_signed,
        landlord_signed_at
      } = req.body;

      const updateData = {};
      if (inspection_date !== undefined) updateData.inspection_date = inspection_date;
      if (conducted_by_user_id !== undefined) updateData.conducted_by_user_id = conducted_by_user_id;
      if (tenant_present !== undefined) updateData.tenant_present = tenant_present;
      if (tenant_user_id !== undefined) updateData.tenant_user_id = tenant_user_id;
      if (condition_report !== undefined) updateData.condition_report = condition_report;
      if (photos !== undefined) updateData.photos = photos;
      if (notes !== undefined) updateData.notes = notes;
      if (overall_condition !== undefined) updateData.overall_condition = overall_condition;
      if (tenant_signed !== undefined) updateData.tenant_signed = tenant_signed;
      if (tenant_signed_at !== undefined) updateData.tenant_signed_at = tenant_signed_at;
      if (landlord_signed !== undefined) updateData.landlord_signed = landlord_signed;
      if (landlord_signed_at !== undefined) updateData.landlord_signed_at = landlord_signed_at;

      const { data, error } = await supabase
        .from('property_inspections')
        .update(updateData)
        .eq('inspection_id', id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true, inspection: data });
    }

    // DELETE /api/compliance/inspections/:id
    if (method === 'DELETE') {
      if (!id) {
        return res.status(400).json({ success: false, error: 'Inspection ID required' });
      }

      const { error } = await supabase
        .from('property_inspections')
        .delete()
        .eq('inspection_id', id);

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Property inspections API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

