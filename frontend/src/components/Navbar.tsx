'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, Map, FileText, MapPin, BookOpen, Code2, LayoutGrid, IdCard } from 'lucide-react';

const NAV_ITEMS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: '/', label: 'Landscape', icon: <LayoutGrid className="w-4 h-4 mr-1.5" /> },
  { href: '/map', label: 'Map', icon: <Map className="w-4 h-4 mr-1.5" /> },
  { href: '/findings', label: 'Findings', icon: <FileText className="w-4 h-4 mr-1.5" /> },
  { href: '/npi', label: 'NPI check', icon: <IdCard className="w-4 h-4 mr-1.5" /> },
  { href: '/for-state-medicaid', label: 'For States', icon: <MapPin className="w-4 h-4 mr-1.5" /> },
  { href: '/methodology', label: 'Methodology', icon: <BookOpen className="w-4 h-4 mr-1.5" /> },
  { href: '/developer', label: 'Developer', icon: <Code2 className="w-4 h-4 mr-1.5" /> },
];

export default function Navbar() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem('token'));
  }, []);

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-2xl font-bold text-primary-600">
            AINPI
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center text-slate-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('token');
                  setIsLoggedIn(false);
                  router.push('/');
                }}
                aria-label="Sign out"
                className="text-slate-500 hover:text-slate-900 p-2 rounded-full"
              >
                <LogOut className="w-5 h-5" />
              </button>
            ) : (
              <Link
                href="/login"
                aria-label="Sign in"
                className="text-slate-500 hover:text-slate-900 p-2 rounded-full"
              >
                <User className="w-5 h-5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
