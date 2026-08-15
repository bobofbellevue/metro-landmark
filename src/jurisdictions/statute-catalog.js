/**
 * Shared statute / municipal-code catalog for jurisdiction packs.
 * Labels are operator-facing; hrefs point at official text where available.
 * Not a substitute for legal counsel.
 */
export const STATUTE_CATALOG = Object.freeze({
  RCW_59_18: {
    id: 'RCW_59.18',
    label: 'RCW 59.18 (Residential Landlord-Tenant Act)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18',
  },
  RCW_59_18_140: {
    id: 'RCW_59.18.140',
    label: 'RCW 59.18.140 (rent-increase notice)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.140',
  },
  RCW_59_18_150: {
    id: 'RCW_59.18.150',
    label: 'RCW 59.18.150 (landlord entry)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.150',
  },
  RCW_59_18_200: {
    id: 'RCW_59.18.200',
    label: 'RCW 59.18.200 (tenant end of periodic tenancy)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.200',
  },
  RCW_59_18_280: {
    id: 'RCW_59.18.280',
    label: 'RCW 59.18.280 (security deposit statement and refund)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.280',
  },
  RCW_59_18_650: {
    id: 'RCW_59.18.650',
    label: 'RCW 59.18.650 (just cause / ending a tenancy)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.650',
  },
  RCW_59_18_700: {
    id: 'RCW_59.18.700',
    label: 'RCW 59.18.700 (rent-increase cap)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.700',
  },
  RCW_59_12_030: {
    id: 'RCW_59.12.030',
    label: 'RCW 59.12.030 (unlawful detainer)',
    href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.12.030',
  },
  SMC_22_206: {
    id: 'SMC_22.206',
    label: 'SMC Title 22 (Housing)',
    href: 'https://library.municode.com/wa/seattle/codes/municipal_code?nodeId=TIT22HOBUCO',
  },
  SMC_22_206_160: {
    id: 'SMC_22.206.160',
    label: 'SMC 22.206.160 (Seattle just-cause eviction)',
    href: 'https://library.municode.com/wa/seattle/codes/municipal_code?nodeId=TIT22HOBUCO',
  },
  SMC_14_09: {
    id: 'SMC_14.09',
    label: 'SMC 14.09 (use of criminal history in tenant screening)',
    href: 'https://library.municode.com/wa/seattle/codes/municipal_code?nodeId=TIT14HURI',
  },
});

/**
 * @param {string[]|null|undefined} ids catalog keys or dotted ids (RCW_59.18.140)
 * @returns {Array<{id: string, label: string, href?: string}>}
 */
export function resolveStatuteRefs(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const byId = new Map(
    Object.values(STATUTE_CATALOG).map((entry) => [entry.id, entry])
  );
  const seen = new Set();
  const resolved = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    const entry = byId.get(id);
    if (entry) {
      seen.add(id);
      resolved.push({ ...entry });
    }
  }
  return resolved;
}

/**
 * Merge parent then child citation lists, child-first uniqueness by id.
 * @param {string[]|null|undefined} parentIds
 * @param {string[]|null|undefined} childIds
 */
export function mergeStatuteRefIds(parentIds, childIds) {
  const merged = [];
  const seen = new Set();
  for (const id of [...(parentIds || []), ...(childIds || [])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}
