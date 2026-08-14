// tests/integration/landlord-integration.test.js
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { createSafetyContext, requireProdTestOptIn } from "./safety-harness.js";

dotenv.config();
requireProdTestOptIn();

const supabase = createClient(
  process.env.TEST_SUPABASE_URL,
  process.env.TEST_SUPABASE_SERVICE_KEY || process.env.TEST_SUPABASE_PUBLISHABLE_KEY
);

const safety = createSafetyContext({
  prefix: "test-landlord-int-",
  tag: "[TEST_LANDLORD_INT]"
});

async function cleanupLandlordScopedData() {
  const { data: users } = await supabase
    .from("users")
    .select("user_id")
    .ilike("email", `${safety.prefix}%`);

  const userIds = (users || []).map(u => u.user_id);
  if (userIds.length === 0) return;

  const { data: landlords } = await supabase
    .from("landlords")
    .select("landlord_id")
    .in("user_id", userIds);

  const landlordIds = (landlords || []).map(l => l.landlord_id);

  if (landlordIds.length > 0) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("contact_id")
      .eq("contactable_type", "landlord")
      .in("contactable_id", landlordIds);

    const contactIds = (contacts || []).map(c => c.contact_id);
    if (contactIds.length > 0) {
      await supabase.from("contact_methods").delete().in("contact_id", contactIds);
      await supabase.from("contacts").delete().in("contact_id", contactIds);
    }

    await supabase
      .from("addresses")
      .delete()
      .eq("addressable_type", "landlord")
      .in("addressable_id", landlordIds);

    await supabase.from("properties").delete().in("landlord_id", landlordIds);
    await supabase.from("landlords").delete().in("landlord_id", landlordIds);
  }

  await supabase.from("users").delete().in("user_id", userIds);
}

async function createLandlordUser(label) {
  const passwordHash = await bcrypt.hash("password123", 10);
  const { data: user, error } = await supabase
    .from("users")
    .insert({
      email: safety.email(label),
      password_hash: passwordHash,
      role: "landlord"
    })
    .select()
    .single();

  if (error) throw error;
  return user;
}

async function createLandlordRecord(userId) {
  const { data: landlord, error } = await supabase
    .from("landlords")
    .insert({ user_id: userId })
    .select()
    .single();

  if (error) throw error;
  return landlord;
}

describe("Landlord Integration Tests", () => {
  beforeEach(async () => {
    await cleanupLandlordScopedData();
  });

  afterAll(async () => {
    await cleanupLandlordScopedData();
  });

  test("creates landlord user and landlord record", async () => {
    const user = await createLandlordUser("create-record");
    const landlord = await createLandlordRecord(user.user_id);

    expect(user.role).toBe("landlord");
    expect(user.email).toBe(safety.email("create-record"));
    expect(landlord.user_id).toBe(user.user_id);
    expect(landlord.landlord_id).toBeDefined();
  });

  test("creates property linked to landlord", async () => {
    const user = await createLandlordUser("property-owner");
    const landlord = await createLandlordRecord(user.user_id);

    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .insert({
        property_type: "Apartment",
        landlord_id: landlord.landlord_id
      })
      .select()
      .single();

    expect(propertyError).toBeNull();
    expect(property.landlord_id).toBe(landlord.landlord_id);

    const { data: landlordWithProperty, error: readError } = await supabase
      .from("landlords")
      .select("landlord_id, properties(property_id, property_type)")
      .eq("landlord_id", landlord.landlord_id)
      .single();

    expect(readError).toBeNull();
    expect(landlordWithProperty.properties.length).toBeGreaterThanOrEqual(1);
  });

  test("creates landlord contacts and contact methods", async () => {
    const user = await createLandlordUser("contact-methods");
    const landlord = await createLandlordRecord(user.user_id);

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        contactable_id: landlord.landlord_id,
        contactable_type: "landlord",
        first_name: "Jordan",
        last_name: "Owner"
      })
      .select()
      .single();

    expect(contactError).toBeNull();

    const { error: methodError } = await supabase
      .from("contact_methods")
      .insert([
        { contact_id: contact.contact_id, method_type: "phone", value: "503-555-0001" },
        { contact_id: contact.contact_id, method_type: "email", value: safety.email("contact-alt") }
      ]);

    expect(methodError).toBeNull();

    const { data: methods, error: readError } = await supabase
      .from("contact_methods")
      .select("method_type, value")
      .eq("contact_id", contact.contact_id);

    expect(readError).toBeNull();
    expect(methods.length).toBe(2);
  });

  test("creates multiple landlord addresses", async () => {
    const user = await createLandlordUser("addresses");
    const landlord = await createLandlordRecord(user.user_id);

    const { error } = await supabase
      .from("addresses")
      .insert([
        {
          addressable_id: landlord.landlord_id,
          addressable_type: "landlord",
          address_line_1: safety.taggedText("101 First Ave"),
          city: "Seattle",
          state_province_region: "WA",
          postal_code: "98101"
        },
        {
          addressable_id: landlord.landlord_id,
          addressable_type: "landlord",
          address_line_1: safety.taggedText("202 Second Ave"),
          city: "Portland",
          state_province_region: "OR",
          postal_code: "97201"
        }
      ]);

    expect(error).toBeNull();

    const { data: addresses, error: readError } = await supabase
      .from("addresses")
      .select("city")
      .eq("addressable_type", "landlord")
      .eq("addressable_id", landlord.landlord_id);

    expect(readError).toBeNull();
    expect(addresses.length).toBe(2);
  });

  test("updates landlord contact information", async () => {
    const user = await createLandlordUser("update-contact");
    const landlord = await createLandlordRecord(user.user_id);

    const { data: contact } = await supabase
      .from("contacts")
      .insert({
        contactable_id: landlord.landlord_id,
        contactable_type: "landlord",
        first_name: "Old",
        last_name: "Name"
      })
      .select()
      .single();

    const { error: updateError } = await supabase
      .from("contacts")
      .update({ first_name: "New", last_name: "Name" })
      .eq("contact_id", contact.contact_id);

    expect(updateError).toBeNull();

    const { data: updatedContact, error: readError } = await supabase
      .from("contacts")
      .select("first_name")
      .eq("contact_id", contact.contact_id)
      .single();

    expect(readError).toBeNull();
    expect(updatedContact.first_name).toBe("New");
  });

  test("enforces unique email constraint for landlord users", async () => {
    const email = safety.email("duplicate-email");
    const passwordHash = await bcrypt.hash("password123", 10);

    const first = await supabase
      .from("users")
      .insert({ email, password_hash: passwordHash, role: "landlord" })
      .select()
      .single();

    const second = await supabase
      .from("users")
      .insert({ email, password_hash: passwordHash, role: "landlord" })
      .select()
      .single();

    expect(first.error).toBeNull();
    expect(second.error).toBeDefined();
    expect(second.error.message.toLowerCase()).toContain("unique");
  });

  test("queries created landlord users with join", async () => {
    for (let index = 1; index <= 3; index += 1) {
      const user = await createLandlordUser(`join-${index}`);
      await createLandlordRecord(user.user_id);
    }

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("user_id, email, role")
      .ilike("email", `${safety.prefix}%`)
      .eq("role", "landlord");

    expect(usersError).toBeNull();
    const userIds = (users || []).map(user => user.user_id);
    expect(userIds.length).toBeGreaterThanOrEqual(3);

    const { data: rows, error } = await supabase
      .from("landlords")
      .select("landlord_id, user_id")
      .in("user_id", userIds);

    expect(error).toBeNull();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    rows.forEach(row => expect(userIds).toContain(row.user_id));
  });
});
