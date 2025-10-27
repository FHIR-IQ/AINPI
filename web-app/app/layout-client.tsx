'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function LayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const isLoginPage = pathname === '/login';

  useEffect(() => {
    // Check for user in localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (error) {
        console.error('Failed to parse user data');
      }
    }
  }, [pathname]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/login');
  };

  return (
    <ProtectedRoute>
      {!isLoginPage && (
        <nav className="bg-blue-600 text-white shadow-lg">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link href="/dashboard" className="text-2xl font-bold hover:text-blue-100 transition-colors">
                ProviderCard v2
              </Link>
              <div className="flex items-center gap-6">
                <Link href="/dashboard" className="hover:text-blue-200 transition-colors">
                  Dashboard
                </Link>
                <Link href="/providers/new" className="hover:text-blue-200 transition-colors">
                  New Provider
                </Link>
                {user && (
                  <div className="flex items-center gap-4 ml-4 pl-4 border-l border-blue-500">
                    <div className="text-sm">
                      <div className="font-medium">{user.name}</div>
                      <div className="text-blue-200 text-xs">{user.email}</div>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors text-sm font-medium"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </nav>
      )}
      {children}
    </ProtectedRoute>
  );
}
