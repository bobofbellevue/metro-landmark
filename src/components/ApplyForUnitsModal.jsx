import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { X, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { parseTemplateData } from '../utils/template-data.js';
import { ConfirmationModal } from './ui';
import { ApplicationFormBuilder } from './ApplicationFormBuilder';
import { extractFormValues } from '../utils/pdf-to-json-client.js';
import { mapImportedDataToTemplate, normalizeDates } from '../utils/application-data-mapper.js';
import { formatUnitQualifier } from '../utils/unit-display.js';

// Helper functions moved to utility file - imported above

function ApplyForUnitsModal({
  applicant,
  onClose,
  onApplySuccess,
  showFullApplication = false,
  preselectedUnits = [],
  readOnly = false,
  customTitle = null
}) {
  const { user } = useContext(AuthContext);
  const [units, setUnits] = useState([]);
  const [applications, setApplications] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUnits, setSelectedUnits] = useState(preselectedUnits);
  const [unitNotes, _setUnitNotes] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [_isDragging, _setIsDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const formatAddress = (address) => {
    if (!address) return '';
    const parts = [
      address.address_line_1,
      address.address_line_2,
      address.city,
      address.state_province_region,
      address.postal_code
    ].filter(Boolean);
    return parts.join(', ');
  };

  const formatBrBa = (beds, baths) => {
    const bedVal = beds === null || beds === undefined || beds === '' ? null : beds;
    const bathVal = baths === null || baths === undefined || baths === '' ? null : baths;
    const bedStr = bedVal !== null ? `${bedVal}BR` : null;
    const bathStr = bathVal !== null ? `${bathVal}BA` : null;
    return [bedStr, bathStr].filter(Boolean).join(' ');
  };

  const parseParkingFromFeatures = (unit) => {
    const featureNames =
      unit?.unit_features?.map(uf => uf?.features?.feature_name).filter(Boolean) || [];

    const ruleDedicated = featureNames.includes('parking_rule:dedicated');
    const ruleFcfs = featureNames.includes('parking_rule:first_come_first_serve');

    const counts = {
      garage: 0,
      carport: 0,
      paved_driveway: 0,
      off_street: 0,
    };

    for (const name of featureNames) {
      const m = name.match(/^parking_dedicated_(garage|carport|paved_driveway|off_street)_spaces:(\d+)$/);
      if (m) {
        counts[m[1]] = parseInt(m[2], 10);
      }
    }

    const parts = [];
    if (ruleFcfs) {
      parts.push('Parking: First-come first-serve');
    } else if (ruleDedicated) {
      const detail = [];
      if (counts.garage) detail.push(`${counts.garage} garage`);
      if (counts.carport) detail.push(`${counts.carport} carport`);
      if (counts.paved_driveway) detail.push(`${counts.paved_driveway} driveway`);
      if (counts.off_street) detail.push(`${counts.off_street} off-street`);
      parts.push(`Parking: Dedicated${detail.length ? ` (${detail.join(', ')})` : ''}`);
    }

    return {
      summary: parts.join(' • '),
      featureNames,
    };
  };

  const getUnitParkingDisplay = (unit) => {
    if (!unit) return null;
    const parkingValue =
      unit.parking ??
      unit.parking_spaces ??
      unit.parking_spots ??
      unit.parking_count ??
      null;
    if (parkingValue === null || parkingValue === undefined || parkingValue === '') return null;
    return `${parkingValue} parking`;
  };

  // mapImportedDataToTemplate and normalizeDates are now imported from utility

  const [documentData, setDocumentData] = useState(() => {
    try {
      const initialData = applicant?.document_data || {};
      return initialData;
    } catch (error) {
      console.error('Fill Application: Error in useState initializer:', error);
      return {};
    }
  });

  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [importProgress, setImportProgress] = useState({ stage: '', progress: 0, message: '' });
  const [importedFile, setImportedFile] = useState(null);
  const fillApplicationFileInputRef = useRef(null);
  
  // selectedTemplateData must be defined before useEffect that uses it (TDZ fix)
  const selectedTemplateData = useMemo(() => {
    if (!selectedTemplate) return {};
    return selectedTemplate.parsed_template_data || parseTemplateData(selectedTemplate);
  }, [selectedTemplate]);

  // Fetch application data from database when modal opens or applicant changes
  useEffect(() => {
    const fetchApplicationData = async () => {
      if (!showFullApplication || !applicant) {
        console.log('[ApplyForUnitsModal] fetchApplicationData: Skipping - showFullApplication:', showFullApplication, 'applicant:', applicant?.client_id || applicant?.applicant_id);
        return;
      }
      
      const clientId = applicant?.client_id || applicant?.applicant_id;
      const applicantUserId = applicant?.user_id;
      console.log('[ApplyForUnitsModal] fetchApplicationData: Starting fetch for client_id:', clientId, 'user_id:', applicantUserId);
      
      if (!clientId) {
        console.warn('[ApplyForUnitsModal] fetchApplicationData: No client_id found');
        return;
      }
      
      setIsLoadingData(true);
      try {
        // Fetch the most recent application from database
        const { data: applications, error } = await supabase
          .from('client_applications')
          .select('*')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(1);
        
        console.log('[ApplyForUnitsModal] fetchApplicationData: Fetched applications:', {
          count: applications?.length || 0,
          error: error?.message,
          application_id: applications?.[0]?.application_id,
          has_field_data: !!applications?.[0]?.field_data,
          field_data_keys: applications?.[0]?.field_data ? Object.keys(applications[0].field_data) : []
        });
        
        if (error) {
          console.error('[ApplyForUnitsModal] Error fetching application data:', error);
          // Fall back to prop data if database fetch fails
          if (applicant?.document_data && Object.keys(applicant.document_data).length > 0) {
            console.log('[ApplyForUnitsModal] fetchApplicationData: Using prop document_data as fallback');
            setDocumentData(applicant.document_data);
          } else {
            console.log('[ApplyForUnitsModal] fetchApplicationData: No document_data available');
            setDocumentData({});
          }
          setIsLoadingData(false);
          return;
        }
        
        // Use field_data from database if available, otherwise fall back to document_data from prop
        const dbData = applications?.[0]?.field_data;
        const propData = applicant?.document_data;
        const sourceData = dbData && Object.keys(dbData).length > 0 ? dbData : propData;
        
        console.log('[ApplyForUnitsModal] fetchApplicationData: Data source decision:', {
          has_db_data: !!dbData,
          db_data_keys: dbData ? Object.keys(dbData) : [],
          has_prop_data: !!propData,
          prop_data_keys: propData ? Object.keys(propData) : [],
          using_source: dbData && Object.keys(dbData).length > 0 ? 'database' : 'prop',
          source_data_keys: sourceData ? Object.keys(sourceData) : []
        });
        
        if (sourceData && Object.keys(sourceData).length > 0) {
          if (selectedTemplateData && Object.keys(selectedTemplateData).length > 0) {
            // Check if data is already in template structure by comparing top-level keys
            // If data keys match template category keys, it's likely already mapped
            const dataKeys = Object.keys(sourceData);
            const templateKeys = Object.keys(selectedTemplateData);
            const matchingKeys = dataKeys.filter(key => templateKeys.includes(key));
            const isAlreadyMapped = matchingKeys.length > 0 && matchingKeys.length >= dataKeys.length * 0.5;
            
            console.log('[ApplyForUnitsModal] fetchApplicationData: Template mapping decision:', {
              isAlreadyMapped,
              matchingKeys_count: matchingKeys.length,
              dataKeys_count: dataKeys.length,
              templateKeys_count: templateKeys.length
            });
            
            if (isAlreadyMapped) {
              // Data appears to already be in template structure, just normalize dates
              const normalized = normalizeDates(sourceData);
              console.log('[ApplyForUnitsModal] fetchApplicationData: Using normalized data (already mapped)');
              setDocumentData(normalized);
            } else {
              // Data needs mapping to template structure
              const mapped = mapImportedDataToTemplate(sourceData, selectedTemplateData);
              const normalized = normalizeDates(mapped);
              console.log('[ApplyForUnitsModal] fetchApplicationData: Using mapped and normalized data');
              setDocumentData(normalized);
            }
          } else {
            console.log('[ApplyForUnitsModal] fetchApplicationData: No template data, using source data as-is');
            setDocumentData(sourceData);
          }
        } else {
          console.log('[ApplyForUnitsModal] fetchApplicationData: No source data available, setting empty object');
          setDocumentData({});
        }
        
        // Also check for documents
        if (applicantUserId) {
          console.log('[ApplyForUnitsModal] fetchApplicationData: Checking for documents with tenant_user_id:', applicantUserId);
          // Note: Documents are loaded by DocumentManagement component, but we can log here
        }
      } catch (error) {
        console.error('[ApplyForUnitsModal] Error in fetchApplicationData:', error);
        // Fall back to prop data on error
        if (applicant?.document_data && Object.keys(applicant.document_data).length > 0) {
          console.log('[ApplyForUnitsModal] fetchApplicationData: Using prop document_data as error fallback');
          setDocumentData(applicant.document_data);
        } else {
          console.log('[ApplyForUnitsModal] fetchApplicationData: No document_data available after error');
          setDocumentData({});
        }
      } finally {
        setIsLoadingData(false);
      }
    };
    
    fetchApplicationData();
  }, [applicant, showFullApplication, selectedTemplateData]);

  useEffect(() => {
    console.log('[UNIT_TRACKING] ApplyForUnitsModal: useEffect for unit selection:', {
      preselectedUnitsCount: preselectedUnits.length,
      unitsCount: units.length,
      applicationsCount: applications.length,
      selectedUnitsCount: selectedUnits.length,
      preselectedUnitIds: preselectedUnits.map(u => u.unit_id),
      applicationUnitIds: applications.map(a => a.unit_id).filter(Boolean)
    });

    // First priority: use preselected units if provided
    if (preselectedUnits.length > 0 && units.length > 0) {
      // Match preselected units (which may just have unit_id) with actual unit objects
      const matchedUnits = preselectedUnits
        .map(preselected => {
          if (preselected.unit_id) {
            return units.find(u => u.unit_id === preselected.unit_id);
          }
          return preselected;
        })
        .filter(Boolean); // Remove any undefined values
      
      console.log('[UNIT_TRACKING] ApplyForUnitsModal: Matching preselected units:', {
        preselectedCount: preselectedUnits.length,
        matchedCount: matchedUnits.length,
        preselectedUnitIds: preselectedUnits.map(u => u.unit_id),
        matchedUnitIds: matchedUnits.map(u => u.unit_id)
      });
      
      if (matchedUnits.length > 0) {
        setSelectedUnits(matchedUnits);
        return; // Don't check applications if we have preselected units
      }
    }
    
    // Second priority: if no preselected units and no current selection, use units from fetched applications
    if (preselectedUnits.length === 0 && selectedUnits.length === 0 && units.length > 0 && applications.length > 0) {
      const appsWithUnits = applications.filter(app => app.unit_id);
      console.log('[UNIT_TRACKING] ApplyForUnitsModal: Checking fetched applications for units:', {
        appsWithUnitsCount: appsWithUnits.length,
        appsWithUnits: appsWithUnits.map(a => ({ application_id: a.application_id, unit_id: a.unit_id }))
      });
      
      if (appsWithUnits.length > 0) {
        const unitIds = appsWithUnits.map(app => app.unit_id);
        const matchedUnits = units.filter(u => unitIds.includes(u.unit_id));
        console.log('[UNIT_TRACKING] ApplyForUnitsModal: Found units from applications:', {
          unitIds: unitIds,
          matchedUnitsCount: matchedUnits.length,
          matchedUnitIds: matchedUnits.map(u => u.unit_id)
        });
        
        if (matchedUnits.length > 0) {
          console.log('[UNIT_TRACKING] ApplyForUnitsModal: Setting selectedUnits from fetched applications');
          setSelectedUnits(matchedUnits);
        }
      }
    }
  }, [preselectedUnits, units, applications]);

  // Fetch application templates
  useEffect(() => {
    const fetchTemplates = async () => {
      if (!showFullApplication || !user) return;

      setLoadingTemplates(true);
      try {
        let query = supabase
          .from('templates')
          .select(`
                        template_id,
                        template_name,
                        template_type,
                        template_level,
                        template_data,
                        template_data_raw,
                        is_default,
                        pmc_id,
                        landlord_id,
                        pm_companies(company_name)
                    `)
          .eq('template_type', 'Application')
          .order('is_default', { ascending: false })
          .order('template_level', { ascending: true })
          .order('template_name', { ascending: true });

        // Apply role-based filtering
        if (user?.role === 'global_admin') {
          // Global admin sees all templates
        } else if (user?.role === 'company_admin' && user?.pmc_id) {
          query = query.or(`template_level.eq.system,template_level.eq.company.and(pmc_id.eq.${user.pmc_id}),template_level.eq.company.and(applies_to_all_companies.eq.true)`);
        } else {
          // Limited access for other roles - only system templates
          query = query.eq('template_level', 'system');
        }

        const { data, error } = await query;

        if (error) {
          console.error('Error fetching templates:', error);
          setTemplates([]);
          setFormError('Failed to load application templates. Please refresh the page.');
        } else {
          const templatesList = (data || []).map(template => ({
            ...template,
            parsed_template_data: parseTemplateData(template)
          }));
          setTemplates(templatesList);
          
          // Auto-select default template if available
          if (templatesList.length > 0) {
            const defaultTemplate = templatesList.find(t => t.is_default);
            if (defaultTemplate) {
              setSelectedTemplate(defaultTemplate);
            } else if (templatesList.length === 1) {
              setSelectedTemplate(templatesList[0]);
            }
          } else {
            setFormError('No application templates found. Please contact your administrator.');
          }
        }
      } catch (error) {
        console.error('Error fetching templates:', error);
        setTemplates([]);
        setFormError('Failed to load application templates. Please refresh the page.');
      } finally {
        setLoadingTemplates(false);
      }
    };

    fetchTemplates();
  }, [showFullApplication, user]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Use client_id (applicant_id maps to client_id in the applicant object)
        const clientId = applicant?.client_id || applicant?.applicant_id;

        if (!clientId) {
          console.error('[ApplyForUnitsModal] No client_id/applicant_id found in applicant object:', applicant);
          setFormError('Invalid applicant data. Please refresh the page.');
          return;
        }

        const [unitsResult, applicationsResult] = await Promise.all([
          supabase.from('units').select(`
                        *,
                        unit_features(
                          feature_id,
                          features(feature_name)
                        ),
                        properties!inner(
                            property_id,
                            property_type,
                            property_name,
                            landlord_id,
                            pmc_id
                        )
                    `),
          supabase.from('client_applications').select('*').eq('client_id', clientId)
        ]);

        if (unitsResult.error) {
          console.error('[ApplyForUnitsModal] Units query error:', unitsResult.error);
          throw unitsResult.error;
        }
        if (applicationsResult.error) {
          console.error('[ApplyForUnitsModal] Applications query error:', applicationsResult.error);
          throw applicationsResult.error;
        }

        // Enrich units with property address + landlord/PM company names for display and searching
        const loadedUnits = unitsResult.data || [];
        const propertyIds = [...new Set(loadedUnits.map(u => u.properties?.property_id).filter(Boolean))];
        const landlordIds = [...new Set(loadedUnits.map(u => u.properties?.landlord_id).filter(Boolean))];
        const pmcIds = [...new Set(loadedUnits.map(u => u.properties?.pmc_id).filter(Boolean))];

        const [addressesResult, landlordContactsResult, pmCompaniesResult] = await Promise.all([
          propertyIds.length > 0
            ? supabase.from('addresses').select('*').eq('addressable_type', 'property').in('addressable_id', propertyIds)
            : Promise.resolve({ data: [], error: null }),
          landlordIds.length > 0
            ? supabase.from('contacts').select('contactable_id, first_name, middle_name, last_name').eq('contactable_type', 'landlord').in('contactable_id', landlordIds)
            : Promise.resolve({ data: [], error: null }),
          pmcIds.length > 0
            ? supabase.from('pm_companies').select('pmc_id, company_name').in('pmc_id', pmcIds)
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (addressesResult.error) console.warn('[ApplyForUnitsModal] Addresses query error:', addressesResult.error);
        if (landlordContactsResult.error) console.warn('[ApplyForUnitsModal] Landlord contacts query error:', landlordContactsResult.error);
        if (pmCompaniesResult.error) console.warn('[ApplyForUnitsModal] PM companies query error:', pmCompaniesResult.error);

        const addressesByPropertyId = new Map((addressesResult.data || []).map(a => [a.addressable_id, a]));
        const landlordNameById = new Map(
          (landlordContactsResult.data || []).map(c => {
            const name = [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' ').trim();
            return [c.contactable_id, name || ''];
          })
        );
        const pmCompanyNameById = new Map((pmCompaniesResult.data || []).map(p => [p.pmc_id, p.company_name || '']));

        const enrichedUnits = loadedUnits.map(u => {
          const propertyId = u.properties?.property_id;
          const landlordId = u.properties?.landlord_id;
          const pmcId = u.properties?.pmc_id;
          return {
            ...u,
            property_address: propertyId ? (addressesByPropertyId.get(propertyId) || null) : null,
            landlord_name: landlordId ? (landlordNameById.get(landlordId) || '') : '',
            pm_company_name: pmcId ? (pmCompanyNameById.get(pmcId) || '') : '',
          };
        });

        setUnits(enrichedUnits);
        const fetchedApplications = applicationsResult.data || [];
        console.log('[UNIT_TRACKING] ApplyForUnitsModal: Fetched applications:', {
          count: fetchedApplications.length,
          applications: fetchedApplications.map(a => ({
            application_id: a.application_id,
            unit_id: a.unit_id,
            status: a.status
          }))
        });
        setApplications(fetchedApplications);
        // Clear any previous errors on successful load
        setFormError('');
      } catch (error) {
        console.error('[ApplyForUnitsModal] Error fetching data:', error);
        setFormError('Failed to load data. Please refresh the page.');
      }
    };

    if (applicant) {
      fetchData();
    }
  }, [applicant]);

  const handleFillApplicationFileImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setIsLoadingData(true);
    setImportProgress({ stage: 'Extracting', progress: 0, message: 'Reading file...' });

    try {
      setImportProgress({ stage: 'Extracting', progress: 50, message: 'Extracting form values...' });
      const extractedData = await extractFormValues(file);
      
      if (!extractedData || Object.keys(extractedData).length === 0) {
        throw new Error('No data extracted from file');
      }

      // Store the imported file for later upload
      setImportedFile(file);

      setImportProgress({ stage: 'Mapping', progress: 70, message: 'Mapping to template...' });
      
      if (selectedTemplateData && Object.keys(selectedTemplateData).length > 0) {
        const mapped = mapImportedDataToTemplate(extractedData, selectedTemplateData);
        
        setImportProgress({ stage: 'Normalizing', progress: 85, message: 'Normalizing dates...' });
        const normalized = normalizeDates(mapped);
        
        setDocumentData(normalized);
      } else {
        const normalized = normalizeDates(extractedData);
        setDocumentData(normalized);
      }

      setImportProgress({ stage: 'Complete', progress: 100, message: 'Import complete!' });
      
      // Reset file input
      if (fillApplicationFileInputRef.current) {
        fillApplicationFileInputRef.current.value = '';
      }
    } catch (error) {
      setFormError(`Import failed: ${error.message}`);
      setImportProgress({ stage: 'Error', progress: 0, message: error.message });
      setImportedFile(null);
    } finally {
      setIsImporting(false);
      setIsLoadingData(false);
      setTimeout(() => {
        setImportProgress({ stage: '', progress: 0, message: '' });
      }, 3000);
    }
  };

  const handleSubmit = async () => {
    if (showFullApplication && (!selectedTemplate || !documentData)) {
      setFormError('Please select a template and fill in the application form.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      if (showFullApplication) {
        const clientId = applicant?.client_id || applicant?.applicant_id;
        
        if (!clientId) {
          console.error('[ApplyForUnitsModal] Cannot save application: no client_id/applicant_id found:', applicant);
          setFormError('Invalid applicant data. Cannot save application.');
          setIsSubmitting(false);
          return;
        }

        // Get selected unit_id if available (use first selected unit if multiple)
        const selectedUnitId = selectedUnits && selectedUnits.length > 0 
          ? selectedUnits[0]?.unit_id || null 
          : null;

        console.log('[UNIT_TRACKING] ApplyForUnitsModal: Saving application:', {
          clientId,
          selectedUnitId,
          selectedUnitsCount: selectedUnits?.length || 0,
          selectedUnits: selectedUnits?.map(u => ({ unit_id: u.unit_id, unit_number: u.unit_number })) || []
        });

        // Check if application already exists
        let applicationId = applicant?.applications?.[0]?.application_id;
        
        // If no application exists, create one
        if (!applicationId) {
          const insertData = {
              client_id: clientId,
              field_data: documentData,
              template_id: selectedTemplate.template_id,
              status: 'draft',
              applied_at: new Date().toISOString()
          };
          
          // Include unit_id if a unit is selected
          if (selectedUnitId) {
            insertData.unit_id = selectedUnitId;
          }

          console.log('[UNIT_TRACKING] ApplyForUnitsModal: Creating new application with data:', {
            client_id: insertData.client_id,
            unit_id: insertData.unit_id,
            status: insertData.status
          });

          const { data: newApplication, error: createError } = await supabase
            .from('client_applications')
            .insert(insertData)
            .select()
            .single();

          if (createError) {
            console.error('[UNIT_TRACKING] ApplyForUnitsModal: ERROR creating application:', createError);
            throw createError;
          }

          applicationId = newApplication.application_id;
          console.log('[UNIT_TRACKING] ApplyForUnitsModal: Application created:', {
            application_id: applicationId,
            unit_id: newApplication.unit_id,
            client_id: newApplication.client_id
          });
        } else {
          // Update existing application
          const updateData = {
              field_data: documentData,
              template_id: selectedTemplate.template_id
          };
          
          // Include unit_id if a unit is selected (update it if it wasn't set before)
          if (selectedUnitId) {
            updateData.unit_id = selectedUnitId;
          }

          console.log('[UNIT_TRACKING] ApplyForUnitsModal: Updating application:', {
            application_id: applicationId,
            unit_id: updateData.unit_id,
            willUpdateUnitId: !!updateData.unit_id
          });

          const { error: updateError } = await supabase
            .from('client_applications')
            .update(updateData)
            .eq('application_id', applicationId);

          if (updateError) {
            console.error('[UNIT_TRACKING] ApplyForUnitsModal: ERROR updating application:', updateError);
            throw updateError;
          }

          console.log('[UNIT_TRACKING] ApplyForUnitsModal: Application updated successfully');
        }

        // Upload imported file as a document if it exists
        if (importedFile && applicationId) {
          try {
            // Get user ID for document upload
            let userId = null;
            try {
              const { data: { user: authUser } } = await supabase.auth.getUser();
              userId = authUser?.id || user?.user_id || null;
            } catch {
              userId = user?.user_id || null;
            }

            // Convert file to base64
            const base64Data = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = (error) => reject(error);
              reader.readAsDataURL(importedFile);
            });

            // Upload document
            const uploadResponse = await fetch('/api/documents/upload', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                file: base64Data,
                file_name: importedFile.name,
                file_type: importedFile.type,
                mime_type: importedFile.type,
                tenant_user_id: userId, // For applications, use tenant_user_id (user_id from clients table)
                document_type: 'rental_application',
                user_id: userId
              })
            });

            const uploadResult = await uploadResponse.json();
            if (!uploadResult.success) {
              // Don't fail the whole operation - document upload is optional
            }
          } catch (fileError) {
            // Don't fail the whole operation - document upload is optional
          }
        }
        
        if (onApplySuccess) {
          onApplySuccess();
        }
      } else {
        // Create new applications for selected units
        const clientId = applicant?.client_id || applicant?.applicant_id;
        
        if (!clientId) {
          console.error('[ApplyForUnitsModal] Cannot create applications: no client_id/applicant_id in applicant object:', applicant);
          setFormError('Invalid applicant data. Cannot create applications.');
          return;
        }

        const alreadyAppliedUnitIds = new Set(
          (applications || []).map(a => a.unit_id).filter(Boolean)
        );
        const unitsToApplyFor = (selectedUnits || []).filter(u => u?.unit_id && !alreadyAppliedUnitIds.has(u.unit_id));

        // If everything selected is already applied for, just close (no-op)
        if (unitsToApplyFor.length === 0) {
          handleClose();
          return;
        }

        const newApplications = await Promise.all(
          unitsToApplyFor.map(async (unit) => {
            const { data, error } = await supabase
              .from('client_applications')
              .insert({
                client_id: clientId,
                unit_id: unit.unit_id,
                status: 'pending',
                notes: unitNotes[unit.unit_id] || '',
                applied_at: new Date().toISOString()
              })
              .select()
              .single();

            if (error) {
              console.error('[ApplyForUnitsModal] Error creating application for unit', unit.unit_id, ':', error);
              throw error;
            }
            return data;
          })
        );
        if (onApplySuccess) {
          onApplySuccess(newApplications);
        }
      }

      handleClose();
    } catch (error) {
      console.error('Error submitting application:', error);
      setFormError(`Failed to ${showFullApplication ? 'update' : 'submit'} application: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Wrapper to clear temporary data before closing
  const handleClose = () => {
    // Clear temporary document_data from applicant prop when closing
    if (applicant?.document_data) {
      delete applicant.document_data;
    }
    onClose();
  };

  const handleDeleteApplication = async () => {
    if (!confirmDelete) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('client_applications')
        .delete()
        .eq('application_id', confirmDelete);

      if (error) {
        console.error('[ApplyForUnitsModal] Error deleting application:', error);
        throw error;
      }

      if (onApplySuccess) {
        onApplySuccess();
      }

      setConfirmDelete(null);
      handleClose();
    } catch (error) {
      console.error('[ApplyForUnitsModal] Error deleting application:', error);
      setFormError(`Failed to delete application: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredUnits = units.filter((unit) => {
    const normalizedSearch = (searchTerm || '').trim().toLowerCase();
    if (!normalizedSearch) return true;

    // Multi-term AND search: "redmond 2br" => must match both terms somewhere in the searchable text
    const terms = normalizedSearch.split(/\s+/).filter(Boolean);
    const addressStr = formatAddress(unit.property_address).toLowerCase();
    const parkingStr = (getUnitParkingDisplay(unit) || '').toLowerCase();
    const brba = formatBrBa(unit.beds, unit.baths).toLowerCase();
    const parsedParking = parseParkingFromFeatures(unit);
    const parkingSummary = (parsedParking.summary || '').toLowerCase();

    const haystack = [
      unit.unit_number,
      unit.properties?.property_name,
      unit.properties?.property_type,
      addressStr,
      brba,
      unit.beds?.toString(),
      unit.baths?.toString(),
      unit.square_footage?.toString(),
      parkingStr,
      parkingSummary,
      ...(parsedParking.featureNames || []),
      unit.landlord_name,
      unit.pm_company_name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return terms.every(term => haystack.includes(term));
  });

  const displayedUnits = useMemo(() => {
    const selectedIdSet = new Set((selectedUnits || []).map(u => u?.unit_id).filter(Boolean));
    const byString = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

    return [...filteredUnits].sort((a, b) => {
      const aSel = selectedIdSet.has(a?.unit_id);
      const bSel = selectedIdSet.has(b?.unit_id);
      if (aSel !== bSel) return aSel ? -1 : 1;

      const aCity = a?.property_address?.city || '';
      const bCity = b?.property_address?.city || '';
      const cityCmp = byString(aCity, bCity);
      if (cityCmp !== 0) return cityCmp;

      const aStreet = a?.property_address?.address_line_1 || '';
      const bStreet = b?.property_address?.address_line_1 || '';
      const streetCmp = byString(aStreet, bStreet);
      if (streetCmp !== 0) return streetCmp;

      const aUnit = a?.unit_number?.toString() || '';
      const bUnit = b?.unit_number?.toString() || '';
      return byString(aUnit, bUnit);
    });
  }, [filteredUnits, selectedUnits]);

  if (!applicant) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <h2 className="text-xl font-semibold">
            {customTitle || (showFullApplication ? 'Fill Application' : 'Select Units')}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={24} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto">
          {showFullApplication && (
            <>
              <div className="p-6 border-b">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Application Template
                </label>
                {loadingTemplates ? (
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
                    <div className="text-sm text-gray-500">Loading templates...</div>
                  </div>
                ) : (
                  <select
                    value={selectedTemplate?.template_id || ''}
                    onChange={(e) => {
                      const template = templates.find(t => t.template_id === e.target.value);
                      setSelectedTemplate(template || null);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select a template...</option>
                    {templates.map((template) => (
                      <option key={template.template_id} value={template.template_id}>
                        {template.template_name} {template.is_default ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedTemplate && (
                <div className="p-6">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Import Application File (PDF, DOCX)
                    </label>
                    <input
                      ref={fillApplicationFileInputRef}
                      type="file"
                      accept=".pdf,.docx"
                      onChange={handleFillApplicationFileImport}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                      disabled={isImporting}
                    />
                    {isImporting && (
                      <div className="mt-2 text-sm text-gray-600">
                        <div>{importProgress.stage}: {importProgress.message}</div>
                        <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                          <div 
                            className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${importProgress.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Loading indicator when mapping document data to template or importing file */}
                  {(isLoadingData || isImporting) ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="flex flex-col items-center gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                        <p className="text-sm text-gray-600">
                          {isImporting && importProgress.stage ? `${importProgress.stage}: ${importProgress.message}` : 'Loading application data...'}
                        </p>
                        {isImporting && importProgress.progress > 0 && (
                          <div className="w-64 bg-gray-200 rounded-full h-2 mt-1">
                            <div 
                              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${importProgress.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <ApplicationFormBuilder
                      templateData={selectedTemplateData}
                      documentData={documentData}
                      onChange={(newData) => {
                        setDocumentData(newData);
                      }}
                      readOnly={readOnly}
                    />
                  )}
                </div>
              )}
            </>
          )}

          {!showFullApplication && (
            <>
              <div className="p-6 border-b">
                <input
                  type="text"
                  placeholder="Search units (address, beds/baths, landlord, PM company)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="p-6">
                {displayedUnits.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    {searchTerm ? 'No units found matching your search.' : 'No units available.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {displayedUnits.map((unit) => {
                      const parkingDisplay = getUnitParkingDisplay(unit);
                      const brba = formatBrBa(unit.beds, unit.baths);
                      const parsedParking = parseParkingFromFeatures(unit);

                      return (
                        <div
                          key={unit.unit_id}
                          className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-colors ${
                            selectedUnits.some(u => u.unit_id === unit.unit_id)
                              ? 'border-indigo-500 bg-indigo-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          onClick={() => {
                            setSelectedUnits(prev => {
                              const isSelected = prev.some(u => u.unit_id === unit.unit_id);
                              if (isSelected) {
                                return prev.filter(u => u.unit_id !== unit.unit_id);
                              } else {
                                return [...prev, unit];
                              }
                            });
                          }}
                        >
                          <div>
                            <div className="font-medium">
                              {formatUnitQualifier(unit) || unit.properties?.property_name || ''}
                              {formatUnitQualifier(unit) && unit.properties?.property_name ? (
                                <span className="ml-2 text-sm font-normal text-gray-600">
                                  {unit.properties.property_name}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-sm text-gray-600">
                              {formatAddress(unit.property_address) || 'Address not available'}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500">
                              {brba && <span>{brba}</span>}
                              {parkingDisplay && <span>{parkingDisplay}</span>}
                              {unit.square_footage && <span>{unit.square_footage} sqft</span>}
                              {unit.properties?.property_type && <span className="capitalize">{unit.properties.property_type}</span>}
                            </div>
                            {parsedParking.summary ? (
                              <div className="mt-1 text-xs text-gray-500">{parsedParking.summary}</div>
                            ) : null}
                            {(unit.landlord_name || unit.pm_company_name) && (
                              <div className="mt-1 text-xs text-gray-500">
                                {unit.landlord_name ? `Landlord: ${unit.landlord_name}` : null}
                                {unit.landlord_name && unit.pm_company_name ? ' • ' : null}
                                {unit.pm_company_name ? `PM: ${unit.pm_company_name}` : null}
                              </div>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            checked={selectedUnits.some(u => u.unit_id === unit.unit_id)}
                            onChange={() => {}}
                            className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {formError && (
            <div className="px-6 py-3 bg-red-50 border-t border-red-200">
              <div className="text-sm text-red-800">{formError}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        {readOnly ? (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            {showFullApplication ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || !selectedTemplate}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting || selectedUnits.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : `Apply for ${selectedUnits.length} Unit${selectedUnits.length !== 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </div>
        )}

        <ConfirmationModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={handleDeleteApplication}
          title="Delete Application"
          message="Are you sure you want to delete this application? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          isDestructive={true}
          isLoading={isSubmitting}
        />
      </div>
    </div>
  );
}

export default ApplyForUnitsModal;
