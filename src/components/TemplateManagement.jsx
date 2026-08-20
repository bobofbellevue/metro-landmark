import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { Pencil, Trash2, X, Search, Upload, Copy, Move, FileEdit, Plus, File, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from './ui';
import { useSortableData } from '../hooks';
import { convertFileToJSONSchema } from '../utils/pdf-to-json-client.js';
import { getTemplateDataString } from '../utils/template-data.js';
import { insertWithAudit, updateWithAudit } from '../lib/auditHelpers.js';
import { analyzeTemplatePositionQuality } from '../utils/template-position-quality.js';
import ArchiveModal from './ArchiveModal.jsx';

export default function TemplateManagement() {
    const { user } = useContext(AuthContext);
    const [templates, setTemplates] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [landlords, setLandlords] = useState([]);
    const [editingTemplate, setEditingTemplate] = useState(null);
    const [deletingTemplate, setDeletingTemplate] = useState(null);
    const [copyingTemplate, setCopyingTemplate] = useState(null);
    const [movingTemplate, setMovingTemplate] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // 'all', 'Application', 'Lease', 'Notice'
    const [filterLevel, setFilterLevel] = useState('all'); // 'all', 'system', 'company', 'landlord'
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    
    // Debounce search term
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);
    
    // Filter templates
    const filteredTemplates = useMemo(() => {
        if (!templates || !Array.isArray(templates)) return [];
        
        let filtered = templates;
        
        // Filter by type
        if (filterType !== 'all') {
            filtered = filtered.filter(t => t.template_type === filterType);
        }
        
        // Filter by level
        if (filterLevel !== 'all') {
            filtered = filtered.filter(t => t.template_level === filterLevel);
        }
        
        // Filter by search term
        if (debouncedSearchTerm.trim()) {
            const searchLower = debouncedSearchTerm.toLowerCase();
            filtered = filtered.filter(t => 
                t.template_name?.toLowerCase().includes(searchLower) ||
                (t.company_name && t.company_name.toLowerCase().includes(searchLower)) ||
                (t.landlord_name && t.landlord_name.toLowerCase().includes(searchLower))
            );
        }
        
        return filtered;
    }, [templates, filterType, filterLevel, debouncedSearchTerm]);
    
    const { items: sortedTemplates, requestSort, sortConfig } = useSortableData(filteredTemplates, { key: 'template_name', direction: 'ascending' });
    
    // Fetch templates
    const fetchTemplates = useCallback(async () => {
        try {
            // Build query based on user role
            // Filter out archived templates by default
            let query = supabase
                .from('templates')
                .select(`
                    *,
                    pm_companies(company_name),
                    landlords(landlord_id)
                `)
                .eq('is_archived', false)
                .order('template_level', { ascending: true })
                .order('template_name', { ascending: true });
            
            // Apply role-based filtering
            if (user?.role === 'company_admin' && user?.pmc_id) {
                query = query.or(`template_level.eq.system,template_level.eq.company.and(pmc_id.eq.${user.pmc_id}),template_level.eq.company.and(applies_to_all_companies.eq.true)`);
            } else if (user?.role !== 'global_admin') {
                // Limited access for other roles
                query = query.eq('template_level', 'system');
            }
            
            const { data, error } = await query;
            
            if (error) {
                console.error('Error fetching templates:', error);
                setTemplates([]);
                return;
            }
            
            // Fetch landlord names separately
            const landlordIds = [...new Set(data?.filter(t => t.landlord_id).map(t => t.landlord_id) || [])];
            let landlordNames = {};
            
            if (landlordIds.length > 0) {
                const { data: contactsData } = await supabase
                    .from('contacts')
                    .select('*')
                    .in('contactable_id', landlordIds)
                    .eq('contactable_type', 'landlord');
                
                if (contactsData) {
                    contactsData.forEach(contact => {
                        const name = [contact.first_name, contact.middle_name, contact.last_name]
                            .filter(Boolean).join(' ') || 'Unknown';
                        landlordNames[contact.contactable_id] = name;
                    });
                }
            }
            
            // Enrich templates with names
            const enrichedTemplates = (data || []).map(template => ({
                ...template,
                company_name: template.pm_companies?.company_name || null,
                landlord_name: template.landlord_id ? landlordNames[template.landlord_id] : null
            }));
            
            setTemplates(enrichedTemplates);
        } catch (error) {
            console.error('Error fetching templates:', error);
            setTemplates([]);
        }
    }, [user]);
    
    // Fetch companies and landlords for dropdowns
    const fetchCompaniesAndLandlords = useCallback(async () => {
        if (user?.role !== 'global_admin' && user?.role !== 'company_admin') return;
        
        try {
            const [companiesResult, landlordsResult, contactsResult] = await Promise.all([
                supabase.from('pm_companies').select('*').order('company_name'),
                supabase.from('landlords').select('landlord_id'),
                supabase.from('contacts').select('*').eq('contactable_type', 'landlord')
            ]);
            
            if (companiesResult.error) {
                console.error('Error fetching companies:', companiesResult.error);
            } else {
                setCompanies(companiesResult.data || []);
            }
            
            if (landlordsResult.error) {
                console.error('Error fetching landlords:', landlordsResult.error);
            } else {
                // Enrich landlords with contact names
                const enrichedLandlords = (landlordsResult.data || []).map(landlord => {
                    const contact = contactsResult.data?.find(c => 
                        c.contactable_id === landlord.landlord_id && 
                        c.contactable_type === 'landlord'
                    );
                    const name = contact ? [contact.first_name, contact.middle_name, contact.last_name]
                        .filter(Boolean).join(' ') || 'Unknown' : 'Unknown';
                    return {
                        ...landlord,
                        name,
                        is_independent: !landlord.pmc_id
                    };
                });
                setLandlords(enrichedLandlords);
            }
        } catch (error) {
            console.error('Error fetching companies and landlords:', error);
        }
    }, [user]);
    
    useEffect(() => {
        if (user?.role?.includes('admin')) {
            fetchTemplates();
            fetchCompaniesAndLandlords();
        }
    }, [user, fetchTemplates, fetchCompaniesAndLandlords]);
    
    const handleSuccess = () => {
        setEditingTemplate(null);
        setDeletingTemplate(null);
        setCopyingTemplate(null);
        setMovingTemplate(null);
        fetchTemplates();
    };
    
    const getLevelLabel = (template) => {
        if (template.template_level === 'system') return 'System';
        if (template.template_level === 'company') {
            if (template.applies_to_all_companies) return 'Company (All)';
            return `Company (${template.company_name || 'Unknown'})`;
        }
        if (template.template_level === 'landlord') {
            if (template.applies_to_all_landlords) return 'Landlord (All)';
            if (template.applies_to_independent_landlords) return 'Landlord (Independent)';
            return `Landlord (${template.landlord_name || 'Unknown'})`;
        }
        return template.template_level;
    };
    
    const getSortIndicator = (key) => {
        if (sortConfig.key === key) {
            return sortConfig.direction === 'ascending' ? '↑' : '↓';
        }
        return '';
    };
    
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-800">Templates</h3>
                <button
                    onClick={() => setEditingTemplate({ isNew: true })}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                    <Plus size={16} />
                    Import Form
                </button>
            </div>
            
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="Search templates..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>
                <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                >
                    <option value="all">All Types</option>
                    <option value="Application">Applications</option>
                    <option value="Lease">Leases</option>
                    <option value="Notice">Notices</option>
                </select>
                <select
                    value={filterLevel}
                    onChange={(e) => setFilterLevel(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                >
                    <option value="all">All Levels</option>
                    <option value="system">System</option>
                    <option value="company">Company</option>
                    <option value="landlord">Landlord</option>
                </select>
            </div>
            
            <Card title={`Templates (${filteredTemplates.length})`}>
                <div className="overflow-y-auto overflow-x-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('template_name')} className="flex items-center">
                                        Name {getSortIndicator('template_name')}
                                    </button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('template_type')} className="flex items-center">
                                        Type {getSortIndicator('template_type')}
                                    </button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('template_level')} className="flex items-center">
                                        Level {getSortIndicator('template_level')}
                                    </button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Default</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {sortedTemplates.map(template => (
                                <tr key={template.template_id}>
                                    <td className="px-1.5 py-2 text-sm font-medium text-left whitespace-nowrap">
                                        <div className="flex items-center space-x-2">
                                            <button
                                                onClick={() => setEditingTemplate(template)}
                                                className="text-indigo-600 hover:text-indigo-900"
                                                title="Edit Template"
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            <button
                                                onClick={() => setCopyingTemplate(template)}
                                                className="text-green-600 hover:text-green-900"
                                                title="Copy Template"
                                            >
                                                <Copy size={16} />
                                            </button>
                                            <button
                                                onClick={() => setMovingTemplate(template)}
                                                className="text-purple-600 hover:text-purple-900"
                                                title="Move Template"
                                            >
                                                <Move size={16} />
                                            </button>
                                            <button
                                                onClick={() => setDeletingTemplate(template)}
                                                className="text-red-600 hover:text-red-900"
                                                title="Archive Template"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-1.5 py-2 whitespace-nowrap font-medium">{template.template_name}</td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">{template.template_type}</td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">{getLevelLabel(template)}</td>
                                    <td className="px-1.5 py-2 whitespace-nowrap">
                                        {template.is_default ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                Default
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {sortedTemplates.length === 0 && (
                        <div className="p-8 text-center text-gray-500">
                            No templates found. Click "Import Template" to create one.
                        </div>
                    )}
                </div>
            </Card>
            
            {editingTemplate && (
                <EditTemplateModal
                    template={editingTemplate}
                    companies={companies}
                    landlords={landlords}
                    onClose={() => setEditingTemplate(null)}
                    onSuccess={handleSuccess}
                />
            )}
            {deletingTemplate && (
                <ArchiveModal
                    entity={deletingTemplate}
                    entityType="template"
                    entityName={deletingTemplate.template_name}
                    idField="template_id"
                    onClose={() => setDeletingTemplate(null)}
                    onArchiveSuccess={() => {
                        setDeletingTemplate(null);
                        fetchTemplates();
                    }}
                    showCascade={false}
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}
            {copyingTemplate && (
                <CopyTemplateModal
                    template={copyingTemplate}
                    companies={companies}
                    landlords={landlords}
                    onClose={() => setCopyingTemplate(null)}
                    onSuccess={handleSuccess}
                />
            )}
            {movingTemplate && (
                <MoveTemplateModal
                    template={movingTemplate}
                    companies={companies}
                    landlords={landlords}
                    onClose={() => setMovingTemplate(null)}
                    onSuccess={handleSuccess}
                />
            )}
        </div>
    );
}

// Edit Template Modal (includes import functionality)
const EditTemplateModal = ({ template, companies, landlords, onClose, onSuccess }) => {
    const { user } = useContext(AuthContext);
    const [templateName, setTemplateName] = useState(template.isNew ? '' : template.template_name);
    const [templateType, setTemplateType] = useState(template.isNew ? 'Application' : template.template_type);
    const [templateLevel, setTemplateLevel] = useState(template.isNew ? 'system' : template.template_level);
    const [selectedCompany, setSelectedCompany] = useState(template.pmc_id || null);
    const [selectedLandlord, setSelectedLandlord] = useState(template.landlord_id || null);
    const [appliesToAllCompanies, setAppliesToAllCompanies] = useState(template.applies_to_all_companies || false);
    const [appliesToAllLandlords, setAppliesToAllLandlords] = useState(template.applies_to_all_landlords || false);
    const [appliesToIndependentLandlords, setAppliesToIndependentLandlords] = useState(template.applies_to_independent_landlords || false);
    const initialTemplateData = template.isNew
        ? '{\n\n}'
        : (getTemplateDataString(template) || '{\n\n}');
    const [templateData, setTemplateData] = useState(initialTemplateData);
    const [isDefault, setIsDefault] = useState(template.is_default || false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [jsonError, setJsonError] = useState('');
    const [isConvertingPDF, setIsConvertingPDF] = useState(false);
    const [conversionError, setConversionError] = useState('');
    const [importProgress, setImportProgress] = useState({ stage: '', progress: 0, message: '' });
    const abortControllerRef = useRef(null);
    const [uploadedFile, setUploadedFile] = useState(null); // Store the uploaded file for saving
    const [templateImages, setTemplateImages] = useState(null); // Store the converted images for saving
    const [templateFiles, setTemplateFiles] = useState([]); // Store template files for viewing
    const [loadingFiles, setLoadingFiles] = useState(false);
    
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        console.log('📤 [TEMPLATE IMPORT] Starting file upload:', {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            templateType: templateType,
            templateName: templateName
        });
        
        // Create new AbortController for this import
        abortControllerRef.current = new AbortController();
        
        setIsConvertingPDF(true);
        setConversionError('');
        setJsonError('');
        setImportProgress({ stage: 'starting', progress: 0, message: 'Starting import...' });
        
        try {
            // Unified converter automatically handles PDF and DOCX
            console.log('🔄 [TEMPLATE IMPORT] Calling convertFileToJSONSchema for template type:', templateType);
            const result = await convertFileToJSONSchema(file, {
                abortController: abortControllerRef.current,
                onProgress: (stage, progress, message) => {
                    setImportProgress({ stage, progress, message });
                }
            });
            
            console.log('📥 [TEMPLATE IMPORT] Conversion result received:', {
                success: result.success,
                hasData: !!result.data,
                hasImages: !!(result.images && Array.isArray(result.images)),
                imageCount: result.images?.length || 0,
                model: result.model,
                templateType: templateType
            });
            
            if (result.success) {
                // Check for field positions in the data
                const hasFieldPositions = checkForFieldPositions(result.data);
                const positionQuality = analyzeTemplatePositionQuality(result.data);
                console.log('📍 [TEMPLATE IMPORT] Field positions check:', {
                    hasFieldPositions,
                    positionQuality,
                    positionMeasure: result.position_measure,
                    templateType,
                    fieldCount: countFields(result.data),
                    sampleField: getSampleField(result.data)
                });

                if (positionQuality.synthetic) {
                    setConversionError(
                      'Import could not measure real blank positions (still a vertical column with the same X — ' +
                        `${positionQuality.reason}). ` +
                        'Schema fields are shown for inspection, but do not save until positions spread across ' +
                        'the page (re-import the original PDF, or edit x/y per blank from the page images).'
                    );
                } else if (result.position_measure?.method === 'pdf_text_gaps') {
                    console.log(
                      `✅ [TEMPLATE IMPORT] Geometric blank detection OK (${result.position_measure.geometric_matches} matches)`
                    );
                    // Still show the JSON so it can be inspected/edited, but do not clear the error.
                    setTemplateData(JSON.stringify(result.data, null, 2));
                    setJsonError('');
                    if (result.images && Array.isArray(result.images)) {
                      setTemplateImages(result.images);
                    }
                    setUploadedFile(file);
                    return;
                }
                
                // Preserve field order from document - don't normalize (which would sort alphabetically)
                // JavaScript objects preserve insertion order, so we keep the order from OpenAI
                const jsonString = JSON.stringify(result.data, null, 2);
                setTemplateData(jsonString);
                setJsonError('');
                setConversionError('');
                // Store the file for later saving
                setUploadedFile(file);
                console.log('💾 [TEMPLATE IMPORT] Stored uploaded file for saving:', {
                    fileName: file.name,
                    fileSize: file.size,
                    templateType: templateType
                });
                // Store the images for later saving (for image-based document generation)
                if (result.images && Array.isArray(result.images)) {
                    setTemplateImages(result.images);
                    console.log('🖼️ [TEMPLATE IMPORT] Stored template images for saving:', {
                        imageCount: result.images.length,
                        templateType: templateType
                    });
                } else {
                    console.warn('⚠️ [TEMPLATE IMPORT] No images returned from conversion:', {
                        templateType: templateType,
                        resultImages: result.images
                    });
                }
                // Auto-fill template name from filename if not set
                if (!templateName.trim()) {
                    const nameWithoutExt = file.name.replace(/\.(pdf|docx|doc)$/i, '');
                    setTemplateName(nameWithoutExt);
                }
            } else {
                console.error('❌ [TEMPLATE IMPORT] Conversion failed:', {
                    error: result.error,
                    templateType: templateType
                });
                setConversionError(result.error || 'Failed to convert file. Please try again.');
            }
        } catch (error) {
            console.error('❌ [TEMPLATE IMPORT] Error converting file:', {
                error: error.message,
                stack: error.stack,
                templateType: templateType
            });
            if (error.message === 'Conversion cancelled') {
                setConversionError('Import cancelled by user.');
            } else {
                setConversionError(error.message || 'Failed to convert file. Please try again.');
            }
        } finally {
            setIsConvertingPDF(false);
            setImportProgress({ stage: '', progress: 0, message: '' });
            abortControllerRef.current = null;
            e.target.value = '';
        }
    };
    
    // Helper function to check if field positions exist
    const checkForFieldPositions = (data) => {
        if (!data || typeof data !== 'object') return false;
        
        let hasPosition = false;
        function traverse(obj) {
            if (hasPosition) return; // Early exit if found
            if (obj && typeof obj === 'object') {
                if (Array.isArray(obj)) {
                    obj.forEach(item => traverse(item));
                } else {
                    if (obj.position && typeof obj.position === 'object') {
                        if (typeof obj.position.page === 'number' && 
                            typeof obj.position.x === 'number' && 
                            typeof obj.position.y === 'number') {
                            hasPosition = true;
                            return;
                        }
                    }
                    Object.values(obj).forEach(value => traverse(value));
                }
            }
        }
        traverse(data);
        return hasPosition;
    };
    
    // Helper function to count fields
    const countFields = (data) => {
        if (!data || typeof data !== 'object') return 0;
        let count = 0;
        function traverse(obj) {
            if (obj && typeof obj === 'object') {
                if (Array.isArray(obj)) {
                    obj.forEach(item => traverse(item));
                } else {
                    if (obj.type && (obj.type === 'string' || obj.type === 'date' || obj.type === 'number' || obj.type === 'boolean')) {
                        count++;
                    }
                    Object.values(obj).forEach(value => traverse(value));
                }
            }
        }
        traverse(data);
        return count;
    };
    
    // Helper function to get a sample field
    const getSampleField = (data) => {
        if (!data || typeof data !== 'object') return null;
        let sample = null;
        function traverse(obj, path = '') {
            if (sample) return; // Early exit if found
            if (obj && typeof obj === 'object') {
                if (Array.isArray(obj)) {
                    obj.forEach((item, idx) => traverse(item, `${path}[${idx}]`));
                } else {
                    if (obj.type && (obj.type === 'string' || obj.type === 'date' || obj.type === 'number' || obj.type === 'boolean')) {
                        sample = {
                            path,
                            type: obj.type,
                            hasPosition: !!(obj.position && typeof obj.position === 'object'),
                            position: obj.position
                        };
                        return;
                    }
                    Object.entries(obj).forEach(([key, value]) => traverse(value, path ? `${path}.${key}` : key));
                }
            }
        }
        traverse(data);
        return sample;
    };
    
    const handleCancelImport = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };
    
    const validateJson = () => {
        try {
            JSON.parse(templateData);
            setJsonError('');
            return true;
        } catch (error) {
            setJsonError('Invalid JSON: ' + error.message);
            return false;
        }
    };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormError('');
        
        if (!validateJson()) {
            setFormError('Please fix JSON errors before submitting.');
            return;
        }
        
        if (!templateName.trim()) {
            setFormError('Template name is required.');
            return;
        }
        
        // Validate level constraints
        if (templateLevel === 'system' && (selectedCompany || selectedLandlord)) {
            setFormError('System templates cannot be assigned to companies or landlords.');
            return;
        }
        if (templateLevel === 'company' && selectedLandlord) {
            setFormError('Company templates cannot be assigned to specific landlords.');
            return;
        }
        if (templateLevel === 'company' && !selectedCompany && !appliesToAllCompanies) {
            setFormError('Company templates must be assigned to a company or apply to all companies.');
            return;
        }
        if (templateLevel === 'landlord' && !selectedLandlord && !appliesToAllLandlords && !appliesToIndependentLandlords) {
            setFormError('Landlord templates must be assigned to a landlord, apply to all landlords, or apply to independent landlords.');
            return;
        }
        
        setIsSubmitting(true);
        
        console.log('💾 [TEMPLATE SAVE] Starting template save:', {
            isNew: template.isNew,
            templateType: templateType,
            templateName: templateName.trim(),
            hasUploadedFile: !!uploadedFile,
            hasTemplateImages: !!(templateImages && Array.isArray(templateImages) && templateImages.length > 0),
            templateImagesCount: templateImages?.length || 0
        });
        
        try {
            const parsedData = JSON.parse(templateData);
            
            // Check for field positions before saving
            const hasFieldPositions = checkForFieldPositions(parsedData);
            const positionQuality = analyzeTemplatePositionQuality(parsedData);
            console.log('📍 [TEMPLATE SAVE] Field positions check before save:', {
                hasFieldPositions,
                positionQuality,
                templateType: templateType,
                fieldCount: countFields(parsedData),
                sampleField: getSampleField(parsedData)
            });

            if (positionQuality.synthetic) {
                setFormError(
                  'Cannot save: field positions look invented (same X in a vertical column — ' +
                    `${positionQuality.reason}). Re-import the PDF or fix each blank’s x/y so they ` +
                    'match real underline locations on the page images.'
                );
                setIsSubmitting(false);
                return;
            }
            
            const payload = {
                template_name: templateName.trim(),
                template_type: templateType,
                template_level: templateLevel,
                template_data: parsedData,
                template_data_raw: templateData,
                is_default: isDefault && templateLevel === 'system' ? isDefault : false,
                pmc_id: templateLevel === 'company' ? (selectedCompany || null) : null,
                landlord_id: templateLevel === 'landlord' ? (selectedLandlord || null) : null,
                applies_to_all_companies: templateLevel === 'company' ? appliesToAllCompanies : false,
                applies_to_all_landlords: templateLevel === 'landlord' ? appliesToAllLandlords : false,
                applies_to_independent_landlords: templateLevel === 'landlord' ? appliesToIndependentLandlords : false
            };
            
            let templateId;
            if (template.isNew) {
                const { data: newTemplate, error } = await supabase
                    .from('templates')
                    .insert([payload])
                    .select('template_id')
                    .single();
                if (error) throw error;
                templateId = newTemplate.template_id;
                // Audit log
                if (user?.user_id) {
                    await insertWithAudit('templates', [{ ...payload, template_id: templateId }], user.user_id);
                }
            } else {
                templateId = template.template_id;
                const { error } = await updateWithAudit(
                    'templates',
                    payload,
                    'template_id',
                    template.template_id,
                    user?.user_id
                );
                if (error) throw error;
            }
            
            // Save uploaded file if present
            if (uploadedFile) {
                console.log('📁 [TEMPLATE SAVE] Starting file upload process:', {
                    templateId,
                    templateType: templateType,
                    fileName: uploadedFile.name,
                    fileSize: uploadedFile.size,
                    fileType: uploadedFile.type
                });
                try {
                    // Verify Supabase Auth session exists (required for storage RLS policies)
                    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                    if (sessionError || !session) {
                        console.error('❌ [TEMPLATE SAVE] No Supabase Auth session found for storage upload:', {
                            sessionError,
                            templateType: templateType,
                            templateId
                        });
                        console.warn('Storage upload requires Supabase Auth session. Please log out and log back in.');
                        setFormError('Storage upload requires authentication. Please log out and log back in to refresh your session.');
                        setIsSubmitting(false);
                        return;
                    }
                    
                    // Verify session has access_token
                    if (!session.access_token) {
                        console.error('❌ [TEMPLATE SAVE] Supabase Auth session missing access_token:', {
                            templateType: templateType,
                            templateId
                        });
                        setFormError('Authentication session is invalid. Please log out and log back in.');
                        setIsSubmitting(false);
                        return;
                    }
                    
                    console.log('✅ [TEMPLATE SAVE] Supabase Auth session verified - proceeding with storage upload:', {
                        templateType: templateType,
                        templateId,
                        userId: session.user?.id,
                        hasAccessToken: !!session.access_token
                    });
                    
                    // Convert file to base64
                    const reader = new FileReader();
                    const fileData = await new Promise((resolve, reject) => {
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(uploadedFile);
                    });
                    
                    // Upload to storage
                    const fileName = uploadedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const storagePath = `templates/${templateId}/${fileName}`;
                    
                    // Convert base64 to blob for browser
                    const base64Data = fileData.split(',')[1];
                    const byteCharacters = atob(base64Data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: uploadedFile.type || 'application/pdf' });
                    
                    // Double-check session is still valid right before upload
                    const { data: { session: preUploadSession } } = await supabase.auth.getSession();
                    if (!preUploadSession) {
                        console.error('Session lost before upload - this should not happen');
                        setFormError('Authentication session expired. Please try again.');
                        setIsSubmitting(false);
                        return;
                    }
                    
                    console.log('Uploading to storage with session for user:', preUploadSession.user?.email);
                    
                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from('documents')
                        .upload(storagePath, blob, {
                            contentType: uploadedFile.type || 'application/pdf',
                            upsert: true
                        });
                    
                    // Log upload result
                    if (uploadError) {
                        console.error('❌ Storage upload failed:', uploadError);
                    } else {
                        console.log('✅ Storage upload succeeded! Path:', uploadData?.path);
                    }
                    
                    // Check if upload succeeded
                    let uploadSucceeded = !uploadError;
                    if (uploadError) {
                        console.error('Error uploading document to storage:', uploadError);
                        
                        // Check if it's an RLS/policy error - file might have uploaded but policy check failed
                        const isRLSError = uploadError.message?.includes('row-level security') || 
                                         uploadError.message?.includes('RLS') ||
                                         uploadError.message?.includes('policy') ||
                                         uploadError.message?.includes('violates');
                        
                        if (isRLSError) {
                            // RLS error - file might have uploaded but policy blocked it
                            // Try to proceed with database insert anyway
                            uploadSucceeded = true;
                            console.warn('RLS/policy error on upload. File may have uploaded. Attempting database insert...', uploadError);
                        } else {
                            // Non-RLS error (network, size, etc.) - upload definitely failed
                            uploadSucceeded = false;
                            console.error('Storage upload failed (non-RLS error). Skipping database insert.', uploadError);
                        }
                    }
                    
                    // Only create database record if upload succeeded or we're trying despite RLS error
                    if (uploadSucceeded || uploadData) {
                        
                        // Create or update document record
                        // Use insertWithAudit directly to bypass RLS issues
                        // Get existing document(s) - there might be duplicates, so get the first one
                        const { data: existingDocs, error: existingDocError } = await supabase
                            .from('documents')
                            .select('document_id')
                            .eq('template_id', templateId)
                            .eq('document_type', 'template_document')
                            .limit(1);
                        
                        const existingDoc = existingDocs && existingDocs.length > 0 ? existingDocs[0] : null;
                        
                        if (existingDocError) {
                            console.error('Error checking existing document:', existingDocError);
                        } else {
                            const documentData = {
                                document_type: 'template_document',
                                document_name: templateName.trim(),
                                storage_path: storagePath,
                                file_name: fileName,
                                file_size: uploadedFile.size,
                                mime_type: uploadedFile.type || 'application/pdf',
                                template_id: templateId,
                                created_by_user_id: user?.user_id || null,
                                metadata: { is_template_source: true }
                            };
                            
                            if (existingDoc) {
                                // Use updateWithAudit for updates
                                const { error: updateError } = await updateWithAudit(
                                    'documents',
                                    documentData,
                                    'document_id',
                                    existingDoc.document_id,
                                    user?.user_id
                                );
                                
                                if (updateError) {
                                    console.error('❌ Error updating document record:', updateError);
                                    // If update fails with "Record not found", try insert instead
                                    if (updateError.message?.includes('Record not found') || updateError.message?.includes('not found')) {
                                        console.warn('⚠️ Update failed - record not found. Attempting insert instead...');
                                        const { error: insertError } = await insertWithAudit('documents', [documentData], user?.user_id);
                                        if (insertError) {
                                            console.error('❌ Error inserting document record after update failed:', insertError);
                                        } else {
                                            console.log('✅ Document record inserted successfully (after update failed)');
                                        }
                                    }
                                } else {
                                    console.log('✅ Document record updated successfully');
                                }
                            } else {
                                console.log('📝 No existing document found, creating new record...');
                                // Use insertWithAudit directly to bypass RLS
                                const { error: insertError } = await insertWithAudit('documents', [documentData], user?.user_id);
                                
                                if (insertError) {
                                    console.error('❌ Error inserting document record with audit:', insertError);
                                    // If insertWithAudit also fails, try regular insert as fallback
                                    try {
                                        const { error: fallbackError } = await supabase
                                            .from('documents')
                                            .insert([documentData]);
                                        if (fallbackError) {
                                            console.error('❌ Fallback insert also failed:', fallbackError);
                                        } else {
                                            console.log('✅ Document record inserted successfully (via fallback)');
                                        }
                                    } catch (fallbackErr) {
                                        console.error('❌ Fallback insert error:', fallbackErr);
                                    }
                                } else {
                                    console.log('✅ Document record inserted successfully');
                                }
                            }
                        }
                    }
                } catch (fileError) {
                    console.error('Error saving document file:', fileError);
                    // Don't fail the whole operation if file save fails
                }
            }
            
            // Save template images if present (for image-based document generation)
            if (templateImages && Array.isArray(templateImages) && templateImages.length > 0) {
                console.log('🖼️ [TEMPLATE SAVE] Starting image upload process:', {
                    templateId,
                    templateType: templateType,
                    imageCount: templateImages.length
                });
                try {
                    // Verify Supabase Auth session exists
                    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                    if (sessionError || !session) {
                        console.error('❌ [TEMPLATE SAVE] No Supabase Auth session found for image upload:', {
                            sessionError,
                            templateType: templateType,
                            templateId
                        });
                        // Don't block template save if image upload fails
                    } else {
                        console.log('✅ [TEMPLATE SAVE] Uploading template images:', {
                            templateType: templateType,
                            templateId,
                            imageCount: templateImages.length
                        });
                        
                        // Upload each image page
                        for (let pageIndex = 0; pageIndex < templateImages.length; pageIndex++) {
                            const imageDataUrl = templateImages[pageIndex];
                            
                            // Convert base64 data URL to blob
                            const base64Data = imageDataUrl.split(',')[1];
                            const byteCharacters = atob(base64Data);
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) {
                                byteNumbers[i] = byteCharacters.charCodeAt(i);
                            }
                            const byteArray = new Uint8Array(byteNumbers);
                            const blob = new Blob([byteArray], { type: 'image/png' });
                            
                            // Upload image to storage
                            const imageStoragePath = `templates/${templateId}/images/page_${pageIndex + 1}.png`;
                            
                            const { data: imageUploadData, error: imageUploadError } = await supabase.storage
                                .from('documents')
                                .upload(imageStoragePath, blob, {
                                    contentType: 'image/png',
                                    upsert: true
                                });
                            
                            if (imageUploadError) {
                                console.error(`❌ [TEMPLATE SAVE] Error uploading image page ${pageIndex + 1}:`, {
                                    error: imageUploadError,
                                    templateType: templateType,
                                    templateId,
                                    pageIndex: pageIndex + 1
                                });
                            } else {
                                console.log(`✅ [TEMPLATE SAVE] Image page ${pageIndex + 1} uploaded successfully:`, {
                                    templateType: templateType,
                                    templateId,
                                    path: imageStoragePath
                                });
                            }
                        }
                        console.log('✅ [TEMPLATE SAVE] Completed image upload process:', {
                            templateType: templateType,
                            templateId,
                            totalImages: templateImages.length
                        });
                    }
                } catch (imageError) {
                    console.error('❌ [TEMPLATE SAVE] Error uploading template images:', {
                        error: imageError,
                        templateType: templateType,
                        templateId,
                        stack: imageError.stack
                    });
                    // Don't block template save if image upload fails
                }
            } else {
                console.warn('⚠️ [TEMPLATE SAVE] No template images to upload:', {
                    templateType: templateType,
                    templateId,
                    hasTemplateImages: !!templateImages,
                    isArray: Array.isArray(templateImages),
                    length: templateImages?.length
                });
            }
            
            onSuccess();
        } catch (error) {
            console.error('Error saving template:', error);
            setFormError(error.message || 'Failed to save template.');
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const canEditLevel = template.isNew || user?.role === 'global_admin';
    const canEditSystem = user?.role === 'global_admin';
    
    // Load template files when modal opens (for existing templates)
    useEffect(() => {
        if (!template.isNew && template.template_id) {
            loadTemplateFiles();
        }
    }, [template.template_id, template.isNew]);
    
    const loadTemplateFiles = async () => {
        if (template.isNew) return;
        
        setLoadingFiles(true);
        try {
            // Load document file
            const { data: docRecords, error: docError } = await supabase
                .from('documents')
                .select('document_id, storage_path, file_name, mime_type, file_size')
                .eq('template_id', template.template_id)
                .eq('document_type', 'template_document');
            
            const files = [];
            
            if (!docError && docRecords && docRecords.length > 0) {
                files.push(...docRecords.map(doc => ({
                    type: 'document',
                    id: doc.document_id,
                    name: doc.file_name,
                    path: doc.storage_path,
                    mimeType: doc.mime_type,
                    size: doc.file_size
                })));
            }
            
            // Load image files from storage
            if (template.template_id) {
                const imagesPath = `templates/${template.template_id}/images/`;
                const { data: imageFiles, error: imageError } = await supabase.storage
                    .from('documents')
                    .list(imagesPath);
                
                if (!imageError && imageFiles && imageFiles.length > 0) {
                    files.push(...imageFiles
                        .filter(file => file.name.endsWith('.png'))
                        .map(file => ({
                            type: 'image',
                            id: null,
                            name: file.name,
                            path: `${imagesPath}${file.name}`,
                            mimeType: 'image/png',
                            size: file.metadata?.size || null
                        })));
                }
            }
            
            setTemplateFiles(files);
        } catch (error) {
            console.error('Error loading template files:', error);
        } finally {
            setLoadingFiles(false);
        }
    };
    
    const handleViewFile = async (file) => {
        try {
            // Verify Supabase Auth session
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Not authenticated. Please log out and log back in.');
            }
            
            // Get signed URL for viewing
            const { data: signedUrlData, error: urlError } = await supabase.storage
                .from('documents')
                .createSignedUrl(file.path, 3600);
            
            if (!urlError && signedUrlData?.signedUrl) {
                window.open(signedUrlData.signedUrl, '_blank');
            } else {
                throw new Error(urlError?.message || 'Failed to generate view URL');
            }
        } catch (error) {
            console.error('Error viewing file:', error);
            alert(`Error viewing file: ${error.message || 'Unknown error'}`);
        }
    };
    
    const handleClose = () => {
        if (isConvertingPDF) {
            if (window.confirm('Import is in progress. Do you want to cancel and close?')) {
                handleCancelImport();
                onClose();
            }
        } else {
            setUploadedFile(null); // Clear uploaded file when closing
            setTemplateImages(null); // Clear template images when closing
            onClose();
        }
    };
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                {/* Fixed Header */}
                <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
                    <h2 className="text-xl font-semibold text-gray-900">
                        {template.isNew ? 'Import Form' : 'Edit Template'}
                    </h2>
                    <button 
                        onClick={handleClose} 
                        className="text-gray-400 hover:text-gray-600"
                        disabled={isConvertingPDF}
                    >
                        <X size={24} />
                    </button>
                </div>
                
                {/* Progress Modal Overlay */}
                {isConvertingPDF && (
                    <div className="absolute inset-0 bg-white bg-opacity-95 z-10 flex items-center justify-center rounded-lg">
                        <div className="max-w-md w-full mx-4">
                            <div className="bg-white rounded-lg shadow-xl p-6 border border-gray-200">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-gray-900">Importing Form</h3>
                                    <Loader2 className="animate-spin text-indigo-600" size={20} />
                                </div>
                                
                                <div className="mb-4">
                                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                                        <span>{importProgress.message || 'Processing...'}</span>
                                        <span>{Math.round(importProgress.progress)}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                                        <div 
                                            className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                                            style={{ width: `${importProgress.progress}%` }}
                                        />
                                    </div>
                                </div>
                                
                                <p className="text-sm text-gray-500 mb-4">
                                    This may take a few minutes. Please do not close this window.
                                </p>
                                
                                <button
                                    onClick={handleCancelImport}
                                    className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                >
                                    Cancel Import
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Scrollable Body */}
                <form onSubmit={handleSubmit} id="edit-template-form" className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Template Name</label>
                            <input
                                type="text"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                required
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Template Type</label>
                            <select
                                value={templateType}
                                onChange={(e) => setTemplateType(e.target.value)}
                                required
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                            >
                                <option value="Application">Application</option>
                                <option value="Lease">Lease</option>
                                <option value="Notice">Notice</option>
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Template Level</label>
                        <select
                            value={templateLevel}
                            onChange={(e) => {
                                setTemplateLevel(e.target.value);
                                if (e.target.value === 'system') {
                                    setSelectedCompany(null);
                                    setSelectedLandlord(null);
                                    setAppliesToAllCompanies(false);
                                    setAppliesToAllLandlords(false);
                                    setAppliesToIndependentLandlords(false);
                                } else if (e.target.value === 'company') {
                                    setSelectedLandlord(null);
                                    setAppliesToAllLandlords(false);
                                    setAppliesToIndependentLandlords(false);
                                }
                            }}
                            disabled={!canEditLevel}
                            required
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        >
                            <option value="system">System</option>
                            {user?.role === 'global_admin' && <option value="company">Company</option>}
                            {user?.role === 'global_admin' && <option value="landlord">Landlord</option>}
                        </select>
                    </div>
                    
                    {templateLevel === 'company' && (
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToAllCompanies}
                                        onChange={(e) => {
                                            setAppliesToAllCompanies(e.target.checked);
                                            if (e.target.checked) setSelectedCompany(null);
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to All Companies</span>
                                </label>
                            </div>
                            {!appliesToAllCompanies && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Select Company</label>
                                    <select
                                        value={selectedCompany || ''}
                                        onChange={(e) => setSelectedCompany(e.target.value ? parseInt(e.target.value) : null)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select a company...</option>
                                        {companies.map(company => (
                                            <option key={company.pmc_id} value={company.pmc_id}>
                                                {company.company_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {templateLevel === 'landlord' && (
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToAllLandlords}
                                        onChange={(e) => {
                                            setAppliesToAllLandlords(e.target.checked);
                                            if (e.target.checked) {
                                                setSelectedLandlord(null);
                                                setAppliesToIndependentLandlords(false);
                                            }
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to All Landlords</span>
                                </label>
                            </div>
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToIndependentLandlords}
                                        onChange={(e) => {
                                            setAppliesToIndependentLandlords(e.target.checked);
                                            if (e.target.checked) {
                                                setSelectedLandlord(null);
                                                setAppliesToAllLandlords(false);
                                            }
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to Independent Landlords Only</span>
                                </label>
                            </div>
                            {!appliesToAllLandlords && !appliesToIndependentLandlords && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Select Landlord</label>
                                    <select
                                        value={selectedLandlord || ''}
                                        onChange={(e) => setSelectedLandlord(e.target.value ? parseInt(e.target.value) : null)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select a landlord...</option>
                                        {landlords.map(landlord => (
                                            <option key={landlord.landlord_id} value={landlord.landlord_id}>
                                                {landlord.name} {landlord.is_independent ? '(Independent)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {templateLevel === 'system' && canEditSystem && (
                        <div>
                            <label className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={isDefault}
                                    onChange={(e) => setIsDefault(e.target.checked)}
                                    className="mr-2"
                                />
                                <span className="text-sm font-medium text-gray-700">Set as Default Template</span>
                            </label>
                        </div>
                    )}
                    
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">Template Data (JSON)</label>
                            <label className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 cursor-pointer">
                                <File size={16} />
                                {isConvertingPDF ? 'Converting...' : 'Import Form'}
                                <input
                                    type="file"
                                    accept=".pdf,.docx,.doc"
                                    onChange={handleFileUpload}
                                    disabled={isConvertingPDF}
                                    className="hidden"
                                />
                            </label>
                        </div>
                        {conversionError && (
                            <div className="mb-2 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                {conversionError}
                            </div>
                        )}
                        <textarea
                            value={templateData}
                            onChange={(e) => {
                                setTemplateData(e.target.value);
                                validateJson();
                            }}
                            rows={20}
                            className={`block w-full px-3 py-2 border rounded-md shadow-sm font-mono text-sm ${
                                jsonError ? 'border-red-300' : 'border-gray-300'
                            }`}
                        />
                        {jsonError && (
                            <p className="mt-1 text-sm text-red-600">{jsonError}</p>
                        )}
                    </div>
                    
                    {/* Template Files Section */}
                    {!template.isNew && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Template Files
                            </label>
                            {loadingFiles ? (
                                <div className="p-4 text-center text-gray-500">
                                    <Loader2 className="animate-spin mx-auto mb-2" size={20} />
                                    Loading files...
                                </div>
                            ) : templateFiles.length > 0 ? (
                                <div className="space-y-2">
                                    {templateFiles.map((file, index) => (
                                        <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-gray-200">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <File size={16} className="text-gray-500 flex-shrink-0" />
                                                <span className="text-sm text-gray-700 truncate" title={file.name}>
                                                    {file.name}
                                                </span>
                                                {file.size && (
                                                    <span className="text-xs text-gray-500 flex-shrink-0">
                                                        ({(file.size / 1024).toFixed(1)} KB)
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => handleViewFile(file)}
                                                    className="px-2 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded"
                                                    title="View"
                                                >
                                                    View
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-4 text-center text-gray-500 text-sm border border-gray-200 rounded-md bg-gray-50">
                                    No files stored for this template
                                </div>
                            )}
                        </div>
                    )}
                    
                    {formError && (
                        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {formError}
                        </div>
                    )}
                </form>
                
                {/* Fixed Footer */}
                <div className="flex justify-end gap-4 p-6 border-t flex-shrink-0">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isConvertingPDF}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="edit-template-form"
                        disabled={isSubmitting || isConvertingPDF}
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'Saving...' : template.isNew ? 'Save' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// DeleteTemplateModal has been replaced with ArchiveModal
// ArchiveModal provides archive (soft delete) and hard delete options

// Copy Template Modal
const CopyTemplateModal = ({ template, companies, landlords, onClose, onSuccess }) => {
    const { user } = useContext(AuthContext);
    const [templateName, setTemplateName] = useState(`${template.template_name} (Copy)`);
    const [templateLevel, setTemplateLevel] = useState(template.template_level);
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [selectedLandlord, setSelectedLandlord] = useState(null);
    const [appliesToAllCompanies, setAppliesToAllCompanies] = useState(false);
    const [appliesToAllLandlords, setAppliesToAllLandlords] = useState(false);
    const [appliesToIndependentLandlords, setAppliesToIndependentLandlords] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    
    const handleCopy = async () => {
        if (!templateName.trim()) {
            setFormError('Template name is required.');
            return;
        }
        
        // Validate level constraints
        if (templateLevel === 'company' && !selectedCompany && !appliesToAllCompanies) {
            setFormError('Company templates must be assigned to a company or apply to all companies.');
            return;
        }
        if (templateLevel === 'landlord' && !selectedLandlord && !appliesToAllLandlords && !appliesToIndependentLandlords) {
            setFormError('Landlord templates must be assigned to a landlord, apply to all landlords, or apply to independent landlords.');
            return;
        }
        
        setIsSubmitting(true);
        setFormError('');
        
        try {
            const rawTemplateString = template.template_data_raw || JSON.stringify(template.template_data || {}, null, 2);
            let parsedTemplateData = template.template_data;
            if (template.template_data_raw) {
                try {
                    parsedTemplateData = JSON.parse(template.template_data_raw);
                } catch (parseError) {
                    console.error('Error parsing template_data_raw while copying template:', parseError);
                    parsedTemplateData = template.template_data || {};
                }
            }
            
            const payload = {
                template_name: templateName.trim(),
                template_type: template.template_type,
                template_level: templateLevel,
                template_data: parsedTemplateData,
                template_data_raw: rawTemplateString,
                is_default: false,
                pmc_id: templateLevel === 'company' ? (selectedCompany || null) : null,
                landlord_id: templateLevel === 'landlord' ? (selectedLandlord || null) : null,
                applies_to_all_companies: templateLevel === 'company' ? appliesToAllCompanies : false,
                applies_to_all_landlords: templateLevel === 'landlord' ? appliesToAllLandlords : false,
                applies_to_independent_landlords: templateLevel === 'landlord' ? appliesToIndependentLandlords : false
            };
            
            const { error } = await insertWithAudit('templates', [payload], user?.user_id);
            if (error) throw error;
            onSuccess();
        } catch (error) {
            console.error('Error copying template:', error);
            setFormError(error.message || 'Failed to copy template.');
        } finally {
            setIsSubmitting(false);
        }
    };
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
                {/* Fixed Header */}
                <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
                    <h2 className="text-xl font-semibold text-gray-900">Copy Template</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>
                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">New Template Name</label>
                        <input
                            type="text"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            required
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Template Level</label>
                        <select
                            value={templateLevel}
                            onChange={(e) => {
                                setTemplateLevel(e.target.value);
                                if (e.target.value === 'system') {
                                    setSelectedCompany(null);
                                    setSelectedLandlord(null);
                                    setAppliesToAllCompanies(false);
                                    setAppliesToAllLandlords(false);
                                    setAppliesToIndependentLandlords(false);
                                } else if (e.target.value === 'company') {
                                    setSelectedLandlord(null);
                                    setAppliesToAllLandlords(false);
                                    setAppliesToIndependentLandlords(false);
                                }
                            }}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        >
                            <option value="system">System</option>
                            {user?.role === 'global_admin' && <option value="company">Company</option>}
                            {user?.role === 'global_admin' && <option value="landlord">Landlord</option>}
                        </select>
                    </div>
                    
                    {templateLevel === 'company' && (
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToAllCompanies}
                                        onChange={(e) => {
                                            setAppliesToAllCompanies(e.target.checked);
                                            if (e.target.checked) setSelectedCompany(null);
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to All Companies</span>
                                </label>
                            </div>
                            {!appliesToAllCompanies && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Select Company</label>
                                    <select
                                        value={selectedCompany || ''}
                                        onChange={(e) => setSelectedCompany(e.target.value ? parseInt(e.target.value) : null)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select a company...</option>
                                        {companies.map(company => (
                                            <option key={company.pmc_id} value={company.pmc_id}>
                                                {company.company_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {templateLevel === 'landlord' && (
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToAllLandlords}
                                        onChange={(e) => {
                                            setAppliesToAllLandlords(e.target.checked);
                                            if (e.target.checked) {
                                                setSelectedLandlord(null);
                                                setAppliesToIndependentLandlords(false);
                                            }
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to All Landlords</span>
                                </label>
                            </div>
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToIndependentLandlords}
                                        onChange={(e) => {
                                            setAppliesToIndependentLandlords(e.target.checked);
                                            if (e.target.checked) {
                                                setSelectedLandlord(null);
                                                setAppliesToAllLandlords(false);
                                            }
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to Independent Landlords Only</span>
                                </label>
                            </div>
                            {!appliesToAllLandlords && !appliesToIndependentLandlords && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Select Landlord</label>
                                    <select
                                        value={selectedLandlord || ''}
                                        onChange={(e) => setSelectedLandlord(e.target.value ? parseInt(e.target.value) : null)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select a landlord...</option>
                                        {landlords.map(landlord => (
                                            <option key={landlord.landlord_id} value={landlord.landlord_id}>
                                                {landlord.name} {landlord.is_independent ? '(Independent)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {formError && (
                        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {formError}
                        </div>
                    )}
                </div>
                {/* Fixed Footer */}
                <div className="flex justify-end gap-4 p-6 border-t flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCopy}
                        disabled={isSubmitting}
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Copying...' : 'Copy Template'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Move Template Modal (similar to Copy but updates existing template)
const MoveTemplateModal = ({ template, companies, landlords, onClose, onSuccess }) => {
    const { user } = useContext(AuthContext);
    const [templateLevel, setTemplateLevel] = useState(template.template_level);
    const [selectedCompany, setSelectedCompany] = useState(template.pmc_id || null);
    const [selectedLandlord, setSelectedLandlord] = useState(template.landlord_id || null);
    const [appliesToAllCompanies, setAppliesToAllCompanies] = useState(template.applies_to_all_companies || false);
    const [appliesToAllLandlords, setAppliesToAllLandlords] = useState(template.applies_to_all_landlords || false);
    const [appliesToIndependentLandlords, setAppliesToIndependentLandlords] = useState(template.applies_to_independent_landlords || false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    
    const handleMove = async () => {
        // Validate level constraints
        if (templateLevel === 'company' && !selectedCompany && !appliesToAllCompanies) {
            setFormError('Company templates must be assigned to a company or apply to all companies.');
            return;
        }
        if (templateLevel === 'landlord' && !selectedLandlord && !appliesToAllLandlords && !appliesToIndependentLandlords) {
            setFormError('Landlord templates must be assigned to a landlord, apply to all landlords, or apply to independent landlords.');
            return;
        }
        
        setIsSubmitting(true);
        setFormError('');
        
        try {
            const payload = {
                template_level: templateLevel,
                pmc_id: templateLevel === 'company' ? (selectedCompany || null) : null,
                landlord_id: templateLevel === 'landlord' ? (selectedLandlord || null) : null,
                applies_to_all_companies: templateLevel === 'company' ? appliesToAllCompanies : false,
                applies_to_all_landlords: templateLevel === 'landlord' ? appliesToAllLandlords : false,
                applies_to_independent_landlords: templateLevel === 'landlord' ? appliesToIndependentLandlords : false,
                is_default: false // Moving a template removes default status
            };
            
            const { error } = await supabase
                .from('templates')
                .update(payload)
                .eq('template_id', template.template_id);
            
            if (error) throw error;
            onSuccess();
        } catch (error) {
            console.error('Error moving template:', error);
            setFormError(error.message || 'Failed to move template.');
        } finally {
            setIsSubmitting(false);
        }
    };
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
                {/* Fixed Header */}
                <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
                    <h2 className="text-xl font-semibold text-gray-900">Move Template</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>
                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <p className="text-sm text-gray-600">
                        Move template "{template.template_name}" to a different level.
                    </p>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Template Level</label>
                        <select
                            value={templateLevel}
                            onChange={(e) => {
                                setTemplateLevel(e.target.value);
                                if (e.target.value === 'system') {
                                    setSelectedCompany(null);
                                    setSelectedLandlord(null);
                                    setAppliesToAllCompanies(false);
                                    setAppliesToAllLandlords(false);
                                    setAppliesToIndependentLandlords(false);
                                } else if (e.target.value === 'company') {
                                    setSelectedLandlord(null);
                                    setAppliesToAllLandlords(false);
                                    setAppliesToIndependentLandlords(false);
                                }
                            }}
                            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                        >
                            <option value="system">System</option>
                            {user?.role === 'global_admin' && <option value="company">Company</option>}
                            {user?.role === 'global_admin' && <option value="landlord">Landlord</option>}
                        </select>
                    </div>
                    
                    {templateLevel === 'company' && (
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToAllCompanies}
                                        onChange={(e) => {
                                            setAppliesToAllCompanies(e.target.checked);
                                            if (e.target.checked) setSelectedCompany(null);
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to All Companies</span>
                                </label>
                            </div>
                            {!appliesToAllCompanies && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Select Company</label>
                                    <select
                                        value={selectedCompany || ''}
                                        onChange={(e) => setSelectedCompany(e.target.value ? parseInt(e.target.value) : null)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select a company...</option>
                                        {companies.map(company => (
                                            <option key={company.pmc_id} value={company.pmc_id}>
                                                {company.company_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {templateLevel === 'landlord' && (
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToAllLandlords}
                                        onChange={(e) => {
                                            setAppliesToAllLandlords(e.target.checked);
                                            if (e.target.checked) {
                                                setSelectedLandlord(null);
                                                setAppliesToIndependentLandlords(false);
                                            }
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to All Landlords</span>
                                </label>
                            </div>
                            <div>
                                <label className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={appliesToIndependentLandlords}
                                        onChange={(e) => {
                                            setAppliesToIndependentLandlords(e.target.checked);
                                            if (e.target.checked) {
                                                setSelectedLandlord(null);
                                                setAppliesToAllLandlords(false);
                                            }
                                        }}
                                        className="mr-2"
                                    />
                                    <span className="text-sm font-medium text-gray-700">Apply to Independent Landlords Only</span>
                                </label>
                            </div>
                            {!appliesToAllLandlords && !appliesToIndependentLandlords && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Select Landlord</label>
                                    <select
                                        value={selectedLandlord || ''}
                                        onChange={(e) => setSelectedLandlord(e.target.value ? parseInt(e.target.value) : null)}
                                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    >
                                        <option value="">Select a landlord...</option>
                                        {landlords.map(landlord => (
                                            <option key={landlord.landlord_id} value={landlord.landlord_id}>
                                                {landlord.name} {landlord.is_independent ? '(Independent)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {formError && (
                        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                            {formError}
                        </div>
                    )}
                </div>
                {/* Fixed Footer */}
                <div className="flex justify-end gap-4 p-6 border-t flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleMove}
                        disabled={isSubmitting}
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Moving...' : 'Move Template'}
                    </button>
                </div>
            </div>
        </div>
    );
};

