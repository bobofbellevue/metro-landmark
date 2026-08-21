import React, { useState, useEffect, useContext, useRef } from 'react';
import { Building2, LayoutDashboard, Wrench, Shield, LogOut, Settings as SettingsIcon, Menu, X, UserCircle, UserPlus, Building, Briefcase, FileText, UserCheck, Store, DollarSign } from 'lucide-react';

// Import shared modules
import { AuthContext, SidebarContext } from './contexts';
import { supabase } from './lib/supabase.js';
import { Card } from './components/ui';
import {
  brand,
  readStoredAuthUser,
  writeStoredAuthUser,
  clearStoredAuthUser,
} from './config/brand.js';
import { api } from './api.js';
import { applyOrgTheme, clearOrgTheme } from './utils/org-theme.js';

// Import page-level components (Admin)
import AdminPage from './pages/AdminPage';
import PropertiesPage from './pages/PropertiesPage';
import VendorsPage from './pages/VendorsPage';
import ApplicantsPage from './pages/ApplicantsPage';
import TenantsPage from './pages/TenantsPage';
import LeasesPage from './pages/LeasesPage';
import LandlordsPage from './pages/LandlordsPage';
import MaintenancePage from './pages/MaintenancePage';
import CompliancePage from './pages/CompliancePage';
import CompliancePoliciesPage from './pages/CompliancePoliciesPage';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import DocumentsPage from './pages/DocumentsPage';
import PaymentsPage from './pages/PaymentsPage';

// Import tenant layout and pages
import TenantSinglePage from './pages/tenant/TenantSinglePage';

// Import applicant portal
import ApplicantPortal from './pages/applicant/ApplicantPortal';

// Import vendor layout and pages
import VendorLayout from './layouts/VendorLayout';
import VendorProfile from './pages/vendor/VendorProfile';
import VendorMaintenance from './pages/vendor/VendorMaintenance';

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authAttempted, setAuthAttempted] = useState(false);
  const [userType, setUserType] = useState(null); // 'tenant', 'applicant', or 'admin'
  const [orgTheme, setOrgTheme] = useState(null);
  const [resolvedPhones, setResolvedPhones] = useState(null);

  useEffect(() => {
    document.title = brand.productName;

    const storedUser = readStoredAuthUser();
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      determineUserType(parsedUser);
      
      // Check if Supabase Auth session exists and is valid
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error || !session) {
          console.warn('No Supabase Auth session found - storage operations may fail. User may need to log in again.');
        }
      });
    }
    setAuthAttempted(true);
  }, []);

  const determineUserType = async (userData) => {
    if (!userData || !userData.email) {
      setUserType('admin');
      return;
    }

    // Check if user is a vendor
    if (userData.role === 'vendor') {
      setUserType('vendor');
      return;
    }

    try {
      const clientUserId = userData.user_id || userData.id;
      const { data: clientRecord, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', clientUserId)
        .maybeSingle();

      if (clientError && clientError.code !== 'PGRST116') {
        console.error('[App] Error fetching client record:', clientError);
      }

      if (clientRecord?.client_id) {
        // Determine if client is a tenant or applicant based on active client_units assignments
        const today = new Date().toISOString().split('T')[0];
        const { data: activeAssignments, error: unitsError } = await supabase
          .from('client_units')
          .select('client_unit_id')
          .eq('client_id', clientRecord.client_id)
          .eq('is_archived', false)
          .lte('start_date', today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .limit(1);

        if (!unitsError && activeAssignments && activeAssignments.length > 0) {
          setUserType('tenant');
        } else {
          setUserType('applicant');
        }
        return;
      }
    } catch (error) {
      console.error('Error determining client role:', error);
    }

    // Default to admin layout
    setUserType('admin');
  };

  // Enrich logged-in user with full profile (to get first/last name for header)
  useEffect(() => {
    const enrichUserProfile = async () => {
      try {
        if (!user || !user.user_id) return;
        
        // Store original user_id and email to prevent accidental user switching
        const originalUserId = user.user_id;
        const originalEmail = user.email;
        
        // Only fetch if we don't already have name fields
        const missingName = !user.first_name && !user.last_name;
        if (!missingName) return;
        
        // Get user details and contact information
        // For clients (tenants/applicants), use client_id; for others, use user_id
        let contactQuery;
        
        // Check if user is a client (tenant or applicant)
        const { data: clientData, error: clientError } = await supabase
          .from('clients')
          .select('client_id')
          .eq('user_id', originalUserId)
          .maybeSingle();
        
        if (clientError) {
          console.error('[App] Error checking if user is client:', clientError);
        }
        
        if (clientData?.client_id) {
          // User is a client - use user_id with contactable_type='client'
          contactQuery = supabase
            .from('contacts')
            .select('*')
            .eq('contactable_id', originalUserId)
            .eq('contactable_type', 'client')
            .maybeSingle();
        } else {
          // User is not a client - use user_id with contactable_type='user'
          contactQuery = supabase
            .from('contacts')
            .select('*')
            .eq('contactable_id', originalUserId)
            .eq('contactable_type', 'user')
            .maybeSingle();
        }
        
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('user_id', originalUserId)
          .maybeSingle();
        
        if (userError) {
          console.error('[App] Error fetching user data:', userError);
        }
        
        const { data: contactData, error: contactError } = await contactQuery;
        
        if (contactError) {
          console.error('[App] Error fetching contact data:', contactError);
        }
        
        if (userData) {
          // Verify we're still enriching the same user (safety check)
          if (userData.user_id !== originalUserId || userData.email !== originalEmail) {
            console.error('[Auth] User enrichment attempted to change user - prevented');
            return;
          }
          
          const contact = contactData;
          const enriched = { 
            ...user, 
            ...userData,
            first_name: contact?.first_name || '',
            middle_name: contact?.middle_name || '',
            last_name: contact?.last_name || ''
          };
          
          // Double-check before setting
          if (enriched.user_id === originalUserId && enriched.email === originalEmail) {
            setUser(enriched);
            writeStoredAuthUser(JSON.stringify(enriched));
          } else {
            console.error('[Auth] Enriched user data mismatch - prevented user change');
          }
        } else if (!userError) {
          console.warn('[App] User not found in database - user_id:', originalUserId);
        }
      } catch (error) {
        console.error('[App] Error enriching user profile:', error);
      }
    };
    enrichUserProfile();
  }, [user?.user_id, user?.email]); // Only re-run if user_id or email changes

  useEffect(() => {
    if (!user?.pmc_id) {
      clearOrgTheme();
      setOrgTheme(null);
      return undefined;
    }

    let cancelled = false;
    const loadOrgTheme = async () => {
      try {
        const data = await api.get('/org-theme', user);
        if (cancelled) return;
        if (data?.success && data.theme) {
          setOrgTheme(data.theme);
          applyOrgTheme(data.theme);
        } else {
          setOrgTheme(null);
          clearOrgTheme();
        }
      } catch {
        if (!cancelled) {
          setOrgTheme(null);
          clearOrgTheme();
        }
      }
    };
    loadOrgTheme();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setResolvedPhones(null);
      return undefined;
    }
    let cancelled = false;
    const loadPhones = async () => {
      try {
        const data = await api.get('/phone-resources', user);
        if (cancelled) return;
        if (data?.success && data.resolved) {
          setResolvedPhones(data.resolved);
        }
      } catch {
        if (!cancelled) setResolvedPhones(null);
      }
    };
    loadPhones();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleLoginSuccess = async (userData, supabaseSession) => {
    setUser(userData);
    writeStoredAuthUser(JSON.stringify(userData));
    
    // Set Supabase Auth session if provided (for storage access)
    if (supabaseSession?.access_token) {
      try {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: supabaseSession.access_token,
          refresh_token: supabaseSession.refresh_token || '',
        });
        if (sessionError) {
          console.warn('Could not set Supabase Auth session:', sessionError);
        }
      } catch (sessionError) {
        console.warn('Error setting Supabase session:', sessionError);
      }
    }
    
    await determineUserType(userData);
  };

  const handleLogout = async () => {
    setUser(null);
    setUserType(null);
    setOrgTheme(null);
    clearOrgTheme();
    setResolvedPhones(null);
    clearStoredAuthUser();
    // Sign out from Supabase Auth as well
    await supabase.auth.signOut();
  };

  const authValue = { user, logout: handleLogout, orgTheme, setOrgTheme, resolvedPhones, setResolvedPhones };

  if (!authAttempted) return null;

  // Show loading state while determining user type
  if (user && userType === null) {
    return (
      <AuthContext.Provider value={authValue}>
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={authValue}>
      {user ? (
        userType === 'tenant' ? <TenantAppLayout /> :
        userType === 'applicant' ? <ApplicantAppLayout /> :
        userType === 'vendor' ? <VendorAppLayout /> :
        <MainAppLayout />
      ) : (
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      )}
    </AuthContext.Provider>
  );
}

// --- Login Page ---
const LoginPage = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const emailInputRef = useRef(null);

  // Clear leftover autofill, then put the caret in Email address.
  useEffect(() => {
    setEmail('');
    setPassword('');
    setError('');

    const timeout = setTimeout(() => {
      setEmail('');
      setPassword('');
      emailInputRef.current?.focus();
    }, 100);

    return () => clearTimeout(timeout);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (data.success) {
        onLoginSuccess(data.user, data.supabaseSession);
      } else {
        setError(data.message || 'Login failed.');
      }
    } catch {
      setError('Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="flex items-end justify-center min-h-screen bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${brand.backgroundUrl})` }}
      role={brand.backgroundAlt ? 'img' : undefined}
      aria-label={brand.backgroundAlt || undefined}
    >
      <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-md mb-8">
        <div className="flex items-center gap-4">
            <img src={brand.logoUrl} alt={brand.logoAlt} className="h-16 flex-shrink-0" />
            <div>
                <h2 className="text-3xl font-extrabold text-gray-900">{brand.productHeading}</h2>
                <p className="mt-2 text-sm text-gray-600">Sign in to your account</p>
            </div>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit} autoComplete="off">
          <div className="space-y-3">
            <div><input id="email-address" name="email" type="email" autoComplete="off" required className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md appearance-none" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} ref={emailInputRef} /></div>
            <div><input id="password" name="password" type="password" autoComplete="off" required className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md appearance-none" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          </div>
          {error && (<div className="p-3 text-sm text-red-700 bg-red-100 border-red-400 rounded-md">{error}</div>)}
          <div><button type="submit" disabled={isLoading} className="relative flex justify-center w-full px-4 py-2 text-sm font-medium text-indigo-600 bg-gray-100 border border-gray-300 rounded-md group hover:bg-gray-200">{isLoading ? 'Signing in...' : 'Sign in'}</button></div>
        </form>
      </div>
    </div>
  );
};

// --- Tenant App Layout ---
function TenantAppLayout() {
  return <TenantSinglePage />;
}

// --- Applicant App Layout ---
function ApplicantAppLayout() {
  return <ApplicantPortal />;
}

// --- Vendor App Layout ---
function VendorAppLayout() {
  return (
    <VendorLayout>
      <VendorPageRouter />
    </VendorLayout>
  );
}

function VendorPageRouter() {
  const { activePage } = useContext(SidebarContext);
  
  switch (activePage) {
    case 'Profile': return <VendorProfile />;
    case 'Maintenance': return <VendorMaintenance />;
    default: return <VendorProfile />;
  }
}

// --- Main App Layout (Admin) ---
function MainAppLayout() {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePage, setActivePage] = useState('Dashboard');
  const isMobile = () => window.innerWidth < 768;
  const toggleSidebar = () => isMobile() ? setMobileOpen(p => !p) : setExpanded(p => !p);

  useEffect(() => {
    const handleResize = () => { if (!isMobile()) setMobileOpen(false); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const renderActivePage = () => {
    switch (activePage) {
      case 'Dashboard': return <DashboardPage />;
      case 'Landlords': return <LandlordsPage />;
      case 'Properties': return <PropertiesPage />;
      case 'Vendors': return <VendorsPage />;
      case 'Applicants': return <ApplicantsPage />;
      case 'Tenants': return <TenantsPage />;
      case 'Leases': return <LeasesPage />;
      case 'Payments': return <PaymentsPage />;
      case 'Maintenance': return <MaintenancePage />;
      case 'Compliance': return <CompliancePage />;
      case 'Compliance Policies': return <CompliancePoliciesPage />;
      case 'Documents': return <DocumentsPage />;
      case 'Admin': return <AdminPage />;
      case 'Settings': return <SettingsPage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <SidebarContext.Provider value={{ expanded, mobileOpen, toggleSidebar, activePage, setActivePage }}>
      <div className="flex h-full max-h-full bg-gray-100 overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          <TopHeader />
          <main className="app-main flex flex-col flex-1 min-w-0 min-h-0 p-2 md:p-3 lg:p-4">{renderActivePage()}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

// --- UI Components ---
function Sidebar() {
  const { user } = useContext(AuthContext);
  const { mobileOpen, expanded, toggleSidebar } = useContext(SidebarContext);
  
  // Get menu items based on user role
  const getMenuItems = () => {
    const role = user?.role;
    const baseItems = [
      { icon: <LayoutDashboard />, text: 'Dashboard' }
    ];

    if (role === 'global_admin') {
      return [
        ...baseItems,
        { icon: <Briefcase />, text: 'Landlords' },
        { icon: <Building2 />, text: 'Properties' },
        { icon: <Store />, text: 'Vendors' },
        { icon: <UserCheck />, text: 'Applicants' },
        { icon: <Building2 />, text: 'Tenants' },
        { icon: <FileText />, text: 'Leases' },
        { icon: <DollarSign />, text: 'Payments' },
        { icon: <Wrench />, text: 'Maintenance' },
        { icon: <Shield />, text: 'Compliance' },
        { icon: <Shield />, text: 'Compliance Policies' },
        { icon: <FileText />, text: 'Documents' },
        { icon: <UserPlus />, text: 'Admin' },
        { icon: <SettingsIcon />, text: 'Settings' }
      ];
    }

    if (role === 'company_admin') {
      return [
        ...baseItems,
        { icon: <Building2 />, text: 'Properties' },
        { icon: <UserCheck />, text: 'Applicants' },
        { icon: <Building2 />, text: 'Tenants' },
        { icon: <FileText />, text: 'Leases' },
        { icon: <DollarSign />, text: 'Payments' },
        { icon: <Wrench />, text: 'Maintenance' },
        { icon: <Shield />, text: 'Compliance' },
        { icon: <Shield />, text: 'Compliance Policies' },
        { icon: <FileText />, text: 'Documents' },
        { icon: <UserPlus />, text: 'Admin' },
        { icon: <SettingsIcon />, text: 'Settings' }
      ];
    }

    if (role === 'manager') {
      return [
        ...baseItems,
        { icon: <Building2 />, text: 'Properties' },
        { icon: <FileText />, text: 'Leases' },
        { icon: <DollarSign />, text: 'Payments' },
        { icon: <Wrench />, text: 'Maintenance' },
        { icon: <Shield />, text: 'Compliance' },
        { icon: <FileText />, text: 'Documents' },
        { icon: <SettingsIcon />, text: 'Settings' }
      ];
    }

    if (role === 'staff') {
      return [
        ...baseItems,
        { icon: <Building2 />, text: 'Properties' },
        { icon: <Wrench />, text: 'Maintenance' },
        { icon: <SettingsIcon />, text: 'Settings' }
      ];
    }

    if (role === 'landlord') {
      return [
        ...baseItems,
        { icon: <Building2 />, text: 'Properties' },
        { icon: <FileText />, text: 'Leases' },
        { icon: <DollarSign />, text: 'Payments' },
        { icon: <Wrench />, text: 'Maintenance' },
        { icon: <Shield />, text: 'Compliance' },
        { icon: <FileText />, text: 'Documents' },
        { icon: <SettingsIcon />, text: 'Settings' }
      ];
    }

    // Default fallback (shouldn't reach here, but just in case)
    return baseItems;
  };

  const menuItems = getMenuItems();

  return (
    <>
      <aside className={`app-sidebar fixed top-0 left-0 z-20 h-full bg-gray-800 text-white transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:flex-shrink-0 overflow-x-hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${expanded ? 'w-64' : 'w-20'}`}>
        <nav className="flex flex-col h-full">
          <SidebarHeader />
          <ul className="flex-1 min-h-0 px-3 overflow-y-auto overflow-x-hidden">
            {menuItems.map((item, index) => (
              <SidebarItem key={index} icon={item.icon} text={item.text} />
            ))}
          </ul>
          <div className="p-4 border-t border-gray-700"><LogoutButton /></div>
        </nav>
      </aside>
      {mobileOpen && <div onClick={toggleSidebar} className="fixed inset-0 z-10 bg-black md:hidden opacity-50"></div>}
    </>
  );
}
function SidebarHeader() {
    const { expanded, toggleSidebar, mobileOpen } = useContext(SidebarContext);
    const { orgTheme } = useContext(AuthContext);
    const sidebarLogo = orgTheme?.logoUrl || brand.logoUrl;
    const invertLogo = !orgTheme?.logoUrl;
    const isMobileDevice = () => window.innerWidth < 768;
    return (
      <div className="flex items-center justify-between p-4 pb-2">
        <div className={`flex items-center overflow-hidden transition-all ${expanded ? "gap-4" : "gap-0"}`}>
          <div className={`flex-shrink-0 transition-all duration-200 flex items-center justify-center rounded-lg ${expanded ? 'h-16 w-16 bg-indigo-500 p-2' : 'h-16 w-16 bg-indigo-500 p-1.5'}`}>
            <img 
              src={sidebarLogo} 
              alt={brand.logoAlt} 
              className="h-full w-full"
              style={invertLogo ? { filter: 'brightness(0) invert(1)' } : undefined}
            />
          </div>
          <h2 className={`font-bold transition-opacity duration-200 text-sm leading-tight ${expanded ? 'opacity-100' : 'opacity-0'}`}>{brand.productStackedLine1}<br />{brand.productStackedLine2}</h2>
        </div>
        <button onClick={toggleSidebar} className="p-2 rounded-lg md:block hover:bg-gray-700">
          {isMobileDevice() && mobileOpen ? <X /> : (expanded ? <X /> : <Menu />)}
        </button>
      </div>
    );
}
function SidebarItem({ icon, text }) {
  const { expanded, activePage, setActivePage } = useContext(SidebarContext);
  const isActive = activePage === text;
  return (
    <li onClick={() => setActivePage(text)} className={`sidebar-nav-item relative flex items-center py-1.5 px-3 my-0.5 font-medium rounded-md cursor-pointer transition-colors group ${isActive ? "bg-gradient-to-tr from-indigo-200 to-indigo-100 text-indigo-800" : "hover:bg-indigo-500 text-gray-300"}`}>
      {icon}
      <span className={`overflow-hidden transition-all ${expanded ? "w-52 ml-3" : "w-0"}`}>{text}</span>
      {!expanded && (<div className={`absolute left-full rounded-md px-2 py-1 ml-6 bg-indigo-100 text-indigo-800 text-sm invisible opacity-20 -translate-x-3 transition-all group-hover:visible group-hover:opacity-100 group-hover:translate-x-0`}>{text}</div>)}
    </li>
  );
}
function LogoutButton() {
    const { logout } = useContext(AuthContext);
    const { expanded } = useContext(SidebarContext);
    return (<button onClick={logout} className="flex items-center w-full px-3 py-2 text-gray-300 rounded-md hover:bg-indigo-500"><LogOut /><span className={`overflow-hidden transition-all ${expanded ? "w-52 ml-3" : "w-0"}`}>Logout</span></button>);
}
function TopHeader() {
  const { user } = useContext(AuthContext);
  
  const formatUserName = (u) => {
    if (!u) return '';
    const first = u.first_name || '';
    const last = u.last_name || '';
    const middle = u.middle_name ? ` ${u.middle_name.charAt(0)}. ` : ' ';
    return `${first}${middle}${last}`.replace(/\s+/g, ' ').trim() || u.email;
  };
  
  return (
    <header className="flex items-center justify-between p-4 bg-white border-b shrink-0 md:justify-end">
       <button onClick={useContext(SidebarContext).toggleSidebar} className="p-2 text-gray-500 rounded-lg md:hidden hover:bg-gray-100"><Menu /></button>
      <div className="flex items-center">
        <UserCircle className="w-8 h-8 text-gray-600"/>
        <div className="ml-2">
            <div className="text-sm font-semibold text-gray-800">{formatUserName(user)}</div>
            <div className="text-xs text-gray-500 capitalize">{user?.role.replace('_', ' ')}</div>
        </div>
      </div>
    </header>
  );
}
