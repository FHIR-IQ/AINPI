'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, User, Sparkles, Search, Database, BarChart3, Lightbulb, FileText, BookOpen, MapPin } from 'lucide-react';

export default function Navbar() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem('token'));
  }, []);

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <button onClick={() => router.push('/npd')} className="text-2xl font-bold text-primary-600">
              AINPI
            </button>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/npd')}
              className="flex items-center text-primary-600 hover:text-primary-700 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Database className="w-4 h-4 mr-2" />
              NPD Search
            </button>
            <button
              onClick={() => router.push('/data-quality')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Data Quality
            </button>
            <button
              onClick={() => router.push('/findings')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <FileText className="w-4 h-4 mr-2" />
              Findings
              <span className="ml-1.5 inline-flex items-center rounded-full bg-red-500 text-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                H27
              </span>
            </button>
            <button
              onClick={() => router.push('/states')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <MapPin className="w-4 h-4 mr-2" />
              States
            </button>
            <button
              onClick={() => router.push('/briefings/va')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
              title="Virginia State Medicaid briefing — 2026-05-04"
            >
              <FileText className="w-4 h-4 mr-2" />
              VA Briefing
              <span className="ml-1.5 inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                New
              </span>
            </button>
            <button
              onClick={() => router.push('/methodology')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <BookOpen className="w-4 h-4 mr-2" />
              Methodology
            </button>
            <button
              onClick={() => router.push('/insights')}
              className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Lightbulb className="w-4 h-4 mr-2" />
              Insights
            </button>
            <button
              onClick={() => router.push('/provider-search')}
              className="flex items-center text-gray-500 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Search className="w-4 h-4 mr-2" />
              Payer Search
              <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Soon
              </span>
            </button>
            <button
              onClick={() => router.push('/magic-scanner')}
              className="flex items-center text-gray-500 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Magic Scanner
              <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Soon
              </span>
            </button>
            {isLoggedIn ? (
              <>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem('token');
                    setIsLoggedIn(false);
                    router.push('/npd');
                  }}
                  className="flex items-center text-gray-700 hover:text-red-600 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={() => router.push('/login')}
                className="flex items-center text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium"
              >
                <User className="w-4 h-4 mr-2" />
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
