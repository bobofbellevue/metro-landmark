import React, { useState, useEffect } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import DateInput from './DateInput';

/**
 * Policy Editor Component
 * Template-driven form builder for compliance policies
 */
export default function PolicyEditor({
  policy = null,
  policyType = null,
  policyLevel = null,
  onClose,
  onSave,
  pmcId = null,
  landlordId = null,
  propertyId = null
}) {
  const [selectedPolicyType, setSelectedPolicyType] = useState(policy?.policy_type || policyType || '');
  const [selectedPolicyLevel, setSelectedPolicyLevel] = useState(policy?.policy_level || policyLevel || 'system');
  const [policyName, setPolicyName] = useState(policy?.policy_name || '');
  const [description, setDescription] = useState(policy?.description || '');
  const [isDefault, setIsDefault] = useState(policy?.is_default || false);
  const [inheritanceMode, setInheritanceMode] = useState(policy?.inheritance_mode || 'extend');
  const [policyData, setPolicyData] = useState(policy?.policy_data || { sections: [] });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load template structure if creating new policy
  useEffect(() => {
    if (!policy && selectedPolicyType) {
      loadPolicyTemplate();
    }
  }, [selectedPolicyType, policy]);

  const loadPolicyTemplate = async () => {
    if (!selectedPolicyType) return;
    try {
      // Try to get a system default policy as template
      const response = await fetch(
        `/api/compliance/policies?type=${selectedPolicyType}&policy_level=system&is_default=true`
      );
      if (response.ok) {
        const { policies } = await response.json();
        if (policies && policies.length > 0) {
          const template = policies[0];
          setPolicyData(template.policy_data || { sections: [] });
          if (!policy) {
            setPolicyName(template.policy_name || '');
            setDescription(template.description || '');
          }
        } else {
          // Initialize with empty structure
          setPolicyData({ sections: [] });
        }
      }
    } catch (err) {
      console.error('Error loading policy template:', err);
      setPolicyData({ sections: [] });
    }
  };

  const handleFieldChange = (sectionIndex, fieldIndex, fieldId, value) => {
    const newPolicyData = { ...policyData };
    if (!newPolicyData.sections) {
      newPolicyData.sections = [];
    }
    if (!newPolicyData.sections[sectionIndex]) {
      newPolicyData.sections[sectionIndex] = { fields: [] };
    }
    if (!newPolicyData.sections[sectionIndex].fields) {
      newPolicyData.sections[sectionIndex].fields = [];
    }

    const field = newPolicyData.sections[sectionIndex].fields[fieldIndex];
    if (field) {
      field.value = value;
    }

    setPolicyData(newPolicyData);
  };

  const handleAddSection = () => {
    const newPolicyData = { ...policyData };
    if (!newPolicyData.sections) {
      newPolicyData.sections = [];
    }
    newPolicyData.sections.push({
      section_id: `section_${Date.now()}`,
      section_title: 'New Section',
      fields: []
    });
    setPolicyData(newPolicyData);
  };

  const handleAddField = (sectionIndex) => {
    const newPolicyData = { ...policyData };
    if (!newPolicyData.sections[sectionIndex].fields) {
      newPolicyData.sections[sectionIndex].fields = [];
    }
    newPolicyData.sections[sectionIndex].fields.push({
      field_id: `field_${Date.now()}`,
      field_type: 'text',
      label: 'New Field',
      value: '',
      required: false
    });
    setPolicyData(newPolicyData);
  };

  const handleSave = async () => {
    if (!policyName.trim()) {
      setError('Policy name is required');
      return;
    }
    if (!selectedPolicyType) {
      setError('Policy type is required');
      return;
    }
    if (!selectedPolicyLevel) {
      setError('Policy level is required');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const policyPayload = {
        policy_type: selectedPolicyType,
        policy_level: selectedPolicyLevel,
        policy_name: policyName,
        description: description || null,
        is_default: isDefault,
        policy_data: policyData,
        inheritance_mode: inheritanceMode,
        pmc_id: selectedPolicyLevel === 'company' ? pmcId : null,
        landlord_id: selectedPolicyLevel === 'landlord' ? landlordId : null,
        property_id: selectedPolicyLevel === 'property' ? propertyId : null
      };

      const url = policy
        ? `/api/compliance/policies/${policy.policy_id}`
        : '/api/compliance/policies';

      const method = policy ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyPayload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save policy');
      }

      onSave(result.policy);
    } catch (err) {
      setError(err.message || 'Failed to save policy');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderField = (field, sectionIndex, fieldIndex) => {
    const fieldId = field.field_id || `field_${fieldIndex}`;
    const value = field.value || '';

    switch (field.field_type) {
      case 'number':
        return (
          <div key={fieldId} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => handleFieldChange(sectionIndex, fieldIndex, fieldId, parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required={field.required}
            />
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
          </div>
        );

      case 'boolean':
        return (
          <div key={fieldId} className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value === true || value === 'true'}
              onChange={(e) => handleFieldChange(sectionIndex, fieldIndex, fieldId, e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <label className="text-sm font-medium text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {field.description && (
              <p className="text-xs text-gray-500 ml-2">{field.description}</p>
            )}
          </div>
        );

      case 'date':
        return (
          <div key={fieldId} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <DateInput
              value={value}
              onChange={(newValue) => handleFieldChange(sectionIndex, fieldIndex, fieldId, newValue)}
              className="w-full"
            />
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
          </div>
        );

      case 'select':
        return (
          <div key={fieldId} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              value={value}
              onChange={(e) => handleFieldChange(sectionIndex, fieldIndex, fieldId, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required={field.required}
            >
              <option value="">Select an option</option>
              {(field.options || []).map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
          </div>
        );

      case 'text':
      default:
        return (
          <div key={fieldId} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => handleFieldChange(sectionIndex, fieldIndex, fieldId, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required={field.required}
            />
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">
            {policy ? 'Edit Policy' : 'Create Policy'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isSubmitting}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              {!policy && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Policy Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedPolicyType}
                      onChange={(e) => setSelectedPolicyType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    >
                      <option value="">Select policy type</option>
                      <option value="applicant_screening">Applicant Screening</option>
                      <option value="rent_increase">Rent Increase</option>
                      <option value="eviction">Eviction</option>
                      <option value="move_in">Move-In</option>
                      <option value="move_out">Move-Out</option>
                      <option value="security_deposit">Security Deposit</option>
                      <option value="collections">Collections</option>
                      <option value="lease_violation">Lease Violation</option>
                      <option value="lease_termination">Lease Termination</option>
                      <option value="habitability">Habitability</option>
                      <option value="entry_notice">Entry Notice</option>
                      <option value="tenant_screening">Tenant Screening</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Policy Level <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedPolicyLevel}
                      onChange={(e) => setSelectedPolicyLevel(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    >
                      <option value="system">System</option>
                      <option value="company">Company</option>
                      <option value="landlord">Landlord</option>
                      <option value="property">Property</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Policy Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={policyName}
                  onChange={(e) => setPolicyName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Set as default policy</span>
                </label>
              </div>

              {selectedPolicyLevel !== 'system' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Inheritance Mode
                  </label>
                  <select
                    value={inheritanceMode}
                    onChange={(e) => setInheritanceMode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="extend">Extend (add to parent policy)</option>
                    <option value="replace">Replace (override parent policy)</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Extend: Adds to parent policy. Replace: Completely overrides parent policy.
                  </p>
                </div>
              )}
            </div>

            {/* Policy Data Sections */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800">Policy Sections</h3>
                <button
                  onClick={handleAddSection}
                  className="px-3 py-1 text-sm text-indigo-600 hover:text-indigo-800 border border-indigo-300 rounded-md"
                >
                  + Add Section
                </button>
              </div>

              {(!policyData.sections || policyData.sections.length === 0) && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-md text-center text-gray-500">
                  No sections defined. Add a section to start building your policy.
                </div>
              )}

              {policyData.sections?.map((section, sectionIndex) => (
                <div key={section.section_id || sectionIndex} className="border border-gray-200 rounded-lg p-4">
                  <div className="mb-4">
                    <input
                      type="text"
                      value={section.section_title || ''}
                      onChange={(e) => {
                        const newData = { ...policyData };
                        newData.sections[sectionIndex].section_title = e.target.value;
                        setPolicyData(newData);
                      }}
                      className="w-full px-3 py-2 text-lg font-semibold border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Section Title"
                    />
                  </div>

                  <div className="space-y-4">
                    {section.fields?.map((field, fieldIndex) => (
                      <div key={field.field_id || fieldIndex}>
                        {renderField(field, sectionIndex, fieldIndex)}
                      </div>
                    ))}
                    <button
                      onClick={() => handleAddField(sectionIndex)}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      + Add Field
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center space-x-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Save Policy</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

