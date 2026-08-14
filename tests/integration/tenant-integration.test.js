// tests/integration/tenant-integration.test.js
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
  prefix: "test-tenant-int-",
  tag: "[TEST_TENANT_INT]"
});

async function cleanupTenantScopedData() {
  const { data: users } = await supabase
    .from("users")
    .select("user_id")
    .ilike("email", `${safety.prefix}%`);

  const userIds = (users || []).map(u => u.user_id);
  if (userIds.length === 0) return;

  const { data: clients } = await supabase
    .from("clients")
    .select("client_id")
    .in("user_id", userIds);

  const clientIds = (clients || []).map(c => c.client_id);

  const contactFilters = [];
  if (clientIds.length > 0) contactFilters.push(`and(contactable_type.eq.client,contactable_id.in.(${clientIds.join(",")}))`);
  if (userIds.length > 0) contactFilters.push(`and(contactable_type.eq.user,contactable_id.in.(${userIds.join(",")}))`);

  if (contactFilters.length > 0) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("contact_id")
      .or(contactFilters.join(","));

    const contactIds = (contacts || []).map(contact => contact.contact_id);

    if (contactIds.length > 0) {
      await supabase.from("contact_methods").delete().in("contact_id", contactIds);
      await supabase.from("contacts").delete().in("contact_id", contactIds);
    }
  }

  if (userIds.length > 0) {
    await supabase
      .from("addresses")
      .delete()
      .eq("addressable_type", "user")
      .in("addressable_id", userIds);
  }

  if (clientIds.length > 0) {
    await supabase.from("clients").delete().in("client_id", clientIds);
  }

  await supabase.from("users").delete().in("user_id", userIds);
}

async function createTenantUser(label) {
  const passwordHash = await bcrypt.hash("password123", 10);
  const { data: user, error } = await supabase
    .from("users")
    .insert({
      email: safety.email(label),
      password_hash: passwordHash,
      role: "tenant"
    })
    .select()
    .single();

  if (error) throw error;
  return user;
}

async function createClientProfile(userId, overrides = {}) {
  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      user_id: userId,
      ...overrides
    })
    .select()
    .single();

  if (error) throw error;
  return client;
}

async function createClientContact(clientId, firstName = "Test", lastName = "Tenant") {
  const candidates = [
    { contactable_type: "client", contactable_id: clientId },
    { contactable_type: "user", contactable_id: clientId }
  ];

  let lastError = null;

  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        contactable_id: candidate.contactable_id,
        contactable_type: candidate.contactable_type,
        first_name: firstName,
        last_name: lastName
      })
      .select()
      .single();

    if (!error) return data;
    lastError = error;
  }

  throw lastError || new Error("Unable to create client contact");
}

describe("Tenant Integration Tests (clients schema)", () => {
  beforeEach(async () => {
    await cleanupTenantScopedData();
  });

  afterAll(async () => {
    await cleanupTenantScopedData();
  });

  test("creates tenant user with client profile", async () => {
    const user = await createTenantUser("create-profile");
    const client = await createClientProfile(user.user_id);

    expect(user.role).toBe("tenant");
    expect(user.email).toBe(safety.email("create-profile"));
    expect(client.user_id).toBe(user.user_id);
  });

  test("enforces unique email on users", async () => {
    const email = safety.email("duplicate-email");
    const passwordHash = await bcrypt.hash("password123", 10);

    const firstInsert = await supabase
      .from("users")
      .insert({ email, password_hash: passwordHash, role: "tenant" })
      .select()
      .single();

    const secondInsert = await supabase
      .from("users")
      .insert({ email, password_hash: passwordHash, role: "tenant" })
      .select()
      .single();

    expect(firstInsert.error).toBeNull();
    expect(secondInsert.error).toBeDefined();
    expect(secondInsert.error.message.toLowerCase()).toContain("unique");
  });

  test("creates and queries client contact methods", async () => {
    const user = await createTenantUser("contact-methods");
    const client = await createClientProfile(user.user_id);
    const contact = await createClientContact(client.client_id, "Alice", "Renter");

    const { error: methodsError } = await supabase
      .from("contact_methods")
      .insert([
        { contact_id: contact.contact_id, method_type: "phone", value: "206-555-0101" },
        { contact_id: contact.contact_id, method_type: "email", value: safety.email("alt-contact") }
      ]);

    expect(methodsError).toBeNull();

    const { data: methods, error: readError } = await supabase
      .from("contact_methods")
      .select("method_type, value")
      .eq("contact_id", contact.contact_id);

    expect(readError).toBeNull();
    expect(methods.length).toBe(2);
  });

  test("updates client profile fields", async () => {
    const user = await createTenantUser("update-profile");
    const client = await createClientProfile(user.user_id, {
      date_of_birth: "1990-01-01",
      gender: "female"
    });

    const { error: updateError } = await supabase
      .from("clients")
      .update({
        date_of_birth: "1991-02-02",
        gender: "non-binary",
        social_security_number: "123-45-6789"
      })
      .eq("client_id", client.client_id);

    expect(updateError).toBeNull();

    const { data: updatedClient, error: getError } = await supabase
      .from("clients")
      .select("date_of_birth, gender, social_security_number")
      .eq("client_id", client.client_id)
      .single();

    expect(getError).toBeNull();
    expect(updatedClient.date_of_birth).toBe("1991-02-02");
    expect(updatedClient.gender).toBe("non-binary");
    expect(updatedClient.social_security_number).toBe("123-45-6789");
  });

  test("queries clients joined to tenant users", async () => {
    for (let index = 1; index <= 3; index += 1) {
      const user = await createTenantUser(`join-${index}`);
      await createClientProfile(user.user_id);
    }

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("user_id, email, role")
      .ilike("email", `${safety.prefix}%`)
      .eq("role", "tenant");

    expect(usersError).toBeNull();
    const userIds = (users || []).map(user => user.user_id);
    expect(userIds.length).toBeGreaterThanOrEqual(3);

    const { data: rows, error } = await supabase
      .from("clients")
      .select("client_id, user_id")
      .in("user_id", userIds);

    expect(error).toBeNull();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    rows.forEach(row => expect(userIds).toContain(row.user_id));
  });

  test("creates and reads user address data", async () => {
    const user = await createTenantUser("addresses");
    await createClientProfile(user.user_id);

    const { error: insertError } = await supabase
      .from("addresses")
      .insert([
        {
          addressable_id: user.user_id,
          addressable_type: "user",
          address_line_1: safety.taggedText("123 Main St"),
          city: "Seattle",
          state_province_region: "WA",
          postal_code: "98101"
        },
        {
          addressable_id: user.user_id,
          addressable_type: "user",
          address_line_1: safety.taggedText("456 Oak Ave"),
          city: "Portland",
          state_province_region: "OR",
          postal_code: "97201"
        }
      ]);

    expect(insertError).toBeNull();

    const { data: addresses, error: readError } = await supabase
      .from("addresses")
      .select("address_line_1, city")
      .eq("addressable_type", "user")
      .eq("addressable_id", user.user_id);

    expect(readError).toBeNull();
    expect(addresses.length).toBe(2);
    expect(addresses.some(address => address.city === "Seattle")).toBe(true);
    expect(addresses.some(address => address.city === "Portland")).toBe(true);
  });

  test("deletes client profile and user records", async () => {
    const user = await createTenantUser("delete-flow");
    const client = await createClientProfile(user.user_id);

    const deleteClient = await supabase
      .from("clients")
      .delete()
      .eq("client_id", client.client_id);

    expect(deleteClient.error).toBeNull();

    const deleteUser = await supabase
      .from("users")
      .delete()
      .eq("user_id", user.user_id);

    expect(deleteUser.error).toBeNull();

    const { data: userAfterDelete } = await supabase
      .from("users")
      .select("user_id")
      .eq("user_id", user.user_id)
      .maybeSingle();

    expect(userAfterDelete).toBeNull();
  });
});
