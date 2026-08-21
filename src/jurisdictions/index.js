/**
 * Jurisdiction pack registry (Workstream 2).
 *
 * Packs encapsulate display names, city matchers, statute metadata, and
 * compliance rule numbers. Detection and calculators should go through here
 * instead of hard-coding city / "washington_state" branches.
 */
import { washingtonStatePack } from './packs/washington_state.js';
import { seattlePack } from './packs/seattle.js';
import { tacomaPack } from './packs/tacoma.js';
import { bellinghamPack } from './packs/bellingham.js';
import { olympiaPack } from './packs/olympia.js';
import { federalWayPack } from './packs/federal_way.js';
import {
  mergeStatuteRefIds,
  resolveStatuteRefs,
} from './statute-catalog.js';

const PACKS = Object.freeze({
  [washingtonStatePack.id]: washingtonStatePack,
  [seattlePack.id]: seattlePack,
  [tacomaPack.id]: tacomaPack,
  [bellinghamPack.id]: bellinghamPack,
  [olympiaPack.id]: olympiaPack,
  [federalWayPack.id]: federalWayPack,
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
    preferredLandlordAssociation:
      pack.preferredLandlordAssociation ||
      parent.preferredLandlordAssociation ||
      null,
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
      noticeService: mergeRuleSection(
        parent.resolvedRules.noticeService,
        pack.rules.noticeService
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
    noticeService: rules.noticeService?.citationIds,
  }[section];
  if (sectionIds?.length) return resolveStatuteRefs(sectionIds);
  return resolved.resolvedStatuteRefs || [];
}

export { resolveStatuteRefs } from './statute-catalog.js';

export const DEFAULT_NOTICE_SERVICE_METHODS = Object.freeze([
  { id: 'in_person', label: 'In Person', needsPrint: true },
  { id: 'first_class_mail', label: 'First Class Mail', needsPrint: true },
  { id: 'certified_mail', label: 'Certified Mail', needsPrint: true },
  { id: 'posting', label: 'Posting on Door', needsPrint: true },
  {
    id: 'posting_and_first_class_mail',
    label: 'Posting and First Class Mail',
    needsPrint: true,
    compound: true,
  },
  { id: 'email', label: 'Email', needsPrint: false },
  { id: 'other', label: 'Other (describe in notes)', needsPrint: true },
]);

/**
 * Pack-configured service methods (falls back to the default WA list).
 * @param {string} packId
 * @returns {Array<{ id: string, label: string, needsPrint?: boolean, compound?: boolean }>}
 */
export function getNoticeServiceMethods(packId) {
  const methods =
    getResolvedJurisdictionPack(packId).resolvedRules.noticeService?.methods;
  if (Array.isArray(methods) && methods.length > 0) return methods;
  return DEFAULT_NOTICE_SERVICE_METHODS;
}

/**
 * Official form URLs and required local language for a rent-increase notice.
 * @param {string} packId
 * @returns {{ officialFormUrls: Array<{label: string, href: string}>, requiredNoticeLanguage: string[], excludeDayOfService: boolean, serviceNotes: string|null, preferredMethodIds: string[] }}
 */
export function getRentIncreaseNoticeResources(packId) {
  const resolved = getResolvedJurisdictionPack(packId);
  const rent = resolved.resolvedRules.rentIncrease || {};
  const service = resolved.resolvedRules.noticeService || {};
  const packUrls = Array.isArray(resolved.sourceUrls) ? resolved.sourceUrls : [];
  const formUrls = Array.isArray(rent.officialFormUrls) ? rent.officialFormUrls : [];
  const seen = new Set();
  const officialFormUrls = [];
  for (const entry of [...formUrls, ...packUrls]) {
    const href = entry?.href;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    officialFormUrls.push({
      label: entry.label || href,
      href,
    });
  }
  return {
    officialFormUrls,
    requiredNoticeLanguage: Array.isArray(rent.requiredNoticeLanguage)
      ? rent.requiredNoticeLanguage
      : [],
    excludeDayOfService: !!rent.excludeDayOfService,
    serviceNotes: service.notes || null,
    preferredMethodIds: Array.isArray(service.preferredMethodIds)
      ? service.preferredMethodIds
      : [],
    preferredLandlordAssociation: resolved.preferredLandlordAssociation || null,
  };
}
