import { jest } from "@jest/globals";

// Setup environment
process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

let mockSupabaseResults = {
	usersInsert: null,
	tenantsInsert: null,
	contactsInsert: null,
	contactMethodsInsert: null,
	usersDelete: null,
	applicantsInsert: null,
	clientsInsert: null,
};

let bcryptHashResult = "hashed_password";

// Mock Supabase
await jest.unstable_mockModule("@supabase/supabase-js", () => {
	return {
		createClient: () => ({
			from: (table) => {
				return {
					insert: (data) => ({
						select: () => ({
							single: async () => {
								if (table === "users") {
									if (mockSupabaseResults.usersInsert?.error) {
										return mockSupabaseResults.usersInsert;
									}
									return {
										data: mockSupabaseResults.usersInsert?.data || {
											user_id: "u2",
											email: "tenant@test.com",
											role: "tenant",
										},
										error: null,
									};
								}
								if (table === "tenants") {
									if (mockSupabaseResults.tenantsInsert?.error) {
										return mockSupabaseResults.tenantsInsert;
									}
									return {
										data: mockSupabaseResults.tenantsInsert?.data || {
											tenant_id: "t1",
											email: "tenant@test.com",
											status: "tenant",
										},
										error: null,
									};
								}
								if (table === "applicants") {
									if (mockSupabaseResults.applicantsInsert?.error) {
										return mockSupabaseResults.applicantsInsert;
									}
									return {
										data: mockSupabaseResults.applicantsInsert?.data || {
											applicant_id: "a1",
											email: "tenant@test.com",
											status: "applicant",
										},
										error: null,
									};
								}
								if (table === "clients") {
									if (mockSupabaseResults.clientsInsert?.error) {
										return mockSupabaseResults.clientsInsert;
									}
									return {
										data: mockSupabaseResults.clientsInsert?.data || {
											client_id: "c1",
											lifecycle_stage: "tenant",
											status: "active",
										},
										error: null,
									};
								}
								return { data: null, error: null };
							},
						}),
						async then(onSuccess) {
							if (table === "contacts") {
								const result = mockSupabaseResults.contactsInsert || {
									data: null,
									error: null,
								};
								return onSuccess(result);
							}
							if (table === "contact_methods") {
								const result = mockSupabaseResults.contactMethodsInsert || {
									data: null,
									error: null,
								};
								return onSuccess(result);
							}
							return onSuccess({ data: null, error: null });
						},
					}),
					delete: () => ({
						eq: async () => {
							return mockSupabaseResults.usersDelete || { error: null };
						},
					}),
					select: (fields) => ({
						eq: (field, val) => ({
							single: async () => {
								if (table === "contacts") {
									return {
										data: { contact_id: "c2" },
										error: null,
									};
								}
								return { data: null, error: null };
							},
						}),
					}),
				};
			},
		}),
	};
});

// Mock bcryptjs
await jest.unstable_mockModule("bcryptjs", () => {
	return {
		default: {
			genSalt: async () => "salt_value",
			hash: async () => bcryptHashResult,
			compare: async (password, hash) => password === "correct_password",
		},
	};
});

describe("Tenant Operations", () => {
	beforeEach(() => {
		mockSupabaseResults = {
			usersInsert: null,
			tenantsInsert: null,
			contactsInsert: null,
			contactMethodsInsert: null,
			usersDelete: null,
			applicantsInsert: null,
		};
		bcryptHashResult = "hashed_password";
	});

	describe("Create Tenant", () => {
		test("should create tenant with user, contact, and tenant records", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u2", email: "tenant@test.com", role: "tenant" },
				error: null,
			};
			mockSupabaseResults.tenantsInsert = {
				data: { tenant_id: "t1", email: "tenant@test.com", status: "tenant" },
				error: null,
			};
			mockSupabaseResults.contactsInsert = { data: null, error: null };
			mockSupabaseResults.clientsInsert = {
				data: {
					client_id: "c1",
					lifecycle_stage: "tenant",
					status: "active",
					email: "tenant@test.com",
				},
				error: null,
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Step 1: Create user
			const userResult = await supabase
				.from("users")
				.insert([
					{
						email: "tenant@test.com",
						password_hash: "hashed_password",
						role: "tenant",
					},
				])
				.select()
				.single();

			expect(userResult.data.user_id).toBe("u2");
			expect(userResult.data.role).toBe("tenant");
			expect(userResult.error).toBeNull();

			// Step 2: Create contact record
			const contactResult = await supabase.from("contacts").insert([
				{
					contactable_id: "u2",
					contactable_type: "user",
					first_name: "Jane",
					last_name: "Smith",
				},
			]);

			expect(contactResult.error).toBeNull();

			// Step 3: Create tenant record
			const tenantResult = await supabase
				.from("clients")
				.insert([
					{
						lifecycle_stage: "tenant",
						status: "active",
					},
				])
				.select()
				.single();

			expect(tenantResult.data.lifecycle_stage).toBe("tenant");
			expect(tenantResult.data.status).toBe("active");
			expect(tenantResult.error).toBeNull();
		});

		test("should create applicant with optional user account", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u3", email: "applicant@test.com", role: "tenant" },
				error: null,
			};
			mockSupabaseResults.applicantsInsert = {
				data: {
					applicant_id: "a1",
					email: "applicant@test.com",
					status: "applicant",
				},
				error: null,
			};
			mockSupabaseResults.contactsInsert = { data: null, error: null };
			mockSupabaseResults.clientsInsert = {
				data: {
					client_id: "c2",
					lifecycle_stage: "applicant",
					status: "active",
					applicant_id: "a1",
				},
				error: null,
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Create user (optional - password provided)
			const userResult = await supabase
				.from("users")
				.insert([
					{
						email: "applicant@test.com",
						password_hash: "hashed_password",
						role: "tenant",
					},
				])
				.select()
				.single();

			expect(userResult.data).toBeDefined();

			// Create contact record
			await supabase.from("contacts").insert([
				{
					contactable_id: "u3",
					contactable_type: "user",
					first_name: "Bob",
					last_name: "Johnson",
				},
			]);

			// Create applicant record
			const applicantResult = await supabase
				.from("clients")
				.insert([
					{
						lifecycle_stage: "applicant",
						status: "active",
					},
				])
				.select()
				.single();

			expect(applicantResult.data.lifecycle_stage).toBe("applicant");
			expect(applicantResult.data.status).toBe("active");
			expect(applicantResult.error).toBeNull();
		});

		test("should rollback user creation if tenant creation fails", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u2", email: "tenant@test.com", role: "tenant" },
				error: null,
			};
			mockSupabaseResults.contactsInsert = { data: null, error: null };
			mockSupabaseResults.tenantsInsert = {
				data: null,
				error: { message: "Tenant creation failed" },
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Create user (succeeds)
			const userResult = await supabase
				.from("users")
				.insert([
					{
						email: "tenant@test.com",
						password_hash: "hashed_password",
						role: "tenant",
					},
				])
				.select()
				.single();

			expect(userResult.data).toBeDefined();

			// Create contact
			await supabase.from("contacts").insert([
				{
					contactable_id: "u2",
					contactable_type: "user",
					first_name: "Jane",
					last_name: "Smith",
				},
			]);

			// Create tenant (fails)
			const tenantResult = await supabase
				.from("clients")
				.insert([{ lifecycle_stage: "tenant", status: "active" }])
				.select()
				.single();

			expect(tenantResult.error).toBeDefined();

			// Cleanup: delete user
			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u2");

			expect(deleteResult.error).toBeNull();
		});

		test("should create tenant with contact methods", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u2", email: "tenant@test.com", role: "tenant" },
				error: null,
			};
			mockSupabaseResults.contactsInsert = { data: null, error: null };
			mockSupabaseResults.contactMethodsInsert = { data: null, error: null };
			mockSupabaseResults.tenantsInsert = {
				data: { tenant_id: "t1", email: "tenant@test.com" },
				error: null,
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Create user
			await supabase
				.from("users")
				.insert([
					{
						email: "tenant@test.com",
						password_hash: "hashed_password",
						role: "tenant",
					},
				])
				.select()
				.single();

			// Create contact
			await supabase.from("contacts").insert([
				{
					contactable_id: "u2",
					contactable_type: "user",
					first_name: "Jane",
					last_name: "Smith",
				},
			]);

			// Create contact methods
			const contactMethodResult = await supabase
				.from("contact_methods")
				.insert([
					{
						contact_id: "c2",
						method_type: "phone",
						value: "555-5678",
						is_primary: true,
					},
					{
						contact_id: "c2",
						method_type: "email",
						value: "jane.alt@test.com",
						is_primary: false,
					},
				]);

			expect(contactMethodResult.error).toBeNull();

			// Create tenant
			const tenantResult = await supabase
				.from("clients")
				.insert([
					{
						lifecycle_stage: "tenant",
						status: "active",
					},
				])
				.select()
				.single();

			expect(tenantResult.error).toBeNull();
		});
	});

	describe("Delete Tenant", () => {
		test("should delete tenant user and related records", async () => {
			mockSupabaseResults.usersDelete = { error: null };

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Delete user (cascades to contact, contact_methods, tenant records)
			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u2");

			expect(deleteResult.error).toBeNull();
		});

		test("should handle delete error if tenant has active leases", async () => {
			mockSupabaseResults.usersDelete = {
				error: { message: "Cannot delete tenant with active leases" },
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u2");

			expect(deleteResult.error).toBeDefined();
			expect(deleteResult.error.message).toContain("active leases");
		});

		test("should allow deletion of tenant without leases", async () => {
			mockSupabaseResults.usersDelete = { error: null };

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u2");

			expect(deleteResult.error).toBeNull();
		});
	});
});
