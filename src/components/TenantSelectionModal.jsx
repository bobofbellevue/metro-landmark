import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, UserPlus, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const TenantSelectionModal = ({ 
    isOpen, 
    onClose, 
    tenants, 
    selectedTenantIds, 
    onTenantSelection, 
    title = "Select Tenants" 
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [tenantUnits, setTenantUnits] = useState(new Map()); // Map<user_id, {unit_id, unit_name, unit_address}>
    const [unitTenants, setUnitTenants] = useState(new Map()); // Map<unit_id, Set<user_id>>
    const [loadingUnits, setLoadingUnits] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    
    // Debounce search term
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);
        
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Fetch unit assignments for tenants
    useEffect(() => {
        if (!isOpen || !tenants || tenants.length === 0) return;

        const fetchTenantUnits = async () => {
            setLoadingUnits(true);
            try {
                // Get client_ids for all tenants
                const userIds = tenants.map(t => t.user_id).filter(Boolean);
                if (userIds.length === 0) {
                    setLoadingUnits(false);
                    return;
                }

                const { data: clientRecords } = await supabase
                    .from('clients')
                    .select('client_id, user_id')
                    .in('user_id', userIds);

                if (!clientRecords || clientRecords.length === 0) {
                    setLoadingUnits(false);
                    return;
                }

                const clientIds = clientRecords.map(cr => cr.client_id);
                const userIdToClientId = new Map(
                    clientRecords.map(cr => [cr.user_id, cr.client_id])
                );

                // Fetch client_units for these clients
                const today = new Date().toISOString().split('T')[0];
                const { data: clientUnits } = await supabase
                    .from('client_units')
                    .select('client_id, unit_id')
                    .in('client_id', clientIds)
                    .eq('is_archived', false)
                    .or(`end_date.is.null,end_date.gte.${today}`);

                if (!clientUnits || clientUnits.length === 0) {
                    setLoadingUnits(false);
                    return;
                }

                // Get unique unit_ids
                const unitIds = [...new Set(clientUnits.map(cu => cu.unit_id).filter(Boolean))];
                
                // Fetch units with addresses
                const { data: units } = await supabase
                    .from('units')
                    .select(`
                        unit_id,
                        unit_number,
                        properties!inner(
                            property_id,
                            property_name
                        )
                    `)
                    .in('unit_id', unitIds);

                // Fetch addresses for properties
                const propertyIds = [...new Set((units || []).map(u => u.properties?.property_id).filter(Boolean))];
                const { data: addresses } = await supabase
                    .from('addresses')
                    .select('*')
                    .eq('addressable_type', 'property')
                    .in('addressable_id', propertyIds);

                // Build maps
                const unitsMap = new Map();
                const addressesMap = new Map();
                const tenantUnitsMap = new Map();
                const unitTenantsMap = new Map();

                (units || []).forEach(unit => {
                    unitsMap.set(unit.unit_id, unit);
                });

                (addresses || []).forEach(addr => {
                    addressesMap.set(addr.addressable_id, addr);
                });

                // Format unit name
                const formatUnitName = (unit) => {
                    const address = addressesMap.get(unit.properties?.property_id);
                    const addressParts = [
                        address?.address_line_1,
                        address?.city,
                        address?.state_province_region
                    ].filter(Boolean);
                    const addressString = addressParts.length > 0 
                        ? addressParts.join(', ')
                        : (unit.properties?.property_name || 'No Address');
                    return `Unit ${unit.unit_number} - ${addressString}`;
                };

                clientUnits.forEach(cu => {
                    const unit = unitsMap.get(cu.unit_id);
                    if (!unit) return;

                    const clientId = cu.client_id;
                    const userId = Array.from(userIdToClientId.entries())
                        .find(([uid, cid]) => cid === clientId)?.[0];
                    
                    if (!userId) return;

                    const unitName = formatUnitName(unit);
                    tenantUnitsMap.set(userId, {
                        unit_id: unit.unit_id,
                        unit_name: unitName
                    });

                    if (!unitTenantsMap.has(unit.unit_id)) {
                        unitTenantsMap.set(unit.unit_id, new Set());
                    }
                    unitTenantsMap.get(unit.unit_id).add(userId);
                });

                setTenantUnits(tenantUnitsMap);
                setUnitTenants(unitTenantsMap);
            } catch (error) {
                console.error('Error fetching tenant units:', error);
            } finally {
                setLoadingUnits(false);
            }
        };

        fetchTenantUnits();
    }, [isOpen, tenants]);

    // Filter tenants based on search term
    const filteredTenants = useMemo(() => {
        if (!tenants || !Array.isArray(tenants)) {
            return [];
        }
        if (!debouncedSearchTerm.trim()) {
            return tenants;
        }
        
        const searchLower = debouncedSearchTerm.toLowerCase();
        return tenants.filter(tenant => {
            const nameMatch = [
                tenant.first_name,
                tenant.last_name,
                tenant.email
            ].some(field => field && field.toLowerCase().includes(searchLower));
            
            return nameMatch;
        });
    }, [tenants, debouncedSearchTerm]);

    // Sort tenants by last name, then first name (unit info remains for warnings/display)
    const sortedTenants = useMemo(() => {
        if (!filteredTenants || filteredTenants.length === 0) return [];

        const withUnitInfo = filteredTenants.map(tenant => {
            const unitInfo = tenantUnits.get(tenant.user_id);
            return unitInfo ? { ...tenant, unitInfo } : { ...tenant };
        });

        return withUnitInfo.sort((a, b) => {
            const aLast = (a.last_name || '').toLowerCase();
            const bLast = (b.last_name || '').toLowerCase();
            const lastCompare = aLast.localeCompare(bLast);
            if (lastCompare !== 0) return lastCompare;

            const aFirst = (a.first_name || '').toLowerCase();
            const bFirst = (b.first_name || '').toLowerCase();
            const firstCompare = aFirst.localeCompare(bFirst);
            if (firstCompare !== 0) return firstCompare;

            return (a.email || '').toLowerCase().localeCompare((b.email || '').toLowerCase());
        });
    }, [filteredTenants, tenantUnits]);

    // Check if tenants are from different units
    const getSelectedTenantsUnitIds = useMemo(() => {
        const unitIds = new Set();
        selectedTenantIds.forEach(userId => {
            const unitInfo = tenantUnits.get(userId);
            if (unitInfo) {
                unitIds.add(unitInfo.unit_id);
            }
        });
        return unitIds;
    }, [selectedTenantIds, tenantUnits]);

    // Check for warnings when selecting tenants
    useEffect(() => {
        if (selectedTenantIds.length === 0) {
            setWarningMessage('');
            return;
        }

        const unitIds = Array.from(getSelectedTenantsUnitIds);
        
        // Check if multiple different units are selected
        if (unitIds.length > 1) {
            setWarningMessage('Warning: You have selected tenants from different units. Please select tenants from only one unit at a time.');
            return;
        }

        // Check if a tenant with assigned unit is selected but not all tenants from that unit
        if (unitIds.length === 1) {
            const unitId = unitIds[0];
            const allTenantsInUnit = unitTenants.get(unitId) || new Set();
            const selectedTenantsInUnit = selectedTenantIds.filter(
                userId => tenantUnits.get(userId)?.unit_id === unitId
            );
            
            if (selectedTenantsInUnit.length > 0 && selectedTenantsInUnit.length < allTenantsInUnit.size) {
                const unitInfo = Array.from(tenantUnits.values()).find(u => u.unit_id === unitId);
                setWarningMessage(`Warning: You have selected ${selectedTenantsInUnit.length} of ${allTenantsInUnit.size} tenant(s) from ${unitInfo?.unit_name || 'this unit'}. Consider selecting all tenants from this unit.`);
            } else {
                setWarningMessage('');
            }
        } else {
            setWarningMessage('');
        }
    }, [selectedTenantIds, getSelectedTenantsUnitIds, unitTenants, tenantUnits]);

    const handleTenantToggle = (tenantId) => {
        const isSelected = selectedTenantIds.includes(tenantId);
        const tenantUnitInfo = tenantUnits.get(tenantId);
        
        // Check if selecting this tenant would create a conflict with different units
        if (!isSelected && tenantUnitInfo) {
            const currentUnitIds = Array.from(getSelectedTenantsUnitIds);
            if (currentUnitIds.length > 0 && !currentUnitIds.includes(tenantUnitInfo.unit_id)) {
                // Prevent selection - different unit
                return;
            }
        }
        
        onTenantSelection(tenantId, !isSelected);
    };

    const handleSelectAllInUnit = (unitId, unitName) => {
        const allTenantsInUnit = unitTenants.get(unitId) || new Set();
        allTenantsInUnit.forEach(userId => {
            if (!selectedTenantIds.includes(userId)) {
                onTenantSelection(userId, true);
            }
        });
    };

    const handleSelectAll = () => {
        const allFilteredIds = sortedTenants.map(t => t.user_id);
        const allSelected = allFilteredIds.every(id => selectedTenantIds.includes(id));
        
        if (allSelected) {
            // Deselect all filtered tenants
            allFilteredIds.forEach(id => {
                if (selectedTenantIds.includes(id)) {
                    onTenantSelection(id, false);
                }
            });
        } else {
            // Select all filtered tenants (but only if they're from the same unit or no units)
            const unitIds = new Set();
            allFilteredIds.forEach(id => {
                const unitInfo = tenantUnits.get(id);
                if (unitInfo) {
                    unitIds.add(unitInfo.unit_id);
                }
            });
            
            if (unitIds.size > 1) {
                // Can't select all - different units
                return;
            }
            
            allFilteredIds.forEach(id => {
                if (!selectedTenantIds.includes(id)) {
                    onTenantSelection(id, true);
                }
            });
        }
    };

    const handleDone = () => {
        // Check for warnings before closing
        const unitIds = Array.from(getSelectedTenantsUnitIds);
        if (unitIds.length === 1) {
            const unitId = unitIds[0];
            const allTenantsInUnit = unitTenants.get(unitId) || new Set();
            const selectedTenantsInUnit = selectedTenantIds.filter(
                userId => tenantUnits.get(userId)?.unit_id === unitId
            );
            
            if (selectedTenantsInUnit.length > 0 && selectedTenantsInUnit.length < allTenantsInUnit.size) {
                const unitInfo = Array.from(tenantUnits.values()).find(u => u.unit_id === unitId);
                if (!window.confirm(`You have selected ${selectedTenantsInUnit.length} of ${allTenantsInUnit.size} tenant(s) from ${unitInfo?.unit_name || 'this unit'}. Do you want to continue without selecting all tenants from this unit?`)) {
                    return;
                }
            }
        }
        
        onClose();
    };

    const formatTenantName = (tenant) => {
        const first = tenant.first_name || '';
        const last = tenant.last_name || '';
        const middle = tenant.middle_name ? ` ${tenant.middle_name.charAt(0)}.` : '';
        const name = `${last}, ${first}${middle}`.replace(/\s+/g, ' ').trim();
        // If name is empty, fall back to email or "Unknown"
        return name || tenant.email || 'Unknown';
    };

    if (!isOpen) return null;
    
    const handleBackdropClick = (e) => {
        // Prevent closing on backdrop click - only close via buttons
        e.stopPropagation();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={handleBackdropClick}>
            <div className="w-full max-w-2xl max-h-[80vh] bg-white rounded-lg shadow-xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-800">{title}</h2>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X size={24} />
                    </button>
                </div>
                
                {/* Search and Controls */}
                <div className="p-6 border-b border-gray-200">
                    <div className="relative mb-4">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search tenants by name or email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        />
                    </div>
                    
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                            {debouncedSearchTerm ? (
                                sortedTenants.length === 0 ? (
                                    <span className="text-red-600">No tenants found matching "{debouncedSearchTerm}"</span>
                                ) : (
                                    <span>Showing {sortedTenants.length} of {tenants.length} tenants</span>
                                )
                            ) : (
                                <span>Showing {tenants.length} tenants</span>
                            )}
                        </div>
                        
                        {sortedTenants.length > 0 && (
                            <button
                                type="button"
                                onClick={handleSelectAll}
                                className="flex items-center gap-2 px-3 py-1 text-sm text-indigo-600 hover:text-indigo-800 border border-indigo-300 rounded-md hover:bg-indigo-50"
                            >
                                <UserPlus size={16} />
                                {sortedTenants.every(t => selectedTenantIds.includes(t.user_id)) ? 'Deselect All' : 'Select All'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Warning Message */}
                {warningMessage && (
                    <div className="px-6 py-3 bg-yellow-50 border-b border-yellow-200">
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-yellow-800">{warningMessage}</p>
                        </div>
                    </div>
                )}
                
                {/* Tenant List */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loadingUnits ? (
                        <div className="text-center py-8 text-gray-500">Loading tenant assignments...</div>
                    ) : sortedTenants.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            {debouncedSearchTerm ? 'No tenants found matching your search.' : 'No tenants available.'}
                        </div>
                    ) : (
                        <div className="finder-list space-y-2">
                            {sortedTenants.map(tenant => {
                                const isSelected = selectedTenantIds.includes(tenant.user_id);
                                const unitInfo = tenant.unitInfo || tenantUnits.get(tenant.user_id);
                                const isDisabled = !isSelected && unitInfo && getSelectedTenantsUnitIds.size > 0 && !getSelectedTenantsUnitIds.has(unitInfo.unit_id);
                                
                                // Check if there are other unselected tenants in the same unit
                                const allTenantsInUnit = unitInfo ? (unitTenants.get(unitInfo.unit_id) || new Set()) : new Set();
                                const selectedTenantsInUnit = Array.from(allTenantsInUnit).filter(
                                    userId => selectedTenantIds.includes(userId)
                                );
                                const hasUnselectedTenantsInUnit = unitInfo && isSelected && selectedTenantsInUnit.length < allTenantsInUnit.size;
                                
                                return (
                                    <div
                                        key={tenant.user_id}
                                        className={`rounded-lg border transition-colors ${
                                            isSelected 
                                                ? 'bg-indigo-50 border-indigo-200' 
                                                : isDisabled
                                                ? 'bg-gray-100 border-gray-200 opacity-50 cursor-not-allowed'
                                                : 'bg-white border-gray-200 hover:bg-gray-50 cursor-pointer'
                                        }`}
                                    >
                                        <div 
                                            onClick={() => !isDisabled && handleTenantToggle(tenant.user_id)}
                                            className="flex items-center justify-between p-3"
                                        >
                                            <div className="flex items-center space-x-3 flex-1">
                                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                                    isSelected 
                                                        ? 'bg-indigo-600 border-indigo-600' 
                                                        : 'border-gray-300'
                                                }`}>
                                                    {isSelected && <Check size={12} className="text-white" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-gray-900 break-words">
                                                        {formatTenantName(tenant)}
                                                    </div>
                                                    {unitInfo && (
                                                        <div className="finder-secondary text-indigo-600 mt-1">
                                                            {unitInfo.unit_name}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <div className="finder-secondary text-indigo-600 ml-2">
                                                    Selected
                                                </div>
                                            )}
                                        </div>
                                        {hasUnselectedTenantsInUnit && (
                                            <div className="px-3 pb-3">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSelectAllInUnit(unitInfo.unit_id, unitInfo.unit_name);
                                                    }}
                                                    className="w-full text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-300 rounded px-2 py-1 hover:bg-indigo-50"
                                                >
                                                    Select all Tenants of {unitInfo.unit_name}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                
                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                            {selectedTenantIds.length} tenant{selectedTenantIds.length !== 1 ? 's' : ''} selected
                        </div>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDone}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TenantSelectionModal;
