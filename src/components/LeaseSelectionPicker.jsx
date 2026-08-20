import React, { useEffect, useMemo, useState } from 'react';
import { Search, Check, X } from 'lucide-react';
import { useFinderLimit } from '../hooks/useFinderLimit.js';
import { filterLeasesBySearch, leasePickerHoverText, leasePickerPrimaryLabel } from '../utils/lease-display.js';
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
 * @param {{ id: string, title: string, description?: string, emptyLabel?: string }[]} [props.groups]
 * @param {Record<string, { group?: string, badge?: string, badgeClass?: string }>} [props.leaseAnnotations]
 */
export default function LeaseSelectionPicker({
  value = null,
  onChange,
  statuses = DEFAULT_STATUSES,
  error = '',
  emptyMessage = 'No matching leases found.',
  showRent = true,
  showDeposit = false,
  groups = null,
  leaseAnnotations = {},
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

  const groupedSections = useMemo(() => {
    if (!Array.isArray(groups) || groups.length === 0) {
      return [{ group: null, leases: sortedLeases }];
    }
    const searching = Boolean(debouncedSearchTerm);
    return groups
      .map((group) => ({
        group,
        leases: sortedLeases.filter((lease) => {
          const annotation = leaseAnnotations[String(lease.lease_id)];
          const groupId = annotation?.group || 'generate';
          return groupId === group.id;
        }),
      }))
      .filter((section) => searching ? section.leases.length > 0 : true);
  }, [groups, sortedLeases, leaseAnnotations, debouncedSearchTerm]);

  const listLength = groupedSections.reduce(
    (sum, section) => sum + section.leases.length,
    0
  );
  const { visibleCount, hasMore, showMore } = useFinderLimit(listLength, [
    debouncedSearchTerm,
    leases.length,
  ]);
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
            className={`flex items-start justify-between gap-3 p-2 rounded-md border ${
              error ? 'border-red-300 bg-red-50' : 'border-indigo-200 bg-indigo-50'
            }`}
          >
            <LeaseRowContent
              lease={selectedLease}
              showRent={showRent}
              showDeposit={showDeposit}
              annotation={leaseAnnotations[String(selectedLease.lease_id)]}
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
                  Showing {Math.min(visibleCount, sortedLeases.length)} of {sortedLeases.length} matching leases
                  {leases.length !== sortedLeases.length
                    ? ` (${leases.length} total)`
                    : ''}
                </span>
              )
            ) : (
              <span>
                Showing {Math.min(visibleCount, leases.length)} of {leases.length} leases
              </span>
            )}
          </div>

          {!isLoading && !loadError && (
            <div className="space-y-4">
              {listLength === 0 && groupedSections.length <= 1 ? (
                <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-md">
                  <div className="p-4 text-center text-sm text-gray-500">{emptyMessage}</div>
                </div>
              ) : (
                (() => {
                  let remaining = visibleCount || listLength;
                  return groupedSections.map((section) => {
                    const take = Math.min(section.leases.length, remaining);
                    remaining -= take;
                    const visibleLeases = section.leases.slice(0, take);
                    return (
                      <LeaseGroup
                        key={section.group?.id || 'all'}
                        group={section.group}
                        leases={visibleLeases}
                        emptyLabel={section.group?.emptyLabel}
                        value={value}
                        onSelect={handleSelect}
                        showRent={showRent}
                        showDeposit={showDeposit}
                        leaseAnnotations={leaseAnnotations}
                      />
                    );
                  });
                })()
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

function LeaseGroup({
  group,
  leases,
  emptyLabel,
  value,
  onSelect,
  showRent,
  showDeposit,
  leaseAnnotations,
}) {
  return (
    <div>
      {group ? (
        <div className="mb-1">
          <h4 className="text-sm font-semibold text-gray-800">{group.title}</h4>
          {group.description ? (
            <p className="text-xs text-gray-600">{group.description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="finder-list max-h-80 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
        {leases.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">
            {emptyLabel || 'None right now.'}
          </div>
        ) : (
          leases.map((lease) => {
            const isSelected = String(lease.lease_id) === String(value);
            const annotation = leaseAnnotations[String(lease.lease_id)];
            return (
              <button
                key={lease.lease_id}
                type="button"
                onClick={() => onSelect(lease)}
                className={`w-full text-left p-2 hover:bg-gray-50 transition-colors ${
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
                    annotation={annotation}
                  />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function LeaseRowContent({ lease, showRent, showDeposit, annotation }) {
  const hover = leasePickerHoverText(lease, { showRent, showDeposit });

  return (
    <div className="flex-1 min-w-0" title={hover}>
      <div className="text-gray-900 flex flex-wrap items-center gap-2">
        <span className="whitespace-normal break-words">{leasePickerPrimaryLabel(lease)}</span>
        {annotation?.badge ? (
          <span
            className={`px-2 py-0.5 rounded finder-secondary ${
              annotation.badgeClass || 'bg-gray-100 text-gray-700'
            }`}
          >
            {annotation.badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}
