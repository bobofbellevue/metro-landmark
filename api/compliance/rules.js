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

    // GET /api/compliance/rules or /api/compliance/rules/:id
    if (method === 'GET') {
      if (id) {
        // Get single rule
        const { data, error } = await supabase
          .from('compliance_rules')
          .select('*')
          .eq('rule_id', id)
          .single();

        if (error) {
          return res.status(404).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, rule: data });
      } else {
        // List rules with filters
        const { jurisdiction, applies_to, rule_type, is_active } = req.query;
        let query = supabase
          .from('compliance_rules')
          .select('*')
          .order('created_at', { ascending: false });

        if (jurisdiction) query = query.eq('jurisdiction', jurisdiction);
        if (applies_to) query = query.eq('applies_to', applies_to);
        if (rule_type) query = query.eq('rule_type', rule_type);
        if (is_active !== undefined) {
          query = query.eq('is_active', is_active === 'true');
        } else {
          // Default to active rules only
          query = query.eq('is_active', true);
        }

        // Filter by effective/expiration dates
        query = query.or('effective_date.is.null,effective_date.lte.' + new Date().toISOString().split('T')[0]);
        query = query.or('expiration_date.is.null,expiration_date.gte.' + new Date().toISOString().split('T')[0]);

        const { data, error } = await query;

        if (error) {
          return res.status(500).json({ success: false, error: error.message });
        }

        return res.status(200).json({ success: true, rules: data || [] });
      }
    }

    // POST /api/compliance/rules
    if (method === 'POST') {
      const {
        rule_name,
        rule_type,
        jurisdiction,
        applies_to,
        rule_condition,
        rule_action,
        notice_period_days,
        prohibited,
        source,
        effective_date,
        expiration_date,
        is_active
      } = req.body;

      if (!rule_name || !rule_type || !jurisdiction || !rule_condition || !rule_action) {
        return res.status(400).json({
          success: false,
          error: 'rule_name, rule_type, jurisdiction, rule_condition, and rule_action are required'
        });
      }

      const { data, error } = await supabase
        .from('compliance_rules')
        .insert({
          rule_name,
          rule_type,
          jurisdiction,
          applies_to: applies_to || null,
          rule_condition,
          rule_action,
          notice_period_days: notice_period_days || null,
          prohibited: prohibited || false,
          source: source || null,
          effective_date: effective_date || null,
          expiration_date: expiration_date || null,
          is_active: is_active !== undefined ? is_active : true
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(201).json({ success: true, rule: data });
    }

    // PUT /api/compliance/rules/:id
    if (method === 'PUT') {
      if (!id) {
        return res.status(400).json({ success: false, error: 'Rule ID required' });
      }

      const {
        rule_name,
        rule_type,
        jurisdiction,
        applies_to,
        rule_condition,
        rule_action,
        notice_period_days,
        prohibited,
        source,
        effective_date,
        expiration_date,
        is_active
      } = req.body;

      const updateData = {};
      if (rule_name !== undefined) updateData.rule_name = rule_name;
      if (rule_type !== undefined) updateData.rule_type = rule_type;
      if (jurisdiction !== undefined) updateData.jurisdiction = jurisdiction;
      if (applies_to !== undefined) updateData.applies_to = applies_to;
      if (rule_condition !== undefined) updateData.rule_condition = rule_condition;
      if (rule_action !== undefined) updateData.rule_action = rule_action;
      if (notice_period_days !== undefined) updateData.notice_period_days = notice_period_days;
      if (prohibited !== undefined) updateData.prohibited = prohibited;
      if (source !== undefined) updateData.source = source;
      if (effective_date !== undefined) updateData.effective_date = effective_date;
      if (expiration_date !== undefined) updateData.expiration_date = expiration_date;
      if (is_active !== undefined) updateData.is_active = is_active;

      const { data, error } = await supabase
        .from('compliance_rules')
        .update(updateData)
        .eq('rule_id', id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true, rule: data });
    }

    // DELETE /api/compliance/rules/:id
    if (method === 'DELETE') {
      if (!id) {
        return res.status(400).json({ success: false, error: 'Rule ID required' });
      }

      const { error } = await supabase
        .from('compliance_rules')
        .delete()
        .eq('rule_id', id);

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Compliance rules API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

