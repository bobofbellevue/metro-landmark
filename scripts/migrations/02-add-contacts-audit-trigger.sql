-- Migration: Add audit trigger for contacts table
-- This ensures that changes to contact records (including landlord name changes) are logged

-- Update audit trigger function to handle contacts table
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old_values JSONB;
  v_new_values JSONB;
  v_changed_fields TEXT[];
  v_record_id INTEGER;
  v_table_name TEXT;
  v_pk_column TEXT;
  v_user_id INTEGER;
BEGIN
  v_table_name := TG_TABLE_NAME;
  
  -- Determine primary key column name based on table
  CASE v_table_name
    WHEN 'pm_companies' THEN v_pk_column := 'pmc_id';
    WHEN 'users' THEN v_pk_column := 'user_id';
    WHEN 'landlords' THEN v_pk_column := 'landlord_id';
    WHEN 'properties' THEN v_pk_column := 'property_id';
    WHEN 'units' THEN v_pk_column := 'unit_id';
    WHEN 'clients' THEN v_pk_column := 'client_id';
    WHEN 'vendors' THEN v_pk_column := 'vendor_id';
    WHEN 'leases' THEN v_pk_column := 'lease_id';
    WHEN 'maintenance_requests' THEN v_pk_column := 'request_id';
    WHEN 'templates' THEN v_pk_column := 'template_id';
    WHEN 'client_applications' THEN v_pk_column := 'application_id';
    WHEN 'lease_clients' THEN v_pk_column := 'lease_client_id';
    WHEN 'client_units' THEN v_pk_column := 'client_unit_id';
    WHEN 'compliance_workflows' THEN v_pk_column := 'workflow_id';
    WHEN 'compliance_policies' THEN v_pk_column := 'policy_id';
    WHEN 'documents' THEN v_pk_column := 'document_id';
    WHEN 'legal_notices' THEN v_pk_column := 'notice_id';
    WHEN 'contacts' THEN v_pk_column := 'contact_id';
    WHEN 'addresses' THEN v_pk_column := 'address_id';
    WHEN 'contact_methods' THEN v_pk_column := 'method_id';
    ELSE v_pk_column := 'id';
  END CASE;
  
  -- Get record ID and values
  IF TG_OP = 'DELETE' THEN
    EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING OLD INTO v_record_id;
    v_old_values := to_jsonb(OLD);
    v_new_values := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING NEW INTO v_record_id;
    v_old_values := NULL;
    v_new_values := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT ($1.%I)::INTEGER', v_pk_column) USING NEW INTO v_record_id;
    v_old_values := to_jsonb(OLD);
    v_new_values := to_jsonb(NEW);
    
    -- Calculate changed fields
    SELECT array_agg(key)
    INTO v_changed_fields
    FROM jsonb_each(v_new_values)
    WHERE jsonb_extract_path(v_old_values, key) IS DISTINCT FROM value;
  END IF;

  -- Get user_id from session variables
  BEGIN
    v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- Mask sensitive data before storing
  v_old_values := mask_sensitive_data(v_old_values);
  v_new_values := mask_sensitive_data(v_new_values);

  -- Insert audit log (only if audit_logs table exists and record_id is not NULL)
  IF v_record_id IS NOT NULL AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
    INSERT INTO audit_logs (
      table_name,
      record_id,
      action,
      user_id,
      old_values,
      new_values,
      changed_fields
    ) VALUES (
      v_table_name,
      v_record_id,
      TG_OP,
      v_user_id,
      v_old_values,
      v_new_values,
      v_changed_fields
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS audit_trigger_contacts ON contacts;
DROP TRIGGER IF EXISTS audit_trigger_addresses ON addresses;
DROP TRIGGER IF EXISTS audit_trigger_contact_methods ON contact_methods;

-- Create audit triggers for contacts, addresses, and contact_methods tables
DO $$
BEGIN
    -- Only create triggers if audit_logs table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
        -- Contacts table
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contacts') THEN
            CREATE TRIGGER audit_trigger_contacts
              BEFORE INSERT OR UPDATE OR DELETE ON contacts
              FOR EACH ROW
              EXECUTE FUNCTION audit_trigger_function();
        END IF;
        
        -- Addresses table
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'addresses') THEN
            CREATE TRIGGER audit_trigger_addresses
              BEFORE INSERT OR UPDATE OR DELETE ON addresses
              FOR EACH ROW
              EXECUTE FUNCTION audit_trigger_function();
        END IF;
        
        -- Contact methods table
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contact_methods') THEN
            CREATE TRIGGER audit_trigger_contact_methods
              BEFORE INSERT OR UPDATE OR DELETE ON contact_methods
              FOR EACH ROW
              EXECUTE FUNCTION audit_trigger_function();
        END IF;
    END IF;
END $$;

