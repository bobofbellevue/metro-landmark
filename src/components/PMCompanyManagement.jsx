import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import { Pencil, Trash2, X, ArrowUpDown, Search, PlusCircle } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from './ui';
import { useSortableData } from '../hooks';
import { useFinderLimit } from '../hooks/useFinderLimit';
import { insertWithAudit, updateWithAudit, deleteWithAudit } from '../lib/auditHelpers.js';
import ArchiveModal from './ArchiveModal';
import ContactMethodTypeInput from './ContactMethodTypeInput';

export default function PMCompanyManagement() {
    const { user } = useContext(AuthContext);
    const [companies, setCompanies] = useState([]);
    const [editingCompany, setEditingCompany] = useState(null);
    const [deletingCompany, setDeletingCompany] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    
    // Debounce search term to avoid excessive filtering
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300); // 300ms delay
        
        return () => clearTimeout(timer);
    }, [searchTerm]);
    
    // Filter companies based on search term
    const filteredCompanies = useMemo(() => {

        if (!companies || !Array.isArray(companies)) {

            return [];
        }
        if (!debouncedSearchTerm.trim()) {

            return companies;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return companies.filter(company => {
            // Search in company name
            const nameMatch = company.company_name && 
                company.company_name.toLowerCase().includes(searchLower);
            
            // Search in address fields
            const addressMatch = [
                company.address_line_1,
                company.address_line_2,
                company.city,
                company.state_province_region,
                company.postal_code,
                company.country
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            return nameMatch || addressMatch;
        });
    }, [companies, debouncedSearchTerm]);

    const { items: sortedCompanies, requestSort, sortConfig } = useSortableData(filteredCompanies, { key: 'company_name', direction: 'ascending' });
    const { visibleCount: companyVisibleCount, hasMore: hasMoreCompanies, showMore: showMoreCompanies } = useFinderLimit(
        sortedCompanies.length,
        [debouncedSearchTerm, companies.length]
    );
    const displayedCompanies = sortedCompanies.slice(0, companyVisibleCount || sortedCompanies.length);

    const fetchCompanies = async () => {
        try {
            // Fetch companies, their addresses, and contact info
            const [companiesResult, addressesResult] = await Promise.all([
                supabase.from('pm_companies').select('*').order('company_name'),
                supabase.from('addresses').select('*').eq('addressable_type', 'pm_company')
            ]);
                
            if (companiesResult.error) {
                console.error('Error fetching companies:', companiesResult.error);
                setCompanies([]);
                return;
            }
            
            if (addressesResult.error) {
                console.error('Error fetching addresses:', addressesResult.error);
                // Continue with companies even if addresses fail
            }
            
            // Fetch contact info for PM companies
            const pmcIds = companiesResult.data?.map(c => c.pmc_id) || [];
            const contactsResult = pmcIds.length > 0 ? await supabase
                .from('contacts')
                .select('contact_id, contactable_id, first_name, last_name, middle_name')
                .in('contactable_id', pmcIds)
                .eq('contactable_type', 'pm_company') : { data: [] };
            
            // Get contact IDs and fetch their methods
            const contactIds = contactsResult.data?.map(c => c.contact_id) || [];
            const { data: methodsData } = contactIds.length > 0 ? await supabase
                .from('contact_methods')
                .select('contact_id, method_type, value')
                .in('contact_id', contactIds) : { data: [] };
            
            // Join companies with their addresses and contact info
            const companiesWithAddresses = companiesResult.data.map(company => {
                const address = addressesResult.data?.find(addr => 
                    addr.addressable_id === company.pmc_id && 
                    addr.addressable_type === 'pm_company'
                );
                const contact = contactsResult.data?.find(c => 
                    c.contactable_id === company.pmc_id
                );
                const contactMethods = contact ? methodsData?.filter(m => m.contact_id === contact.contact_id) || [] : [];
                
                return {
                    ...company,
                    address: address || {
                        address_line_1: '',
                        address_line_2: '',
                        city: '',
                        state_province_region: '',
                        postal_code: '',
                        country: ''
                    },
                    contact: contact ? {
                        ...contact,
                        methods: contactMethods
                    } : null
                };
            });
            
            setCompanies(companiesWithAddresses || []);
        } catch (error) {
            console.error('Error fetching companies:', error);
            setCompanies([]);
        }
    };

    useEffect(() => { 
        if (user?.role === 'global_admin') fetchCompanies(); 
    }, [user]);

    const handleSuccess = () => {
        setEditingCompany(null);
        setDeletingCompany(null);
        fetchCompanies();
    };
    
    const formatAddress = (c) => {
        if (!c.address) return 'No address specified';
        const { address_line_1, address_line_2, city, state_province_region, postal_code, country } = c.address;
        if (!address_line_1 && !city) return 'No address specified';
        return [address_line_1, address_line_2, city, state_province_region, postal_code, country].filter(Boolean).join(', ');
    };

    const getSortIndicator = (name) => {
        if (!sortConfig || sortConfig.key !== name) return <ArrowUpDown size={14} className="ml-2 text-gray-400"/>;
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <CreatePmcForm onPmcCreated={handleSuccess} />
            <Card
                title="PM Company Search"
                className="lg:col-span-2 max-h-[calc(100vh-160px)]"
                contentClassName="flex flex-col h-full"
            >
                <div className="flex flex-col h-full">
                {/* Search Box */}
                <div className="mb-4 flex-shrink-0">
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search companies by name, city, state, or postal code..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        />
                        {searchTerm !== debouncedSearchTerm ? (
                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                            </div>
                        ) : searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                                title="Clear search"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                        {debouncedSearchTerm ? (
                            sortedCompanies.length === 0 ? (
                                <span className="text-red-600">No companies found matching "{debouncedSearchTerm}"</span>
                            ) : (
                                <span>Showing {sortedCompanies.length} of {companies.length} companies</span>
                            )
                        ) : (
                            <span>Showing {companies.length} of {companies.length} companies</span>
                        )}
                    </div>
                </div>
                <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-y-auto overflow-x-hidden h-full">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">Actions</th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('company_name')} className="flex items-center">Company Name {getSortIndicator('company_name')}</button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                     <button onClick={() => requestSort('address')} className="flex items-center">Address {getSortIndicator('address')}</button>
                                </th>
                                <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                                    <button onClick={() => requestSort('contact')} className="flex items-center">Contact {getSortIndicator('contact')}</button>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {displayedCompanies.map(c => (
                                <tr key={c.pmc_id}>
                                    <td className="px-1.5 py-2 text-sm font-medium text-left whitespace-nowrap">
                                        <div className="flex items-center space-x-4">
                                            <button onClick={() => {

                                                setEditingCompany(c);
                                            }} className="text-indigo-600 hover:text-indigo-900" title="Edit PM Company"><Pencil size={16}/></button>
                                            <button onClick={() => setDeletingCompany(c)} className="text-red-600 hover:text-red-900" title="Delete PM Company"><Trash2 size={16}/></button>
                                        </div>
                                    </td>
                                    <td className="px-1.5 py-2 whitespace-nowrap font-medium">{c.company_name}</td>
                                    <td className="px-1.5 py-2 text-sm text-gray-500 whitespace-nowrap">{formatAddress(c)}</td>
                                    <td className="px-1.5 py-2 text-sm text-gray-500">
                                        {c.contact?.methods && c.contact.methods.length > 0 ? (
                                            <div className="space-y-1">
                                                {c.contact.methods.map((method, idx) => (
                                                    <div key={idx} className="text-xs">
                                                        <span className="font-medium capitalize">{method.method_type}:</span> {method.value}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-gray-400">No contact info</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
                {hasMoreCompanies && (
                    <div className="pt-3 mt-4 border-t text-right flex-shrink-0">
                        <button
                            type="button"
                            onClick={showMoreCompanies}
                            className="text-indigo-600 hover:text-indigo-800 underline text-sm font-medium"
                        >
                            more
                        </button>
                    </div>
                )}
                </div>
            </Card>
            {editingCompany && <EditPmcModal company={editingCompany} onClose={() => setEditingCompany(null)} onUpdateSuccess={handleSuccess} />}
            {deletingCompany && (
                <ArchiveModal 
                    entity={deletingCompany}
                    entityType="pm_company"
                    entityName={deletingCompany.company_name}
                    idField="pmc_id"
                    onClose={() => setDeletingCompany(null)}
                    onArchiveSuccess={handleSuccess}
                    showCascade={true}
                    cascadeMessage="Also archive all associated users"
                    requireReason={false}
                    isAdmin={user?.role === 'global_admin'}
                />
            )}
        </div>
    );
};

const CreatePmcForm = ({ onPmcCreated }) => {
    const { user } = useContext(AuthContext);
    const [companyName, setCompanyName] = useState('');
    const [address, setAddress] = useState({
        address_line_1: '', address_line_2: '', city: '', state_province_region: '', postal_code: '', country: ''
    });
    const [contactMethods, setContactMethods] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const formBodyRef = useRef(null);
    const contactMethodInputRefs = useRef({});
    
    const handleAddressChange = (field, value) => setAddress(prev => ({ ...prev, [field]: value }));

    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(m => m.tempId === tempId ? { ...m, [field]: value } : m)
        );
    };

    const addMethod = () => {
        const newTempId = Date.now();
        setContactMethods([...contactMethods, { type: '', value: '', tempId: newTempId }]);
        // Focus the new input field after state update
        setTimeout(() => {
            const input = contactMethodInputRefs.current[newTempId];
            if (input) {
                input.focus();
            }
        }, 0);
    };

    const removeMethod = (tempId) => {
        setContactMethods(contactMethods.filter(m => m.tempId !== tempId));
    };

    const resetForm = useCallback(() => {
        setCompanyName('');
        setAddress({
            address_line_1: '',
            address_line_2: '',
            city: '',
            state_province_region: '',
            postal_code: '',
            country: ''
        });
        setContactMethods([]);
        setFormError('');
    }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');
        try {
            const userId = user?.user_id;
            
            // First create the company
            const { data: companyData, error: companyError } = await insertWithAudit(
                'pm_companies',
                [{ company_name: companyName }],
                userId
            );
            
            if (companyError) {
                setFormError(companyError.message || 'Failed to create company.');
                return;
            }
            
            const company = companyData?.[0] || companyData;
            if (!company?.pmc_id) {
                setFormError('Failed to create company - no ID returned.');
                return;
            }
            
            // Then create the address
            if (Object.values(address).some(v => v && v.trim())) {
                const { error: addressError } = await insertWithAudit(
                    'addresses',
                    [{
                        addressable_id: company.pmc_id,
                        addressable_type: 'pm_company',
                        ...address
                    }],
                    userId
                );
                    
                if (addressError) {
                    console.error('Error creating company address:', addressError);
                    // Company was created but address failed - still show success
                }
            }
            
            // Create contact and contact methods if provided
            const validContactMethods = contactMethods.filter(m => m.type && m.value);
            if (validContactMethods.length > 0) {
                // Create contact record (PM companies don't have names, so we create an empty contact)
                const { data: contactData, error: contactError } = await insertWithAudit(
                    'contacts',
                    [{
                        contactable_id: company.pmc_id,
                        contactable_type: 'pm_company',
                        first_name: null,
                        middle_name: null,
                        last_name: null
                    }],
                    userId
                );
                
                const contact = contactData?.[0] || contactData;
                if (contactError) {
                    console.error('Error creating contact:', contactError);
                } else if (contact?.contact_id) {
                    // Insert contact methods
                    const contactMethodsToInsert = validContactMethods.map(method => ({
                        contact_id: contact.contact_id,
                        method_type: method.type,
                        value: method.value
                    }));
                    
                    const { error: contactMethodsError } = await insertWithAudit(
                        'contact_methods',
                        contactMethodsToInsert,
                        userId
                    );
                    
                    if (contactMethodsError) {
                        console.error('Error creating contact methods:', contactMethodsError);
                    }
                }
            }
            
            resetForm();
            onPmcCreated();
            // Scroll form body to top after state updates
            setTimeout(() => {
                if (formBodyRef.current) {
                    formBodyRef.current.scrollTop = 0;
                }
            }, 0);
        } catch {
            setFormError('Could not connect to server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        resetForm();
        // Scroll form body to top after state updates
        setTimeout(() => {
            if (formBodyRef.current) {
                formBodyRef.current.scrollTop = 0;
            }
        }, 0);
    };

    return (
        <Card hideTitle className="lg:col-span-1 max-h-[calc(100vh-160px)]" contentClassName="h-full">
            <form onSubmit={handleCreate} className="flex flex-col h-full">
                <div className="flex items-start justify-between pb-4 mb-4 border-b">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Add PM Company</h2>
                    </div>
                </div>
                <div ref={formBodyRef} className="flex-1 overflow-y-auto pr-1 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Company Name</label>
                    <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" />
                </div>
                <div className="pt-4 border-t">
                    <h4 className="text-md font-medium text-gray-800 mb-2">Address</h4>
                    <div className="space-y-2">
                        <input value={address.address_line_1} onChange={e => handleAddressChange('address_line_1', e.target.value)} placeholder="Address Line 1" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <input value={address.address_line_2} onChange={e => handleAddressChange('address_line_2', e.target.value)} placeholder="Address Line 2" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input value={address.city} onChange={e => handleAddressChange('city', e.target.value)} placeholder="City" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <input value={address.state_province_region} onChange={e => handleAddressChange('state_province_region', e.target.value)} placeholder="State / Province" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input value={address.postal_code} onChange={e => handleAddressChange('postal_code', e.target.value)} placeholder="Postal Code" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <input value={address.country} onChange={e => handleAddressChange('country', e.target.value)} placeholder="Country" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                        </div>
                    </div>
                </div>
                <div className="pt-4 border-t">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-md font-medium text-gray-800">Contact Methods</h4>
                        <button type="button" onClick={addMethod} className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center">
                            <PlusCircle size={16} className="mr-1"/> Add Contact Method
                        </button>
                    </div>
                        <div className="space-y-2">
                            {contactMethods.map((method) => (
                                <div key={method.tempId} className="flex gap-2 mb-2 items-center">
                                    <ContactMethodTypeInput
                                        value={method.type}
                                        onChange={value => handleMethodChange(method.tempId, 'type', value)}
                                        className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    />
                                    <input
                                        type="text"
                                        value={method.value}
                                        onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)}
                                        placeholder="Value (e.g., 555-1234)"
                                        autoComplete="tel"
                                        name="contact-method-value"
                                        className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeMethod(method.tempId)}
                                        className="p-2 text-red-500 hover:text-red-700"
                                        title="Remove"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                    </div>
                </div>
                </div>
                <div className="pt-4 mt-4 border-t flex flex-col gap-3">
                    {formError && (<div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">{formError}</div>)}
                    <div className="flex justify-end gap-3 flex-wrap">
                        <button type="button" onClick={handleClear} className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">
                            Clear
                        </button>
                        <button type="submit" disabled={isSubmitting} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                            {isSubmitting ? 'Adding...' : 'Add Company'}
                        </button>
                    </div>
                </div>
            </form>
        </Card>
    );
};

const EditPmcModal = ({ company, onClose, onUpdateSuccess }) => {
    const { user } = useContext(AuthContext);
    const [name, setName] = useState(company.company_name || '');
    const [address, setAddress] = useState({
        address_line_1: company.address?.address_line_1 || '',
        address_line_2: company.address?.address_line_2 || '',
        city: company.address?.city || '',
        state_province_region: company.address?.state_province_region || '',
        postal_code: company.address?.postal_code || '',
        country: company.address?.country || '',
    });
    const [contactMethods, setContactMethods] = useState(() => 
        (company.contact?.methods || []).map(m => ({ 
            ...m, 
            type: m.method_type || '', 
            method_type: m.method_type || '',
            tempId: Date.now() + Math.random() 
        }))
    );
    const contactMethodInputRefs = useRef({});

    const handleAddressChange = (field, value) => {
        setAddress(prev => ({ ...prev, [field]: value }));
    };

    const handleMethodChange = (tempId, field, value) => {
        setContactMethods(prevMethods => 
            prevMethods.map(m => m.tempId === tempId ? { ...m, [field]: value } : m)
        );
    };

    const addMethod = () => {
        const newTempId = Date.now();
        setContactMethods([...contactMethods, { type: '', value: '', tempId: newTempId }]);
        // Focus the new input field after state update
        setTimeout(() => {
            const input = contactMethodInputRefs.current[newTempId];
            if (input) {
                input.focus();
            }
        }, 0);
    };

    const removeMethod = (tempId) => {
        setContactMethods(contactMethods.filter(m => m.tempId !== tempId));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Ensure pmc_id is a number
        const pmcId = parseInt(company.pmc_id, 10);

        try {
            const userId = user?.user_id;
            
            // Update company name in pm_companies table
            const { error: companyError } = await updateWithAudit(
                'pm_companies',
                { company_name: name },
                'pmc_id',
                pmcId,
                userId
            );
                
            if (companyError) {
                console.error('Error updating company name:', companyError);
                return;
            }
            
            // Update address in addresses table
            // First find the address_id
            const { data: existingAddress } = await supabase
                .from('addresses')
                .select('address_id')
                .eq('addressable_id', pmcId)
                .eq('addressable_type', 'pm_company')
                .maybeSingle();
            
            if (existingAddress?.address_id) {
                const { error: addressError } = await updateWithAudit(
                    'addresses',
                    address,
                    'address_id',
                    existingAddress.address_id,
                    userId
                );
                    
                if (addressError) {
                    console.error('Error updating company address:', addressError);
                }
            } else if (Object.values(address).some(v => v && v.trim())) {
                // Create new address if it doesn't exist
                await insertWithAudit(
                    'addresses',
                    [{
                        addressable_id: pmcId,
                        addressable_type: 'pm_company',
                        ...address
                    }],
                    userId
                );
            }

            // Update contact and contact methods
            const validContactMethods = contactMethods.filter(m => m.type && m.value);
            
            // Get or create contact
            let { data: existingContact } = await supabase
                .from('contacts')
                .select('contact_id')
                .eq('contactable_id', pmcId)
                .eq('contactable_type', 'pm_company')
                .maybeSingle();
            
            let contactId = existingContact?.contact_id;
            
            if (!contactId && validContactMethods.length > 0) {
                // Create contact if we have contact methods but no contact exists
                const { data: newContact, error: contactError } = await insertWithAudit(
                    'contacts',
                    [{
                        contactable_id: pmcId,
                        contactable_type: 'pm_company',
                        first_name: null,
                        middle_name: null,
                        last_name: null
                    }],
                    userId
                );
                
                const contact = newContact?.[0] || newContact;
                if (contactError) {
                    console.error('Error creating contact:', contactError);
                } else if (contact?.contact_id) {
                    contactId = contact.contact_id;
                }
            }
            
            // Update contact methods
            if (contactId) {
                // Delete existing contact methods
                await deleteWithAudit(
                    'contact_methods',
                    'contact_id',
                    contactId,
                    userId
                );
                
                // Insert new contact methods
                if (validContactMethods.length > 0) {
                    const contactMethodsToInsert = validContactMethods.map(method => ({
                        contact_id: contactId,
                        method_type: method.type || method.method_type,
                        value: method.value
                    }));
                    
                    const { error: contactMethodsError } = await insertWithAudit(
                        'contact_methods',
                        contactMethodsToInsert,
                        userId
                    );
                    
                    if (contactMethodsError) {
                        console.error('Error updating contact methods:', contactMethodsError);
                    }
                }
            }

            onUpdateSuccess();
        } catch (error) {
            console.error('Error updating company:', error);
        }
    };
    
    const handleBackdropClick = (e) => {
        // Only close if clicking directly on the backdrop and not dragging
        if (e.target === e.currentTarget) {
            // Don't close on backdrop click
            return;
        }
    };

    const handleModalMouseDown = (e) => {
        e.stopPropagation();
    };

    return (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div className="w-full max-w-lg bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" onMouseDown={handleModalMouseDown} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Edit Company</h2>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    <form onSubmit={handleSubmit} className="p-6 space-y-4" id="edit-pmc-form">
                    <div><label className="block text-sm font-medium text-gray-700">Company Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/></div>
                    <div className="pt-4 border-t">
                        <h4 className="text-md font-medium text-gray-800 mb-2">Address</h4>
                        <div className="space-y-2">
                            <input value={address.address_line_1} onChange={e => handleAddressChange('address_line_1', e.target.value)} placeholder="Address Line 1" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <input value={address.address_line_2} onChange={e => handleAddressChange('address_line_2', e.target.value)} placeholder="Address Line 2" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <input value={address.city} onChange={e => handleAddressChange('city', e.target.value)} placeholder="City" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <input value={address.state_province_region} onChange={e => handleAddressChange('state_province_region', e.target.value)} placeholder="State / Province" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <input value={address.postal_code} onChange={e => handleAddressChange('postal_code', e.target.value)} placeholder="Postal Code" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                                <input value={address.country} onChange={e => handleAddressChange('country', e.target.value)} placeholder="Country" className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                        </div>
                    </div>
                    <div className="pt-4 border-t">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-md font-medium text-gray-800">Contact Methods</h4>
                            <button type="button" onClick={addMethod} className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center">
                                <PlusCircle size={16} className="mr-1"/> Add Contact Method
                            </button>
                        </div>
                        <div className="space-y-2">
                            {contactMethods.map((method) => (
                                <div key={method.tempId} className="flex gap-2 mb-2 items-center">
                                    <ContactMethodTypeInput
                                        value={method.type}
                                        onChange={value => handleMethodChange(method.tempId, 'type', value)}
                                        className="w-1/3 block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    />
                                    <input
                                        type="text"
                                        value={method.value}
                                        onChange={e => handleMethodChange(method.tempId, 'value', e.target.value)}
                                        placeholder="Value (e.g., 555-1234)"
                                        autoComplete="tel"
                                        name="contact-method-value"
                                        className="flex-grow block px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeMethod(method.tempId)}
                                        className="p-2 text-red-500 hover:text-red-700"
                                        title="Remove"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                    </form>
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                        <button type="submit" form="edit-pmc-form" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
    );
};


