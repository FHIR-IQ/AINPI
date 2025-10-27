'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Redirect authenticated users to dashboard
    const token = localStorage.getItem('auth_token');
    if (token) {
      router.push('/dashboard');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center mb-12">
          <h1 className="text-5xl font-bold mb-6 text-slate-800 dark:text-slate-200">
            ProviderCard v2
          </h1>
          <p className="text-xl text-slate-600 dark:text-slate-400 mb-8">
            Provider Directory & Credentialing Management System
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <Link
            href="/providers/new"
            className="group p-8 bg-white dark:bg-slate-800 rounded-lg shadow-lg hover:shadow-xl transition-all transform hover:scale-105 border border-slate-200 dark:border-slate-700"
          >
            <div className="text-4xl mb-4">👨‍⚕️</div>
            <h2 className="text-2xl font-bold mb-3 text-slate-800 dark:text-slate-200 group-hover:text-blue-600">
              Create Provider Profile
            </h2>
            <p className="text-slate-600 dark:text-slate-400">
              Add new provider with licenses, specialties, locations, and insurance plans
            </p>
          </Link>

          <Link
            href="/dashboard"
            className="group p-8 bg-white dark:bg-slate-800 rounded-lg shadow-lg hover:shadow-xl transition-all transform hover:scale-105 border border-slate-200 dark:border-slate-700"
          >
            <div className="text-4xl mb-4">📊</div>
            <h2 className="text-2xl font-bold mb-3 text-slate-800 dark:text-slate-200 group-hover:text-blue-600">
              System Dashboard
            </h2>
            <p className="text-slate-600 dark:text-slate-400">
              View connected systems, sync status, and manually trigger updates
            </p>
          </Link>
        </div>

        <div className="mt-16 max-w-4xl mx-auto">
          <h3 className="text-2xl font-bold mb-6 text-center text-slate-800 dark:text-slate-200">
            Key Features
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-6 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-2xl mb-2">🏥</div>
              <h4 className="font-semibold mb-2 text-slate-800 dark:text-slate-200">Multi-Location</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Manage multiple practice locations with primary designation
              </p>
            </div>
            <div className="p-6 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-2xl mb-2">📜</div>
              <h4 className="font-semibold mb-2 text-slate-800 dark:text-slate-200">License Tracking</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Track state licenses with expiration monitoring
              </p>
            </div>
            <div className="p-6 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-2xl mb-2">🔄</div>
              <h4 className="font-semibold mb-2 text-slate-800 dark:text-slate-200">Real-time Sync</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Automated sync to connected credentialing systems
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
