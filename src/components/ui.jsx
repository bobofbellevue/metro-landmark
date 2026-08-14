import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export const Card = ({ title, children, className, contentClassName, hideTitle = false }) => (
    <div className={`p-6 bg-white rounded-lg shadow-md flex flex-col ${className || ''}`}>
        {!hideTitle && (
            <h3 className="mb-4 text-xl font-semibold text-gray-800 flex-shrink-0">{title}</h3>
        )}
        <div className={`flex-1 ${contentClassName || ''}`}>{children}</div>
    </div>
);

export const ConfirmationModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title = "Confirm Action", 
    message = "Are you sure you want to proceed?", 
    confirmText = "Confirm", 
    cancelText = "Cancel",
    isDestructive = false,
    isSuccess = false,
    isLoading = false 
}) => {
    if (!isOpen) return null;

    const handleConfirm = async () => {
        const result = onConfirm();
        // If onConfirm returns a promise, wait for it before closing
        if (result && typeof result.then === 'function') {
            try {
                await result;
                // Close after promise resolves successfully
                onClose();
            } catch (error) {
                // If there's an error, don't close the modal
                // The parent component should handle the error and may want to keep it open
                return;
            }
        } else {
            // If not a promise, close immediately
            onClose();
        }
    };

    const handleBackdropClick = (e) => {
        // Prevent closing on backdrop click - only close via buttons
        e.stopPropagation();
    };

    const handleModalClick = (e) => {
        e.stopPropagation();
    };

    const iconWrapClass = isDestructive
        ? 'bg-red-100'
        : isSuccess
          ? 'bg-green-100'
          : 'bg-yellow-100';
    const iconClass = isDestructive
        ? 'text-red-600'
        : isSuccess
          ? 'text-green-600'
          : 'text-yellow-600';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={handleBackdropClick}>
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={handleModalClick}>
                <div className="flex items-center justify-between p-6 border-b">
                    <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-full ${iconWrapClass}`}>
                            <AlertTriangle className={`w-6 h-6 ${iconClass}`} />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">
                            {title}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                        disabled={isLoading}
                    >
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-6">
                    <p className="text-sm text-gray-700 mb-6 whitespace-pre-wrap">
                        {message}
                    </p>
                    
                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={onClose}
                            disabled={isLoading}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-50"
                        >
                            {cancelText}
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isLoading}
                            className={`px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm disabled:opacity-50 ${
                                isDestructive 
                                    ? 'bg-red-600 hover:bg-red-700' 
                                    : 'bg-indigo-600 hover:bg-indigo-700'
                            }`}
                        >
                            {isLoading ? 'Processing...' : confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
