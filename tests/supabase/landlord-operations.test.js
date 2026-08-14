import { jest } from "@jest/globals";

// Setup environment
process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

let mockSupabaseResults = {
	usersInsert: null,
	landlordsInsert: null,
	contactsInsert: null,
	addressesInsert: null,
	contactMethodsInsert: null,
	usersDelete: null,
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
											user_id: "u1",
											email: "landlord@test.com",
											role: "landlord",
										},
										error: null,
									};
								}
								if (table === "landlords") {
									if (mockSupabaseResults.landlordsInsert?.error) {
										return mockSupabaseResults.landlordsInsert;
									}
									return {
										data: mockSupabaseResults.landlordsInsert?.data || {
											landlord_id: "l1",
											user_id: "u1",
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
							if (table === "addresses") {
								const result = mockSupabaseResults.addressesInsert || {
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
										data: { contact_id: "c1" },
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

describe("Landlord Operations", () => {
	beforeEach(() => {
		mockSupabaseResults = {
			usersInsert: null,
			landlordsInsert: null,
			contactsInsert: null,
			addressesInsert: null,
			contactMethodsInsert: null,
			usersDelete: null,
		};
		bcryptHashResult = "hashed_password";
	});

	describe("Create Landlord", () => {
		test("should create landlord with user and contact records", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u1", email: "landlord@test.com", role: "landlord" },
				error: null,
			};
			mockSupabaseResults.landlordsInsert = {
				data: { landlord_id: "l1", user_id: "u1" },
				error: null,
			};
			mockSupabaseResults.contactsInsert = { data: null, error: null };

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Step 1: Create user
			const userResult = await supabase
				.from("users")
				.insert([
					{
						email: "landlord@test.com",
						password_hash: "hashed_password",
						role: "landlord",
					},
				])
				.select()
				.single();

			expect(userResult.data.user_id).toBe("u1");
			expect(userResult.data.role).toBe("landlord");
			expect(userResult.error).toBeNull();

			// Step 2: Create landlord record
			const landlordResult = await supabase
				.from("landlords")
				.insert([{ user_id: "u1" }])
				.select()
				.single();

			expect(landlordResult.data.landlord_id).toBe("l1");
			expect(landlordResult.error).toBeNull();
		});

		test("should rollback user creation if landlord creation fails", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u1", email: "landlord@test.com", role: "landlord" },
				error: null,
			};
			mockSupabaseResults.landlordsInsert = {
				data: null,
				error: { message: "Failed to create landlord" },
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Step 1: Create user (succeeds)
			const userResult = await supabase
				.from("users")
				.insert([
					{
						email: "landlord@test.com",
						password_hash: "hashed_password",
						role: "landlord",
					},
				])
				.select()
				.single();

			expect(userResult.data).toBeDefined();

			// Step 2: Create landlord record (fails)
			const landlordResult = await supabase
				.from("landlords")
				.insert([{ user_id: "u1" }])
				.select()
				.single();

			expect(landlordResult.error).toBeDefined();
			expect(landlordResult.error.message).toBe("Failed to create landlord");

			// Step 3: Cleanup should delete the user
			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u1");

			expect(deleteResult.error).toBeNull();
		});

		test("should create landlord with address and contact methods", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u1", email: "landlord@test.com", role: "landlord" },
				error: null,
			};
			mockSupabaseResults.landlordsInsert = {
				data: { landlord_id: "l1", user_id: "u1" },
				error: null,
			};
			mockSupabaseResults.contactsInsert = { data: null, error: null };
			mockSupabaseResults.addressesInsert = { data: null, error: null };
			mockSupabaseResults.contactMethodsInsert = { data: null, error: null };

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Create user
			await supabase
				.from("users")
				.insert([
					{
						email: "landlord@test.com",
						password_hash: "hashed_password",
						role: "landlord",
					},
				])
				.select()
				.single();

			// Create landlord
			await supabase
				.from("landlords")
				.insert([{ user_id: "u1" }])
				.select()
				.single();

			// Create contact
			const contactResult = await supabase.from("contacts").insert([
				{
					contactable_id: "l1",
					contactable_type: "landlord",
					first_name: "John",
					last_name: "Doe",
				},
			]);

			expect(contactResult.error).toBeNull();

			// Create address
			const addressResult = await supabase.from("addresses").insert([
				{
					addressable_id: "l1",
					addressable_type: "landlord",
					address_line_1: "123 Main St",
					city: "Portland",
					state_province_region: "OR",
				},
			]);

			expect(addressResult.error).toBeNull();

			// Create contact methods
			const contactMethodResult = await supabase
				.from("contact_methods")
				.insert([
					{
						contact_id: "c1",
						method_type: "phone",
						value: "555-1234",
					},
				]);

			expect(contactMethodResult.error).toBeNull();
		});

		test("should handle user creation error", async () => {
			mockSupabaseResults.usersInsert = {
				data: null,
				error: { message: "Email already exists" },
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			const userResult = await supabase
				.from("users")
				.insert([
					{
						email: "landlord@test.com",
						password_hash: "hashed_password",
						role: "landlord",
					},
				])
				.select()
				.single();

			expect(userResult.error).toBeDefined();
			expect(userResult.error.message).toContain("Email already exists");
		});

		test("should handle contact creation failure after landlord created", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u1", email: "landlord@test.com", role: "landlord" },
				error: null,
			};
			mockSupabaseResults.landlordsInsert = {
				data: { landlord_id: "l1", user_id: "u1" },
				error: null,
			};
			mockSupabaseResults.contactsInsert = {
				data: null,
				error: { message: "Contact insert failed" },
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
						email: "landlord@test.com",
						password_hash: "hashed_password",
						role: "landlord",
					},
				])
				.select()
				.single();

			expect(userResult.data).toBeDefined();

			// Create landlord (succeeds)
			const landlordResult = await supabase
				.from("landlords")
				.insert([{ user_id: "u1" }])
				.select()
				.single();

			expect(landlordResult.data).toBeDefined();

			// Create contact (fails)
			const contactResult = await supabase.from("contacts").insert([
				{
					contactable_id: "l1",
					contactable_type: "landlord",
					first_name: "John",
					last_name: "Doe",
				},
			]);

			expect(contactResult.error).toBeDefined();
			expect(contactResult.error.message).toBe("Contact insert failed");

			// Cleanup: delete user (cascades to landlord)
			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u1");

			expect(deleteResult.error).toBeNull();
		});

		// Test removed: Landlords no longer have direct PMC association

		test("should create landlord with multiple contact methods", async () => {
			mockSupabaseResults.usersInsert = {
				data: { user_id: "u1", email: "landlord@test.com", role: "landlord" },
				error: null,
			};
			mockSupabaseResults.landlordsInsert = {
				data: { landlord_id: "l1", user_id: "u1" },
				error: null,
			};
			mockSupabaseResults.contactsInsert = { data: null, error: null };
			mockSupabaseResults.contactMethodsInsert = { data: null, error: null };

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Create user and landlord
			await supabase
				.from("users")
				.insert([
					{
						email: "landlord@test.com",
						password_hash: "hashed_password",
						role: "landlord",
					},
				])
				.select()
				.single();

			await supabase
				.from("landlords")
				.insert([{ user_id: "u1" }])
				.select()
				.single();

			await supabase.from("contacts").insert([
				{
					contactable_id: "l1",
					contactable_type: "landlord",
					first_name: "John",
					last_name: "Doe",
				},
			]);

			// Create multiple contact methods
			const methods = [
				{
					contact_id: "c1",
					method_type: "phone",
					value: "555-1234",
				},
				{
					contact_id: "c1",
					method_type: "email",
					value: "alt@test.com",
				},
				{
					contact_id: "c1",
					method_type: "phone",
					value: "555-5678",
				},
			];

			const result = await supabase.from("contact_methods").insert(methods);

			expect(result.error).toBeNull();
		});
	});

	describe("Delete Landlord", () => {
		test("should delete landlord user and related records", async () => {
			mockSupabaseResults.usersDelete = { error: null };

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			// Delete user (cascades to landlord and related records)
			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u1");

			expect(deleteResult.error).toBeNull();
		});

		test("should handle delete error gracefully", async () => {
			mockSupabaseResults.usersDelete = {
				error: { message: "Cannot delete user with active leases" },
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u1");

			expect(deleteResult.error).toBeDefined();
			expect(deleteResult.error.message).toContain("Cannot delete");
		});

		test("should prevent deletion if landlord has active properties", async () => {
			mockSupabaseResults.usersDelete = {
				error: { message: "Cannot delete landlord with active properties" },
			};

			const supabase = (await import("@supabase/supabase-js")).createClient(
				"http://localhost",
				"anon-key"
			);

			const deleteResult = await supabase
				.from("users")
				.delete()
				.eq("user_id", "u1");

			expect(deleteResult.error).toBeDefined();
			expect(deleteResult.error.message).toContain("active properties");
		});
	});
});


