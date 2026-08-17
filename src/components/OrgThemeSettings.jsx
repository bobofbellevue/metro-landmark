import React, { useContext, useEffect, useState } from 'react';
import { Card } from './ui';
import { AuthContext } from '../contexts';
import { api } from '../api';
import { brand } from '../config/brand.js';
import {
  DEFAULT_ORG_PRIMARY,
  applyOrgTheme,
  canEditOrgTheme,
  clearOrgTheme,
  normalizePrimaryHex,
  themeScaleFromPrimary,
} from '../utils/org-theme.js';

export default function OrgThemeSettings() {
  const { user, orgTheme, setOrgTheme } = useContext(AuthContext);
  const [companyName, setCompanyName] = useState('');
  const [primary, setPrimary] = useState(
    orgTheme?.primary || DEFAULT_ORG_PRIMARY
  );
  const [logoUrl, setLogoUrl] = useState(orgTheme?.logoUrl || '');
  const [canEdit, setCanEdit] = useState(canEditOrgTheme(user?.role));
  const [hasCompany, setHasCompany] = useState(Boolean(user?.pmc_id));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.user_id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = await api.get('/org-theme', user);
        if (cancelled) return;
        if (!data?.success) {
          setError(data?.error || 'Could not load company appearance.');
          setHasCompany(Boolean(user?.pmc_id));
          setCanEdit(false);
          return;
        }
        setHasCompany(Boolean(data.pmcId));
        setCanEdit(Boolean(data.canEdit));
        setCompanyName(data.companyName || '');
        setPrimary(data.theme?.primary || data.defaults?.primary || DEFAULT_ORG_PRIMARY);
        setLogoUrl(data.theme?.logoUrl || '');
      } catch {
        if (!cancelled) {
          setError('Could not load company appearance.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const previewScale = themeScaleFromPrimary(primary);
  const previewHex = normalizePrimaryHex(primary) || DEFAULT_ORG_PRIMARY;

  const handlePrimaryText = (value) => {
    setPrimary(value);
    setSuccess('');
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.put(
        '/org-theme',
        { primary, logoUrl: logoUrl.trim() || null },
        user
      );
      if (!data?.success) {
        setError(data?.error || 'Could not save company appearance.');
        return;
      }
      setOrgTheme?.(data.theme);
      applyOrgTheme(data.theme);
      setPrimary(data.theme?.primary || DEFAULT_ORG_PRIMARY);
      setLogoUrl(data.theme?.logoUrl || '');
      setSuccess('Company appearance saved. Staff see these colors after they sign in.');
    } catch {
      setError('Could not save company appearance.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.put('/org-theme', { reset: true }, user);
      if (!data?.success) {
        setError(data?.error || 'Could not reset company appearance.');
        return;
      }
      setOrgTheme?.(null);
      clearOrgTheme();
      setPrimary(data.defaults?.primary || DEFAULT_ORG_PRIMARY);
      setLogoUrl('');
      setSuccess('Company appearance reset to deploy defaults.');
    } catch {
      setError('Could not reset company appearance.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card title="Company appearance">
        <p className="text-sm text-gray-600">Loading company appearance…</p>
      </Card>
    );
  }

  if (!hasCompany) {
    return (
      <Card title="Company appearance">
        <p className="text-sm text-gray-600">
          Assign this account to a PM company to set company colors. The product
          name ({brand.productName}) and login art stay in deploy environment
          variables.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Company appearance">
      <p className="mb-4 text-sm text-gray-600">
        Colors apply after sign-in for {companyName || 'this PM company'}. Login
        and the product name ({brand.productName}) stay deploy-wide.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="org-theme-primary">
            Primary color
          </label>
          <div className="mt-1 flex items-center gap-3">
            <input
              id="org-theme-primary-picker"
              type="color"
              value={previewHex}
              onChange={(e) => handlePrimaryText(e.target.value)}
              disabled={!canEdit || saving}
              className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1 disabled:cursor-not-allowed"
              aria-label="Pick primary color"
            />
            <input
              id="org-theme-primary"
              type="text"
              value={primary}
              onChange={(e) => handlePrimaryText(e.target.value)}
              disabled={!canEdit || saving}
              spellCheck={false}
              className="block w-40 px-3 py-2 border border-gray-300 rounded-md shadow-sm font-mono text-sm disabled:bg-gray-50"
              placeholder="#4f46e5"
            />
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700">Preview</span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg p-1.5"
              style={{ backgroundColor: previewScale['500'] }}
            >
              <div className="h-full w-full rounded bg-white/20" />
            </div>
            <div className="flex overflow-hidden rounded border border-gray-200">
              {['50', '100', '200', '400', '600', '800', '900'].map((step) => (
                <div
                  key={step}
                  title={`${step}: ${previewScale[step]}`}
                  className="h-8 w-8"
                  style={{ backgroundColor: previewScale[step] }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="org-theme-logo">
            Company logo URL (optional)
          </label>
          <input
            id="org-theme-logo"
            type="text"
            value={logoUrl}
            onChange={(e) => {
              setLogoUrl(e.target.value);
              setSuccess('');
            }}
            disabled={!canEdit || saving}
            className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm text-sm disabled:bg-gray-50"
            placeholder="/brand/company-logo.svg"
          />
          <p className="mt-1 text-xs text-gray-500">
            HTTPS URL or a same-origin path. Leave blank to keep the deploy logo
            in the sidebar.
          </p>
        </div>

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

        {canEdit && (
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
            >
              Reset to deploy defaults
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
            >
              {saving ? 'Saving...' : 'Save appearance'}
            </button>
          </div>
        )}
      </form>
    </Card>
  );
}
