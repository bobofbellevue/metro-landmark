import React, { useState, useEffect, useContext } from 'react';
import { User, Home, FileText, Wrench, LogOut, Menu, X, UserCircle } from 'lucide-react';
import { AuthContext, SidebarContext } from '../contexts';

export default function TenantLayout({ children }) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePage, setActivePage] = useState('Profile');
  const isMobile = () => window.innerWidth < 768;
  const toggleSidebar = () => isMobile() ? setMobileOpen(p => !p) : setExpanded(p => !p);

  useEffect(() => {
    const handleResize = () => { if (!isMobile()) setMobileOpen(false); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <SidebarContext.Provider value={{ expanded, mobileOpen, toggleSidebar, activePage, setActivePage }}>
      <div className="flex h-screen bg-gray-100 overflow-hidden">
        <TenantSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <TenantHeader />
          <main className="flex-1 min-w-0 p-2 overflow-y-auto overflow-x-hidden md:p-3 lg:p-4">{children}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

function TenantSidebar() {
  const { logout } = useContext(AuthContext);
  const { expanded, mobileOpen, toggleSidebar } = useContext(SidebarContext);
  const isMobile = () => window.innerWidth < 768;
  
  const menuItems = [
    { icon: <User />, text: 'My Profile', page: 'Profile' },
    { icon: <Home />, text: 'My Properties', page: 'Properties' },
    { icon: <FileText />, text: 'My Applications', page: 'Applications' },
    { icon: <FileText />, text: 'My Leases', page: 'Leases' },
    { icon: <Wrench />, text: 'Maintenance', page: 'Maintenance' },
  ];

  return (
    <>
      <aside className={`fixed top-0 left-0 z-20 h-full bg-gray-800 text-white transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:flex-shrink-0 overflow-x-hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${expanded ? 'w-64' : 'w-20'}`}>
        <nav className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 pb-2">
            <div className={`flex items-center overflow-hidden transition-all ${expanded ? "gap-4" : "gap-0"}`}>
              <Home className={`flex-shrink-0 text-indigo-400 transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`} size={32} />
              <h2 className={`font-bold whitespace-nowrap transition-opacity duration-200 text-sm ${expanded ? 'opacity-100' : 'opacity-0'}`}>My Portal</h2>
            </div>
            <button onClick={toggleSidebar} className="p-2 rounded-lg md:block hover:bg-gray-700">
              {isMobile() && mobileOpen ? <X /> : (expanded ? <X /> : <Menu />)}
            </button>
          </div>
          <ul className="flex-1 px-4 overflow-y-auto overflow-x-hidden">
            {menuItems.map(item => (
              <TenantSidebarItem key={item.page} icon={item.icon} text={item.text} page={item.page} />
            ))}
          </ul>
          <div className="p-4 border-t border-gray-700">
            <button onClick={logout} className="flex items-center w-full px-3 py-2 text-gray-300 rounded-md hover:bg-indigo-500">
              <LogOut />
              <span className={`overflow-hidden transition-all ${expanded ? "w-52 ml-3" : "w-0"}`}>Logout</span>
            </button>
          </div>
        </nav>
      </aside>
      {mobileOpen && <div onClick={toggleSidebar} className="fixed inset-0 z-10 bg-black md:hidden opacity-50"></div>}
    </>
  );
}

function TenantSidebarItem({ icon, text, page }) {
  const { expanded, activePage, setActivePage } = useContext(SidebarContext);
  const isActive = activePage === page;
  return (
    <li onClick={() => setActivePage(page)} className={`relative flex items-center py-2 px-3 my-1 font-medium rounded-md cursor-pointer transition-colors group ${isActive ? "bg-gradient-to-tr from-indigo-200 to-indigo-100 text-indigo-800" : "hover:bg-indigo-500 text-gray-300"}`}>
      {icon}
      <span className={`overflow-hidden transition-all ${expanded ? "w-52 ml-3" : "w-0"}`}>{text}</span>
      {!expanded && (<div className={`absolute left-full rounded-md px-2 py-1 ml-6 bg-indigo-100 text-indigo-800 text-sm invisible opacity-20 -translate-x-3 transition-all group-hover:visible group-hover:opacity-100 group-hover:translate-x-0`}>{text}</div>)}
    </li>
  );
}

function TenantHeader() {
  const { user } = useContext(AuthContext);
  const { toggleSidebar } = useContext(SidebarContext);
  
  const formatUserName = (u) => {
    if (!u) return '';
    const first = u.first_name || '';
    const last = u.last_name || '';
    const middle = u.middle_name ? ` ${u.middle_name.charAt(0)}. ` : ' ';
    return `${first}${middle}${last}`.replace(/\s+/g, ' ').trim() || u.email;
  };
  
  return (
    <header className="flex items-center justify-between p-4 bg-white border-b md:justify-end">
      <button onClick={toggleSidebar} className="p-2 text-gray-500 rounded-lg md:hidden hover:bg-gray-100"><Menu /></button>
      <div className="flex items-center">
        <UserCircle className="w-8 h-8 text-gray-600"/>
        <div className="ml-2">
          <div className="text-sm font-semibold text-gray-800">{formatUserName(user)}</div>
          <div className="text-xs text-gray-500">Tenant</div>
        </div>
      </div>
    </header>
  );
}

