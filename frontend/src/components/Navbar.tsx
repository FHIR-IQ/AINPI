'use client';

import { useRouter } from 'next/navigation';
import { LogOut, User, Activity, LayoutDashboard, UserPlus, Sparkles, Search } from 'lucide-react';

export default function Navbar() {
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <h1 className="text-2xl font-bold text-primary-600">ProviderCard</h1>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/demo')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Demo
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <User className="w-4 h-4 mr-2" />
              Profile
            </button>
            <button
              onClick={() => router.push('/magic-scanner')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Magic Scanner
            </button>
            <button
              onClick={() => router.push('/provider-search')}
              className="flex items-center text-primary-600 hover:text-primary-700 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Search className="w-4 h-4 mr-2" />
              Provider Search
            </button>
            <button
              onClick={() => router.push('/providers/new')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              New Provider
            </button>
            <button
              onClick={() => router.push('/audit-log')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Activity className="w-4 h-4 mr-2" />
              Audit Log
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center text-gray-700 hover:text-red-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
