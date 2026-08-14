import React, { useState, useEffect, useContext } from 'react';
import { Plus, Edit, Trash2, Eye, Search, Filter, X, ChevronRight, Building2, User, Home, Globe } from 'lucide-react';
import { AuthContext } from '../contexts';
import { Card, ConfirmationModal } from '../components/ui';
import PolicyEditor from '../components/PolicyEditor';

const POLICY_TYPES = [
  'applicant_screening',
  'rent_increase',
  'eviction',
  'move_in',
  'move_out',
  'security_deposit',
  'collections',
  'lease_violation',
  'lease_termination',
  'habitability',
  'entry_notice',
  'tenant_screening',
  'rent_control'
];

const POLICY_LEVELS = [
  { value: 'system', label: 'System', icon: Globe },
  { value: 'company', label: 'Company', icon: Building2 },
  { value: 'landlord', label: 'Landlord', icon: User },
  { value: 'property', label: 'Property', icon: Home }
];

export default function CompliancePoliciesPage() {
  const { user } = useContext(AuthContext);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [viewingPolicy, setViewingPolicy] = useState(null);
  const [deletingPolicy, setDeletingPolicy] = useState(null);
  const [viewingMerged, setViewingMerged] = useState(null);

  useEffect(() => {
    loadPolicies();
  }, [filterType, filterLevel]);

  const loadPolicies = async () => {
    setLoading(true);
    setError('');

    try {
      let url = '/api/compliance/policies?';
      const params = new URLSearchParams();
      if (filterType) params.append('policy_type', filterType);
      if (filterLevel) params.append('policy_level', filterLevel);
      url += params.toString();

      const response = await fetch(url);
      
      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const result = await response.json();
          throw new Error(result.error || `Failed to load policies: ${response.statusText}`);
        } else {
          const text = await response.text();
          throw new Error(text || `Failed to load policies: ${response.statusText}`);
        }
      }

      const result = await response.json();
      setPolicies(result.policies || []);
    } catch (err) {
      setError(err.message || 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingPolicy) return;

    try {
      const response = await fetch(`/api/compliance/policies/${deletingPolicy.policy_id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const result = await response.json();
          throw new Error(result.error || `Failed to delete policy: ${response.statusText}`);
        } else {
          const text = await response.text();
          throw new Error(text || `Failed to delete policy: ${response.statusText}`);
        }
      }

      const result = await response.json();
      setDeletingPolicy(null);
      loadPolicies();
    } catch (err) {
      setError(err.message || 'Failed to delete policy');
    }
  };

  const handleSave = () => {
    setEditingPolicy(null);
    setCreatingPolicy(false);
    loadPolicies();
  };

  const filteredPolicies = policies.filter(policy => {
    const matchesSearch = !searchTerm || 
      policy.policy_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      policy.policy_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      policy.description?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const formatPolicyType = (type) => {
    return type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || type;
  };

  const getLevelIcon = (level) => {
    const levelInfo = POLICY_LEVELS.find(l => l.value === level);
    return levelInfo ? levelInfo.icon : Globe;
  };

  const getLevelLabel = (level) => {
    const levelInfo = POLICY_LEVELS.find(l => l.value === level);
    return levelInfo ? levelInfo.label : level;
  };

  const canEdit = (policy) => {
    if (user?.role === 'global_admin') return true;
    if (policy.policy_level === 'system') return false;
    if (user?.role === 'company_admin' && policy.policy_level === 'company') return true;
    if (user?.role === 'landlord' && policy.policy_level === 'landlord') return true;
    return false;
  };

  const canDelete = (policy) => {
    if (policy.policy_level === 'system') return false;
    return canEdit(policy);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Compliance Policies</h2>
          <p className="text-gray-600 mt-2">
            Manage written policies for compliance processes. Policies inherit from higher levels (system → company → landlord → property).
          </p>
        </div>
        <button
          onClick={() => setCreatingPolicy(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center space-x-2"
        >
          <Plus className="w-5 h-5" />
          <span>Create Policy</span>
        </button>
      </div>

      {/* Filters */}
      <Card title="" className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search policies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Types</option>
            {POLICY_TYPES.map(type => (
              <option key={type} value={type}>{formatPolicyType(type)}</option>
            ))}
          </select>

          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Levels</option>
            {POLICY_LEVELS.map(level => (
              <option key={level.value} value={level.value}>{level.label}</option>
            ))}
          </select>

          {(filterType || filterLevel || searchTerm) && (
            <button
              onClick={() => {
                setFilterType('');
                setFilterLevel('');
                setSearchTerm('');
              }}
              className="px-4 py-2 text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 flex items-center space-x-2"
            >
              <X className="w-4 h-4" />
              <span>Clear Filters</span>
            </button>
          )}
        </div>
      </Card>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {/* Policies List */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading policies...</div>
      ) : filteredPolicies.length === 0 ? (
        <Card title="" className="text-center py-12">
          <p className="text-gray-500">No policies found.</p>
          <button
            onClick={() => setCreatingPolicy(true)}
            className="mt-4 px-4 py-2 text-indigo-600 hover:text-indigo-800"
          >
            Create your first policy
          </button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredPolicies.map(policy => {
            const LevelIcon = getLevelIcon(policy.policy_level);
            return (
              <Card key={policy.policy_id} title="" className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <LevelIcon className="w-5 h-5 text-gray-500" />
                      <h3 className="text-lg font-semibold text-gray-800">{policy.policy_name}</h3>
                      {policy.is_default && (
                        <span className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded">
                          Default
                        </span>
                      )}
                      {!policy.is_active && (
                        <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      <span className="font-medium">Type:</span> {formatPolicyType(policy.policy_type)} |{' '}
                      <span className="font-medium">Level:</span> {getLevelLabel(policy.policy_level)}
                    </p>
                    {policy.description && (
                      <p className="text-sm text-gray-500 mb-2">{policy.description}</p>
                    )}
                    <div className="flex items-center space-x-2 text-xs text-gray-500">
                      <span>Version {policy.version || 1}</span>
                      {policy.created_at && (
                        <span>• Created {new Date(policy.created_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => setViewingMerged(policy)}
                      className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
                      title="View merged policy (with inheritance)"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    {canEdit(policy) && (
                      <button
                        onClick={() => setEditingPolicy(policy)}
                        className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
                        title="Edit policy"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                    )}
                    {canDelete(policy) && (
                      <button
                        onClick={() => setDeletingPolicy(policy)}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md"
                        title="Delete policy"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {creatingPolicy && (
        <PolicyEditor
          onClose={() => setCreatingPolicy(false)}
          onSave={handleSave}
        />
      )}

      {editingPolicy && (
        <PolicyEditor
          policy={editingPolicy}
          policyType={editingPolicy.policy_type}
          policyLevel={editingPolicy.policy_level}
          pmcId={editingPolicy.pmc_id}
          landlordId={editingPolicy.landlord_id}
          propertyId={editingPolicy.property_id}
          onClose={() => setEditingPolicy(null)}
          onSave={handleSave}
        />
      )}

      {deletingPolicy && (
        <ConfirmationModal
          isOpen={!!deletingPolicy}
          onClose={() => setDeletingPolicy(null)}
          onConfirm={handleDelete}
          title="Delete Policy"
          message={`Are you sure you want to delete "${deletingPolicy.policy_name}"? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          isDestructive={true}
        />
      )}

      {viewingMerged && (
        <MergedPolicyViewer
          policy={viewingMerged}
          onClose={() => setViewingMerged(null)}
        />
      )}
    </div>
  );
}

// Component to view merged policy with inheritance chain
function MergedPolicyViewer({ policy, onClose }) {
  const [mergedPolicy, setMergedPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMergedPolicy();
  }, [policy]);

  const loadMergedPolicy = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/compliance/policies/${policy.policy_id}?merged=true`);
      
      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const result = await response.json();
          throw new Error(result.error || `Failed to load merged policy: ${response.statusText}`);
        } else {
          const text = await response.text();
          throw new Error(text || `Failed to load merged policy: ${response.statusText}`);
        }
      }

      const result = await response.json();
      setMergedPolicy(result.policy);
    } catch (err) {
      console.error('Error loading merged policy:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">Merged Policy View</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading merged policy...</div>
          ) : mergedPolicy ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">{mergedPolicy.policy_name}</h3>
                <div className="flex items-center space-x-4 text-sm text-gray-600">
                  <span>Type: {mergedPolicy.policy_type?.replace(/_/g, ' ')}</span>
                  <span>•</span>
                  <span>Level: {mergedPolicy.policy_level}</span>
                  {mergedPolicy.inheritance_chain && mergedPolicy.inheritance_chain.length > 1 && (
                    <>
                      <span>•</span>
                      <span>Inheritance: {mergedPolicy.inheritance_chain.join(' → ')}</span>
                    </>
                  )}
                </div>
              </div>

              {mergedPolicy.policy_data?.sections?.map((section, idx) => (
                <div key={section.section_id || idx} className="border border-gray-200 rounded-lg p-4">
                  <h4 className="text-md font-semibold text-gray-800 mb-3">{section.section_title}</h4>
                  <div className="space-y-3">
                    {section.fields?.map((field, fieldIdx) => (
                      <div key={field.field_id || fieldIdx} className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div>
                          <span className="font-medium text-gray-700">{field.label}:</span>
                          <span className="ml-2 text-gray-600">
                            {field.field_type === 'boolean' 
                              ? (field.value ? 'Yes' : 'No')
                              : String(field.value || 'N/A')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">Failed to load merged policy</div>
          )}
        </div>

        <div className="flex justify-end p-6 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
