import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Check } from 'lucide-react';
import { useFinderLimit } from '../hooks/useFinderLimit.js';
import {
  filterUnitsBySearch,
  formatUnitAddressLine,
  formatUnitPickerLabel,
  sortUnitsForPicker,
} from '../utils/unit-display.js';

/**
 * Modal unit picker (mirrors TenantSelectionModal UX).
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {object[]} props.units
 * @param {number|string|null} props.selectedUnitId
 * @param {(unitId: number|null, unit: object|null) => void} props.onUnitSelect
 * @param {string} [props.title]
 * @param {string} [props.emptyMessage]
 */
export default function UnitSelectionModal({
  isOpen,
  onClose,
  units = [],
  selectedUnitId = null,
  onUnitSelect,
  title = 'Select Unit',
  emptyMessage = 'No units available.',
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [pendingUnitId, setPendingUnitId] = useState(selectedUnitId);

  useEffect(() => {
    if (isOpen) {
      setPendingUnitId(selectedUnitId);
      setSearchTerm('');
      setDebouncedSearchTerm('');
    }
  }, [isOpen, selectedUnitId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const enrichedUnits = useMemo(
    () =>
      (units || []).map((unit) => ({
        ...unit,
        addressLine:
          unit.addressLine || formatUnitAddressLine(unit.property_address || unit.address),
      })),
    [units]
  );

  const filteredUnits = useMemo(
    () => filterUnitsBySearch(enrichedUnits, debouncedSearchTerm),
    [enrichedUnits, debouncedSearchTerm]
  );

  const sortedUnits = useMemo(() => sortUnitsForPicker(filteredUnits), [filteredUnits]);

  const { visibleCount, hasMore, showMore } = useFinderLimit(sortedUnits.length, [
    debouncedSearchTerm,
    enrichedUnits.length,
    isOpen,
  ]);
  const displayedUnits = sortedUnits.slice(0, visibleCount || sortedUnits.length);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    e.stopPropagation();
  };

  const handleDone = () => {
    if (pendingUnitId == null || pendingUnitId === '') {
      onUnitSelect?.(null, null);
    } else {
      const unit = enrichedUnits.find((u) => String(u.unit_id) === String(pendingUnitId));
      onUnitSelect?.(unit?.unit_id ?? pendingUnitId, unit || null);
    }
    onClose();
  };

  const handleClear = () => {
    setPendingUnitId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl max-h-[80vh] bg-white rounded-lg shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 border-b border-gray-200">
          <div className="relative mb-4">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search by property, unit, or address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              autoFocus
            />
          </div>

          <div className="text-sm text-gray-600">
            {debouncedSearchTerm ? (
              sortedUnits.length === 0 ? (
                <span className="text-red-600">
                  No units found matching &quot;{debouncedSearchTerm}&quot;
                </span>
              ) : (
                <span>
                  Showing {displayedUnits.length} of {sortedUnits.length} matching units
                  {enrichedUnits.length !== sortedUnits.length
                    ? ` (${enrichedUnits.length} total)`
                    : ''}
                </span>
              )
            ) : (
              <span>
                Showing {displayedUnits.length} of {enrichedUnits.length} units
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {displayedUnits.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {debouncedSearchTerm ? 'No units found matching your search.' : emptyMessage}
            </div>
          ) : (
            <div className="space-y-2">
              {displayedUnits.map((unit) => {
                const isSelected = String(unit.unit_id) === String(pendingUnitId);
                return (
                  <button
                    key={unit.unit_id}
                    type="button"
                    title={unit.addressLine || undefined}
                    onClick={() => setPendingUnitId(unit.unit_id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-200'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
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
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 whitespace-normal break-words">
                          {formatUnitPickerLabel(unit)}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="text-xs text-indigo-600 font-medium ml-2 flex-shrink-0">
                          Selected
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {hasMore && (
            <button
              type="button"
              onClick={showMore}
              className="mt-4 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Show more units
            </button>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {pendingUnitId != null && pendingUnitId !== ''
                ? '1 unit selected'
                : 'No unit selected'}
            </div>
            <div className="flex gap-3">
              {(pendingUnitId != null && pendingUnitId !== '') && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDone}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
