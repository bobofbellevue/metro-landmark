import React, { useContext, useEffect, useState } from 'react';
import { Card } from './ui';
import { AuthContext } from '../contexts';
import { api } from '../api';
import {
  formatPhoneDisplay,
  phoneView,
} from '../config/phones.js';

function sourceLabel(source) {
  switch (source) {
    case 'pmc':
      return 'This company';
    case 'system':
      return 'Deploy default';
    case 'env':
      return 'Environment variable';
    case 'default':
      return 'Product default';
    default:
      return 'Not set';
  }
}

export default function PhoneResourcesSettings({ scope = 'company' }) {
  const { user, setResolvedPhones } = useContext(AuthContext);
  const [purposes, setPurposes] = useState([]);
  const [resolved, setResolved] = useState({});
  const [drafts, setDrafts] = useState({});
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingPurpose, setSavingPurpose] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const endpoint =
    scope === 'system' ? '/phone-resources?scope=system' : '/phone-resources';

  const load = async () => {
    if (!user?.user_id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.get(endpoint, user);
      if (!data?.success) {
        setError(data?.error || 'Could not load phone numbers.');
        setCanEdit(false);
        return;
      }
      setCanEdit(Boolean(data.canEdit));
      setPurposes(data.purposes || []);
      setResolved(data.resolved || {});
      if (scope !== 'system') setResolvedPhones?.(data.resolved);
      const nextDrafts = {};
      for (const item of data.purposes || []) {
        const row = (data.resources || []).find(
          (r) => r.purpose === item.id && (scope === 'system' ? !r.pmcId : r.pmcId)
        );
        nextDrafts[item.id] = {
          e164: row?.e164 || '',
          vapiPhoneNumberId: row?.vapiPhoneNumberId || '',
          label: row?.label || '',
        };
      }
      setDrafts(nextDrafts);
    } catch {
      setError('Could not load phone numbers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id, scope]);

  const updateDraft = (purpose, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [purpose]: { ...prev[purpose], [field]: value },
    }));
    setSuccess('');
  };

  const handleSave = async (purpose) => {
    setSavingPurpose(purpose);
    setError('');
    setSuccess('');
    try {
      const draft = drafts[purpose] || {};
      const data = await api.put(
        '/phone-resources',
        {
          purpose,
          e164: draft.e164,
          vapiPhoneNumberId: draft.vapiPhoneNumberId,
          label: draft.label,
          scope,
        },
        user
      );
      if (!data?.success) {
        setError(data?.error || 'Could not save phone number.');
        return;
      }
      setResolved(data.resolved || {});
      if (scope !== 'system') setResolvedPhones?.(data.resolved);
      setSuccess(`Saved ${purpose.replace(/_/g, ' ')}.`);
    } catch {
      setError('Could not save phone number.');
    } finally {
      setSavingPurpose('');
    }
  };

  const handleClear = async (purpose) => {
    setSavingPurpose(purpose);
    setError('');
    setSuccess('');
    try {
      const data = await api.put(
        '/phone-resources',
        { purpose, reset: true, scope },
        user
      );
      if (!data?.success) {
        setError(data?.error || 'Could not clear phone number.');
        return;
      }
      setResolved(data.resolved || {});
      if (scope !== 'system') setResolvedPhones?.(data.resolved);
      setDrafts((prev) => ({
        ...prev,
        [purpose]: { e164: '', vapiPhoneNumberId: '', label: '' },
      }));
      setSuccess(`Cleared ${purpose.replace(/_/g, ' ')}; fallback will be used.`);
    } catch {
      setError('Could not clear phone number.');
    } finally {
      setSavingPurpose('');
    }
  };

  if (loading) {
    return (
      <Card title="Phone numbers">
        <p className="text-sm text-gray-600">Loading phone numbers…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md">
          {success}
        </div>
      )}
      {purposes.map((item) => {
        const current = resolved[item.id] || {};
        const draft = drafts[item.id] || {};
        const view = phoneView(current.e164);
        return (
          <Card key={item.id} title={item.label}>
            <p className="mb-3 text-sm text-gray-600">{item.description}</p>
            <p className="mb-4 text-sm text-gray-800">
              In use:{' '}
              <span className="font-medium">
                {view.display || 'None'}
              </span>
              <span className="ml-2 text-xs text-gray-500">
                ({sourceLabel(current.source)})
              </span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Number (E.164)
                </label>
                <input
                  type="text"
                  value={draft.e164}
                  onChange={(e) => updateDraft(item.id, 'e164', e.target.value)}
                  disabled={!canEdit || Boolean(savingPurpose)}
                  placeholder="+12065551212"
                  className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm text-sm font-mono disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Label (optional)
                </label>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => updateDraft(item.id, 'label', e.target.value)}
                  disabled={!canEdit || Boolean(savingPurpose)}
                  placeholder="Main maintenance line"
                  className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm text-sm disabled:bg-gray-50"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700">
                Vapi phone number ID (optional)
              </label>
              <input
                type="text"
                value={draft.vapiPhoneNumberId}
                onChange={(e) =>
                  updateDraft(item.id, 'vapiPhoneNumberId', e.target.value)
                }
                disabled={!canEdit || Boolean(savingPurpose)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm text-sm font-mono disabled:bg-gray-50"
              />
              <p className="mt-1 text-xs text-gray-500">
                UUID from the Vapi dashboard for this DID. Needed for outbound
                vendor calls when this purpose is vendor dispatch. Leave blank
                to keep the deploy <span className="font-mono">VAPI_PHONE_NUMBER_ID</span>.
              </p>
            </div>
            {canEdit && (
              <div className="flex flex-wrap justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => handleClear(item.id)}
                  disabled={Boolean(savingPurpose)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                >
                  Clear to fallback
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(item.id)}
                  disabled={Boolean(savingPurpose)}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
                >
                  {savingPurpose === item.id ? 'Saving...' : 'Save number'}
                </button>
              </div>
            )}
          </Card>
        );
      })}
      {!canEdit && (
        <p className="text-sm text-gray-500">
          Only company admins can change these numbers. Current values still
          apply after sign-in ({formatPhoneDisplay(resolved.tenant_maintenance?.e164) || 'none'} for tenant maintenance).
        </p>
      )}
    </div>
  );
}
