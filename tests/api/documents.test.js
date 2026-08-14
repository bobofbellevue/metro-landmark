import { jest } from "@jest/globals";

// Mock data that will be returned by mocked Supabase
let mockQueryResult = null;
let mockStorageUploadResult = null;
let mockStorageDeleteResult = null;
let mockStorageListResult = null;
let mockStorageRemoveFn = null;

// Mock Supabase client
const createMockSupabaseClient = () => ({
  from: (table) => {
    const queryBuilder = {
      select: (columns) => {
        const selectBuilder = {
          eq: (field, value) => {
            selectBuilder.lastEq = { field, value };
            return selectBuilder;
          },
          single: () => Promise.resolve(mockQueryResult),
          order: (column, options) => selectBuilder,
          then: (resolve) => resolve(mockQueryResult)
        };
        return selectBuilder;
      },
      insert: (data) => ({
        select: () => ({
          single: () => Promise.resolve(mockQueryResult)
        })
      }),
      update: (data) => ({
        eq: (field, value) => ({
          select: () => ({
            single: () => Promise.resolve(mockQueryResult)
          })
        })
      }),
      delete: () => ({
        eq: (field, value) => Promise.resolve(mockQueryResult)
      })
    };
    return queryBuilder;
  },
  storage: {
    from: (bucket) => ({
      upload: (path, file, options) => Promise.resolve(mockStorageUploadResult),
      remove: (paths) => {
        if (mockStorageRemoveFn) mockStorageRemoveFn(paths);
        return Promise.resolve(mockStorageDeleteResult);
      },
      list: () => Promise.resolve(mockStorageListResult),
      download: (path) => Promise.resolve({
        data: new Blob(["test content"], { type: "application/pdf" }),
        error: null
      }),
      getPublicUrl: (path) => ({
        data: { publicUrl: `https://example.com/storage/${path}` }
      })
    })
  }
});

// Set required environment variables (API uses service role key)
process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";

// Mock @supabase/supabase-js
await jest.unstable_mockModule("@supabase/supabase-js", () => ({
  createClient: () => createMockSupabaseClient()
}));

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

describe("api/documents/[id]", () => {
  let handler;

  beforeAll(async () => {
    const module = await import("../../api/documents/[id].js");
    handler = module.default;
  });

  beforeEach(() => {
    mockQueryResult = null;
    mockStorageDeleteResult = null;
    mockStorageRemoveFn = null;
  });

  describe("GET method", () => {
    test("should return document metadata when document exists", async () => {
      const mockDocument = {
        document_id: 123,
        document_name: "Test Document",
        file_name: "test.pdf",
        document_type: "lease_agreement",
        is_signed: false,
        created_at: "2026-01-01T00:00:00Z"
      };

      mockQueryResult = {
        data: mockDocument,
        error: null
      };

      const req = createReq("GET", { id: "123" });
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData).toEqual({
        success: true,
        document: mockDocument
      });
    });

    test("should return 404 when document not found", async () => {
      mockQueryResult = {
        data: null,
        error: { code: "PGRST116", message: "Not found" }
      };

      const req = createReq("GET", { id: "999" });
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.jsonData).toMatchObject({
        success: false,
        error: "Document not found"
      });
    });

    test("should return 400 when document ID is missing", async () => {
      const req = createReq("GET", {});
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData).toMatchObject({
        success: false,
        error: "Document ID is required"
      });
    });

    test("should return 500 on database error", async () => {
      mockQueryResult = {
        data: null,
        error: { code: "500", message: "Database connection failed" }
      };

      const req = createReq("GET", { id: "123" });
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.jsonData.success).toBe(false);
    });
  });

  describe("DELETE method", () => {
    test("should delete document and storage file successfully", async () => {
      // Track storage remove calls
      const removedPaths = [];
      mockStorageRemoveFn = jest.fn((paths) => {
        removedPaths.push(...paths);
      });

      // First query to get document
      mockQueryResult = {
        data: {
          document_id: 123,
          storage_path: "documents/test.pdf",
          file_path: "documents/test.pdf"
        },
        error: null
      };

      mockStorageDeleteResult = { data: null, error: null };

      const req = createReq("DELETE", { id: "123" });
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData).toMatchObject({
        success: true,
        message: "Document deleted successfully"
      });
      
      // Verify storage deletion was called
      expect(mockStorageRemoveFn).toHaveBeenCalled();
      expect(removedPaths).toContain("documents/test.pdf");
    });

    test("should return 404 when document to delete not found", async () => {
      mockQueryResult = {
        data: null,
        error: { code: "PGRST116", message: "Not found" }
      };

      const req = createReq("DELETE", { id: "999" });
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.jsonData).toMatchObject({
        success: false,
        error: "Document not found"
      });
    });
  });

  describe("OPTIONS method", () => {
    test("should handle OPTIONS request for CORS", async () => {
      const req = createReq("OPTIONS", { id: "123" });
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);
      expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    });
  });

  describe("Unsupported methods", () => {
    test("should return 405 for unsupported methods", async () => {
      const req = createReq("POST", { id: "123" });
      const res = createRes();

      await handler(req, res);

      expect(res.statusCode).toBe(405);
      expect(res.jsonData).toMatchObject({
        success: false,
        error: "Method not allowed"
      });
    });
  });
});

describe("api/documents/list", () => {
  let handler;

  beforeAll(async () => {
    const module = await import("../../api/documents/list.js");
    handler = module.default;
  });

  beforeEach(() => {
    mockQueryResult = null;
  });

  test("should list all documents without filters", async () => {
    const mockDocuments = [
      {
        document_id: 1,
        document_name: "Doc 1",
        document_type: "lease_agreement",
        created_at: "2026-01-01T00:00:00Z"
      },
      {
        document_id: 2,
        document_name: "Doc 2",
        document_type: "notice",
        created_at: "2025-12-31T00:00:00Z"
      }
    ];

    mockQueryResult = {
      data: mockDocuments,
      error: null
    };

    const req = createReq("GET", {});
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toEqual({
      success: true,
      documents: mockDocuments
    });
  });

  test("should filter documents by documentable_type", async () => {
    const mockDocuments = [
      {
        document_id: 1,
        documentable_type: "lease",
        document_name: "Lease Doc"
      }
    ];

    mockQueryResult = {
      data: mockDocuments,
      error: null
    };

    const req = createReq("GET", { documentable_type: "lease" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.documents).toEqual(mockDocuments);
  });

  test("should filter documents by documentable_id", async () => {
    const mockDocuments = [
      {
        document_id: 1,
        documentable_id: 456,
        document_name: "Entity Doc"
      }
    ];

    mockQueryResult = {
      data: mockDocuments,
      error: null
    };

    const req = createReq("GET", { documentable_id: "456" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.documents).toEqual(mockDocuments);
  });

  test("should filter documents by document_type", async () => {
    const mockDocuments = [
      {
        document_id: 1,
        document_type: "lease_agreement",
        document_name: "Lease"
      }
    ];

    mockQueryResult = {
      data: mockDocuments,
      error: null
    };

    const req = createReq("GET", { document_type: "lease_agreement" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.documents).toEqual(mockDocuments);
  });

  test("should filter documents by is_signed status", async () => {
    const mockDocuments = [
      {
        document_id: 1,
        is_signed: true,
        document_name: "Signed Doc"
      }
    ];

    mockQueryResult = {
      data: mockDocuments,
      error: null
    };

    const req = createReq("GET", { is_signed: "true" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.documents).toEqual(mockDocuments);
  });

  test("should apply multiple filters simultaneously", async () => {
    const mockDocuments = [
      {
        document_id: 1,
        documentable_type: "lease",
        documentable_id: 123,
        document_type: "lease_agreement",
        is_signed: true
      }
    ];

    mockQueryResult = {
      data: mockDocuments,
      error: null
    };

    const req = createReq("GET", {
      documentable_type: "lease",
      documentable_id: "123",
      document_type: "lease_agreement",
      is_signed: "true"
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.documents).toEqual(mockDocuments);
  });

  test("should return empty array when no documents match filters", async () => {
    mockQueryResult = {
      data: [],
      error: null
    };

    const req = createReq("GET", { documentable_id: "999999" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toEqual({
      success: true,
      documents: []
    });
  });

  test("should return 500 on database error", async () => {
    mockQueryResult = {
      data: null,
      error: { message: "Database connection failed" }
    };

    const req = createReq("GET", {});
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.error).toBeDefined();
  });

  test("should return 405 for non-GET methods", async () => {
    const req = createReq("POST", {});
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.jsonData).toMatchObject({
      success: false,
      error: "Method not allowed. Use GET."
    });
  });

  test("should handle OPTIONS request for CORS", async () => {
    const req = createReq("OPTIONS", {});
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
  });
});

describe("api/documents/upload", () => {
  let handler;

  beforeAll(async () => {
    const module = await import("../../api/documents/upload.js");
    handler = module.default;
  });

  beforeEach(() => {
    mockQueryResult = null;
    mockStorageUploadResult = null;
  });

  test("should upload document successfully", async () => {
    mockStorageUploadResult = {
      data: {
        path: "documents/test-file.pdf",
        id: "file-id-123",
        fullPath: "documents/test-file.pdf"
      },
      error: null
    };

    mockQueryResult = {
      data: {
        document_id: 1,
        document_name: "Test Upload",
        file_name: "test-file.pdf",
        storage_path: "documents/test-file.pdf"
      },
      error: null
    };

    const req = createReq("POST", {}, {
      file: "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PmVuZG9iag==",
      file_name: "test-file.pdf",
      documentable_type: "lease",
      documentable_id: 123,
      document_type: "lease_agreement"
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.document_id).toBeDefined();
  });

  test("should return 400 when required fields are missing", async () => {
    const req = createReq("POST", {}, {
      file_name: "test.pdf"
      // Missing file, documentable_type, documentable_id
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
  });

  test("should validate file type", async () => {
    const req = createReq("POST", {}, {
      file: "data:application/octet-stream;base64,base64data",
      file_name: "malicious.exe",
      documentable_type: "lease",
      documentable_id: 123
    });
    const res = createRes();

    await handler(req, res);

    // Should reject invalid file types
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.jsonData.success).toBe(false);
  });

  test("should handle storage upload errors", async () => {
    mockStorageUploadResult = {
      data: null,
      error: { message: "Storage quota exceeded" }
    };

    const req = createReq("POST", {}, {
      file: "data:application/pdf;base64,JVBERi0xLjQK",
      file_name: "test.pdf",
      documentable_type: "lease",
      documentable_id: 123,
      document_type: "lease_agreement"
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.jsonData.success).toBe(false);
  });

  test("should return 405 for non-POST methods", async () => {
    const req = createReq("GET", {});
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.jsonData.success).toBe(false);
  });
});
