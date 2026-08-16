import React, { useState, useEffect } from 'react';
import { AlertCircle, Calendar, CheckCircle } from 'lucide-react';
import { calculateNoticePeriod } from '../utils/compliance-calculator';
import {
  detectJurisdictionFromPropertyId,
  getJurisdictionDisplayName,
} from '../utils/jurisdiction-detector';
import {
  calendarDaysUntil,
  formatWorkflowDateForLocale,
  isCompleteWorkflowDate,
  toWorkflowDateString,
} from '../utils/workflow-date.js';

/**
 * NoticePeriodCalculator - Calculates required notice periods for compliance workflows
 * 
 * @param {string} workflowType - Type of workflow (rent_increase, eviction, etc.)
 * @param {string} leaseType - 'month_to_month' or 'fixed_term'
 * @param {number} propertyId - Property ID for jurisdiction detection
 * @param {string} jurisdiction - Override jurisdiction (optional)
 * @param {Object} context - Additional context (currentRent, newRent, effectiveDate, etc.)
 * @param {Function} onCalculationChange - Callback when calculation changes
 */
export default function NoticePeriodCalculator({
  workflowType,
  leaseType,
  propertyId,
  jurisdiction: overrideJurisdiction,
  context = {},
  onCalculationChange
}) {
  const [calculation, setCalculation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [jurisdiction, setJurisdiction] = useState(overrideJurisdiction);

  const effectiveDateReady = isCompleteWorkflowDate(context.effectiveDate);
  const effectiveDateKey = effectiveDateReady ? context.effectiveDate : null;

  useEffect(() => {
    if (workflowType && leaseType) {
      calculateNotice();
    }
  }, [
    workflowType,
    leaseType,
    propertyId,
    overrideJurisdiction,
    effectiveDateKey,
    context.currentRent,
    context.newRent,
  ]);

  useEffect(() => {
    if (!overrideJurisdiction && propertyId) {
      detectJurisdictionFromPropertyId(propertyId).then(setJurisdiction);
    } else {
      setJurisdiction(overrideJurisdiction);
    }
  }, [propertyId, overrideJurisdiction]);

  useEffect(() => {
    if (calculation && onCalculationChange) {
      onCalculationChange(calculation);
    }
  }, [calculation]);

  const calculateNotice = async () => {
    if (!workflowType || !leaseType) return;

    setIsLoading(true);
    setError(null);

    try {
      const safeContext = {
        ...context,
        // Avoid calculating against partial years while the user is still typing.
        effectiveDate: effectiveDateKey,
      };

      const result = await calculateNoticePeriod({
        workflowType,
        leaseType,
        propertyId,
        jurisdiction,
        context: safeContext
      });

      setCalculation(result);
    } catch (err) {
      console.error('Error calculating notice period:', err);
      setError(err.message || 'Failed to calculate notice period');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="animate-pulse flex items-center gap-2">
          <div className="h-4 w-4 bg-gray-300 rounded"></div>
          <span className="text-sm text-gray-600">Calculating notice period...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-red-800">Calculation Error</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!calculation) {
    return null;
  }

  const {
    noticePeriodDays,
    requiredNoticeDate,
    effectiveDate,
    jurisdiction: calcJurisdiction,
    citations = [],
    evaluation,
  } = calculation;
  const requiredNoticeIso = toWorkflowDateString(requiredNoticeDate);
  const effectiveIso = toWorkflowDateString(effectiveDate);
  const displayLocale =
    typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  const requiredNoticeLabel = requiredNoticeIso
    ? formatWorkflowDateForLocale(requiredNoticeIso, displayLocale)
    : '';
  const effectiveLabel = effectiveIso
    ? formatWorkflowDateForLocale(effectiveIso, displayLocale)
    : '';
  const daysUntilNotice = requiredNoticeIso ? calendarDaysUntil(requiredNoticeIso) : null;
  const isNoticeDatePast = daysUntilNotice != null && daysUntilNotice < 0;
  const unitLabel = workflowType === 'entry' || workflowType === 'entry_notice' ? 'hours' : 'days';

  return (
    <div className="space-y-4">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <Calendar className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Notice Period Requirements</h4>
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-blue-700">Required Notice Period:</span>
                <span className="font-semibold text-blue-900">{noticePeriodDays} {unitLabel}</span>
              </div>
              {calcJurisdiction && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-blue-700">Jurisdiction pack:</span>
                  <span className="font-semibold text-blue-900">
                    {getJurisdictionDisplayName(calcJurisdiction)}
                  </span>
                </div>
              )}
              {leaseType && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-blue-700">Lease Type:</span>
                  <span className="font-semibold text-blue-900">
                    {leaseType === 'month_to_month' ? 'Month-to-Month' : 'Fixed-Term'}
                  </span>
                </div>
              )}
              {citations.length > 0 && (
                <div className="pt-1">
                  <span className="text-blue-700">Citations: </span>
                  <span className="text-blue-900">
                    {citations.map((cite, index) => (
                      <span key={cite.id}>
                        {index > 0 && ', '}
                        {cite.href ? (
                          <a
                            href={cite.href}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            {cite.id}
                          </a>
                        ) : (
                          cite.id
                        )}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <p className="text-xs text-blue-800 pt-1">
                Pack-dependent reference math — not a substitute for legal counsel.
              </p>
            </div>
          </div>
        </div>
      </div>

      {evaluation?.exceedsCap && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          Proposed increase {evaluation.percentIncrease?.toFixed(1)}% exceeds the{' '}
          {evaluation.maxIncreasePercent}% pack cap for this year (RCW 59.18.700).
        </div>
      )}
      {evaluation?.firstTwelveMonthsBlocked && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
          Pack rule: no rent increase during the first 12 months of the tenancy.
        </div>
      )}
      {evaluation?.excludeDayOfService && (
        <p className="text-xs text-blue-800">
          Latest serve date counts a full notice period that does not include the
          day of service (Seattle housing-cost example: June 1 increase → served
          by December 2).
        </p>
      )}

      {requiredNoticeDate && (
        <div className={`p-4 border rounded-lg ${
          isNoticeDatePast 
            ? 'bg-red-50 border-red-200' 
            : daysUntilNotice !== null && daysUntilNotice <= 7
            ? 'bg-yellow-50 border-yellow-200'
            : 'bg-green-50 border-green-200'
        }`}>
          <div className="flex items-start gap-3">
            {isNoticeDatePast ? (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            ) : daysUntilNotice !== null && daysUntilNotice <= 7 ? (
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h4 className={`text-sm font-semibold mb-2 ${
                isNoticeDatePast 
                  ? 'text-red-900' 
                  : daysUntilNotice !== null && daysUntilNotice <= 7
                  ? 'text-yellow-900'
                  : 'text-green-900'
              }`}>
                Required Notice Date
              </h4>
              <p className={`text-sm ${
                isNoticeDatePast 
                  ? 'text-red-800' 
                  : daysUntilNotice !== null && daysUntilNotice <= 7
                  ? 'text-yellow-800'
                  : 'text-green-800'
              }`}>
                Notice must be served by: <strong>{requiredNoticeLabel}</strong>
              </p>
              {isNoticeDatePast && (
                <p className="text-xs text-red-700 mt-2">
                  ⚠️ Warning: The required notice date is in the past. You may need to adjust the effective date.
                </p>
              )}
              {!isNoticeDatePast && daysUntilNotice !== null && daysUntilNotice <= 7 && (
                <p className="text-xs text-yellow-700 mt-2">
                  ⚠️ Notice date is approaching. Ensure notice is served on time.
                </p>
              )}
              {effectiveLabel && (
                <p className="text-xs text-gray-600 mt-2">
                  Effective date: {effectiveLabel}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {calculation.rules && calculation.rules.length > 0 && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-xs text-gray-600">
            <strong>Applicable Rules:</strong> {calculation.rules.map(r => r.rule_name).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

