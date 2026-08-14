import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { createSafetyContext, requireProdTestOptIn } from "./safety-harness.js";

dotenv.config();

const { prefix: TEST_PREFIX, tag: TEST_TAG } = createSafetyContext({
  prefix: "test-maint-workflow-",
  tag: "[TEST_MAINT_WORKFLOW]"
});

const hasIntegrationEnv = !!(process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_SERVICE_KEY);

const describeOrSkip = hasIntegrationEnv ? describe : describe.skip;

const supabase = hasIntegrationEnv
  ? createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_SERVICE_KEY)
  : null;

if (hasIntegrationEnv) {
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = process.env.TEST_SUPABASE_SERVICE_KEY;
  process.env.CRON_SECRET = "integration-cron-secret";
}

requireProdTestOptIn();

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

async function getOrCreateClient(createdRecords) {
  const { data: existingClient } = await supabase
    .from("clients")
    .select("client_id")
    .limit(1)
    .maybeSingle();

  if (existingClient?.client_id) {
    return existingClient.client_id;
  }

  const passwordHash = await bcrypt.hash("workflow-test-password", 10);
  const { data: user, error: userError } = await supabase
    .from("users")
    .insert({
      email: `${TEST_PREFIX}${Date.now()}@test.com`,
      password_hash: passwordHash,
      role: "tenant"
    })
    .select("user_id")
    .single();

  if (userError) {
    throw userError;
  }

  createdRecords.userId = user.user_id;

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .insert({ user_id: user.user_id })
    .select("client_id")
    .single();

  if (clientError) {
    throw clientError;
  }

  createdRecords.clientId = client.client_id;
  return client.client_id;
}

async function getOrCreateVendor(createdRecords) {
  const { data: existingVendor } = await supabase
    .from("vendors")
    .select("vendor_id")
    .limit(1)
    .maybeSingle();

  if (existingVendor?.vendor_id) {
    return existingVendor.vendor_id;
  }

  const timestamp = Date.now();
  const firstAttempt = await supabase
    .from("vendors")
    .insert({
      company_name: `${TEST_PREFIX}vendor-${timestamp}`,
      description: `${TEST_TAG} integration test vendor`
    })
    .select("vendor_id")
    .single();

  if (!firstAttempt.error && firstAttempt.data?.vendor_id) {
    createdRecords.vendorId = firstAttempt.data.vendor_id;
    return firstAttempt.data.vendor_id;
  }

  const secondAttempt = await supabase
    .from("vendors")
    .insert({
      vendor_name: `${TEST_PREFIX}vendor-${timestamp}`,
      email: `${TEST_PREFIX}${timestamp}@test.com`
    })
    .select("vendor_id")
    .single();

  if (secondAttempt.error || !secondAttempt.data?.vendor_id) {
    throw secondAttempt.error || firstAttempt.error || new Error("Unable to create test vendor");
  }

  createdRecords.vendorId = secondAttempt.data.vendor_id;
  return secondAttempt.data.vendor_id;
}

async function cleanupTaggedData() {
  await supabase
    .from("client_appointments")
    .delete()
    .ilike("notes", `${TEST_TAG}%`);

  await supabase
    .from("maintenance_requests")
    .delete()
    .ilike("description", `${TEST_TAG}%`);

  const { data: taggedUsers } = await supabase
    .from("users")
    .select("user_id")
    .ilike("email", `${TEST_PREFIX}%`);

  const taggedUserIds = (taggedUsers || []).map(u => u.user_id);
  if (taggedUserIds.length > 0) {
    await supabase.from("clients").delete().in("user_id", taggedUserIds);
    await supabase.from("users").delete().in("user_id", taggedUserIds);
  }

  try {
    await supabase
      .from("vendors")
      .delete()
      .ilike("company_name", `${TEST_PREFIX}%`);
  } catch {
  }

  try {
    await supabase
      .from("vendors")
      .delete()
      .ilike("vendor_name", `${TEST_PREFIX}%`);
  } catch {
  }
}

describeOrSkip("Maintenance workflow integration", () => {
  let createAppointmentHandler;
  let appointmentByIdHandler;
  let closeResolvedRequestsHandler;
  let createMaintenanceRequest;

  beforeAll(async () => {
    const createApptModule = await import("../../api/appointments/create.js");
    const byIdModule = await import("../../api/appointments/[id].js");
    const closeModule = await import("../../api/cron/close-resolved-requests.js");
    const maintenanceLogicModule = await import("../../api/voice/maintenance-logic.js");

    createAppointmentHandler = createApptModule.default;
    appointmentByIdHandler = byIdModule.default;
    closeResolvedRequestsHandler = closeModule.default;
    createMaintenanceRequest = maintenanceLogicModule.createMaintenanceRequest;
  });

  beforeEach(async () => {
    await cleanupTaggedData();
  });

  afterEach(async () => {
    await cleanupTaggedData();
  });

  test("create -> assign appointment -> complete request", async () => {
    const createdRecords = {
      appointmentId: null,
      maintenanceRequestId: null,
      clientId: null,
      userId: null,
      vendorId: null
    };

    try {
      const clientId = await getOrCreateClient(createdRecords);
      const vendorId = await getOrCreateVendor(createdRecords);

      const createRequestResult = await createMaintenanceRequest(
        {
          description: `${TEST_TAG} Integration test: ceiling leak in living room`,
          priority: "Medium",
          status: "New",
          caller_name: "Integration Caller"
        },
        null,
        null,
        supabase,
        null,
        null,
        "Leak reported in ceiling"
      );

      expect(createRequestResult.success).toBe(true);
      expect(createRequestResult.request_id).toBeDefined();
      createdRecords.maintenanceRequestId = createRequestResult.request_id;

      const createReqObj = createReq("POST", {
        clientId,
        vendorId,
        maintenanceRequestId: createdRecords.maintenanceRequestId,
        scheduledDateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        notes: `${TEST_TAG} Integration workflow assignment`
      });
      const createResObj = createRes();

      await createAppointmentHandler(createReqObj, createResObj);

      expect(createResObj.statusCode).toBe(201);
      expect(createResObj.jsonData.success).toBe(true);
      createdRecords.appointmentId = createResObj.jsonData.appointment.appointment_id;

      const completeReqObj = createReq(
        "PUT",
        {
          status: "completed",
          resolvedIssue: true,
          actualDateTime: new Date().toISOString(),
          result: "Issue fully resolved"
        },
        { id: String(createdRecords.appointmentId) }
      );
      const completeResObj = createRes();

      await appointmentByIdHandler(completeReqObj, completeResObj);

      expect(completeResObj.statusCode).toBe(200);
      expect(completeResObj.jsonData.success).toBe(true);
      expect(completeResObj.jsonData.appointment.status).toBe("completed");
      expect(completeResObj.jsonData.appointment.resolved_issue).toBe(true);

      const cronReqObj = createReq(
        "POST",
        {},
        {},
        { authorization: `Bearer ${process.env.CRON_SECRET}` }
      );
      const cronResObj = createRes();

      await closeResolvedRequestsHandler(cronReqObj, cronResObj);

      expect(cronResObj.statusCode).toBe(200);
      expect(cronResObj.jsonData.processed).toBeGreaterThanOrEqual(1);

      const { data: updatedRequest, error: requestError } = await supabase
        .from("maintenance_requests")
        .select("request_id, status, completed_at, admin_notes")
        .eq("request_id", createdRecords.maintenanceRequestId)
        .single();

      expect(requestError).toBeNull();
      expect(updatedRequest.status).toBe("Completed");
      expect(updatedRequest.completed_at).toBeTruthy();
      expect(updatedRequest.admin_notes || "").toContain(`Appointment ID: ${createdRecords.appointmentId}`);
    } finally {
      await cleanupTaggedData();
    }
  });
});
