'use client';

import { useState, useEffect } from 'react';

interface Subscriber {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSync: string;
  url: string;
}

interface WebhookDelivery {
  id: string;
  subscriberName: string;
  eventType: string;
  status: 'delivered' | 'failed' | 'pending';
  httpStatus?: number;
  responseTime?: string;
  timestamp: string;
  payload?: any;
}

export default function DashboardPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([
    {
      id: 'sub-001',
      name: 'Credentialing Management System',
      status: 'connected',
      lastSync: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      url: 'https://api.credentialing.example.com/webhooks',
    },
    {
      id: 'sub-002',
      name: 'Provider Directory Service',
      status: 'connected',
      lastSync: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      url: 'https://api.directory.example.com/webhooks',
    },
  ]);

  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedPayload, setExpandedPayload] = useState<string | null>(null);

  const formatTimeAgo = (isoString: string): string => {
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffSec < 60) return `${diffSec} seconds ago`;
    if (diffMin < 60) return `${diffMin} minutes ago`;
    if (diffHr < 24) return `${diffHr} hours ago`;
    return new Date(isoString).toLocaleDateString();
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);

    // Simulate sync delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Update last sync times
    const now = new Date().toISOString();
    setSubscribers(prev => prev.map(sub => ({
      ...sub,
      lastSync: now,
    })));

    // Add mock webhook deliveries
    const newDeliveries: WebhookDelivery[] = subscribers.map((sub, idx) => ({
      id: `delivery-${Date.now()}-${idx}`,
      subscriberName: sub.name,
      eventType: 'practitioner.updated',
      status: 'delivered',
      httpStatus: 200,
      responseTime: `${200 + idx * 45}ms`,
      timestamp: now,
      payload: {
        eventType: 'practitioner.updated',
        timestamp: now,
        resource: {
          resourceType: 'Practitioner',
          id: 'demo-001',
          name: 'Dr. Sarah Johnson',
          specialties: ['207RC0000X', '207R00000X'],
          licenses: [
            { state: 'MA', number: 'MD123456' },
            { state: 'NH', number: 'NH789012' },
          ],
        },
      },
    }));

    setWebhookDeliveries(prev => [...newDeliveries, ...prev]);
    setIsSyncing(false);
  };

  const togglePayload = (deliveryId: string) => {
    setExpandedPayload(prev => prev === deliveryId ? null : deliveryId);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
              System Dashboard
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Monitor connected systems and webhook deliveries
            </p>
          </div>
          <button
            onClick={handleSyncNow}
            disabled={isSyncing}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSyncing ? (
              <>
                <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                Syncing...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Sync Now
              </>
            )}
          </button>
        </div>

        {/* Connected Systems */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
            Connected Systems
          </h2>
          <div className="space-y-4">
            {subscribers.map((subscriber) => (
              <div
                key={subscriber.id}
                className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full ${
                    subscriber.status === 'connected' ? 'bg-green-500' :
                    subscriber.status === 'error' ? 'bg-red-500' :
                    'bg-slate-400'
                  }`} />
                  <div>
                    <h3 className="font-medium text-slate-900 dark:text-white">
                      {subscriber.name}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {subscriber.url}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${
                    subscriber.status === 'connected' ? 'text-green-600 dark:text-green-400' :
                    subscriber.status === 'error' ? 'text-red-600 dark:text-red-400' :
                    'text-slate-600 dark:text-slate-400'
                  }`}>
                    {subscriber.status === 'connected' ? '✓ Connected' :
                     subscriber.status === 'error' ? '✗ Error' :
                     'Disconnected'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                    Last sync: {formatTimeAgo(subscriber.lastSync)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Webhook Deliveries */}
        {webhookDeliveries.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 p-6">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
              Recent Webhook Deliveries
            </h2>
            <div className="space-y-3">
              {webhookDeliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden"
                >
                  <div className="p-4 bg-slate-50 dark:bg-slate-800">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-2 h-2 rounded-full ${
                            delivery.status === 'delivered' ? 'bg-green-500' :
                            delivery.status === 'failed' ? 'bg-red-500' :
                            'bg-yellow-500'
                          }`} />
                          <h3 className="font-medium text-slate-900 dark:text-white">
                            {delivery.subscriberName}
                          </h3>
                          {delivery.httpStatus && (
                            <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                              delivery.httpStatus === 200 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                              {delivery.httpStatus} {delivery.httpStatus === 200 ? 'OK' : 'Error'}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                          <p>Event: <span className="font-mono">{delivery.eventType}</span></p>
                          {delivery.responseTime && (
                            <p>Response Time: {delivery.responseTime}</p>
                          )}
                          <p>Time: {formatTimeAgo(delivery.timestamp)}</p>
                        </div>
                      </div>
                      {delivery.payload && (
                        <button
                          onClick={() => togglePayload(delivery.id)}
                          className="ml-4 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded border border-blue-300 dark:border-blue-700"
                        >
                          {expandedPayload === delivery.id ? 'Hide Payload ▲' : 'View Payload ▼'}
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedPayload === delivery.id && delivery.payload && (
                    <div className="p-4 bg-slate-900 dark:bg-black border-t border-slate-700">
                      <pre className="text-xs text-green-400 font-mono overflow-x-auto">
                        {JSON.stringify(delivery.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {webhookDeliveries.length === 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 p-12 text-center">
            <div className="text-slate-400 dark:text-slate-600 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
              No webhook deliveries yet
            </h3>
            <p className="text-slate-500 dark:text-slate-500">
              Click "Sync Now" to trigger a manual synchronization
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
