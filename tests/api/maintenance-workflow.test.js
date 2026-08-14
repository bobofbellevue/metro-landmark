import { jest } from "@jest/globals";

process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_SECRET_KEY = "test-secret";
process.env.CRON_SECRET = "test-cron-secret";

let createClientMock = null;

await jest.unstable_mockModule("@supabase/supabase-js", () => ({
  createClient: (...args) => createClientMock(...args)
}));

const { default: createAppointmentHandler } = await import("../../api/appointments/create.js");
const { default: closeResolvedRequestsHandler } = await import("../../api/cron/close-resolved-requests.js");
const { createMaintenanceRequest } = await import("../../api/voice/maintenance-logic.js");

function createReq(method, body = {}, query = {}, headers = {}) {
  return {
    method,
    body,
    query,
    headers
  };
}

function createRes() {
  const res = {};
  res.headers = {};
  res.setHeader = (key, value) => {
    res.headers[key] = value;
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
  res.end = () => res;
  return res;
}

describe("Maintenance workflow unit tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
  });

  test("createMaintenanceRequest creates an unassigned maintenance request", async () => {
    let insertedRequest = null;

    const mockSupabase = {
      from: (table) => {
        if (table !== "maintenance_requests") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          insert: (rows) => {
            insertedRequest = rows[0];
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    request_id: 101,
                    ...rows[0]
                  },
                  error: null
                })
              })
            };
          }
        };
      }
    };

    const result = await createMaintenanceRequest(
      {
        description: "Kitchen sink leak",
        priority: "Medium",
        status: "New",
        caller_name: "Jordan Lee"
      },
      null,
      null,
      mockSupabase,
      null,
      null,
      "Caller reports water leaking under the sink"
    );

    expect(result.success).toBe(true);
    expect(result.request_id).toBe(101);
    expect(result.is_unassigned).toBe(true);
    expect(insertedRequest.status).toBe("New");
    expect(insertedRequest.assigned_vendor_id).toBeNull();
    expect(insertedRequest.description).toContain("Unassigned Request");
  });

  test("appointments/create creates an appointment to assign maintenance work", async () => {
    createClientMock = () => ({
      from: (table) => {
        if (table === "maintenance_requests") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { request_id: 9001, tenant_user_id: 77 },
                  error: null
                })
              })
            })
          };
        }

        if (table === "clients") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { client_id: 42 },
                  error: null
                })
              })
            })
          };
        }

        if (table === "vendors") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { vendor_id: 15 },
                  error: null
                })
              })
            })
          };
        }

        if (table === "client_appointments") {
          return {
            insert: (rows) => ({
              select: () => ({
                single: async () => ({
                  data: {
                    appointment_id: 555,
                    ...rows[0]
                  },
                  error: null
                })
              })
            })
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }
    });

    const req = createReq("POST", {
      clientId: 42,
      vendorId: 15,
      maintenanceRequestId: 9001,
      scheduledDateTime: "2026-02-20T16:00:00.000Z",
      notes: "Please call before arrival"
    });
    const res = createRes();

    await createAppointmentHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.appointment.maintenance_request_id).toBe(9001);
    expect(res.jsonData.appointment.vendor_id).toBe(15);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("close-resolved-requests marks maintenance request as Completed", async () => {
    let capturedUpdate = null;

    createClientMock = () => ({
      from: (table) => {
        if (table === "client_appointments") {
          const query = {
            eq: () => query,
            neq: () => query,
            is: async () => ({
              data: [
                {
                  appointment_id: 444,
                  maintenance_request_id: 9001,
                  actual_date_time: "2026-02-16T10:00:00.000Z",
                  scheduled_date_time: "2026-02-16T09:30:00.000Z",
                  result: "Leak fixed"
                }
              ],
              error: null
            })
          };

          return {
            select: () => query
          };
        }

        if (table === "maintenance_requests") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { admin_notes: "Existing note" },
                  error: null
                })
              })
            }),
            update: (payload) => {
              capturedUpdate = payload;
              return {
                eq: async () => ({ error: null })
              };
            }
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }
    });

    const req = createReq(
      "POST",
      {},
      {},
      { authorization: "Bearer test-cron-secret" }
    );
    const res = createRes();

    await closeResolvedRequestsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.successful).toBe(1);
    expect(capturedUpdate.status).toBe("Completed");
    expect(capturedUpdate.completed_at).toBe("2026-02-16T10:00:00.000Z");
    expect(capturedUpdate.admin_notes).toContain("Appointment ID: 444");
  });
});
