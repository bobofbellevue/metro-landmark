import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Save, Edit2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * FormExtractionReview component for reviewing and correcting extracted form data
 * 
 * Props:
 * - applicationId: Integer (application_id from client_applications)
 * - documentId: Integer (optional, document_id for reference)
 * - onSave: Function (optional, callback when data is saved)
 * - onCancel: Function (optional, callback when cancelled)
 */
export default function FormExtractionReview({
  applicationId,
  documentId,
  onSave,
  onCancel
}) {
  const [fieldData, setFieldData] = useState({});
  const [originalData, setOriginalData] = useState({});
  const [processingStatus, setProcessingStatus] = useState('pending');
  const [confidence, setConfidence] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editedFields, setEditedFields] = useState(new Set());
  const [fieldConfidences, setFieldConfidences] = useState({});

  useEffect(() => {
    if (applicationId) {
      loadApplicationData();
    }
  }, [applicationId]);

  const loadApplicationData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch application with field_data
      const { data: application, error: appError } = await supabase
        .from('client_applications')
        .select('field_data, processing_status, extraction_confidence, template_id')
        .eq('application_id', applicationId)
        .single();

      if (appError) throw appError;

      if (application) {
        setFieldData(application.field_data || {});
        setOriginalData(JSON.parse(JSON.stringify(application.field_data || {})));
        setProcessingStatus(application.processing_status || 'pending');
        setConfidence(application.extraction_confidence);
        setTemplateId(application.template_id);

        // Load template if available
        if (application.template_id) {
          const { data: templateData, error: templateError } = await supabase
            .from('templates')
            .select('template_data, template_name')
            .eq('template_id', application.template_id)
            .single();

          if (!templateError && templateData) {
            setTemplate(templateData.template_data);
          }
        }

        // Initialize field confidences (if we had per-field confidence, use it)
        // For now, use overall confidence for all fields
        const confidences = {};
        if (application.extraction_confidence) {
          // Distribute confidence across fields (simplified - in real implementation, 
          // we'd track per-field confidence from extraction)
          Object.keys(application.field_data || {}).forEach(category => {
            Object.keys(application.field_data[category] || {}).forEach(field => {
              confidences[`${category}.${field}`] = application.extraction_confidence;
            });
          });
        }
        setFieldConfidences(confidences);
      }
    } catch (err) {
      console.error('Error loading application data:', err);
      setError(err.message || 'Failed to load application data');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (category, field, value) => {
    setFieldData(prev => {
      const updated = { ...prev };
      if (!updated[category]) updated[category] = {};
      updated[category] = { ...updated[category], [field]: value };
      return updated;
    });

    // Track edited fields
    setEditedFields(prev => new Set([...prev, `${category}.${field}`]));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('client_applications')
        .update({
          field_data: fieldData,
          processing_status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('application_id', applicationId);

      if (updateError) throw updateError;

      // Update document metadata if documentId provided
      if (documentId) {
        await supabase
          .from('documents')
          .update({
            metadata: {
              processing_status: 'completed',
              reviewed: true,
              reviewed_at: new Date().toISOString()
            }
          })
          .eq('document_id', documentId);
      }

      if (onSave) {
        onSave(fieldData);
      }
    } catch (err) {
      console.error('Error saving field data:', err);
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const getConfidenceColor = (conf) => {
    if (!conf) return 'text-gray-500';
    if (conf >= 80) return 'text-green-600';
    if (conf >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceIcon = (conf) => {
    if (!conf) return null;
    if (conf >= 80) return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (conf >= 60) return <AlertCircle className="w-4 h-4 text-yellow-600" />;
    return <XCircle className="w-4 h-4 text-red-600" />;
  };

  const isFieldEdited = (category, field) => {
    return editedFields.has(`${category}.${field}`);
  };

  const renderField = (category, field, value, fieldType = 'string') => {
    const fieldKey = `${category}.${field}`;
    const fieldConf = fieldConfidences[fieldKey];
    const isEdited = isFieldEdited(category, field);

    return (
      <div key={fieldKey} className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-700">
            {field.replace(/_/g, ' ')}
            {isEdited && (
              <span className="ml-2 text-xs text-blue-600">(edited)</span>
            )}
          </label>
          {fieldConf !== undefined && (
            <div className="flex items-center gap-1 text-xs">
              {getConfidenceIcon(fieldConf)}
              <span className={getConfidenceColor(fieldConf)}>
                {Math.round(fieldConf)}%
              </span>
            </div>
          )}
        </div>
        {fieldType === 'boolean' ? (
          <select
            value={value === true || value === 'true' ? 'true' : 'false'}
            onChange={(e) => handleFieldChange(category, field, e.target.value === 'true')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : fieldType === 'number' ? (
          <input
            type="number"
            value={value || ''}
            onChange={(e) => handleFieldChange(category, field, e.target.value ? parseFloat(e.target.value) : null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ) : fieldType === 'date' ? (
          <input
            type="date"
            value={value || ''}
            onChange={(e) => handleFieldChange(category, field, e.target.value || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <textarea
            value={value || ''}
            onChange={(e) => handleFieldChange(category, field, e.target.value || null)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>
    );
  };

  const renderCategory = (category, fields) => {
    if (!fields || typeof fields !== 'object') return null;

    return (
      <div key={category} className="mb-6 border border-gray-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {category.replace(/_/g, ' ')}
        </h3>
        <div className="space-y-2">
          {Object.entries(fields).map(([field, value]) => {
            // Determine field type from template or infer from value
            let fieldType = 'string';
            if (template && template[category] && template[category][field]) {
              fieldType = template[category][field].type || 'string';
            } else if (typeof value === 'boolean') {
              fieldType = 'boolean';
            } else if (typeof value === 'number') {
              fieldType = 'number';
            } else if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) {
              fieldType = 'date';
            }

            return renderField(category, field, value, fieldType);
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading extracted data...</span>
      </div>
    );
  }

  if (error && !fieldData || Object.keys(fieldData).length === 0) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <p className="text-red-800">{error || 'No extracted data available'}</p>
        {onCancel && (
          <button
            onClick={onCancel}
            className="mt-2 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Review Extracted Data</h2>
          <p className="text-sm text-gray-600 mt-1">
            Review and correct the automatically extracted form data
          </p>
        </div>
        {confidence !== null && (
          <div className="flex items-center gap-2">
            {getConfidenceIcon(confidence)}
            <span className={`text-sm font-medium ${getConfidenceColor(confidence)}`}>
              Overall Confidence: {Math.round(confidence)}%
            </span>
          </div>
        )}
      </div>

      {/* Status */}
      {processingStatus && (
        <div className={`p-3 rounded-md ${
          processingStatus === 'completed' ? 'bg-green-50 border border-green-200' :
          processingStatus === 'error' ? 'bg-red-50 border border-red-200' :
          'bg-yellow-50 border border-yellow-200'
        }`}>
          <p className={`text-sm ${
            processingStatus === 'completed' ? 'text-green-800' :
            processingStatus === 'error' ? 'text-red-800' :
            'text-yellow-800'
          }`}>
            Status: {processingStatus}
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Extracted fields */}
      <div className="space-y-4">
        {Object.entries(fieldData).map(([category, fields]) => 
          renderCategory(category, fields)
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </button>
      </div>
    </div>
  );
}

