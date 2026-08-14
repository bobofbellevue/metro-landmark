import React, { useEffect, useMemo, useState } from 'react';
import { Search, Check, X } from 'lucide-react';
import { useFinderLimit } from '../hooks/useFinderLimit.js';
import { filterLeasesBySearch } from '../utils/lease-display.js';
import { fetchEnrichedLeases } from '../utils/fetch-enriched-leases.js';

const DEFAULT_STATUSES = ['active', 'pending', 'future'];

/**
 * Searchable lease picker (Select Tenants–style list with multi-line rows).
 *
 * @param {object} props
 * @param {number|string|null} props.value - selected lease_id
 * @param {(leaseId: number, lease: object) => void} props.onChange
 * @param {string[]} [props.statuses]
 * @param {string} [props.error]
 * @param {string} [props.emptyMessage]
 * @param {boolean} [props.showRent]
 * @param {boolean} [props.showDeposit]
 */
export default function LeaseSelectionPicker({
  value = null,
  onChange,
  statuses = DEFAULT_STATUSES,
  error = '',
  emptyMessage = 'No matching leases found.',
  showRent = true,
  showDeposit = false,
}) {
  const [leases, setLeases] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const statusKey = Array.isArray(statuses) ? statuses.join('|') : String(statuses || '');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let cancelled = false;
    const statusList = statusKey ? statusKey.split('|') : DEFAULT_STATUSES;

    async function load() {
      setIsLoading(true);
      setLoadError('');
      try {
        const enriched = await fetchEnrichedLeases(statusList);
        if (!cancelled) setLeases(enriched);
      } catch (err) {
        console.error('Error loading leases for picker:', err);
        if (!cancelled) {
          setLeases([]);
          setLoadError(err.message || 'Failed to load leases.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [statusKey]);

  const filteredLeases = useMemo(
    () => filterLeasesBySearch(leases, debouncedSearchTerm),
    [leases, debouncedSearchTerm]
  );

  const sortedLeases = useMemo(() => {
    return [...filteredLeases].sort((a, b) => {
      const aName = (a.units?.properties?.property_name || '').toLowerCase();
      const bName = (b.units?.properties?.property_name || '').toLowerCase();
      const byProperty = aName.localeCompare(bName);
      if (byProperty !== 0) return byProperty;
      return String(a.units?.unit_number || '').localeCompare(
        String(b.units?.unit_number || ''),
        undefined,
        { numeric: true }
      );
    });
  }, [filteredLeases]);

  const { visibleCount, hasMore, showMore } = useFinderLimit(sortedLeases.length, [
    debouncedSearchTerm,
    leases.length,
  ]);
  const displayedLeases = sortedLeases.slice(0, visibleCount || sortedLeases.length);
  const selectedLease =
    value != null && value !== ''
      ? leases.find((l) => String(l.lease_id) === String(value))
      : null;

  const handleSelect = (lease) => {
    if (onChange) onChange(lease.lease_id, lease);
  };

  const handleClear = () => {
    if (onChange) onChange(null, null);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Lease <span className="text-red-500">*</span>
        </label>

        {selectedLease ? (
          <div
            className={`flex items-start justify-between gap-3 p-3 rounded-md border ${
              error ? 'border-red-300 bg-red-50' : 'border-indigo-200 bg-indigo-50'
            }`}
          >
            <LeaseRowContent
              lease={selectedLease}
              showRent={showRent}
              showDeposit={showDeposit}
            />
            <button
              type="button"
              onClick={handleClear}
              className="flex-shrink-0 p-1 text-gray-500 hover:text-gray-800"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by property, unit, address, tenant, or landlord..."
              className={`block w-full pl-10 pr-3 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm ${
                error ? 'border-red-300' : 'border-gray-300'
              }`}
            />
          </div>
        )}

        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>

      {!selectedLease && (
        <>
          <div className="text-sm text-gray-600">
            {isLoading ? (
              <span>Loading leases...</span>
            ) : loadError ? (
              <span className="text-red-600">{loadError}</span>
            ) : debouncedSearchTerm ? (
              sortedLeases.length === 0 ? (
                <span className="text-red-600">
                  No leases found matching &quot;{debouncedSearchTerm}&quot;
                </span>
              ) : (
                <span>
                  Showing {displayedLeases.length} of {sortedLeases.length} matching leases
                  {leases.length !== sortedLeases.length
                    ? ` (${leases.length} total)`
                    : ''}
                </span>
              )
            ) : (
              <span>
                Showing {displayedLeases.length} of {leases.length} leases
              </span>
            )}
          </div>

          {!isLoading && !loadError && (
            <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {displayedLeases.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">{emptyMessage}</div>
              ) : (
                displayedLeases.map((lease) => {
                  const isSelected = String(lease.lease_id) === String(value);
                  return (
                    <button
                      key={lease.lease_id}
                      type="button"
                      onClick={() => handleSelect(lease)}
                      className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-indigo-50' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600'
                              : 'border-gray-300'
                          }`}
                        >
                          {isSelected && <Check size={12} className="text-white" />}
                        </div>
                        <LeaseRowContent
                          lease={lease}
                          showRent={showRent}
                          showDeposit={showDeposit}
                        />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {hasMore && (
            <button
              type="button"
              onClick={showMore}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Show more leases
            </button>
          )}
        </>
      )}
    </div>
  );
}

function LeaseRowContent({ lease, showRent, showDeposit }) {
  const propertyName = lease.units?.properties?.property_name || 'Property';
  const unitNumber = lease.units?.unit_number ?? '—';
  const rentLabel =
    showRent && lease.monthly_rent_amount != null
      ? `$${Number(lease.monthly_rent_amount).toLocaleString()}/mo`
      : null;
  const depositLabel =
    showDeposit && lease.security_deposit_amount != null
      ? `Deposit $${Number(lease.security_deposit_amount).toLocaleString()}`
      : null;

  return (
    <div className="flex-1 min-w-0 space-y-0.5">
      <div className="font-medium text-gray-900">
        {propertyName}
        <span className="text-gray-500 font-normal"> · Unit {unitNumber}</span>
      </div>
      {lease.addressLine && (
        <div className="text-sm text-gray-600 truncate">{lease.addressLine}</div>
      )}
      <div className="text-sm text-gray-700">
        <span className="text-gray-500">Tenant: </span>
        {lease.tenantNames || '—'}
      </div>
      <div className="text-sm text-gray-700">
        <span className="text-gray-500">Landlord: </span>
        {lease.landlordName || '—'}
      </div>
      <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
        {lease.status && <span className="capitalize">{lease.status}</span>}
        {rentLabel && <span>{rentLabel}</span>}
        {depositLabel && <span>{depositLabel}</span>}
      </div>
    </div>
  );
}
