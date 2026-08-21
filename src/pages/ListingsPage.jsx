import React, { useContext, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Download, Search, X } from 'lucide-react';
import { AuthContext } from '../contexts';
import { api } from '../api';
import { Card } from '../components/ui';
import CurrencyInput, { formatCurrencyDisplay } from '../components/CurrencyInput';
import DateInput from '../components/DateInput';
import { useSortableData } from '../hooks';
import { localeContextFromBrowser } from '../config/locale.js';
import { formatWorkflowDateMMDDYYYY } from '../utils/workflow-date.js';
import {
  canEditListings,
  filterListingsBySearch,
  listingLabel,
  listingStreet,
} from '../utils/listings.js';

const API_BASE_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

function emptyForm() {
  return {
    unitId: null,
    listed: false,
    askingRent: null,
    availableOn: '',
    description: '',
  };
}

function formFromRow(row) {
  if (!row) return emptyForm();
  return {
    unitId: row.unitId,
    listed: Boolean(row.listed),
    askingRent: row.askingRent ?? row.lastRent ?? null,
    availableOn: row.availableOn || '',
    description: row.description || '',
  };
}

export default function ListingsPage() {
  const { user } = useContext(AuthContext);
  const locale = localeContextFromBrowser();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [listedFilter, setListedFilter] = useState('all');
  const [form, setForm] = useState(emptyForm);
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  const canEdit = canEditListings(user?.role);

  const load = async () => {
    if (!user?.user_id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/listings', user);
      if (!data?.success) {
        setError(data?.error || 'Could not load listings.');
        setListings([]);
        return;
      }
      setListings(data.listings || []);
    } catch {
      setError('Could not load listings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id]);

  const selected = useMemo(
    () => listings.find((row) => Number(row.unitId) === Number(selectedUnitId)) || null,
    [listings, selectedUnitId]
  );

  const filtered = useMemo(() => {
    const searched = filterListingsBySearch(listings, searchTerm);
    if (listedFilter === 'listed') return searched.filter((row) => row.listed);
    if (listedFilter === 'unlisted') return searched.filter((row) => !row.listed);
    return searched;
  }, [listings, searchTerm, listedFilter]);

  const sortable = useMemo(
    () =>
      filtered.map((row) => ({
        ...row,
        street: listingStreet(row),
        label: listingLabel(row),
      })),
    [filtered]
  );

  const { items: visible, requestSort, sortConfig } = useSortableData(sortable, {
    key: 'propertyName',
    direction: 'ascending',
  });

  const listedCount = listings.filter((row) => row.listed).length;

  const getSortIndicator = (name) => {
    if (!sortConfig || sortConfig.key !== name) {
      return <ArrowUpDown size={14} className="ml-2 text-gray-400" />;
    }
    return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
  };

  const selectRow = (row) => {
    setSelectedUnitId(row.unitId);
    setForm(formFromRow(row));
    setFormError('');
  };

  const saveListing = async (payload) => {
    setSaving(true);
    setFormError('');
    try {
      const data = await api.put('/listings', payload, user);
      if (!data?.success) {
        setFormError(data?.error || 'Could not save listing.');
        return false;
      }
      setListings(data.listings || []);
      const updated = (data.listings || []).find(
        (row) => Number(row.unitId) === Number(payload.unitId)
      );
      if (updated) {
        setSelectedUnitId(updated.unitId);
        setForm(formFromRow(updated));
      }
      return true;
    } catch {
      setFormError('Could not save listing.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!canEdit || !form.unitId) return;
    await saveListing({
      unitId: form.unitId,
      listed: form.listed,
      askingRent: form.askingRent,
      availableOn: form.availableOn || null,
      description: form.description,
    });
  };

  const handleToggleListed = async (row, listed) => {
    if (!canEdit) return;
    if (listed && row.askingRent == null && row.lastRent == null) {
      selectRow(row);
      setForm((prev) => ({ ...prev, listed: true }));
      setFormError('Asking rent is required to list a vacancy.');
      return;
    }
    await saveListing({
      unitId: row.unitId,
      listed,
      askingRent: row.askingRent ?? row.lastRent,
      availableOn: row.availableOn || null,
      description: row.description,
    });
  };

  const handleExport = async (format) => {
    setExporting(format);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/listings?format=${format}`, {
        headers: {
          'x-user-id': user?.user_id,
          'x-user-role': user?.role,
        },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Export failed');
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `listings.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setExporting('');
    }
  };

  const handleClear = () => {
    setSelectedUnitId(null);
    setForm(emptyForm());
    setFormError('');
  };

  return (
    <div className="finder-page">
      <h2 className="text-3xl font-bold text-gray-800">Listings</h2>
      <div className={canEdit ? 'finder-split' : 'finder-fill'}>
        {canEdit && (
          <Card
            hideTitle
            className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none"
            contentClassName="flex min-h-0 flex-col h-full"
          >
            <form onSubmit={handleSave} className="flex min-h-0 flex-col h-full">
              <div className="flex items-start justify-between pb-4 mb-4 border-b">
                <h2 className="text-2xl font-bold text-gray-800">
                  {selected ? listingLabel(selected) : 'Vacancy'}
                </h2>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
                {!selected ? (
                  <p className="text-sm text-gray-500">Select a unit from the Vacancy Search list.</p>
                ) : (
                  <>
                    <div>
                      <div className="text-sm text-gray-800">{selected.propertyName || '—'}</div>
                      {listingStreet(selected) ? (
                        <div className="finder-secondary text-gray-500">
                          {listingStreet(selected)}
                          {selected.city
                            ? `, ${selected.city}${selected.state ? ` ${selected.state}` : ''}`
                            : ''}
                        </div>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-gray-500">Beds</div>
                        <div>{selected.beds ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Baths</div>
                        <div>{selected.baths ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Sq ft</div>
                        <div>{selected.squareFootage ?? '—'}</div>
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="text-gray-500">Last rent</div>
                      <div>
                        {selected.lastRent != null
                          ? formatCurrencyDisplay(selected.lastRent, locale)
                          : '—'}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.listed}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, listed: e.target.checked }))
                        }
                        disabled={saving}
                      />
                      Listed
                    </label>
                    <CurrencyInput
                      label="Asking rent"
                      required={form.listed}
                      value={form.askingRent}
                      onChange={(value) => setForm((prev) => ({ ...prev, askingRent: value }))}
                    />
                    <DateInput
                      label="Available"
                      value={form.availableOn}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, availableOn: e.target.value }))
                      }
                    />
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Description
                      </label>
                      <textarea
                        value={form.description}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, description: e.target.value }))
                        }
                        rows={4}
                        maxLength={2000}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="pt-4 mt-4 border-t flex flex-col gap-3 flex-shrink-0">
                {formError && (
                  <p className="text-sm text-red-600 whitespace-pre-wrap">{formError}</p>
                )}
                <div className="flex justify-end gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleClear}
                    className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !form.unitId}
                    className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </Card>
        )}

        <Card
          title="Vacancy Search"
          className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none"
          contentClassName="flex min-h-0 flex-col h-full"
        >
          <div className="flex min-h-0 flex-col h-full">
            <div className="mb-4 flex-shrink-0">
              <div className="flex items-center gap-4 mb-2 flex-wrap">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search property, unit, address…"
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      title="Clear search"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <select
                  value={listedFilter}
                  onChange={(e) => setListedFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                >
                  <option value="all">All vacancies</option>
                  <option value="listed">Listed</option>
                  <option value="unlisted">Unlisted</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleExport('xml')}
                  disabled={Boolean(exporting)}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <Download size={14} />
                  {exporting === 'xml' ? 'XML…' : 'XML'}
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('csv')}
                  disabled={Boolean(exporting)}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <Download size={14} />
                  {exporting === 'csv' ? 'CSV…' : 'CSV'}
                </button>
              </div>
              <div className="mt-2 text-sm text-gray-600">
                {searchTerm || listedFilter !== 'all' ? (
                  visible.length === 0 ? (
                    <span className="text-red-600">No vacancies match these filters.</span>
                  ) : (
                    <span>
                      Showing {visible.length} of {listings.length} vacancies
                      {' · '}
                      {listedCount} listed
                    </span>
                  )
                ) : (
                  <span>
                    Showing {listings.length} of {listings.length} vacancies
                    {' · '}
                    {listedCount} listed
                  </span>
                )}
              </div>
            </div>

            {error && (
              <p className="mb-3 text-sm text-red-600 whitespace-pre-wrap flex-shrink-0">{error}</p>
            )}

            {loading ? (
              <p className="text-sm text-gray-500">Loading vacancies…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-gray-500">No vacancies match these filters.</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-gray-200">
                <div className="overflow-auto h-full min-h-0 max-w-full">
                  <table className="finder-list w-max divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('listed')}
                            className="flex items-center"
                          >
                            Listed {getSortIndicator('listed')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('propertyName')}
                            className="flex items-center"
                          >
                            Property {getSortIndicator('propertyName')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('unitNumber')}
                            className="flex items-center"
                          >
                            Unit {getSortIndicator('unitNumber')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('street')}
                            className="flex items-center"
                          >
                            Address {getSortIndicator('street')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('askingRent')}
                            className="flex items-center"
                          >
                            Asking {getSortIndicator('askingRent')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('lastRent')}
                            className="flex items-center"
                          >
                            Last {getSortIndicator('lastRent')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('availableOn')}
                            className="flex items-center"
                          >
                            Available {getSortIndicator('availableOn')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('beds')}
                            className="flex items-center"
                          >
                            Beds {getSortIndicator('beds')}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {visible.map((row) => {
                        const isSelected = Number(row.unitId) === Number(selectedUnitId);
                        return (
                          <tr
                            key={row.unitId}
                            className={`align-top cursor-pointer ${isSelected ? 'bg-indigo-50' : ''}`}
                            onClick={() => canEdit && selectRow(row)}
                          >
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              {canEdit ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.listed)}
                                  disabled={saving}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => handleToggleListed(row, e.target.checked)}
                                />
                              ) : row.listed ? (
                                'Yes'
                              ) : (
                                'No'
                              )}
                            </td>
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              {row.propertyName || '—'}
                            </td>
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              {row.unitNumber || '—'}
                            </td>
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              <div>{row.street || '—'}</div>
                              {row.city ? (
                                <div className="finder-secondary text-gray-500">
                                  {row.city}
                                  {row.state ? ` ${row.state}` : ''}
                                  {row.postalCode ? ` ${row.postalCode}` : ''}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              {row.askingRent != null
                                ? formatCurrencyDisplay(row.askingRent, locale)
                                : '—'}
                            </td>
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              {row.lastRent != null
                                ? formatCurrencyDisplay(row.lastRent, locale)
                                : '—'}
                            </td>
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              {formatWorkflowDateMMDDYYYY(row.availableOn) || '—'}
                            </td>
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              {row.beds ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
