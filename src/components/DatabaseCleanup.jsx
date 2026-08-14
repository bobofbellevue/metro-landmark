import React, { useState, useContext } from 'react';
import { Trash2, Search, AlertTriangle, FileText, HardDrive, CheckSquare, Square, Loader } from 'lucide-react';
import { AuthContext } from '../contexts';
import { supabase } from '../lib/supabase';
import { ConfirmationModal } from './ui';

export default function DatabaseCleanup() {
    const { user } = useContext(AuthContext);
    const [activeTab, setActiveTab] = useState('records'); // 'records' or 'storage'
    const [isLoading, setIsLoading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [orphanedRecords, setOrphanedRecords] = useState([]);
    const [orphanedFiles, setOrphanedFiles] = useState([]);
    const [selectedRecords, setSelectedRecords] = useState(new Set());
    const [selectedFiles, setSelectedFiles] = useState(new Set());
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showDeleteRecordsConfirm, setShowDeleteRecordsConfirm] = useState(false);
    const [showDeleteFilesConfirm, setShowDeleteFilesConfirm] = useState(false);

    // Check if user is global admin
    if (user?.role !== 'global_admin') {
        return (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-yellow-800">
                    <AlertTriangle size={20} />
                    <p>This tool is only available to Global Administrators.</p>
                </div>
            </div>
        );
    }

    const findOrphanedRecords = async () => {
        setIsLoading(true);
        setError('');
        setSuccess('');
        setSelectedRecords(new Set());

        try {
            const response = await fetch('/api/admin/orphaned-records?type=all');
            const data = await response.json();

            if (!data.success) {
                setError(data.error || 'Failed to find orphaned records');
                return;
            }

            setOrphanedRecords(data.records || []);
            setSuccess(`Found ${data.count || 0} orphaned record(s)`);
        } catch (err) {
            console.error('Error finding orphaned records:', err);
            setError('Could not connect to the server.');
        } finally {
            setIsLoading(false);
        }
    };

    const findOrphanedStorage = async () => {
        setIsLoading(true);
        setError('');
        setSuccess('');
        setSelectedFiles(new Set());

        try {
            const response = await fetch('/api/admin/orphaned-storage');
            const data = await response.json();

            if (!data.success) {
                setError(data.error || 'Failed to find orphaned storage files');
                return;
            }

            setOrphanedFiles(data.files || []);
            setSuccess(`Found ${data.count || 0} orphaned file(s) in storage`);
        } catch (err) {
            console.error('Error finding orphaned storage:', err);
            setError('Could not connect to the server.');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleRecordSelection = (id) => {
        const newSelected = new Set(selectedRecords);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedRecords(newSelected);
    };

    const toggleFileSelection = (path) => {
        const newSelected = new Set(selectedFiles);
        if (newSelected.has(path)) {
            newSelected.delete(path);
        } else {
            newSelected.add(path);
        }
        setSelectedFiles(newSelected);
    };

    const selectAllRecords = () => {
        if (selectedRecords.size === orphanedRecords.length) {
            setSelectedRecords(new Set());
        } else {
            setSelectedRecords(new Set(orphanedRecords.map(r => r.id)));
        }
    };

    const selectAllFiles = () => {
        if (selectedFiles.size === orphanedFiles.length) {
            setSelectedFiles(new Set());
        } else {
            setSelectedFiles(new Set(orphanedFiles.map(f => f.path)));
        }
    };

    const handleDeleteRecordsClick = () => {
        if (selectedRecords.size === 0) return;
        setShowDeleteRecordsConfirm(true);
    };

    const deleteSelectedRecords = async () => {
        setIsDeleting(true);
        setError('');
        setSuccess('');

        try {
            const recordsToDelete = orphanedRecords.filter(r => selectedRecords.has(r.id));
            const response = await fetch('/api/admin/orphaned-records', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ records: recordsToDelete })
            });

            const data = await response.json();

            if (!data.success) {
                setError(data.error || 'Failed to delete records');
                return;
            }

            setSuccess(`Successfully deleted ${data.deleted_count || 0} record(s)`);
            setSelectedRecords(new Set());
            // Refresh the list
            await findOrphanedRecords();
            setShowDeleteRecordsConfirm(false);
        } catch (err) {
            console.error('Error deleting records:', err);
            setError('Could not connect to the server.');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDeleteFilesClick = () => {
        if (selectedFiles.size === 0) return;
        setShowDeleteFilesConfirm(true);
    };

    const deleteSelectedFiles = async () => {
        setIsDeleting(true);
        setError('');
        setSuccess('');

        try {
            const filesToDelete = orphanedFiles.filter(f => selectedFiles.has(f.path));
            const response = await fetch('/api/admin/orphaned-storage', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ files: filesToDelete })
            });

            const data = await response.json();

            if (!data.success) {
                setError(data.error || 'Failed to delete files');
                return;
            }

            setSuccess(`Successfully deleted ${data.deleted_count || 0} file(s) from storage`);
            setSelectedFiles(new Set());
            // Refresh the list
            await findOrphanedStorage();
            setShowDeleteFilesConfirm(false);
        } catch (err) {
            console.error('Error deleting files:', err);
            setError('Could not connect to the server.');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Database Cleanup</h3>
                    <p className="text-sm text-gray-600 mt-1">
                        Find and clean up orphaned database records and storage files that are no longer referenced.
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="flex -mb-px space-x-8">
                    <button
                        onClick={() => setActiveTab('records')}
                        className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                            activeTab === 'records'
                                ? 'border-indigo-500 text-indigo-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        <FileText size={16} />
                        Orphaned Records
                    </button>
                    <button
                        onClick={() => setActiveTab('storage')}
                        className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                            activeTab === 'storage'
                                ? 'border-indigo-500 text-indigo-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        <HardDrive size={16} />
                        Orphaned Storage Files
                    </button>
                </nav>
            </div>

            {/* Messages */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-red-800">
                        <AlertTriangle size={20} />
                        <p>{error}</p>
                    </div>
                </div>
            )}

            {success && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-800">
                        <p>{success}</p>
                    </div>
                </div>
            )}

            {/* Orphaned Records Tab */}
            {activeTab === 'records' && (
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={findOrphanedRecords}
                            disabled={isLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                            Find Orphaned Records
                        </button>

                        {orphanedRecords.length > 0 && (
                            <>
                                <button
                                    onClick={selectAllRecords}
                                    className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    {selectedRecords.size === orphanedRecords.length ? 'Deselect All' : 'Select All'}
                                </button>
                                <button
                                    onClick={handleDeleteRecordsClick}
                                    disabled={isDeleting || selectedRecords.size === 0}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isDeleting ? <Loader size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                    Delete Selected ({selectedRecords.size})
                                </button>
                            </>
                        )}
                    </div>

                    {orphanedRecords.length > 0 && (
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                                                <button onClick={selectAllRecords} className="focus:outline-none">
                                                    {selectedRecords.size === orphanedRecords.length ? (
                                                        <CheckSquare size={16} className="text-indigo-600" />
                                                    ) : (
                                                        <Square size={16} className="text-gray-400" />
                                                    )}
                                                </button>
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Type
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                ID
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Description
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Storage Path
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {orphanedRecords.map((record) => (
                                            <tr key={record.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <button
                                                        onClick={() => toggleRecordSelection(record.id)}
                                                        className="focus:outline-none"
                                                    >
                                                        {selectedRecords.has(record.id) ? (
                                                            <CheckSquare size={16} className="text-indigo-600" />
                                                        ) : (
                                                            <Square size={16} className="text-gray-400" />
                                                        )}
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    {record.type}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    {record.id}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-900">
                                                    {record.description}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-500">
                                                    {record.storage_path || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {orphanedRecords.length === 0 && !isLoading && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                            <p className="text-gray-500">No orphaned records found. Click "Find Orphaned Records" to search.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Orphaned Storage Files Tab */}
            {activeTab === 'storage' && (
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={findOrphanedStorage}
                            disabled={isLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                            Find Orphaned Storage Files
                        </button>

                        {orphanedFiles.length > 0 && (
                            <>
                                <button
                                    onClick={selectAllFiles}
                                    className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    {selectedFiles.size === orphanedFiles.length ? 'Deselect All' : 'Select All'}
                                </button>
                                <button
                                    onClick={handleDeleteFilesClick}
                                    disabled={isDeleting || selectedFiles.size === 0}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isDeleting ? <Loader size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                    Delete Selected ({selectedFiles.size})
                                </button>
                            </>
                        )}
                    </div>

                    {orphanedFiles.length > 0 && (
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                                                <button onClick={selectAllFiles} className="focus:outline-none">
                                                    {selectedFiles.size === orphanedFiles.length ? (
                                                        <CheckSquare size={16} className="text-indigo-600" />
                                                    ) : (
                                                        <Square size={16} className="text-gray-400" />
                                                    )}
                                                </button>
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                File Path
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Description
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {orphanedFiles.map((file, index) => (
                                            <tr key={index} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <button
                                                        onClick={() => toggleFileSelection(file.path)}
                                                        className="focus:outline-none"
                                                    >
                                                        {selectedFiles.has(file.path) ? (
                                                            <CheckSquare size={16} className="text-indigo-600" />
                                                        ) : (
                                                            <Square size={16} className="text-gray-400" />
                                                        )}
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-900 font-mono">
                                                    {file.path}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-500">
                                                    {file.description}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {orphanedFiles.length === 0 && !isLoading && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                            <p className="text-gray-500">No orphaned storage files found. Click "Find Orphaned Storage Files" to search.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Confirmation Modals */}
            <ConfirmationModal
                isOpen={showDeleteRecordsConfirm}
                onClose={() => setShowDeleteRecordsConfirm(false)}
                onConfirm={deleteSelectedRecords}
                title="Delete Orphaned Records"
                message={`Are you sure you want to delete ${selectedRecords.size} orphaned record(s)? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                isDestructive={true}
                isLoading={isDeleting}
            />

            <ConfirmationModal
                isOpen={showDeleteFilesConfirm}
                onClose={() => setShowDeleteFilesConfirm(false)}
                onConfirm={deleteSelectedFiles}
                title="Delete Orphaned Storage Files"
                message={`Are you sure you want to delete ${selectedFiles.size} orphaned file(s) from storage? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                isDestructive={true}
                isLoading={isDeleting}
            />
        </div>
    );
}
