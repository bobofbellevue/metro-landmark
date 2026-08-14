import React, { useState, useEffect, useContext } from 'react';
import { User, Wrench, LogOut, Menu, X, UserCircle } from 'lucide-react';
import { AuthContext, SidebarContext } from '../contexts';

export default function VendorLayout({ children }) {
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
        <VendorSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <VendorHeader />
          <main className="flex-1 min-w-0 p-4 overflow-y-auto overflow-x-hidden md:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

function VendorSidebar() {
  const { logout } = useContext(AuthContext);
  const { expanded, mobileOpen, toggleSidebar } = useContext(SidebarContext);
  const isMobile = () => window.innerWidth < 768;
  
  const menuItems = [
    { icon: <User />, text: 'My Profile', page: 'Profile' },
    { icon: <Wrench />, text: 'Maintenance Requests', page: 'Maintenance' },
  ];

  return (
    <>
      <aside className={`fixed top-0 left-0 z-20 h-full bg-gray-800 text-white transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:flex-shrink-0 overflow-x-hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${expanded ? 'w-64' : 'w-20'}`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h1 className={`font-bold text-xl ${expanded ? 'block' : 'hidden'}`}>Vendor Portal</h1>
          <button onClick={toggleSidebar} className="p-2 hover:bg-gray-700 rounded">
            {expanded ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <nav className="p-4">
          <ul className="space-y-2">
            {menuItems.map((item, index) => (
              <SidebarMenuItem key={index} item={item} />
            ))}
          </ul>
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-700">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 p-3 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <LogOut size={20} />
            {expanded && <span>Logout</span>}
          </button>
        </div>
      </aside>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-10 md:hidden"
          onClick={toggleSidebar}
        />
      )}
    </>
  );
}

function SidebarMenuItem({ item }) {
  const { activePage, setActivePage } = useContext(SidebarContext);
  const { expanded } = useContext(SidebarContext);
  const isActive = activePage === item.page;

  return (
    <li>
      <button
        onClick={() => setActivePage(item.page)}
        className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
          isActive ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700 text-gray-300'
        }`}
      >
        {item.icon}
        {expanded && <span>{item.text}</span>}
      </button>
    </li>
  );
}

function VendorHeader() {
  const { user } = useContext(AuthContext);
  const { mobileOpen, toggleSidebar } = useContext(SidebarContext);

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="flex items-center justify-between p-4">
        <button
          onClick={toggleSidebar}
          className="md:hidden p-2 hover:bg-gray-100 rounded"
        >
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-4 ml-auto">
          <div className="flex items-center gap-2">
            <UserCircle size={24} className="text-gray-600" />
            <span className="text-sm font-medium text-gray-700">{user?.email || 'Vendor'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

