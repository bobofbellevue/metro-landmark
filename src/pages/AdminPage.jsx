import React, { useState, useContext } from 'react';
import { UserPlus, Building, FileText, Shield, Trash2 } from 'lucide-react';

// Import shared and component modules
import { AuthContext } from '../contexts';
import UserManagement from '../components/UserManagement';
import PMCompanyManagement from '../components/PMCompanyManagement';
import TemplateManagement from '../components/TemplateManagement';
import AuditLogs from '../components/AuditLogs';
import DatabaseCleanup from '../components/DatabaseCleanup';

export default function AdminPage() {
    const { user } = useContext(AuthContext);
    const [activeTab, setActiveTab] = useState('users');
    
    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800">Administration</h2>
            <div className="border-b border-gray-200">
                <nav className="flex -mb-px space-x-8">
                    <button onClick={() => setActiveTab('users')} className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'users' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><UserPlus size={16}/> Users</button>
                    {user?.role === 'global_admin' && (
                        <button onClick={() => setActiveTab('pmcs')} className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'pmcs' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><Building size={16}/> PM Companies</button>
                    )}
                    {(user?.role === 'global_admin' || user?.role === 'company_admin') && (
                        <button onClick={() => setActiveTab('templates')} className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'templates' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><FileText size={16}/> Templates</button>
                    )}
                    {(user?.role === 'global_admin' || user?.role === 'company_admin') && (
                        <button onClick={() => setActiveTab('audit')} className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'audit' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><Shield size={16}/> Audit Logs</button>
                    )}
                    {user?.role === 'global_admin' && (
                        <button onClick={() => setActiveTab('orphaned')} className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'orphaned' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><Trash2 size={16}/> Database Cleanup</button>
                    )}
                </nav>
            </div>
            <div className="mt-6">
                {/* The main AuthContext is already provided by App.jsx, so these components will inherit it */}
                {activeTab === 'users' && <UserManagement />}
                {activeTab === 'pmcs' && <PMCompanyManagement />}
                {activeTab === 'templates' && <TemplateManagement />}
                {activeTab === 'audit' && <AuditLogs />}
                {activeTab === 'orphaned' && <DatabaseCleanup />}
            </div>
        </div>
    );
};

