import { jest } from "@jest/globals";

let supabaseQueryResult = null;
let bcryptCompareResult = false;

// Provide dummy Supabase environment variables so the API doesn't short-circuit
process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

await jest.unstable_mockModule("@supabase/supabase-js", () => {
	return {
		createClient: () => ({
			from: (table) => ({
				select: (sel) => ({
					eq: (field, val) => Promise.resolve(supabaseQueryResult),
				}),
			}),
		}),
	};
});

await jest.unstable_mockModule("bcryptjs", () => {
	return {
		default: {
			compare: (password, hash) => Promise.resolve(bcryptCompareResult),
		},
	};
});

const { default: login } = await import("../../api/login.js");

function createReq(method = "POST", body = {}) {
	return { method, body };
}

function createRes() {
	const res = {};
	res.headers = {};
	res.setHeader = (k, v) => {
		res.headers[k] = v;
	};
	res.statusCode = 200;
	res.status = (code) => {
		res.statusCode = code;
		return res;
	};
	res.jsonData = null;
	res.json = (obj) => {
		res.jsonData = obj;
		return res;
	};
	res.end = () => {};
	return res;
}

describe("api/login", () => {
	beforeEach(() => {
		supabaseQueryResult = null;
		bcryptCompareResult = false;
	});

	test("returns 400 when email or password missing", async () => {
		const req = createReq("POST", { email: "a@b.com" });
		const res = createRes();
		await login(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.jsonData).toMatchObject({
			success: false,
			message: "Email and password are required.",
		});
	});

	test("successful login returns user without password_hash", async () => {
		supabaseQueryResult = {
			data: [
				{
					user_id: "u1",
					email: "a@b.com",
					password_hash: "hash",
					name: "Test",
				},
			],
			error: null,
		};
		bcryptCompareResult = true;

		const req = createReq("POST", { email: "a@b.com", password: "pw" });
		const res = createRes();
		await login(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.jsonData).toEqual({
			success: true,
			user: { user_id: "u1", email: "a@b.com", name: "Test" },
		});
	});

	test("invalid password returns 401", async () => {
		supabaseQueryResult = {
			data: [
				{
					user_id: "u1",
					email: "a@b.com",
					password_hash: "hash",
					name: "Test",
				},
			],
			error: null,
		};
		bcryptCompareResult = false;

		const req = createReq("POST", { email: "a@b.com", password: "bad" });
		const res = createRes();
		await login(req, res);

		expect(res.statusCode).toBe(401);
		expect(res.jsonData).toMatchObject({
			success: false,
			message: "Invalid email or password.",
		});
	});

	test("supabase query error returns 500", async () => {
		supabaseQueryResult = { data: null, error: { message: "boom" } };

		const req = createReq("POST", { email: "a@b.com", password: "pw" });
		const res = createRes();
		await login(req, res);

		expect(res.statusCode).toBe(500);
		expect(res.jsonData).toMatchObject({
			success: false,
			message: "Database query failed",
		});
		expect(res.jsonData.error).toBeDefined();
	});
});
