import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MousePointerClick,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { analyzeTemplatePositionQuality } from '../utils/template-position-quality.js';
import { setFieldPositionByPath } from '../utils/template-field-paths.js';
import {
  addTemplateField,
  applyBoxDelta,
  clientPointToImageCoords,
  cloneTemplateData,
  FIELD_TYPES,
  isPlacementApproved,
  listPlacementFields,
  markPlacementApproved,
  placeFieldAtPoint,
  removeFieldByPath,
  renameFieldByPath,
  setFieldMetaByPath,
} from '../utils/template-field-placement.js';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function handleStyle(handle) {
  const size = 8;
  const half = size / 2;
  const common = {
    position: 'absolute',
    width: size,
    height: size,
    background: '#4f46e5',
    border: '1px solid white',
    borderRadius: 1,
    zIndex: 2,
  };
  const map = {
    n: { top: -half, left: '50%', marginLeft: -half, cursor: 'ns-resize' },
    s: { bottom: -half, left: '50%', marginLeft: -half, cursor: 'ns-resize' },
    e: { right: -half, top: '50%', marginTop: -half, cursor: 'ew-resize' },
    w: { left: -half, top: '50%', marginTop: -half, cursor: 'ew-resize' },
    ne: { top: -half, right: -half, cursor: 'nesw-resize' },
    nw: { top: -half, left: -half, cursor: 'nwse-resize' },
    se: { bottom: -half, right: -half, cursor: 'nwse-resize' },
    sw: { bottom: -half, left: -half, cursor: 'nesw-resize' },
  };
  return { ...common, ...map[handle] };
}

/**
 * Visual placement editor: auto-detect is a draft; operator boxes are truth.
 */
export default function TemplateFieldPlacementEditor({
  images = [],
  templateData,
  onApply,
  onClose,
}) {
  const [schema, setSchema] = useState(() => cloneTemplateData(templateData));
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedPath, setSelectedPath] = useState(null);
  const [placingPath, setPlacingPath] = useState(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('string');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pageSize, setPageSize] = useState({ width: 1224, height: 1584 });

  const imgRef = useRef(null);
  const schemaRef = useRef(schema);
  const dragRef = useRef(null);
  schemaRef.current = schema;

  const pageCount = images.length;
  const safePage = Math.min(pageIndex, Math.max(0, pageCount - 1));

  const fields = useMemo(() => listPlacementFields(schema), [schema]);
  const pageFields = fields.filter((f) => f.box && f.box.page === safePage);
  const unplaced = fields.filter((f) => !f.box);
  const selected = fields.find((f) => f.path === selectedPath) || null;

  const updateSchema = useCallback((mutator) => {
    const next = cloneTemplateData(schemaRef.current);
    const result = mutator(next);
    schemaRef.current = next;
    setSchema(next);
    setDirty(true);
    setError('');
    return result;
  }, []);

  const applyBoxToSchema = useCallback(
    (path, box) => {
      updateSchema((next) => {
        setFieldPositionByPath(next, path, {
          page: box.page,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          space: 'image_2x',
        });
      });
    },
    [updateSchema]
  );

  useEffect(() => {
    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) * drag.scaleX;
      const dy = (e.clientY - drag.startY) * drag.scaleY;
      const nextBox = applyBoxDelta(
        drag.startBox,
        drag.handle,
        dx,
        dy,
        drag.pageWidth,
        drag.pageHeight
      );
      applyBoxToSchema(drag.path, nextBox);
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [applyBoxToSchema]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (placingPath) {
          setPlacingPath(null);
          return;
        }
        setSelectedPath(null);
        return;
      }
      if (!selectedPath) return;
      const field = listPlacementFields(schemaRef.current).find(
        (f) => f.path === selectedPath
      );
      if (!field?.box) return;
      const step = e.shiftKey ? 8 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      const nextBox = applyBoxDelta(
        field.box,
        'move',
        dx,
        dy,
        pageSize.width,
        pageSize.height
      );
      applyBoxToSchema(selectedPath, nextBox);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyBoxToSchema, placingPath, selectedPath, pageSize]);

  const startDrag = (event, field, handle) => {
    event.preventDefault();
    event.stopPropagation();
    const img = imgRef.current;
    if (!img || !field.box) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setSelectedPath(field.path);
    setPlacingPath(null);
    dragRef.current = {
      path: field.path,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startBox: { ...field.box },
      scaleX: img.naturalWidth / rect.width,
      scaleY: img.naturalHeight / rect.height,
      pageWidth: img.naturalWidth,
      pageHeight: img.naturalHeight,
    };
  };

  const handlePageClick = (event) => {
    if (!placingPath) return;
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const pt = clientPointToImageCoords(
      event.clientX,
      event.clientY,
      rect,
      img.naturalWidth,
      img.naturalHeight
    );
    if (!pt) return;
    updateSchema((next) => {
      placeFieldAtPoint(next, placingPath, {
        page: safePage,
        x: pt.x,
        y: pt.y,
      });
    });
    setSelectedPath(placingPath);
    setPlacingPath(null);
  };

  const handleAddField = () => {
    const added = updateSchema((next) =>
      addTemplateField(next, {
        key: newFieldName || 'Field',
        type: newFieldType,
      })
    );
    if (!added?.path) {
      setError('Could not add that field.');
      return;
    }
    setNewFieldName('');
    setSelectedPath(added.path);
    setPlacingPath(added.path);
  };

  const handleRename = (value) => {
    if (!selectedPath) return;
    const renamed = updateSchema((next) => renameFieldByPath(next, selectedPath, value));
    if (!renamed) {
      setError('That name is already used or reserved.');
      return;
    }
    setSelectedPath(renamed);
  };

  const handleTypeChange = (type) => {
    if (!selectedPath) return;
    updateSchema((next) => {
      setFieldMetaByPath(next, selectedPath, { type });
    });
  };

  const handleDescriptionChange = (description) => {
    if (!selectedPath) return;
    updateSchema((next) => {
      setFieldMetaByPath(next, selectedPath, { description });
    });
  };

  const handleRemove = (path) => {
    updateSchema((next) => {
      removeFieldByPath(next, path);
    });
    if (selectedPath === path) setSelectedPath(null);
    if (placingPath === path) setPlacingPath(null);
  };

  const handleConfirm = () => {
    const next = cloneTemplateData(schemaRef.current);
    if (pageCount === 0) {
      const ok = window.confirm(
        'No page image is loaded. Confirm placements without seeing the form?'
      );
      if (!ok) return;
    } else if (analyzeTemplatePositionQuality(next).synthetic) {
      const ok = window.confirm(
        'These boxes still line up in a single column, which usually means they were not measured from the page. Use them anyway?'
      );
      if (!ok) return;
    }
    markPlacementApproved(next);
    onApply(next);
  };

  const handleClose = () => {
    if (dirty && !window.confirm('Discard placement changes?')) return;
    onClose();
  };

  const onImgLoad = (event) => {
    const img = event.currentTarget;
    setPageSize({
      width: img.naturalWidth || 1224,
      height: img.naturalHeight || 1584,
    });
  };

  const pageLabel = pageCount > 0 ? `Page ${safePage + 1} of ${pageCount}` : 'No page image';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Place fields</h2>
            <p className="text-sm text-gray-600">
              Auto-detect is a starting draft. Drag boxes onto the blanks, then use these
              placements.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close placement editor"
          >
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 bg-gray-100 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-white flex-shrink-0">
              <button
                type="button"
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                disabled={safePage <= 0}
                className="p-1 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm text-gray-700">{pageLabel}</span>
              <button
                type="button"
                onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="p-1 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {pageCount === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-500">
                  Import the original form first so page images are available.
                </div>
              ) : (
                <div className="relative inline-block max-w-full">
                  <img
                    ref={imgRef}
                    src={images[safePage]}
                    alt=""
                    onLoad={onImgLoad}
                    onClick={handlePageClick}
                    className={`block max-w-full h-auto select-none ${
                      placingPath ? 'cursor-crosshair' : 'cursor-default'
                    }`}
                    draggable={false}
                  />
                  {pageFields.map((field) => {
                    const box = field.box;
                    const selectedHere = field.path === selectedPath;
                    return (
                      <div
                        key={field.path}
                        role="button"
                        tabIndex={0}
                        aria-label={field.path}
                        onPointerDown={(e) => startDrag(e, field, 'move')}
                        className={`absolute border-2 ${
                          selectedHere
                            ? 'border-indigo-600 bg-indigo-500/25'
                            : 'border-amber-500 bg-amber-400/30'
                        }`}
                        style={{
                          left: `${(box.x / pageSize.width) * 100}%`,
                          top: `${(box.y / pageSize.height) * 100}%`,
                          width: `${(box.width / pageSize.width) * 100}%`,
                          height: `${(box.height / pageSize.height) * 100}%`,
                          cursor: 'move',
                        }}
                      >
                        <span className="absolute -top-5 left-0 text-[10px] leading-4 px-1 rounded bg-white/90 text-gray-800 whitespace-nowrap max-w-[180px] truncate pointer-events-none">
                          {field.path.split('.').pop()}
                        </span>
                        {selectedHere &&
                          HANDLES.map((handle) => (
                            <span
                              key={handle}
                              onPointerDown={(e) => startDrag(e, field, handle)}
                              style={handleStyle(handle)}
                            />
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {placingPath && (
              <div className="px-3 py-2 text-sm bg-indigo-50 text-indigo-800 border-t flex items-center gap-2 flex-shrink-0">
                <MousePointerClick size={16} />
                Click the page to place {placingPath.split('.').pop()}.
              </div>
            )}
          </div>

          <div className="w-80 flex-shrink-0 border-l flex flex-col bg-white">
            <div className="p-3 border-b space-y-2">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Add field
              </div>
              <input
                type="text"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Field name"
                className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
              />
              <div className="flex gap-2">
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddField}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </div>

            {unplaced.length > 0 && (
              <div className="p-3 border-b bg-amber-50">
                <div className="text-xs font-medium text-amber-800 uppercase tracking-wide mb-1">
                  Unplaced ({unplaced.length})
                </div>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {unplaced.map((field) => (
                    <button
                      key={field.path}
                      type="button"
                      onClick={() => {
                        setSelectedPath(field.path);
                        setPlacingPath(field.path);
                      }}
                      className="block w-full text-left text-sm text-amber-900 hover:underline truncate"
                    >
                      {field.path}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Fields ({fields.length})
              </div>
              {fields.map((field) => (
                <button
                  key={field.path}
                  type="button"
                  onClick={() => {
                    setSelectedPath(field.path);
                    if (field.box) setPageIndex(field.box.page);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm truncate ${
                    field.path === selectedPath
                      ? 'bg-indigo-50 text-indigo-800'
                      : 'hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  {field.path}
                  {!field.box && (
                    <span className="ml-1 text-amber-600 text-xs">unplaced</span>
                  )}
                </button>
              ))}
            </div>

            {selected && (
              <div className="p-3 border-t space-y-2 bg-gray-50">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Selected
                </div>
                <label className="block text-xs text-gray-600">
                  Name
                  <input
                    type="text"
                    defaultValue={selected.path.split('.').pop()}
                    key={selected.path}
                    onBlur={(e) => handleRename(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleRename(e.currentTarget.value);
                      }
                    }}
                    className="mt-0.5 block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                  />
                </label>
                <label className="block text-xs text-gray-600">
                  Type
                  <select
                    value={selected.type}
                    onChange={(e) => handleTypeChange(e.target.value)}
                    className="mt-0.5 block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-gray-600">
                  Label
                  <input
                    type="text"
                    value={selected.description || ''}
                    onChange={(e) => handleDescriptionChange(e.target.value)}
                    className="mt-0.5 block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                  />
                </label>
                {!selected.box && (
                  <button
                    type="button"
                    onClick={() => setPlacingPath(selected.path)}
                    className="w-full px-2 py-1.5 text-sm text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100"
                  >
                    Click page to place
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(selected.path)}
                  className="inline-flex items-center gap-1 text-sm text-red-700 hover:text-red-900"
                >
                  <Trash2 size={14} />
                  Remove field
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t flex-shrink-0">
          <div className="text-sm text-gray-600">
            {error ? (
              <span className="text-red-700">{error}</span>
            ) : isPlacementApproved(schema) ? (
              'Placements already confirmed.'
            ) : (
              `${pageFields.length} on this page · ${unplaced.length} unplaced`
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            >
              <Check size={16} />
              Use these placements
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
