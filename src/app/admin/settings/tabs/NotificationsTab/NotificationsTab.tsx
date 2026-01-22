'use client';

import { useState, useEffect } from 'react';
import { RMABLogger } from '@/lib/utils/logger';
import { fetchWithAuth } from '@/lib/utils/api';

const logger = RMABLogger.create('NotificationsTab');

interface NotificationBackend {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  events: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ModalState {
  isOpen: boolean;
  mode: 'add' | 'edit';
  selectedType?: string;
  backend?: NotificationBackend;
}

const typeColors: Record<string, string> = {
  discord: 'bg-indigo-500',
  pushover: 'bg-blue-500',
  email: 'bg-green-500',
  slack: 'bg-purple-500',
  telegram: 'bg-sky-500',
  webhook: 'bg-gray-500',
};

const eventLabels: Record<string, string> = {
  request_pending_approval: 'Request Pending Approval',
  request_approved: 'Request Approved',
  request_available: 'Audiobook Available',
  request_error: 'Request Error',
};

export function NotificationsTab() {
  const [backends, setBackends] = useState<NotificationBackend[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    mode: 'add',
  });
  const [formData, setFormData] = useState<any>({
    name: '',
    config: {},
    events: ['request_available', 'request_error'],
    enabled: true,
  });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchBackends();
  }, []);

  const fetchBackends = async () => {
    try {
      setLoading(true);
      const response = await fetchWithAuth('/api/admin/notifications');

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setBackends(data.backends);
        } else {
          logger.error('Failed to fetch backends', { error: data.error });
        }
      } else {
        logger.error('Failed to fetch backends', { status: response.status });
      }
    } catch (error) {
      logger.error('Failed to fetch backends', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = (type: string) => {
    setModalState({ isOpen: true, mode: 'add', selectedType: type });
    setFormData({
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} Notifications`,
      config: type === 'discord' ? { webhookUrl: '', username: 'ReadMeABook', avatarUrl: '' } : { userKey: '', appToken: '', device: '', priority: 0 },
      events: ['request_available', 'request_error'],
      enabled: true,
    });
    setTestResult(null);
  };

  const openEditModal = (backend: NotificationBackend) => {
    setModalState({ isOpen: true, mode: 'edit', selectedType: backend.type, backend });
    setFormData({
      name: backend.name,
      config: backend.config,
      events: backend.events,
      enabled: backend.enabled,
    });
    setTestResult(null);
  };

  const closeModal = () => {
    setModalState({ isOpen: false, mode: 'add' });
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!modalState.selectedType) return;

    try {
      setIsTesting(true);
      setTestResult(null);

      // In edit mode, use backend ID to test with real config (masked values won't work)
      // In add mode, use the form config directly
      const testPayload = modalState.mode === 'edit' && modalState.backend
        ? { backendId: modalState.backend.id }
        : { type: modalState.selectedType, config: formData.config };

      const response = await fetchWithAuth('/api/admin/notifications/test', {
        method: 'POST',
        body: JSON.stringify(testPayload),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({ success: true, message: 'Test notification sent successfully!' });
      } else {
        setTestResult({ success: false, message: data.message || 'Failed to send test notification' });
      }
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!modalState.selectedType) return;

    try {
      setIsSaving(true);

      const url = modalState.mode === 'add' ? '/api/admin/notifications' : `/api/admin/notifications/${modalState.backend?.id}`;
      const method = modalState.mode === 'add' ? 'POST' : 'PUT';

      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify({
          type: modalState.selectedType,
          ...formData,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        await fetchBackends();
        closeModal();
      } else {
        setTestResult({ success: false, message: data.message || 'Failed to save backend' });
      }
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this notification backend?')) return;

    try {
      const response = await fetchWithAuth(`/api/admin/notifications/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          await fetchBackends();
        }
      }
    } catch (error) {
      logger.error('Failed to delete backend', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Configure notification backends to receive alerts for audiobook request events.
        </p>
      </div>

      {/* Type Selector */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add Notification Backend</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => openAddModal('discord')}
            className="flex items-center p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <div className="flex-shrink-0 w-12 h-12 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-2xl">
              D
            </div>
            <div className="ml-4 text-left">
              <div className="font-semibold text-gray-900 dark:text-white">Discord</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Send notifications via Discord webhook</div>
            </div>
          </button>

          <button
            onClick={() => openAddModal('pushover')}
            className="flex items-center p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <div className="flex-shrink-0 w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-2xl">
              P
            </div>
            <div className="ml-4 text-left">
              <div className="font-semibold text-gray-900 dark:text-white">Pushover</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Send notifications via Pushover API</div>
            </div>
          </button>
        </div>
      </div>

      {/* Configured Backends */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Configured Backends</h3>
        {loading ? (
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        ) : backends.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400">No notification backends configured.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {backends.map((backend) => (
              <div key={backend.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 ${typeColors[backend.type]} rounded-lg flex items-center justify-center text-white font-bold`}>
                      {backend.type.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white truncate">{backend.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{backend.type}</div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 mb-3">
                  <div className={`inline-block px-2 py-1 rounded text-xs ${backend.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
                    {backend.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {backend.events.length} {backend.events.length === 1 ? 'event' : 'events'} subscribed
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => openEditModal(backend)}
                    className="flex-1 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(backend.id)}
                    className="flex-1 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalState.isOpen && modalState.selectedType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {modalState.mode === 'add' ? 'Add' : 'Edit'} {modalState.selectedType.charAt(0).toUpperCase() + modalState.selectedType.slice(1)} Notification
                </h3>
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="e.g., Discord - Admins"
                  />
                </div>

                {/* Config Fields */}
                {modalState.selectedType === 'discord' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Webhook URL *</label>
                      <input
                        type="text"
                        value={formData.config.webhookUrl}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, webhookUrl: e.target.value } })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="https://discord.com/api/webhooks/..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username (optional)</label>
                      <input
                        type="text"
                        value={formData.config.username}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, username: e.target.value } })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="ReadMeABook"
                      />
                    </div>
                  </>
                )}

                {modalState.selectedType === 'pushover' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">User Key *</label>
                      <input
                        type="text"
                        value={formData.config.userKey}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, userKey: e.target.value } })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="Your Pushover user key"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">App Token *</label>
                      <input
                        type="text"
                        value={formData.config.appToken}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, appToken: e.target.value } })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="Your Pushover app token"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
                      <select
                        value={formData.config.priority}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, priority: Number(e.target.value) } })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="-2">Lowest</option>
                        <option value="-1">Low</option>
                        <option value="0">Normal</option>
                        <option value="1">High</option>
                        <option value="2">Emergency</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Events */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Subscribe to Events *</label>
                  <div className="space-y-2">
                    {Object.entries(eventLabels).map(([event, label]) => (
                      <label key={event} className="flex items-center space-x-2 p-3 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                        <input
                          type="checkbox"
                          checked={formData.events.includes(event)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({ ...formData, events: [...formData.events, event] });
                            } else {
                              setFormData({ ...formData, events: formData.events.filter((e: string) => e !== event) });
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-900 dark:text-white">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Enabled Toggle */}
                <div>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.enabled}
                      onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-900 dark:text-white">Enable this notification backend</span>
                  </label>
                </div>

                {/* Test Result */}
                {testResult && (
                  <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 text-red-800 dark:text-red-200'}`}>
                    {testResult.message}
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={handleTest}
                    disabled={isTesting}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    {isTesting ? 'Testing...' : 'Send Test'}
                  </button>
                  <div className="flex space-x-2">
                    <button
                      onClick={closeModal}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {isSaving ? 'Saving...' : (modalState.mode === 'add' ? 'Add Backend' : 'Save Changes')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
