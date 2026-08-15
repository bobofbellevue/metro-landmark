/**
 * Jurisdiction pack registry (Workstream 2).
 *
 * Packs encapsulate display names, city matchers, statute metadata, and
 * compliance rule numbers. Detection and calculators should go through here
 * instead of hard-coding "seattle" / "washington_state" branches.
 */
import { washingtonStatePack } from './packs/washington_state.js';
import { seattlePack } from './packs/seattle.js';
import {
  mergeStatuteRefIds,
  resolveStatuteRefs,
} from './statute-catalog.js';

const PACKS = Object.freeze({
  [washingtonStatePack.id]: washingtonStatePack,
  [seattlePack.id]: seattlePack,
});

/** Default pack when nothing matches (reference deployment: WA). */
export const DEFAULT_JURISDICTION_PACK_ID = 'washington_state';

export function listJurisdictionPacks() {
  return Object.values(PACKS);
}

export function getJurisdictionPack(packId) {
  if (packId && PACKS[packId]) return PACKS[packId];
  return PACKS[DEFAULT_JURISDICTION_PACK_ID];
}

/**
 * Resolve pack id from property fields (city_of_jurisdiction / address.city / city).
 * @param {Object|null|undefined} property
 * @returns {string} pack id
 */
export function detectJurisdictionPackId(property) {
  if (!property) return DEFAULT_JURISDICTION_PACK_ID;

  const cityCandidates = [
    property.city_of_jurisdiction,
    property.address?.city,
    property.city,
  ]
    .filter(Boolean)
    .map((c) => String(c).toLowerCase().trim());

  for (const city of cityCandidates) {
    for (const pack of listJurisdictionPacks()) {
      if (pack.cityMatchers?.some((m) => m === city)) {
        return pack.id;
      }
    }
  }

  return DEFAULT_JURISDICTION_PACK_ID;
}

function mergeRuleSection(parentSection, childSection) {
  if (!parentSection && !childSection) return undefined;
  return { ...(parentSection || {}), ...(childSection || {}) };
}

/**
 * Deep-ish merge of parent pack rules under a child pack (child wins).
 * @param {string} packId
 * @returns {object} pack with resolvedRules and resolvedStatuteRefs
 */
export function getResolvedJurisdictionPack(packId) {
  const pack = getJurisdictionPack(packId);
  if (!pack.parentPackId) {
    return {
      ...pack,
      resolvedRules: { ...pack.rules },
      resolvedStatuteRefs: resolveStatuteRefs(pack.statuteRefIds),
    };
  }
  const parent = getResolvedJurisdictionPack(pack.parentPackId);
  return {
    ...pack,
    resolvedRules: {
      ...parent.resolvedRules,
      ...pack.rules,
      rentIncrease: mergeRuleSection(
        parent.resolvedRules.rentIncrease,
        pack.rules.rentIncrease
      ),
      termination: mergeRuleSection(
        parent.resolvedRules.termination,
        pack.rules.termination
      ),
      evictionNoticeDays: mergeRuleSection(
        parent.resolvedRules.evictionNoticeDays,
        pack.rules.evictionNoticeDays
      ),
      rentControl: mergeRuleSection(
        parent.resolvedRules.rentControl,
        pack.rules.rentControl
      ),
      screening: mergeRuleSection(
        parent.resolvedRules.screening,
        pack.rules.screening
      ),
    },
    resolvedStatuteRefs: resolveStatuteRefs(
      mergeStatuteRefIds(parent.statuteRefIds, pack.statuteRefIds)
    ),
  };
}

export function getJurisdictionDisplayName(packId) {
  return getJurisdictionPack(packId).displayName;
}

/** Whether the resolved pack enables rent-control / rent-cap overlays. */
export function isRentControlEnabled(packId) {
  return !!getResolvedJurisdictionPack(packId).resolvedRules.rentControl?.enabled;
}

/** Whether no-cause month-to-month landlord terminations require just cause. */
export function requiresJustCauseForNoCauseTermination(packId) {
  return !!getResolvedJurisdictionPack(packId).resolvedRules.termination
    ?.requiresJustCauseForNoCauseMonthToMonth;
}

/** Seattle-style overlay: must offer renewal unless just cause for non-renewal. */
export function requiresRenewalOffer(packId) {
  return !!getResolvedJurisdictionPack(packId).resolvedRules.termination
    ?.requiresRenewalOffer;
}

/**
 * Commerce-published (or pack default) max annual rent-increase percent.
 * @param {string} packId
 * @param {number} [year]
 * @returns {number|null}
 */
export function getMaxRentIncreasePercent(packId, year = new Date().getFullYear()) {
  const rentControl = getResolvedJurisdictionPack(packId).resolvedRules.rentControl;
  if (!rentControl?.enabled) return null;
  const byYear = rentControl.annualMaxIncreasePercentByYear || {};
  const keyed = byYear[year] ?? byYear[String(year)];
  if (keyed != null) return Number(keyed);
  if (rentControl.defaultMaxIncreasePercent != null) {
    return Number(rentControl.defaultMaxIncreasePercent);
  }
  return null;
}

/**
 * Resolve citation objects for a rule section (falls back to pack statute list).
 * @param {string} packId
 * @param {string} [section] rentIncrease | termination | eviction | deposit | entry | rentControl | screening
 */
export function getRuleCitations(packId, section) {
  const resolved = getResolvedJurisdictionPack(packId);
  const rules = resolved.resolvedRules || {};
  const sectionIds = {
    rentIncrease: rules.rentIncrease?.citationIds,
    termination: rules.termination?.citationIds,
    eviction: rules.evictionCitationIds,
    deposit: rules.depositCitationIds,
    entry: rules.entryCitationIds,
    rentControl: rules.rentControl?.citationIds,
    screening: rules.screening?.citationIds,
  }[section];
  if (sectionIds?.length) return resolveStatuteRefs(sectionIds);
  return resolved.resolvedStatuteRefs || [];
}

export { resolveStatuteRefs } from './statute-catalog.js';
