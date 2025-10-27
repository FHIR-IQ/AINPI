'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ProviderForm from '@/components/forms/ProviderForm';

export default function NewProviderPage() {
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (data: any) => {
    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `Failed to save provider (${response.status})`
        );
      }

      const result = await response.json();
      router.push(`/providers/${result.id}`);
    } catch (error) {
      console.error('Save error:', error);
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Failed to save provider. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-6 text-slate-800 dark:text-slate-200">
            Create Provider Profile
          </h1>

          {saveError && (
            <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-2xl">❌</span>
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-200 mb-1">
                    Failed to save
                  </h3>
                  <p className="text-red-800 dark:text-red-300 text-sm">
                    {saveError}
                  </p>
                </div>
              </div>
            </div>
          )}

          <ProviderForm onSave={handleSave} isSaving={isSaving} />
        </div>
      </div>
    </div>
  );
}
