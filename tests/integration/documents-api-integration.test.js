// tests/integration/documents-api-integration.test.js
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import bcrypt from "bcryptjs";
import dotenv from 'dotenv';
import { createSafetyContext, requireProdTestOptIn } from "./safety-harness.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use real test database
const supabase = createClient(
  process.env.TEST_SUPABASE_URL,
  process.env.TEST_SUPABASE_SERVICE_KEY
);

const TEST_BUCKET = "test-documents";
const { prefix: TEST_PREFIX, tag: TEST_TAG } = createSafetyContext({
  prefix: "test-doc-api-int-",
  tag: "[TEST_DOC_API_INT]"
});

requireProdTestOptIn();

// Set environment variables for API handlers
process.env.VITE_SUPABASE_URL = process.env.TEST_SUPABASE_URL;
process.env.VITE_SUPABASE_SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY;

// Helper to create mock request
function createReq(method, query = {}, body = {}) {
  return {
    method,
    query,
    body,
    headers: {}
  };
}

// Helper to create mock response
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
  res.ended = false;
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

// Helper to create a test unit
const createTestUnit = async () => {
  const { data: unit, error } = await supabase
    .from("units")
    .insert({
      unit_number: `${TEST_PREFIX}unit-${Date.now()}`,
    })
    .select()
    .single();
  
  if (error) throw error;
  return unit;
};

// Helper to create a test lease
const createTestLease = async () => {
  const unit = await createTestUnit();
  
  const { data: lease, error } = await supabase
    .from("leases")
    .insert({
      unit_id: unit.unit_id,
      start_date: "2024-01-01",
      monthly_rent_amount: 1000,
      status: "active"
    })
    .select()
    .single();
  
  if (error) throw error;
  return lease;
};

// Clean up test data
const cleanupDatabase = async () => {
  await supabase.from("documents").delete().ilike("file_name", `${TEST_PREFIX}%`);
  await supabase.from("documents").delete().ilike("document_name", `${TEST_TAG}%`);

  const { data: testUnits } = await supabase
    .from("units")
    .select("unit_id")
    .ilike("unit_number", `${TEST_PREFIX}%`);

  const unitIds = (testUnits || []).map(unit => unit.unit_id);
  if (unitIds.length > 0) {
    await supabase.from("leases").delete().in("unit_id", unitIds);
    await supabase.from("units").delete().in("unit_id", unitIds);
  }

  const { data: testUsers } = await supabase
    .from("users")
    .select("user_id")
    .ilike("email", `${TEST_PREFIX}%`);

  const userIds = (testUsers || []).map(user => user.user_id);
  if (userIds.length > 0) {
    await supabase.from("clients").delete().in("user_id", userIds);
    await supabase.from("users").delete().in("user_id", userIds);
  }
  
  // Clean up test-documents bucket
  const { data: testFiles } = await supabase.storage
    .from(TEST_BUCKET)
    .list();
  
  if (testFiles && testFiles.length > 0) {
    const testFilePaths = testFiles
      .filter(file => file.name.startsWith(TEST_PREFIX))
      .map(file => file.name);

    if (testFilePaths.length > 0) {
      await supabase.storage
        .from(TEST_BUCKET)
        .remove(testFilePaths);
    }
  }

  // Clean up documents bucket (production bucket used by API)
  const { data: docFiles } = await supabase.storage
    .from("documents")
    .list();
  
  if (docFiles && docFiles.length > 0) {
    const docFilePaths = docFiles
      .filter(file => file.name.startsWith(TEST_PREFIX))
      .map(file => file.name);

    if (docFilePaths.length > 0) {
      await supabase.storage
        .from("documents")
        .remove(docFilePaths);
    }
  }
};

// Helper to create a test user
const createTestUser = async () => {
  const passwordHash = await bcrypt.hash("testpassword123", 10);
  const { data: user, error } = await supabase
    .from("users")
    .insert({
      email: `${TEST_PREFIX}user-${Date.now()}@test.com`,
      password_hash: passwordHash,
      role: "landlord"
    })
    .select()
    .single();
  
  if (error) throw error;
  return user;
};

describe("Documents API Integration Tests", () => {
  let getHandler, listHandler, uploadHandler;
  
  beforeAll(async () => {
    // Import actual API handlers
    const getModule = await import("../../api/documents/[id].js");
    const listModule = await import("../../api/documents/list.js");
    const uploadModule = await import("../../api/documents/upload.js");
    
    getHandler = getModule.default;
    listHandler = listModule.default;
    uploadHandler = uploadModule.default;
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  describe("GET /api/documents/[id] - Integration", () => {
    test("should get document metadata from real database", async () => {
      // Create a real document in the database
      const lease = await createTestLease();
      
      const { data: document } = await supabase
        .from("documents")
        .insert({
          lease_id: lease.lease_id,
          document_name: `${TEST_TAG} Integration Test Doc`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}test.pdf`,
          file_path: `${TEST_PREFIX}test.pdf`,
          storage_path: `${TEST_PREFIX}test.pdf`,
          is_signed: false
        })
        .select()
        .single();

      // Call API handler
      const req = createReq("GET", { id: document.document_id.toString() });
      const res = createRes();

      await getHandler(req, res);

      // Verify response
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.document).toBeDefined();
      expect(res.jsonData.document.document_id).toBe(document.document_id);
      expect(res.jsonData.document.document_name).toContain("Integration Test Doc");
      expect(res.jsonData.document.is_signed).toBe(false);
    });

    test("should return 404 for non-existent document", async () => {
      const req = createReq("GET", { id: "999999" });
      const res = createRes();

      await getHandler(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.error).toContain("not found");
    });

    test("should delete document from real database and storage", async () => {
      // Create a real document
      const lease = await createTestLease();
      
      // Upload a real file to the production 'documents' bucket (where API expects it)
      const testContent = Buffer.from("Test document content");
      const fileName = `${TEST_PREFIX}test-delete-${Date.now()}.txt`;
      
      await supabase.storage
        .from("documents")  // Use production bucket so API can find it
        .upload(fileName, testContent);

      const { data: document } = await supabase
        .from("documents")
        .insert({
          lease_id: lease.lease_id,
          document_name: `${TEST_TAG} Delete Test`,
          document_type: "lease_agreement",
          file_name: fileName,
          file_path: fileName,
          storage_path: fileName
        })
        .select()
        .single();

      // Call DELETE via API handler
      const req = createReq("DELETE", { id: document.document_id.toString() });
      const res = createRes();

      await getHandler(req, res);

      // Verify response
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      // Verify document deleted from database
      const { data: deletedDoc } = await supabase
        .from("documents")
        .select()
        .eq("document_id", document.document_id)
        .single();

      expect(deletedDoc).toBeNull();
      
      // Verify file deleted from storage by attempting to download it
      const { data: downloadedFile, error: downloadError } = await supabase.storage
        .from("documents")
        .download(fileName);

      // File should not exist - either error is defined or data is null
      expect(downloadError).toBeDefined();
      expect(downloadedFile).toBeNull();
    });
  });

  describe("GET /api/documents/list - Integration", () => {
    test("should list documents from real database without filters", async () => {
      // Create multiple real documents
      const lease1 = await createTestLease();
      const lease2 = await createTestLease();

      await supabase.from("documents").insert([
        {
          lease_id: lease1.lease_id,
          document_name: `${TEST_TAG} Doc 1`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}doc1.pdf`,
          file_path: `${TEST_PREFIX}doc1.pdf`,
          storage_path: `${TEST_PREFIX}doc1.pdf`
        },
        {
          lease_id: lease2.lease_id,
          document_name: `${TEST_TAG} Doc 2`,
          document_type: "notice",
          file_name: `${TEST_PREFIX}doc2.pdf`,
          file_path: `${TEST_PREFIX}doc2.pdf`,
          storage_path: `${TEST_PREFIX}doc2.pdf`
        }
      ]);

      // Call API handler
      const req = createReq("GET", {});
      const res = createRes();

      await listHandler(req, res);

      // Verify response
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.documents).toBeDefined();
      expect(res.jsonData.documents.length).toBeGreaterThanOrEqual(2);
    });

    test("should filter documents by document_type", async () => {
      const lease1 = await createTestLease();
      const lease2 = await createTestLease();

      await supabase.from("documents").insert([
        {
          lease_id: lease1.lease_id,
          document_name: `${TEST_TAG} Lease Doc`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}lease.pdf`,
          file_path: `${TEST_PREFIX}lease.pdf`,
          storage_path: `${TEST_PREFIX}lease.pdf`
        },
        {
          lease_id: lease2.lease_id,
          document_name: `${TEST_TAG} App Doc`,
          document_type: "filled_application",
          file_name: `${TEST_PREFIX}app.pdf`,
          file_path: `${TEST_PREFIX}app.pdf`,
          storage_path: `${TEST_PREFIX}app.pdf`
        }
      ]);

      // Filter by "lease" document_type
      const req = createReq("GET", { document_type: "lease" });
      const res = createRes();

      await listHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.documents.length).toBeGreaterThanOrEqual(1);
      
      // All returned documents should have document_type containing "lease"
      res.jsonData.documents.forEach(doc => {
        expect(doc.document_type).toContain("lease");
      });
    });

    test("should filter documents by lease_id", async () => {
      const lease1 = await createTestLease();
      const lease2 = await createTestLease();

      await supabase.from("documents").insert([
        {
          lease_id: lease1.lease_id,
          document_name: `${TEST_TAG} Lease 1 Doc 1`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}l1d1.pdf`,
          file_path: `${TEST_PREFIX}l1d1.pdf`,
          storage_path: `${TEST_PREFIX}l1d1.pdf`
        },
        {
          lease_id: lease1.lease_id,
          document_name: `${TEST_TAG} Lease 1 Doc 2`,
          document_type: "notice",
          file_name: `${TEST_PREFIX}l1d2.pdf`,
          file_path: `${TEST_PREFIX}l1d2.pdf`,
          storage_path: `${TEST_PREFIX}l1d2.pdf`
        },
        {
          lease_id: lease2.lease_id,
          document_name: `${TEST_TAG} Lease 2 Doc 1`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}l2d1.pdf`,
          file_path: `${TEST_PREFIX}l2d1.pdf`,
          storage_path: `${TEST_PREFIX}l2d1.pdf`
        }
      ]);

      // Filter by lease1 ID
      const req = createReq("GET", { lease_id: lease1.lease_id.toString() });
      const res = createRes();

      await listHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.documents.length).toBe(2);
      
      // All returned documents should belong to lease1
      res.jsonData.documents.forEach(doc => {
        expect(doc.lease_id).toBe(lease1.lease_id);
      });
    });

    test("should filter documents by is_signed status", async () => {
      const lease = await createTestLease();

      await supabase.from("documents").insert([
        {
          lease_id: lease.lease_id,
          document_name: `${TEST_TAG} Signed Doc`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}signed.pdf`,
          file_path: `${TEST_PREFIX}signed.pdf`,
          storage_path: `${TEST_PREFIX}signed.pdf`,
          is_signed: true,
          signed_at: new Date().toISOString()
        },
        {
          lease_id: lease.lease_id,
          document_name: `${TEST_TAG} Unsigned Doc`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}unsigned.pdf`,
          file_path: `${TEST_PREFIX}unsigned.pdf`,
          storage_path: `${TEST_PREFIX}unsigned.pdf`,
          is_signed: false
        }
      ]);

      // Filter by signed = true
      const req = createReq("GET", { is_signed: "true" });
      const res = createRes();

      await listHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.documents.length).toBeGreaterThanOrEqual(1);
      
      // All returned documents should be signed
      res.jsonData.documents.forEach(doc => {
        expect(doc.is_signed).toBe(true);
      });
    });

    test("should apply multiple filters simultaneously", async () => {
      const lease1 = await createTestLease();
      const lease2 = await createTestLease();

      await supabase.from("documents").insert([
        {
          lease_id: lease1.lease_id,
          document_name: `${TEST_TAG} Match All Filters`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}match.pdf`,
          file_path: `${TEST_PREFIX}match.pdf`,
          storage_path: `${TEST_PREFIX}match.pdf`,
          is_signed: true
        },
        {
          lease_id: lease1.lease_id,
          document_name: `${TEST_TAG} Wrong Type`,
          document_type: "notice",
          file_name: `${TEST_PREFIX}wrong.pdf`,
          file_path: `${TEST_PREFIX}wrong.pdf`,
          storage_path: `${TEST_PREFIX}wrong.pdf`,
          is_signed: true
        },
        {
          lease_id: lease2.lease_id,
          document_name: `${TEST_TAG} Wrong Lease`,
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}wrong2.pdf`,
          file_path: `${TEST_PREFIX}wrong2.pdf`,
          storage_path: `${TEST_PREFIX}wrong2.pdf`,
          is_signed: true
        }
      ]);

      // Apply all filters
      const req = createReq("GET", {
        lease_id: lease1.lease_id.toString(),
        document_type: "lease_agreement",
        is_signed: "true"
      });
      const res = createRes();

      await listHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.documents.length).toBe(1);
      expect(res.jsonData.documents[0].document_name).toContain("Match All Filters");
    });

    test("should return empty array when no documents match filters", async () => {
      const req = createReq("GET", { lease_id: "999999" });
      const res = createRes();

      await listHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.documents).toEqual([]);
    });
  });

  describe("POST /api/documents/upload - Integration", () => {
    test("should upload document to real storage and database", async () => {
      // Create a test user first to satisfy FK constraint
      const user = await createTestUser();
      const lease = await createTestLease();

      // Create a real PDF base64 string (minimal valid PDF)
      const pdfContent = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n210\n%%EOF";
      const base64Pdf = Buffer.from(pdfContent).toString('base64');

      const req = createReq("POST", {}, {
        file: `data:application/pdf;base64,${base64Pdf}`,
        file_name: `${TEST_PREFIX}integration-test-${Date.now()}.pdf`,
        lease_id: lease.lease_id,
        document_type: "lease_agreement",
        user_id: user.user_id // Provide user_id to satisfy FK constraint
      });
      const res = createRes();

      await uploadHandler(req, res);

      // Verify response
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.document_id).toBeDefined();

      // Verify document exists in database
      const { data: document } = await supabase
        .from("documents")
        .select()
        .eq("document_id", res.jsonData.document_id)
        .single();

      expect(document).toBeDefined();
      expect(document.lease_id).toBe(lease.lease_id);
      expect(document.document_type).toBe("lease_agreement");
      expect(document.created_by_user_id).toBe(user.user_id);  // Verify FK relationship

      // Verify file exists in storage
      const { data: storageFile, error: downloadError } = await supabase.storage
        .from("documents")
        .download(document.storage_path);

      expect(downloadError).toBeNull();
      expect(storageFile).toBeDefined();
    });

    test("should reject upload with missing required fields", async () => {
      const req = createReq("POST", {}, {
        file: "data:application/pdf;base64,JVBERi0=",
        file_name: `${TEST_PREFIX}test.pdf`
        // Missing required fields
      });
      const res = createRes();

      await uploadHandler(req, res);

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.jsonData.success).toBe(false);
      expect((res.jsonData.error || "").toLowerCase()).toMatch(/required|document_type|null value|database error/);
    });

    test("should handle invalid base64 data gracefully", async () => {
      const lease = await createTestLease();

      const req = createReq("POST", {}, {
        file: "data:application/pdf;base64,INVALID_BASE64!!!",
        file_name: `${TEST_PREFIX}test.pdf`,
        lease_id: lease.lease_id
      });
      const res = createRes();

      await uploadHandler(req, res);

      // Should handle error gracefully (either 400 or 500 depending on validation)
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.jsonData.success).toBe(false);
    });
  });
});
