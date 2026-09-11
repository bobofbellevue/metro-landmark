import React from 'react';
import DateInput from './DateInput';
import WorkflowTimeInput from './WorkflowTimeInput';
import WorkflowFileField from './WorkflowFileField';
import CurrencyInput from './CurrencyInput';
import WorkflowDateInput from './WorkflowDateInput';
import NoticeLeasePicker from './compliance/NoticeLeasePicker.jsx';
import { stampLeaseSelection } from '../utils/workflow-lease-context.js';
import { workflowFieldShellClass, workflowFieldWidthClass } from '../utils/workflow-field.js';

/**
 * One compliance workflow field. Used by the generic step mapper and by
 * custom step renders that still need compact/inline/currency controls.
 */
export default function WorkflowField({
  field,
  workflowData = {},
  updateField,
  error = '',
  workflowId = null,
  userId = null,
  openWorkflows = [],
  onResumeWorkflow,
  workflowType,
  onLeaseSelected,
}) {
  if (!field?.id) return null;

  if (field.type === 'lease') {
    return (
      <NoticeLeasePicker
        value={workflowData[field.id] || null}
        error={error}
        statuses={field.statuses}
        showRent={field.showRent !== false}
        showDeposit={Boolean(field.showDeposit)}
        emptyMessage={field.emptyMessage}
        openWorkflows={openWorkflows}
        workflowId={workflowId}
        onResumeWorkflow={onResumeWorkflow}
        workflowType={workflowType}
        onSelect={(leaseId, selected) => {
          stampLeaseSelection(updateField, leaseId, selected);
          onLeaseSelected?.(leaseId, selected, updateField, workflowData);
        }}
      />
    );
  }

  const layout = field.layout === 'inline' ? 'inline' : 'stack';
  const shellClass =
    field.type === 'currency'
      ? workflowFieldWidthClass(field.width)
      : workflowFieldShellClass(field);
  const value = workflowData[field.id];
  const ownsLabel =
    field.type === 'currency' ||
    field.type === 'date' ||
    field.type === 'time' ||
    field.type === 'file';
  const controlClass = layout === 'inline' ? 'min-w-0 flex-1' : 'w-full';
  const borderClass = error ? 'border-red-300' : 'border-gray-300';

  const labelEl =
    !ownsLabel && field.label ? (
      <label
        className={`text-sm font-medium text-gray-700 ${
          layout === 'inline' ? 'whitespace-nowrap shrink-0 mb-0' : 'block mb-1'
        }`}
      >
        {field.label}
        {field.required ? <span className="text-red-500 ml-1">*</span> : null}
      </label>
    ) : null;

  let control = null;
  if (field.type === 'text') {
    control = (
      <input
        type="text"
        value={value || ''}
        onChange={(e) => updateField(field.id, e.target.value)}
        className={`${controlClass} px-3 py-2 border rounded-md ${borderClass}`}
        placeholder={field.placeholder}
      />
    );
  } else if (field.type === 'number') {
    control = (
      <input
        type="number"
        value={value || ''}
        onChange={(e) => updateField(field.id, parseFloat(e.target.value))}
        className={`${controlClass} px-3 py-2 border rounded-md ${borderClass}`}
        placeholder={field.placeholder}
      />
    );
  } else if (field.type === 'currency') {
    control = (
      <CurrencyInput
        label={field.label || ''}
        required={Boolean(field.required)}
        value={value}
        onChange={(next) => updateField(field.id, next)}
        inline={layout === 'inline'}
        className={error ? '[&_input]:border-red-300' : ''}
      />
    );
  } else if (field.type === 'date') {
    control = (
      <WorkflowDateInput
        label={field.label || ''}
        required={Boolean(field.required)}
        value={value || ''}
        onChange={(next) => updateField(field.id, next)}
        error={error}
        className={layout === 'inline' ? 'w-auto' : ''}
      />
    );
  } else if (field.type === 'time') {
    control = (
      <WorkflowTimeInput
        label={field.label || ''}
        required={Boolean(field.required)}
        value={value || ''}
        onChange={(next) => updateField(field.id, next)}
        error={error}
      />
    );
  } else if (field.type === 'select') {
    control = (
      <select
        value={value || ''}
        onChange={(e) => updateField(field.id, e.target.value)}
        className={`${controlClass} px-3 py-2 border rounded-md ${borderClass}`}
      >
        {field.includeEmpty === false ? null : <option value="">Select...</option>}
        {(field.options || []).map((option) => (
          <option key={option.value || option} value={option.value || option}>
            {option.label || option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'textarea') {
    control = (
      <textarea
        value={value || ''}
        onChange={(e) => updateField(field.id, e.target.value)}
        rows={field.rows || 4}
        className={`${controlClass} px-3 py-2 border rounded-md ${borderClass}`}
        placeholder={field.placeholder}
      />
    );
  } else if (field.type === 'file') {
    control = (
      <WorkflowFileField
        value={value || null}
        onChange={(fileMeta) => updateField(field.id, fileMeta)}
        error={error}
        leaseId={workflowData.lease_id}
        propertyId={workflowData.property_id}
        unitId={workflowData.unit_id}
        workflowId={workflowId}
        userId={userId}
        documentType={field.documentType}
        acceptedTypes={field.acceptedTypes}
        description={field.description}
      />
    );
  } else {
    control = (
      <DateInput
        label=""
        value={value || ''}
        onChange={(e) => updateField(field.id, e.target.value || null)}
        className={error ? 'border-red-300' : ''}
      />
    );
  }

  const showFieldError = Boolean(error) && field.type !== 'file' && field.type !== 'date' && field.type !== 'time';
  const showDescription = Boolean(field.description) && field.type !== 'file';

  return (
    <div className={shellClass}>
      {labelEl}
      <div className={layout === 'inline' && !ownsLabel ? 'min-w-0 flex-1' : undefined}>
        {control}
        {showFieldError ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
        {showDescription ? (
          <p className="mt-1 text-xs text-gray-500">{field.description}</p>
        ) : null}
      </div>
    </div>
  );
}
