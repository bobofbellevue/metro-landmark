/* eslint-env node */
/**
 * Vacancy listings / syndication export (roadmap E5).
 *
 * GET  /api/listings           vacancies + listing state
 * GET  /api/listings?format=xml|csv   vacancies as a feed
 * PUT  /api/listings           opt-in / update a listing
 */
import { createSupabaseClient } from './utils/supabase-client.js';
import {
  isCompleteWorkflowDate,
  todayWorkflowDate,
  toWorkflowDateString,
} from '../src/utils/workflow-date.js';
import {
  canEditListings,
  canViewListings,
  filterListingsBySearch,
  formatListingLandlordName,
  formatListingManagerName,
  lastRentByUnit,
  listingsToCsv,
  listingsToZillowXml,
  missingClientUnitsTable,
  missingListingsTable,
  occupiedUnitIds,
  parseAskingRent,
  publicListing,
  unitsAssignedWithoutLease,
  validateListingWrite,
} from '../src/utils/listings.js';

export function parseUserIdHeader(headers = {}) {
  const n = parseInt(headers['x-user-id'], 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function loadUser(supabase, userId) {
  const { data, error } = await supabase
    .from('users')
    .select('user_id, pmc_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function landlordIdForUser(supabase, userId) {
  const { data } = await supabase
    .from('landlords')
    .select('landlord_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.landlord_id ?? null;
}

function propertyAccessible(user, property, landlordId) {
  if (user.role === 'global_admin') return true;
  if (user.role === 'landlord') {
    return landlordId != null && Number(property?.landlord_id) === Number(landlordId);
  }
  if (user.pmc_id && property?.pmc_id && Number(property.pmc_id) !== Number(user.pmc_id)) {
    return false;
  }
  if (user.pmc_id && !property?.pmc_id) return false;
  return Boolean(user.pmc_id);
}

async function loadVacancies(supabase, user) {
  const landlordId =
    user.role === 'landlord' ? await landlordIdForUser(supabase, user.user_id) : null;
  if (user.role === 'landlord' && !landlordId) return [];

  let propertyQuery = supabase
    .from('properties')
    .select('property_id, property_name, property_type, pmc_id, landlord_id, manager_id')
    .eq('is_archived', false);
  if (user.role === 'landlord') {
    propertyQuery = propertyQuery.eq('landlord_id', landlordId);
  } else if (user.role !== 'global_admin') {
    if (!user.pmc_id) return [];
    propertyQuery = propertyQuery.eq('pmc_id', user.pmc_id);
  }
  const { data: properties, error: propertyError } = await propertyQuery;
  if (propertyError) throw propertyError;
  const propertyList = (properties || []).filter((p) => propertyAccessible(user, p, landlordId));
  const propertyIds = propertyList.map((p) => p.property_id);
  if (propertyIds.length === 0) return [];
  const propertyById = new Map(propertyList.map((p) => [p.property_id, p]));

  const { data: units, error: unitError } = await supabase
    .from('units')
    .select('unit_id, property_id, unit_number, beds, baths, square_footage')
    .eq('is_archived', false)
    .in('property_id', propertyIds);
  if (unitError) throw unitError;
  const unitList = units || [];
  if (unitList.length === 0) return [];
  const unitIds = unitList.map((u) => u.unit_id);

  const { data: leases, error: leaseError } = await supabase
    .from('leases')
    .select('lease_id, unit_id, status, monthly_rent_amount, start_date')
    .eq('is_archived', false)
    .in('unit_id', unitIds);
  if (leaseError) throw leaseError;
  const occupied = occupiedUnitIds(leases || []);

  let assignments = [];
  const { data: assignmentData, error: assignmentError } = await supabase
    .from('client_units')
    .select('unit_id, lease_id, end_date, vacated_at, is_archived')
    .eq('is_archived', false)
    .in('unit_id', unitIds);
  if (assignmentError && !missingClientUnitsTable(assignmentError)) throw assignmentError;
  if (!assignmentError) assignments = assignmentData || [];
  for (const id of unitsAssignedWithoutLease(assignments, todayWorkflowDate())) {
    occupied.add(id);
  }

  const vacantUnits = unitList.filter((u) => !occupied.has(Number(u.unit_id)));
  if (vacantUnits.length === 0) return [];

  const vacantIds = vacantUnits.map((u) => u.unit_id);
  const rents = lastRentByUnit(leases || []);

  let listingRows = [];
  const { data: listingData, error: listingError } = await supabase
    .from('listings')
    .select('listing_id, unit_id, listed, asking_rent, available_on, description')
    .in('unit_id', vacantIds);
  if (listingError && !missingListingsTable(listingError)) throw listingError;
  if (!listingError) listingRows = listingData || [];
  const listingByUnit = new Map(listingRows.map((row) => [Number(row.unit_id), row]));

  const { data: addresses } = await supabase
    .from('addresses')
    .select(
      'addressable_id, address_line_1, address_line_2, city, state_province_region, postal_code'
    )
    .eq('addressable_type', 'property')
    .in('addressable_id', propertyIds);
  const addressByProperty = new Map(
    (addresses || []).map((row) => [Number(row.addressable_id), row])
  );

  const landlordIds = [
    ...new Set(propertyList.map((p) => p.landlord_id).filter(Boolean)),
  ];
  const pmcIds = [...new Set(propertyList.map((p) => p.pmc_id).filter(Boolean))];
  const managerIds = [
    ...new Set(propertyList.map((p) => p.manager_id).filter(Boolean)),
  ];

  const landlordNames = new Map();
  if (landlordIds.length > 0) {
    const { data: landlordContacts } = await supabase
      .from('contacts')
      .select('contactable_id, first_name, middle_name, last_name')
      .eq('contactable_type', 'landlord')
      .in('contactable_id', landlordIds);
    for (const contact of landlordContacts || []) {
      landlordNames.set(Number(contact.contactable_id), formatListingLandlordName(contact));
    }
  }

  const pmcNames = new Map();
  if (pmcIds.length > 0) {
    const { data: companies } = await supabase
      .from('pm_companies')
      .select('pmc_id, company_name')
      .in('pmc_id', pmcIds);
    for (const company of companies || []) {
      pmcNames.set(Number(company.pmc_id), company.company_name || '');
    }
  }

  const managerNames = new Map();
  if (managerIds.length > 0) {
    const { data: managerContacts } = await supabase
      .from('contacts')
      .select('contactable_id, first_name, middle_name, last_name')
      .eq('contactable_type', 'user')
      .in('contactable_id', managerIds);
    for (const contact of managerContacts || []) {
      managerNames.set(Number(contact.contactable_id), formatListingManagerName(contact));
    }
  }

  return vacantUnits.map((unit) => {
    const property = propertyById.get(unit.property_id) || {};
    const address = addressByProperty.get(Number(unit.property_id)) || {};
    const listing = listingByUnit.get(Number(unit.unit_id)) || {};
    const lastRent = rents.get(Number(unit.unit_id)) ?? null;
    return publicListing({
      unitId: unit.unit_id,
      propertyId: unit.property_id,
      propertyName: property.property_name,
      unitNumber: unit.unit_number,
      addressLine1: address.address_line_1,
      addressLine2: address.address_line_2,
      city: address.city,
      state: address.state_province_region,
      postalCode: address.postal_code,
      beds: unit.beds,
      baths: unit.baths,
      squareFootage: unit.square_footage,
      propertyType: property.property_type,
      lastRent,
      askingRent: listing.asking_rent != null ? Number(listing.asking_rent) : null,
      availableOn: listing.available_on || null,
      description: listing.description || '',
      listed: Boolean(listing.listed),
      hasListing: Boolean(listing.listing_id),
      landlordId: property.landlord_id ?? null,
      landlordName: landlordNames.get(Number(property.landlord_id)) || '',
      pmcId: property.pmc_id ?? null,
      pmcName: pmcNames.get(Number(property.pmc_id)) || '',
      managerId: property.manager_id ?? null,
      managerName: managerNames.get(Number(property.manager_id)) || '',
    });
  });
}

function sendFeed(res, format, rows) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="listings.csv"');
    res.status(200).send(listingsToCsv(rows));
    return;
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="listings.xml"');
  res.status(200).send(listingsToZillowXml(rows));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-user-id, x-user-role'
  );
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Database configuration error',
    });
    return;
  }

  try {
    const userId = parseUserIdHeader(req.headers);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const user = await loadUser(supabase, userId);
    if (!user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    if (!canViewListings(user.role)) {
      res.status(403).json({ success: false, error: 'Not allowed.' });
      return;
    }

    if (req.method === 'GET') {
      const vacancies = await loadVacancies(supabase, user);
      const format = String(req.query?.format || '').trim().toLowerCase();
      if (format === 'xml' || format === 'csv') {
        sendFeed(res, format, vacancies);
        return;
      }
      const search = String(req.query?.q || '');
      res.status(200).json({
        success: true,
        listings: filterListingsBySearch(vacancies, search),
        canEdit: canEditListings(user.role),
      });
      return;
    }

    if (!canEditListings(user.role)) {
      res.status(403).json({ success: false, error: 'Not allowed.' });
      return;
    }

    if (req.method === 'DELETE') {
      const vacancies = await loadVacancies(supabase, user);
      const unitId = Number(
        req.query?.unitId ?? req.query?.unit_id ?? req.body?.unitId ?? req.body?.unit_id
      );
      const vacancy = vacancies.find((row) => Number(row.unitId) === unitId);
      if (!vacancy) {
        res.status(400).json({ success: false, error: 'That unit is not a vacancy you can list.' });
        return;
      }
      const { error: deleteError } = await supabase.from('listings').delete().eq('unit_id', unitId);
      if (deleteError && !missingListingsTable(deleteError)) {
        res.status(500).json({
          success: false,
          error: deleteError.message || 'Could not delete listing.',
        });
        return;
      }
      const updated = await loadVacancies(supabase, user);
      res.status(200).json({
        success: true,
        listings: updated,
        canEdit: true,
      });
      return;
    }

    const body = req.body || {};
    const vacancies = await loadVacancies(supabase, user);
    const unitId = Number(body.unitId ?? body.unit_id);
    const vacancy = vacancies.find((row) => Number(row.unitId) === unitId);
    if (!vacancy) {
      res.status(400).json({ success: false, error: 'That unit is not a vacancy you can list.' });
      return;
    }

    let availableOn = body.availableOn ?? body.available_on ?? null;
    if (availableOn) {
      if (!isCompleteWorkflowDate(availableOn)) {
        res.status(400).json({ success: false, error: 'Available date is not valid.' });
        return;
      }
      availableOn = toWorkflowDateString(availableOn);
    } else {
      availableOn = null;
    }

    const askingRent =
      parseAskingRent(body.askingRent ?? body.asking_rent) ?? vacancy.lastRent;
    const parsed = validateListingWrite({
      unitId,
      listed: body.listed,
      askingRent,
      availableOn,
      description: body.description,
    });
    if (!parsed.ok) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }

    const property = (
      await supabase
        .from('units')
        .select('property_id')
        .eq('unit_id', parsed.value.unitId)
        .maybeSingle()
    ).data;
    const pmcId = property?.property_id
      ? (
          await supabase
            .from('properties')
            .select('pmc_id')
            .eq('property_id', property.property_id)
            .maybeSingle()
        ).data?.pmc_id
      : user.pmc_id;

    const row = {
      unit_id: parsed.value.unitId,
      pmc_id: pmcId || null,
      listed: parsed.value.listed,
      asking_rent: parsed.value.askingRent,
      available_on: parsed.value.availableOn,
      description: parsed.value.description,
      updated_by: user.user_id,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('listings')
      .select('listing_id')
      .eq('unit_id', parsed.value.unitId)
      .maybeSingle();

    let writeError = null;
    if (existing?.listing_id) {
      const { error } = await supabase.from('listings').update(row).eq('listing_id', existing.listing_id);
      writeError = error;
    } else {
      const { error } = await supabase.from('listings').insert(row);
      writeError = error;
    }
    if (writeError) {
      res.status(500).json({
        success: false,
        error: missingListingsTable(writeError)
          ? 'Listings table is missing. Run database migrations.'
          : writeError.message || 'Could not save listing.',
      });
      return;
    }

    const updated = await loadVacancies(supabase, user);
    res.status(200).json({
      success: true,
      listings: updated,
      canEdit: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load listings',
    });
  }
}
