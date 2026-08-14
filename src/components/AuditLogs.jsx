import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { FileText, Download, Search, Filter, X, Calendar, User, Database, Activity, Trash2, ArrowUpDown } from 'lucide-react';
import { AuthContext } from '../contexts';
import { Card } from './ui';
import { api } from '../api';
import DateInput from './DateInput';
import { useSortableData } from '../hooks';

export default function AuditLogs() {
    const { user } = useContext(AuthContext);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [limit] = useState(100);
    const [selectedLog, setSelectedLog] = useState(null);
    const [showClearModal, setShowClearModal] = useState(false);
    const [clearDate, setClearDate] = useState('');
    const [clearAll, setClearAll] = useState(false);
    const [clearing, setClearing] = useState(false);
    
    // Filters
    const [filters, setFilters] = useState({
        table_name: '',
        record_id: '',
        user_id: '',
        action: '',
        start_date: '',
        end_date: '',
        search: ''
    });

    // Available entities for filter dropdown (sorted alphabetically, excluding relationship tables)
    const availableTables = [
        'client_applications',
        'clients',
        'compliance_policies',
        'compliance_workflows',
        'documents',
        'landlords',
        'legal_notices',
        'leases',
        'maintenance_requests',
        'pm_companies',
        'properties',
        'units',
        'users',
        'vendors'
    ].sort();

    const actions = ['INSERT', 'UPDATE', 'DELETE', 'ARCHIVE', 'REINSTATE'];

    // Map table names to user-friendly names
    const getTableDisplayName = (tableName) => {
        const tableNameMap = {
            'pm_companies': 'PM Company',
            'users': 'User',
            'landlords': 'Landlord',
            'properties': 'Property',
            'units': 'Unit',
            'clients': 'Client',
            'vendors': 'Vendor',
            'leases': 'Lease',
            'maintenance_requests': 'Maintenance Request',
            'client_applications': 'Application',
            'documents': 'Document',
            'compliance_workflows': 'Compliance Workflow',
            'compliance_policies': 'Compliance Policy',
            'legal_notices': 'Legal Notice',
            'contacts': 'Contacts',
            'contact_methods': 'Contact Methods'
        };
        return tableNameMap[tableName] || tableName;
    };

    // Map actions to user-friendly terms, detecting Archive/Reinstate
    const getActionDisplayName = (log) => {
        // Check if this is an archive or reinstate operation
        if (log.action === 'UPDATE' && log.changed_fields) {
            const hasIsArchived = log.changed_fields.includes('is_archived');
            if (hasIsArchived) {
                // Check old_values and new_values to determine if archiving or reinstating
                const oldArchived = log.old_values?.is_archived;
                const newArchived = log.new_values?.is_archived;
                if (oldArchived === false && newArchived === true) {
                    return 'Archive';
                }
                if (oldArchived === true && newArchived === false) {
                    return 'Reinstate';
                }
            }
        }
        
        // Standard action mappings
        const actionMap = {
            'INSERT': 'Create',
            'UPDATE': 'Change',
            'DELETE': 'Delete'
        };
        return actionMap[log.action] || log.action;
    };

    // Fetch audit logs
    const fetchLogs = useCallback(async (resetOffset = false) => {
        setLoading(true);
        setError('');

        try {
            const currentOffset = resetOffset ? 0 : offset;
            const params = new URLSearchParams({
                limit: limit.toString(),
                offset: currentOffset.toString()
            });

            // Add filters
            Object.entries(filters).forEach(([key, value]) => {
                if (value && value.trim()) {
                    params.append(key, value.trim());
                }
            });

            const response = await api.get(`/audit-logs/list?${params.toString()}`, user);

            if (response.success) {
                if (resetOffset) {
                    setLogs(response.logs || []);
                    setOffset(0);
                } else {
                    setLogs(prev => [...prev, ...(response.logs || [])]);
                }
                setTotal(response.total || 0);
            } else {
                setError(response.error || 'Failed to fetch audit logs');
                setLogs([]);
            }
        } catch (err) {
            console.error('Error fetching audit logs:', err);
            setError('Failed to fetch audit logs');
            setLogs([]);
        } finally {
            setLoading(false);
        }
    }, [filters, offset, limit, user]);

    // Initial load
    useEffect(() => {
        fetchLogs(true);
    }, [filters, fetchLogs]);

    // Handle filter changes
    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        setOffset(0);
    };

    // Clear all filters
    const clearFilters = () => {
        setFilters({
            table_name: '',
            record_id: '',
            user_id: '',
            action: '',
            start_date: '',
            end_date: '',
            search: ''
        });
        setOffset(0);
    };

    // Export logs
    const handleExport = async (format = 'csv') => {
        try {
            const params = new URLSearchParams({ format });

            // Add filters
            Object.entries(filters).forEach(([key, value]) => {
                if (value && value.trim()) {
                    params.append(key, value.trim());
                }
            });

            const url = `${import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api')}/audit-logs/export?${params.toString()}`;
            
            const response = await fetch(url, {
                headers: {
                    'x-user-id': user?.user_id,
                    'x-user-role': user?.role
                }
            });

            if (!response.ok) {
                throw new Error('Export failed');
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);
        } catch (err) {
            console.error('Error exporting audit logs:', err);
            setError('Failed to export audit logs');
        }
    };

    // Format date/time in user's local timezone
    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short'
        });
    };

    // Get entity name from audit log (for deleted entities, use old_values)
    const getEntityName = (log) => {
        // For DELETE actions, use old_values
        // For INSERT/UPDATE actions, use new_values
        const values = log.action === 'DELETE' ? log.old_values : log.new_values;
        if (!values) return `ID: ${log.record_id}`;
        
        // Try common name fields
        const nameFields = ['company_name', 'first_name', 'last_name', 'name', 'property_name', 'unit_number', 'email'];
        for (const field of nameFields) {
            if (values[field]) {
                if (field === 'first_name' || field === 'last_name') {
                    const firstName = values.first_name || '';
                    const lastName = values.last_name || '';
                    const middleName = values.middle_name || '';
                    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
                    if (fullName) return fullName;
                } else {
                    return values[field];
                }
            }
        }
        
        // Fallback to ID
        return `ID: ${log.record_id}`;
    };

    // Get action color (handles both SQL actions and display names)
    const getActionColor = (action) => {
        const actionUpper = action.toUpperCase();
        // Handle both SQL actions and display names
        if (actionUpper === 'INSERT' || action === 'Create') {
            return 'bg-green-100 text-green-800';
        }
        if (actionUpper === 'UPDATE' || action === 'Change' || action === 'Archive' || action === 'Reinstate') {
            return 'bg-blue-100 text-blue-800';
        }
        if (actionUpper === 'DELETE' || action === 'Delete') {
            return 'bg-red-100 text-red-800';
        }
        return 'bg-gray-100 text-gray-800';
    };

    // Load more
    const loadMore = () => {
        if (!loading && logs.length < total) {
            setOffset(prev => prev + limit);
            fetchLogs(false);
        }
    };

    const hasActiveFilters = Object.values(filters).some(v => v && v.trim());

    // Prepare logs for sorting - add computed fields for sorting
    const logsForSorting = useMemo(() => {
        return logs.map(log => ({
            ...log,
            entityName: getTableDisplayName(log.table_name),
            actionName: getActionDisplayName(log),
            entityDisplayName: getEntityName(log),
            userName: log.user ? log.user.email : 'System',
            time: log.created_at ? new Date(log.created_at).getTime() : 0
        }));
    }, [logs]);

    // Sort logs
    const { items: sortedLogs, requestSort, sortConfig } = useSortableData(logsForSorting, { key: 'time', direction: 'descending' });

    // Get sort indicator
    const getSortIndicator = (key) => {
        if (!sortConfig || sortConfig.key !== key) {
            return <ArrowUpDown size={14} className="ml-2 text-gray-400" />;
        }
        return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
    };

    // Handle clear audit logs
    const handleClear = async () => {
        setClearing(true);
        try {
            const params = new URLSearchParams();
            if (clearAll) {
                params.append('all', 'true');
            } else if (clearDate) {
                params.append('before_date', clearDate);
            }

            const url = `${import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api')}/audit-logs/clear?${params.toString()}`;
            
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'x-user-id': user?.user_id,
                    'x-user-role': user?.role
                }
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to clear audit logs');
            }

            // Refresh the logs list
            setShowClearModal(false);
            setClearDate('');
            setClearAll(false);
            fetchLogs(true);
        } catch (err) {
            console.error('Error clearing audit logs:', err);
            setError(err.message || 'Failed to clear audit logs');
        } finally {
            setClearing(false);
        }
    };

    // Set default date to 90 days ago
    useEffect(() => {
        if (!clearDate && !clearAll) {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            setClearDate(ninetyDaysAgo.toISOString().split('T')[0]);
        }
    }, [showClearModal]);

    return (
        <div className="space-y-6">
            <Card title="Audit Logs" className="max-h-[calc(100vh-160px)]" contentClassName="flex flex-col h-full">
                {/* Filters */}
                <div className="mb-4 flex-shrink-0 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {/* Entity filter */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <Database size={14} className="inline mr-1" />
                                Entity
                            </label>
                            <select
                                value={filters.table_name}
                                onChange={(e) => handleFilterChange('table_name', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">All Entities</option>
                                {availableTables.map(table => (
                                    <option key={table} value={table}>{getTableDisplayName(table)}</option>
                                ))}
                            </select>
                        </div>

                        {/* Action filter */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <Activity size={14} className="inline mr-1" />
                                Action
                            </label>
                            <select
                                value={filters.action}
                                onChange={(e) => handleFilterChange('action', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">All Actions</option>
                                {actions.map(action => {
                                    const actionMap = {
                                        'INSERT': 'Create',
                                        'UPDATE': 'Change',
                                        'DELETE': 'Delete',
                                        'ARCHIVE': 'Archive',
                                        'REINSTATE': 'Reinstate'
                                    };
                                    return (
                                        <option key={action} value={action}>{actionMap[action] || action}</option>
                                    );
                                })}
                            </select>
                        </div>

                        {/* User filter */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <User size={14} className="inline mr-1" />
                                User ID
                            </label>
                            <input
                                type="number"
                                value={filters.user_id}
                                onChange={(e) => handleFilterChange('user_id', e.target.value)}
                                placeholder="Filter by user ID"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        {/* Record ID filter */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Record ID
                            </label>
                            <input
                                type="number"
                                value={filters.record_id}
                                onChange={(e) => handleFilterChange('record_id', e.target.value)}
                                placeholder="Filter by record ID"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        {/* Start date */}
                        <div>
                            <DateInput
                                label="Start Date"
                                value={filters.start_date}
                                onChange={(e) => handleFilterChange('start_date', e.target.value || null)}
                            />
                        </div>

                        {/* End date */}
                        <div>
                            <DateInput
                                label="End Date"
                                value={filters.end_date}
                                onChange={(e) => handleFilterChange('end_date', e.target.value || null)}
                            />
                        </div>

                        {/* Search */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <Search size={14} className="inline mr-1" />
                                Search Fields
                            </label>
                            <input
                                type="text"
                                value={filters.search}
                                onChange={(e) => handleFilterChange('search', e.target.value)}
                                placeholder="Search in changed fields"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                    </div>

                    {/* Filter actions */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {hasActiveFilters && (
                                <button
                                    onClick={clearFilters}
                                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
                                >
                                    <X size={14} />
                                    Clear Filters
                                </button>
                            )}
                            <span className="text-sm text-gray-600">
                                Showing {logs.length} of {total} logs
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleExport('csv')}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center gap-2"
                            >
                                <Download size={16} />
                                Export CSV
                            </button>
                            <button
                                onClick={() => handleExport('json')}
                                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 flex items-center gap-2"
                            >
                                <Download size={16} />
                                Export JSON
                            </button>
                            <button
                                onClick={() => setShowClearModal(true)}
                                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center gap-2"
                            >
                                <Trash2 size={16} />
                                Clear
                            </button>
                        </div>
                    </div>
                </div>

                {/* Error message */}
                {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm">
                        {error}
                    </div>
                )}

                {/* Logs table */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    {loading && logs.length === 0 ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <FileText size={48} className="mx-auto mb-4 text-gray-400" />
                            <p>No audit logs found</p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <button onClick={() => requestSort('time')} className="flex items-center">
                                            Time {getSortIndicator('time')}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <button onClick={() => requestSort('entityName')} className="flex items-center">
                                            Entity {getSortIndicator('entityName')}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <button onClick={() => requestSort('actionName')} className="flex items-center">
                                            Action {getSortIndicator('actionName')}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <button onClick={() => requestSort('entityDisplayName')} className="flex items-center">
                                            Entity Name {getSortIndicator('entityDisplayName')}
                                        </button>
                                    </th>
                                    {sortedLogs.some(log => log.user) && (
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            <button onClick={() => requestSort('userName')} className="flex items-center">
                                                User {getSortIndicator('userName')}
                                            </button>
                                        </th>
                                    )}
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Changed Fields
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Details
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {sortedLogs.map((log) => (
                                    <tr key={log.audit_id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                            {formatDateTime(log.created_at)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {log.entityName}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getActionColor(log.action)}`}>
                                                {log.actionName}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                            <div className="font-medium">{log.entityDisplayName}</div>
                                        </td>
                                        {sortedLogs.some(l => l.user) && (
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                                {log.user ? (
                                                    <div>
                                                        <div className="font-medium">{log.user.email}</div>
                                                        <div className="text-xs text-gray-500">{log.user.role}</div>
                                                    </div>
                                                ) : null}
                                            </td>
                                        )}
                                        <td className="px-4 py-3 text-sm text-gray-900">
                                            {log.changed_fields && log.changed_fields.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {log.changed_fields.slice(0, 3).map((field, idx) => (
                                                        <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                                            {field}
                                                        </span>
                                                    ))}
                                                    {log.changed_fields.length > 3 && (
                                                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                                            +{log.changed_fields.length - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                            <button
                                                onClick={() => setSelectedLog(log)}
                                                className="text-indigo-600 hover:text-indigo-800 underline text-sm"
                                            >
                                                View Details
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Load more */}
                {logs.length < total && (
                    <div className="mt-4 flex-shrink-0 text-center">
                        <button
                            onClick={loadMore}
                            disabled={loading}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Loading...' : `Load More (${total - logs.length} remaining)`}
                        </button>
                    </div>
                )}
            </Card>

            {/* Detail Modal */}
            {selectedLog && (
                <AuditLogDetailModal 
                    log={selectedLog} 
                    onClose={() => setSelectedLog(null)}
                    getTableDisplayName={getTableDisplayName}
                    getActionDisplayName={getActionDisplayName}
                    formatDateTime={formatDateTime}
                />
            )}

            {/* Clear Modal */}
            {showClearModal && (
                <ClearAuditLogsModal
                    onClose={() => {
                        setShowClearModal(false);
                        setClearDate('');
                        setClearAll(false);
                    }}
                    onConfirm={handleClear}
                    clearDate={clearDate}
                    setClearDate={setClearDate}
                    clearAll={clearAll}
                    setClearAll={setClearAll}
                    clearing={clearing}
                />
            )}
        </div>
    );
}

// Clear Audit Logs Modal Component
const ClearAuditLogsModal = ({ onClose, onConfirm, clearDate, setClearDate, clearAll, setClearAll, clearing }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
            <div className="w-full max-w-md bg-white rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Clear Audit Logs</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6 space-y-4">
                    <p className="text-sm text-gray-600">
                        This action cannot be undone. Choose how you want to clear audit logs:
                    </p>

                    <div className="space-y-3">
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                                type="radio"
                                name="clearOption"
                                checked={clearAll}
                                onChange={() => {
                                    setClearAll(true);
                                    setClearDate('');
                                }}
                                className="w-4 h-4 text-red-600 focus:ring-red-500"
                            />
                            <span className="text-sm font-medium text-gray-700">Delete all audit log records</span>
                        </label>

                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input
                                type="radio"
                                name="clearOption"
                                checked={!clearAll}
                                onChange={() => setClearAll(false)}
                                className="w-4 h-4 text-red-600 focus:ring-red-500"
                            />
                            <span className="text-sm font-medium text-gray-700">Delete records older than:</span>
                        </label>

                        {!clearAll && (
                            <div className="ml-7">
                                <DateInput
                                    label="Date"
                                    value={clearDate}
                                    onChange={(e) => setClearDate(e.target.value || '')}
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                    Records created before this date will be deleted (default: 90 days ago)
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={clearing}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={clearing || (!clearAll && !clearDate)}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {clearing ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Clearing...
                            </>
                        ) : (
                            <>
                                <Trash2 size={16} />
                                Clear Logs
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Detail Modal Component
const AuditLogDetailModal = ({ log, onClose, getTableDisplayName, getActionDisplayName, formatDateTime }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
            <div className="w-full max-w-4xl bg-white rounded-lg shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Audit Log Details</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Entity</label>
                            <div className="text-sm text-gray-900">{getTableDisplayName(log.table_name)}</div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Record ID</label>
                            <div className="text-sm text-gray-900">{log.record_id}</div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
                            <div className="text-sm text-gray-900">{getActionDisplayName(log)}</div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                            <div className="text-sm text-gray-900">{formatDateTime(log.created_at)}</div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
                            <div className="text-sm text-gray-900">
                                {log.user ? (
                                    <div>
                                        <div className="font-medium">{log.user.email}</div>
                                        <div className="text-xs text-gray-500">{log.user.role}</div>
                                    </div>
                                ) : (
                                    <span className="text-gray-400">System</span>
                                )}
                            </div>
                        </div>
                        {log.changed_fields && log.changed_fields.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Changed Fields</label>
                                <div className="flex flex-wrap gap-1">
                                    {log.changed_fields.map((field, idx) => (
                                        <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                            {field}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Old Values */}
                    {log.old_values && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Old Values</label>
                            <pre className="bg-gray-50 border border-gray-200 rounded-md p-4 text-xs overflow-x-auto max-h-64 overflow-y-auto">
                                {JSON.stringify(log.old_values, null, 2)}
                            </pre>
                        </div>
                    )}

                    {/* New Values */}
                    {log.new_values && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">New Values</label>
                            <pre className="bg-gray-50 border border-gray-200 rounded-md p-4 text-xs overflow-x-auto max-h-64 overflow-y-auto">
                                {JSON.stringify(log.new_values, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
                
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

