/**
 * Jurisdiction pack registry (Workstream 2).
 *
 * Packs encapsulate display names, city matchers, statute metadata, and
 * compliance rule numbers. Detection and calculators should go through here
 * instead of hard-coding "seattle" / "washington_state" branches.
 */
import { washingtonStatePack } from './packs/washington_state.js';
import { seattlePack } from './packs/seattle.js';

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

/**
 * Deep-ish merge of parent pack rules under a child pack (child wins).
 * @param {string} packId
 * @returns {object} pack with resolvedRules
 */
export function getResolvedJurisdictionPack(packId) {
  const pack = getJurisdictionPack(packId);
  if (!pack.parentPackId) {
    return { ...pack, resolvedRules: { ...pack.rules } };
  }
  const parent = getResolvedJurisdictionPack(pack.parentPackId);
  return {
    ...pack,
    resolvedRules: {
      ...parent.resolvedRules,
      ...pack.rules,
      rentIncrease: { ...parent.resolvedRules.rentIncrease, ...pack.rules.rentIncrease },
      termination: { ...parent.resolvedRules.termination, ...pack.rules.termination },
      evictionNoticeDays: {
        ...parent.resolvedRules.evictionNoticeDays,
        ...pack.rules.evictionNoticeDays,
      },
      rentControl: { ...parent.resolvedRules.rentControl, ...pack.rules.rentControl },
    },
  };
}

export function getJurisdictionDisplayName(packId) {
  return getJurisdictionPack(packId).displayName;
}

/** Whether the resolved pack enables rent-control overlays. */
export function isRentControlEnabled(packId) {
  return !!getResolvedJurisdictionPack(packId).resolvedRules.rentControl?.enabled;
}

/** Whether no-cause month-to-month landlord terminations require just cause. */
export function requiresJustCauseForNoCauseTermination(packId) {
  return !!getResolvedJurisdictionPack(packId).resolvedRules.termination
    ?.requiresJustCauseForNoCauseMonthToMonth;
}
