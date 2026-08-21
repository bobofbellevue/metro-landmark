import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Download, Home, Pencil, Search, Trash2, X } from 'lucide-react';
import { AuthContext } from '../contexts';
import { api } from '../api';
import { Card, ConfirmationModal } from '../components/ui';
import CurrencyInput, { formatCurrencyDisplay } from '../components/CurrencyInput';
import DateInput from '../components/DateInput';
import UnitSelectionModal from '../components/UnitSelectionModal';
import { useSortableData } from '../hooks';
import { localeContextFromBrowser } from '../config/locale.js';
import { formatWorkflowDateMMDDYYYY } from '../utils/workflow-date.js';
import {
  canEditListings,
  filterListings,
  listingAsPickerUnit,
  listingLabel,
  listingStreet,
  listingsToCsv,
  listingsToZillowXml,
  readListingsSearchSession,
  uniqueListingFilters,
  writeListingsSearchSession,
} from '../utils/listings.js';
import { formatUnitPickerLabel } from '../utils/unit-display.js';

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

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(downloadUrl);
  document.body.removeChild(a);
}

function ClampedCellText({ value }) {
  const text = value == null || value === '' ? '—' : String(value);
  const ref = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div
      ref={ref}
      className="min-w-0 whitespace-normal break-words line-clamp-3"
      title={overflows && text !== '—' ? text : undefined}
    >
      {text}
    </div>
  );
}

export default function ListingsPage() {
  const { user } = useContext(AuthContext);
  const locale = localeContextFromBrowser();
  const savedSearch = useMemo(() => readListingsSearchSession(user?.user_id), [user?.user_id]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [searchTerm, setSearchTerm] = useState(savedSearch.searchTerm);
  const [listedFilter, setListedFilter] = useState(savedSearch.listedFilter);
  const [landlordFilter, setLandlordFilter] = useState(savedSearch.landlordFilter);
  const [pmcFilter, setPmcFilter] = useState(savedSearch.pmcFilter);
  const [managerFilter, setManagerFilter] = useState(savedSearch.managerFilter);
  const [form, setForm] = useState(emptyForm);
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

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

  useEffect(() => {
    if (!user?.user_id) return;
    writeListingsSearchSession(user.user_id, {
      searchTerm,
      listedFilter,
      landlordFilter,
      pmcFilter,
      managerFilter,
    });
  }, [user?.user_id, searchTerm, listedFilter, landlordFilter, pmcFilter, managerFilter]);

  const selected = useMemo(
    () => listings.find((row) => Number(row.unitId) === Number(form.unitId)) || null,
    [listings, form.unitId]
  );

  const filters = useMemo(() => uniqueListingFilters(listings), [listings]);

  const filtered = useMemo(
    () =>
      filterListings(listings, {
        searchTerm,
        listed: listedFilter,
        landlordId: landlordFilter,
        pmcId: pmcFilter,
        managerId: managerFilter,
      }),
    [listings, searchTerm, listedFilter, landlordFilter, pmcFilter, managerFilter]
  );

  const pickerUnits = useMemo(() => filtered.map(listingAsPickerUnit), [filtered]);

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
  const filtersActive =
    Boolean(searchTerm) ||
    listedFilter !== 'all' ||
    landlordFilter !== '' ||
    pmcFilter !== '' ||
    managerFilter !== '';

  const getSortIndicator = (name) => {
    if (!sortConfig || sortConfig.key !== name) {
      return <ArrowUpDown size={14} className="ml-2 text-gray-400" />;
    }
    return sortConfig.direction === 'ascending' ? ' 🔼' : ' 🔽';
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
    const ok = await saveListing({
      unitId: form.unitId,
      listed: form.listed,
      askingRent: form.askingRent,
      availableOn: form.availableOn || null,
      description: form.description,
    });
    if (ok) {
      setForm(emptyForm());
      setEditingUnitId(null);
    }
  };

  const handleEdit = (row) => {
    setEditingUnitId(row.unitId);
    setForm(formFromRow(row));
    setFormError('');
  };

  const handleDelete = async () => {
    if (!canEdit || !deleteTarget) return;
    setSaving(true);
    setError('');
    try {
      const data = await api.delete(`/listings?unitId=${deleteTarget.unitId}`, user);
      if (!data?.success) {
        setError(data?.error || 'Could not delete listing.');
        return;
      }
      setListings(data.listings || []);
      if (Number(form.unitId) === Number(deleteTarget.unitId)) {
        setForm(emptyForm());
        setEditingUnitId(null);
      }
      setDeleteTarget(null);
    } catch {
      setError('Could not delete listing.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = (format) => {
    setExporting(format);
    setError('');
    try {
      if (format === 'csv') {
        downloadText('listings.csv', listingsToCsv(filtered), 'text/csv;charset=utf-8');
      } else {
        downloadText(
          'listings.xml',
          listingsToZillowXml(filtered),
          'application/xml;charset=utf-8'
        );
      }
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setExporting('');
    }
  };

  const handleClear = () => {
    setForm(emptyForm());
    setEditingUnitId(null);
    setFormError('');
  };

  const handleUnitSelect = (unitId) => {
    if (unitId == null || unitId === '') {
      setForm(emptyForm());
      setEditingUnitId(null);
      setFormError('');
      return;
    }
    const row = listings.find((item) => Number(item.unitId) === Number(unitId));
    if (!row) return;
    setEditingUnitId(row.hasListing ? row.unitId : null);
    setForm(formFromRow(row));
    setFormError('');
  };

  const selectedPickerUnit = selected ? listingAsPickerUnit(selected) : null;
  const isEditing = editingUnitId != null;

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
                  {isEditing ? 'Edit Listing' : 'Add Listing'}
                </h2>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Select Unit</label>
                  <div className="mt-2">
                    {selected ? (
                      <div className="border border-gray-300 bg-gray-50 rounded-md p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">
                            {formatUnitPickerLabel(selectedPickerUnit)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowUnitModal(true)}
                            className="text-sm text-indigo-600 hover:text-indigo-800"
                          >
                            Change Selection
                          </button>
                        </div>
                        {listingStreet(selected) ? (
                          <div className="finder-secondary text-gray-500">
                            {listingStreet(selected)}
                            {selected.city
                              ? `, ${selected.city}${selected.state ? ` ${selected.state}` : ''}`
                              : ''}
                          </div>
                        ) : null}
                        <div className="grid grid-cols-3 gap-3 text-sm mt-3">
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
                        <div className="text-sm mt-3">
                          <div className="text-gray-500">Last rent</div>
                          <div>
                            {selected.lastRent != null
                              ? formatCurrencyDisplay(selected.lastRent, locale)
                              : '—'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowUnitModal(true)}
                        className="w-full border-2 border-dashed border-gray-300 rounded-md p-4 text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                      >
                        <Home className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                        <span className="text-sm text-gray-600">Select Unit</span>
                      </button>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.listed}
                    onChange={(e) => setForm((prev) => ({ ...prev, listed: e.target.checked }))}
                    disabled={saving || !form.unitId}
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
                  onChange={(e) => setForm((prev) => ({ ...prev, availableOn: e.target.value }))}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows={4}
                    maxLength={2000}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>
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
                    {saving ? 'Saving…' : isEditing ? 'Save Listing' : 'Add Listing'}
                  </button>
                </div>
              </div>
            </form>
          </Card>
        )}

        <Card
          title="Listing Search"
          className="max-h-[calc(100vh-160px)] min-h-0 lg:max-h-none"
          contentClassName="flex min-h-0 flex-col h-full"
        >
          <div className="flex min-h-0 flex-col h-full">
            <div className="mb-4 flex-shrink-0">
              <div className="flex items-center gap-4 mb-2 flex-wrap">
                <div className="relative flex-1 min-w-[12rem]">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search property, unit, address, owner…"
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
                <select
                  value={landlordFilter}
                  onChange={(e) => setLandlordFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                >
                  <option value="">All owners</option>
                  {filters.landlords.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  value={managerFilter}
                  onChange={(e) => setManagerFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                >
                  <option value="">All PMs</option>
                  {filters.managers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  value={pmcFilter}
                  onChange={(e) => setPmcFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                >
                  <option value="">All PMCs</option>
                  {filters.pmcs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
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
                {filtersActive ? (
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
              <p className="text-sm text-gray-500">
                {listings.length === 0
                  ? 'No vacant units.'
                  : 'No vacancies match these filters.'}
              </p>
            ) : (
              <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-gray-200">
                <div className="overflow-auto h-full min-h-0 max-w-full">
                  <table className="finder-list w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {canEdit && (
                          <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                            Actions
                          </th>
                        )}
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('listed')}
                            className="flex items-center"
                          >
                            Listed {getSortIndicator('listed')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase min-w-0">
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
                            onClick={() => requestSort('landlordName')}
                            className="flex items-center"
                          >
                            Owner {getSortIndicator('landlordName')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => requestSort('managerName')}
                            className="flex items-center"
                          >
                            PM {getSortIndicator('managerName')}
                          </button>
                        </th>
                        <th className="px-1.5 py-2 text-xs font-medium tracking-wider text-left text-gray-500 uppercase min-w-0">
                          <button
                            type="button"
                            onClick={() => requestSort('pmcName')}
                            className="flex items-center"
                          >
                            PMC {getSortIndicator('pmcName')}
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
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {visible.map((row) => (
                        <tr key={row.unitId} className="align-top">
                          {canEdit && (
                            <td className="px-1.5 py-2 text-left whitespace-nowrap">
                              <div className="flex items-center space-x-3">
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleEdit(row)}
                                  className="text-indigo-600 hover:text-indigo-900"
                                  title="Edit Listing"
                                >
                                  <Pencil size={16} />
                                </button>
                                {row.hasListing && (
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => setDeleteTarget(row)}
                                    className="text-red-600 hover:text-red-800"
                                    title="Delete Listing"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                          <td className="px-1.5 py-2 text-left whitespace-nowrap">
                            {row.listed ? 'Yes' : 'No'}
                          </td>
                          <td className="px-1.5 py-2 text-left min-w-0">
                            <ClampedCellText value={row.propertyName} />
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
                            {row.landlordName || '—'}
                          </td>
                          <td className="px-1.5 py-2 text-left whitespace-nowrap">
                            {row.managerName || '—'}
                          </td>
                          <td className="px-1.5 py-2 text-left min-w-0">
                            <ClampedCellText value={row.pmcName} />
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <UnitSelectionModal
        isOpen={showUnitModal}
        onClose={() => setShowUnitModal(false)}
        units={pickerUnits}
        selectedUnitId={form.unitId}
        onUnitSelect={handleUnitSelect}
        title="Select Unit"
        emptyMessage="No vacant units available."
      />
      <ConfirmationModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Listing"
        message={
          deleteTarget
            ? `Remove the listing for ${listingLabel(deleteTarget)}?`
            : ''
        }
        confirmText="Delete"
        isDestructive
        isLoading={saving}
      />
    </div>
  );
}
