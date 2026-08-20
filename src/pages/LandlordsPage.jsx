import React, { useContext } from 'react';
import { AuthContext } from '../contexts';
import LandlordManagement from '../components/LandlordManagement';

export default function LandlordsPage() {
    const { user } = useContext(AuthContext);
    
    // Check if user has permission to access landlords
    if (!user?.role || (user.role !== 'global_admin' && user.role !== 'company_admin')) {
        return (
            <div className="space-y-6">
                <h2 className="text-3xl font-bold text-gray-800">Landlords</h2>
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                    <p className="text-red-800">You don't have permission to access this page.</p>
                </div>
            </div>
        );
    }
    
    return (
        <div className="finder-page">
            <h2 className="text-3xl font-bold text-gray-800">Landlords</h2>
            <LandlordManagement />
        </div>
    );
}
