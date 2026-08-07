'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, Map, FileText, MapPin, BookOpen, Code2, LayoutGrid, IdCard, Stethoscope } from 'lucide-react';

const NAV_ITEMS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: '/', label: 'Landscape', icon: <LayoutGrid className="w-4 h-4 mr-1.5" /> },
  { href: '/map', label: 'Map', icon: <Map className="w-4 h-4 mr-1.5" /> },
  { href: '/findings', label: 'Findings', icon: <FileText className="w-4 h-4 mr-1.5" /> },
  { href: '/npi', label: 'NPI check', icon: <IdCard className="w-4 h-4 mr-1.5" /> },
  { href: '/rural-health', label: 'Rural health', icon: <Stethoscope className="w-4 h-4 mr-1.5" /> },
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
    <nav className="bg-paper/85 backdrop-blur-sm border-b border-gray-300 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Masthead. Set in the display serif with a hairline underline on
              hover, the way a publication's name behaves, not a logo button. */}
          <Link href="/" className="group flex items-baseline gap-2">
            <span className="font-serif text-2xl font-semibold tracking-tight text-ink">
              AINPI
            </span>
            <span className="hidden sm:inline text-[10px] uppercase text-gray-500 tracking-[0.16em] border-l border-gray-300 pl-2">
              Provider data audit
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center px-2.5 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:text-primary-600 border-b-2 border-transparent hover:border-primary-600"
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
