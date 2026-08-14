import React, { useState, useContext } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { AuthContext } from '../contexts';
import { supabase } from '../lib/supabase';
import {
    clampDeleteConfirmationInput,
    getDeleteConfirmationMaxLength,
    getDeleteConfirmationTarget,
    matchesDeleteConfirmation,
} from '../utils/delete-confirmation.js';

/**
 * Universal Archive Modal Component
 * 
 * @param {Object} props
 * @param {Object} props.entity - The entity to archive (must have an ID field)
 * @param {string} props.entityType - Type of entity ('landlord', 'property', 'tenant', etc.)
 * @param {string} props.entityName - Display name of the entity
 * @param {string} props.idField - Name of the ID field (e.g., 'landlord_id', 'property_id')
 * @param {Function} props.onClose - Callback when modal is closed
 * @param {Function} props.onArchiveSuccess - Callback after successful archive
 * @param {boolean} props.showCascade - Whether to show cascade option (default: false)
 * @param {string} props.cascadeMessage - Message to display for cascade option
 * @param {boolean} props.requireReason - Whether archive reason is required (default: false)
 * @param {boolean} props.isAdmin - Whether current user is admin (shows hard delete option)
 */
const ArchiveModal = ({ 
    entity, 
    entityType, 
    entityName, 
    idField,
    onClose, 
    onArchiveSuccess,
    showCascade = false,
    cascadeMessage = 'Also archive all related records',
    requireReason = false,
    isAdmin = false
}) => {
    const { user } = useContext(AuthContext);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [archiveReason, setArchiveReason] = useState('');
    const [cascade, setCascade] = useState(true);
    const [showHardDelete, setShowHardDelete] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState('');

    const getDisplayType = () => {
        if (idField && idField.includes('applicant')) {
            return 'Applicant';
        }
        if (idField && idField.includes('tenant')) {
            return 'Tenant';
        }
        return entityType.charAt(0).toUpperCase() + entityType.slice(1);
    };

    const displayType = getDisplayType();

    const handleArchive = async () => {
        if (requireReason && !archiveReason.trim()) {
            setError('Please provide a reason for archiving.');
            return;
        }

        setIsSubmitting(true);
        setError('');
        
        try {
            const entityId = entity[idField];
            
            // Map entity types to table names and function names
            const entityConfig = {
                'pm_company': { tableName: 'pm_companies', functionName: 'archive_entity' },
                'pm_companies': { tableName: 'pm_companies', functionName: 'archive_entity' },
                'landlord': { tableName: 'landlords', functionName: 'archive_landlord' },
                'property': { tableName: 'properties', functionName: 'archive_property' },
                'unit': { tableName: 'units', functionName: 'archive_unit' },
                'client': { tableName: 'clients', functionName: 'archive_applicant' },
                'applicant': { tableName: 'clients', functionName: 'archive_applicant' },
                'tenant': { tableName: 'clients', functionName: 'archive_applicant' },
                'user': { tableName: 'users', functionName: 'archive_user' },
                'vendor': { tableName: 'vendors', functionName: 'archive_vendor' },
                'lease': { tableName: 'leases', functionName: 'archive_lease' },
                'template': { tableName: 'templates', functionName: 'archive_entity' }
            };
            
            const config = entityConfig[entityType] || { 
                tableName: `${entityType}s`, 
                functionName: `archive_${entityType}` 
            };
            
            let archiveError;
            
            // Use archive_entity for entities that don't have specific functions
            if (config.functionName === 'archive_entity') {
                archiveError = (await supabase.rpc('archive_entity', {
                    p_table_name: config.tableName,
                    p_entity_id: entityId,
                    p_archived_by_user_id: user?.user_id || null,
                    p_archive_reason: archiveReason.trim() || null,
                    p_cascade: cascade
                })).error;
            } else {
                // Use specific archive function
                archiveError = (await supabase.rpc(config.functionName, {
                    [`p_${idField}`]: entityId,
                    p_archived_by_user_id: user?.user_id || null,
                    p_archive_reason: archiveReason.trim() || null,
                    p_cascade: cascade
                })).error;
            }
            
            if (archiveError) {
                console.error(`Error archiving ${entityType}:`, archiveError);
                setError(archiveError.message || `Failed to archive ${entityType}.`);
                return;
            }
            
            onArchiveSuccess();
        } catch (err) {
            console.error(`Error during ${entityType} archive:`, err);
            setError('Could not connect to the server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleHardDelete = async () => {
        if (!matchesDeleteConfirmation(deleteConfirmation, entityName)) {
            setError(
                `Type at least the first ${getDeleteConfirmationTarget(entityName).length} character(s) of the ${displayType.toLowerCase()} name (e.g. "${getDeleteConfirmationTarget(entityName)}"). Extra characters are OK if they still match.`
            );
            return;
        }

        setIsSubmitting(true);
        setError('');
        
        try {
            const entityId = entity[idField];

            // Map entity types to correct table names
            const tableNameMap = {
                'pm_company': 'pm_companies',
                'pm_companies': 'pm_companies',
                'client': 'clients',
                'applicant': 'clients',
                'tenant': 'clients',
                'user': 'users',
                'landlord': 'landlords',
                'property': 'properties',
                'unit': 'units',
                'vendor': 'vendors',
                'lease': 'leases',
                'template': 'templates',
                'document': 'documents',
            };
            
            let tableName = tableNameMap[entityType];
            if (!tableName) {
                // Fallback: try pluralizing, but this might create errors
                tableName = `${entityType}s`;
            }

            // Clean up associated document storage files before deleting the entity
            // This must happen BEFORE hard_delete_entity so we can still find the documents
            if (tableName === 'clients' || tableName === 'users' || tableName === 'templates') {
                try {
                    const cleanupResponse = await fetch('/api/documents/cleanup-by-entity', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            table_name: tableName,
                            entity_id: entityId,
                            user_id: user.user_id
                        })
                    });

                    const cleanupData = await cleanupResponse.json();
                    if (!cleanupData.success) {
                        console.warn('Document storage cleanup warning:', cleanupData.error);
                        // Continue with deletion even if cleanup fails
                    } else if (cleanupData.deleted_count > 0) {
                        console.log(`Cleaned up ${cleanupData.deleted_count} document file(s) from storage`);
                    }
                } catch (cleanupError) {
                    console.warn('Error during document storage cleanup:', cleanupError);
                    // Continue with deletion even if cleanup fails
                }
            }

            const { error: deleteError } = await supabase.rpc('hard_delete_entity', {
                p_table_name: tableName,
                p_entity_id: entityId,
                p_deleted_by_user_id: user.user_id,
                p_force: true
            });
            
            if (deleteError) {
                console.error(`Error hard deleting ${entityType}:`, deleteError);
                setError(deleteError.message || `Failed to delete ${displayType.toLowerCase()}.`);
                return;
            }
            
            onArchiveSuccess();
        } catch (err) {
            console.error(`Error during ${entityType} hard delete:`, err);
            setError('Could not connect to the server.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget && !isDragging) {
            onClose();
        }
    };

    const handleModalMouseDown = (e) => {
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleModalMouseMove = (e) => {
        if (e.buttons === 1) {
            setIsDragging(true);
        }
    };

    const handleModalMouseUp = (e) => {
        e.stopPropagation();
        setTimeout(() => setIsDragging(false), 100);
    };
    
    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50" onClick={handleBackdropClick}>
            <div 
                className="w-full max-w-md p-6 space-y-4 bg-white rounded-lg shadow-xl" 
                onMouseDown={handleModalMouseDown}
                onMouseMove={handleModalMouseMove}
                onMouseUp={handleModalMouseUp}
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900">
                        {showHardDelete ? `⚠️ Permanently Delete ${displayType}` : `Archive ${displayType}`}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={24} />
                    </button>
                </div>

                {!showHardDelete ? (
                    <>
                        <div className="space-y-3">
                            <p className="text-sm text-gray-700">
                                You're about to archive <span className="font-bold">{entityName}</span>.
                            </p>
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                                <p className="text-sm text-blue-800">
                                    <strong>Archiving preserves all data and history.</strong> The {entityType} will be hidden from normal views but can be restored later if needed.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700">
                                    Reason for archiving {requireReason && <span className="text-red-500">*</span>}
                                </label>
                                <textarea
                                    value={archiveReason}
                                    onChange={(e) => setArchiveReason(e.target.value)}
                                    placeholder="e.g., No longer managing this property, moved out, etc."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    rows={3}
                                    disabled={isSubmitting}
                                />
                            </div>

                            {showCascade && (
                                <label className="flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-100">
                                    <input
                                        type="checkbox"
                                        checked={cascade}
                                        onChange={(e) => setCascade(e.target.checked)}
                                        className="mt-1"
                                        disabled={isSubmitting}
                                    />
                                    <span className="text-sm text-gray-700">{cascadeMessage}</span>
                                </label>
                            )}
                        </div>

                        {error && (
                            <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                {error}
                            </div>
                        )}

                        <div className="flex justify-between items-center pt-4">
                            {isAdmin ? (
                                <button 
                                    type="button" 
                                    onClick={() => {
                                        setShowHardDelete(true);
                                        setDeleteConfirmation('');
                                        setError('');
                                    }}
                                    className="text-xs text-red-600 hover:text-red-800 underline"
                                    disabled={isSubmitting}
                                >
                                    Permanently delete instead
                                </button>
                            ) : (
                                <div></div>
                            )}
                            
                            <div className="flex gap-3">
                                <button 
                                    type="button" 
                                    onClick={onClose} 
                                    disabled={isSubmitting} 
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="button" 
                                    onClick={handleArchive} 
                                    disabled={isSubmitting} 
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700"
                                >
                                    {isSubmitting ? 'Archiving...' : `Archive ${entityType}`}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="space-y-3">
                            <div className="flex items-start gap-3 p-4 bg-red-50 border-2 border-red-400 rounded-md">
                                <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
                                <div className="space-y-2">
                                    <p className="text-sm font-bold text-red-900">
                                        WARNING: This is permanent deletion!
                                    </p>
                                    <ul className="text-xs text-red-800 space-y-1 list-disc list-inside">
                                        <li>Cannot be undone</li>
                                        <li>All historical data will be lost</li>
                                        <li>May violate audit requirements</li>
                                        <li>Only use for data entry errors or testing</li>
                                    </ul>
                                </div>
                            </div>

                            <p className="text-sm text-gray-700">
                                Are you sure you want to <strong className="text-red-600">permanently delete</strong> <span className="font-bold">{entityName}</span>?
                            </p>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700">
                                    Type at least{' '}
                                    <span className="font-bold text-red-600">
                                        {getDeleteConfirmationTarget(entityName)}
                                    </span>
                                    {String(entityName || '').trim().length >
                                    getDeleteConfirmationTarget(entityName).length ? (
                                        <span className="text-gray-500 font-normal">
                                            {' '}
                                            (first {getDeleteConfirmationTarget(entityName).length}{' '}
                                            characters of &quot;{entityName}&quot;; more is OK if it
                                            still matches)
                                        </span>
                                    ) : null}{' '}
                                    to confirm permanent deletion:
                                </label>
                                <input
                                    type="text"
                                    value={deleteConfirmation}
                                    onChange={(e) =>
                                        setDeleteConfirmation(
                                            clampDeleteConfirmationInput(
                                                e.target.value,
                                                entityName
                                            )
                                        )
                                    }
                                    maxLength={
                                        getDeleteConfirmationMaxLength(entityName) ||
                                        undefined
                                    }
                                    placeholder={getDeleteConfirmationTarget(entityName)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                                    disabled={isSubmitting}
                                    autoFocus
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
                                {error}
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4">
                            <button 
                                type="button" 
                                onClick={() => {
                                    setShowHardDelete(false);
                                    setDeleteConfirmation('');
                                    setError('');
                                }} 
                                disabled={isSubmitting} 
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                            >
                                Back to Archive
                            </button>
                            <button 
                                type="button" 
                                onClick={handleHardDelete} 
                                disabled={isSubmitting || !matchesDeleteConfirmation(deleteConfirmation, entityName)} 
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? 'Deleting...' : 'Permanently Delete'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ArchiveModal;
