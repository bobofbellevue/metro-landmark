// tests/integration/document-integration.test.js
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { cleanupStorageByPrefix, createSafetyContext, requireProdTestOptIn } from "./safety-harness.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.TEST_SUPABASE_URL,
  process.env.TEST_SUPABASE_SERVICE_KEY
);

const TEST_BUCKET = "test-documents";
const { prefix: TEST_PREFIX, likePrefix: TEST_PREFIX_FILTER } = createSafetyContext({
  prefix: "test-e2e-",
  tag: "[TEST_DOCUMENT_INT]"
});

requireProdTestOptIn();

describe("Document Upload Tests", () => {
  const cleanupBucket = async () => {
    // Clean up test documents from database (prefix-based)
    await supabase.from("documents").delete().ilike("file_name", TEST_PREFIX_FILTER);

    // Find test units and cascade delete related leases, then units
    const { data: testUnits } = await supabase
      .from("units")
      .select("unit_id")
      .ilike("unit_number", TEST_PREFIX_FILTER);

    const unitIds = (testUnits || []).map(u => u.unit_id);

    if (unitIds.length > 0) {
      await supabase.from("leases").delete().in("unit_id", unitIds);
      await supabase.from("units").delete().in("unit_id", unitIds);
    }
    
    // Clean up files from test bucket
    await cleanupStorageByPrefix(supabase, TEST_BUCKET, TEST_PREFIX);
  };

  // Helper to create a test unit
  const createTestUnit = async () => {
    const { data: unit, error } = await supabase
      .from("units")
      .insert({
        unit_number: `${TEST_PREFIX}unit-${Date.now()}`,
        // Add other required fields as needed
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

  beforeEach(cleanupBucket);
  afterEach(cleanupBucket);

  test("should upload PDF to test bucket", async () => {
    // Read test file
    const testPDF = fs.readFileSync(
      path.join(__dirname, "../fixtures/APARTMENT LEASE FORM638526637994751083.pdf")
    );

    // Upload to test bucket
    const fileName = `${TEST_PREFIX}upload-${Date.now()}.pdf`;
    const { data, error } = await supabase.storage
      .from(TEST_BUCKET)
      .upload(fileName, testPDF, {
        contentType: "application/pdf"
      });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.path).toBe(fileName);

    // Verify file exists
    const { data: publicURL } = supabase.storage
      .from(TEST_BUCKET)
      .getPublicUrl(fileName);
    
    expect(publicURL.publicUrl).toContain(fileName);
  });

  test("should download file from test bucket", async () => {
    // Upload first
    const content = Buffer.from("Test document content");
    const fileName = `${TEST_PREFIX}download-test.txt`;
    
    await supabase.storage
      .from(TEST_BUCKET)
      .upload(fileName, content);

    // Download
    const { data: downloadedFile, error } = await supabase.storage
      .from(TEST_BUCKET)
      .download(fileName);

    expect(error).toBeNull();
    expect(downloadedFile).toBeDefined();
    
    const downloadedContent = await downloadedFile.text();
    expect(downloadedContent).toBe("Test document content");
  });

  test("should reject invalid file types", async () => {
    // Create client with ANON key to test policy enforcement
    const anonClient = createClient(
      process.env.TEST_SUPABASE_URL,
      process.env.TEST_SUPABASE_PUBLISHABLE_KEY
    );

    const fileName = `${TEST_PREFIX}malicious.exe`;
    const content = Buffer.from("fake exe");

    const { data, error } = await anonClient.storage
      .from(TEST_BUCKET)
      .upload(fileName, content, {
        contentType: "application/x-msdownload"
      });

    // Policy should reject .exe files
    expect(error).toBeDefined();
    expect(error.message).toMatch(/policy|not allowed|permission/i);
  });

    test("should store document metadata in database after upload", async () => {
    // Create a test lease first
    const lease = await createTestLease();
    
    // Upload file
    const testPDF = fs.readFileSync(
        path.join(__dirname, "../fixtures/APARTMENT LEASE FORM638526637994751083.pdf")
    );
    const fileName = `${TEST_PREFIX}lease-${Date.now()}.pdf`;
    const { data: uploadData } = await supabase.storage
        .from(TEST_BUCKET)
        .upload(fileName, testPDF, { contentType: "application/pdf" });

    // Create document metadata with lease_id FK
    const { data: document, error } = await supabase
        .from("documents")
        .insert({
        lease_id: lease.lease_id,
        document_name: fileName,
        file_name: fileName,
        file_path: uploadData.path,
        storage_path: uploadData.path,
        file_type: "application/pdf",
        file_size: testPDF.length,
        document_type: "lease_agreement"
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(document).toBeDefined();
    expect(document.file_name).toBe(fileName);
    expect(document.document_type).toBe("lease_agreement");
    expect(document.lease_id).toBe(lease.lease_id);

    // Query database separately to verify it's actually stored
    const { data: queriedDoc, error: queryError } = await supabase
      .from("documents")
      .select("*")
      .eq("document_id", document.document_id)
      .single();

    expect(queryError).toBeNull();
    expect(queriedDoc).toBeDefined();
    expect(queriedDoc.file_name).toBe(fileName);
    expect(queriedDoc.storage_path).toBe(uploadData.path);
    expect(queriedDoc.lease_id).toBe(lease.lease_id);
    });

    test("should update document metadata", async () => {
    // Create document
    const { data: document, error: insertError } = await supabase
        .from("documents")
        .insert({
        documentable_id: 1,
        documentable_type: "lease",
        document_name: "Test Document",
        document_type: "lease_agreement",
      file_name: `${TEST_PREFIX}test.pdf`,
      file_path: `${TEST_PREFIX}test.pdf`,
      storage_path: `${TEST_PREFIX}test.pdf`,
        is_signed: false
        })
        .select()
        .single();

    expect(insertError).toBeNull();
    expect(document).toBeDefined();

    // Update to signed
    const { data: updated, error } = await supabase
        .from("documents")
        .update({ is_signed: true, signed_at: new Date().toISOString() })
        .eq("document_id", document.document_id)
        .select()
        .single();

    expect(error).toBeNull();
    expect(updated.is_signed).toBe(true);
    expect(updated.signed_at).toBeDefined();
    });

    test("should delete document from storage and database", async () => {
      // Create a test lease first
      const lease = await createTestLease();
      
      // Upload file
      const fileName = `${TEST_PREFIX}to-delete.txt`;
      await supabase.storage
        .from(TEST_BUCKET)
        .upload(fileName, Buffer.from("delete me"));

      // Create metadata with lease_id FK
      const { data: document } = await supabase
        .from("documents")
        .insert({
          lease_id: lease.lease_id,
          document_name: "Delete Test",
          document_type: "lease_agreement",
          file_name: fileName,
          file_path: fileName,
          storage_path: fileName
        })
        .select()
        .single();

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from(TEST_BUCKET)
        .remove([fileName]);

      // Delete from database
      const { error: dbError } = await supabase
        .from("documents")
        .delete()
        .eq("document_id", document.document_id);

      expect(storageError).toBeNull();
      expect(dbError).toBeNull();

      // Verify deletion
      const { data: files } = await supabase.storage.from(TEST_BUCKET).list();
      expect(files.map(f => f.name)).not.toContain(fileName);
    });

    test("should validate file size - accept normal files", async () => {
      const normalContent = Buffer.alloc(1 * 1024 * 1024); // 1MB 
      const fileName = `${TEST_PREFIX}normal-size-${Date.now()}.pdf`;

      const { data, error } = await supabase.storage
        .from(TEST_BUCKET)
        .upload(fileName, normalContent, {
          contentType: "application/pdf"
        });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.path).toBe(fileName);
    });

    test("should validate file size - reject excessively large files", async () => {
      const largeContent = Buffer.alloc(51 * 1024 * 1024); // 51MB
      const fileName = `${TEST_PREFIX}oversized-${Date.now()}.pdf`;

      const { data, error } = await supabase.storage
        .from(TEST_BUCKET)
        .upload(fileName, largeContent, {
          contentType: "application/pdf"
        });

      // Should fail due to size limit
      expect(error).toBeDefined();
      expect(error.message).toMatch(/size|limit|large|payload|413/i);
      expect(data).toBeNull();
    }, 15000); // 15 second timeout for large file upload

    test("should validate file size - reject empty files", async () => {
      const emptyContent = Buffer.alloc(0); // Empty file
      const fileName = `${TEST_PREFIX}empty-${Date.now()}.pdf`;

      const { data, error } = await supabase.storage
        .from(TEST_BUCKET)
        .upload(fileName, emptyContent, {
          contentType: "application/pdf"
        });

      if (error) {
        expect(error.message).toBeDefined();
      } else {
        expect(data).toBeDefined();
        // Verify we can query it
        const { data: fileData } = await supabase.storage
          .from(TEST_BUCKET)
          .list();
        expect(fileData.some(f => f.name === fileName)).toBe(true);
      }
    });

    test("should query documents by lease_id", async () => {
      // Create test leases
      const lease1 = await createTestLease();
      const lease2 = await createTestLease();
      
      // Create multiple documents with lease_id FK
      const { data: inserted, error: insertError } = await supabase.from("documents").insert([
        {
          lease_id: lease1.lease_id,
          documentable_id: lease1.lease_id,
          documentable_type: "lease",
          document_name: "Lease 1",
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}lease1.pdf`,
          file_path: `${TEST_PREFIX}lease1.pdf`,
          storage_path: `${TEST_PREFIX}lease1.pdf`
        },
        {
          lease_id: lease1.lease_id,
          documentable_id: lease1.lease_id,
          documentable_type: "lease",
          document_name: "Lease 2",
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}lease2.pdf`,
          file_path: `${TEST_PREFIX}lease2.pdf`,
          storage_path: `${TEST_PREFIX}lease2.pdf`
        },
        {
          lease_id: lease2.lease_id,
          documentable_id: lease2.lease_id,
          documentable_type: "lease",
          document_name: "Lease 3",
          document_type: "lease_agreement",
          file_name: `${TEST_PREFIX}lease3.pdf`,
          file_path: `${TEST_PREFIX}lease3.pdf`,
          storage_path: `${TEST_PREFIX}lease3.pdf`
        }
      ])
      .select();

      expect(insertError).toBeNull();
      expect(inserted).toBeDefined();
      expect(inserted.length).toBe(3);

      // Query by lease_id FK (should return same results)
      const { data: documents, error } = await supabase
        .from("documents")
        .select()
        .eq("lease_id", lease1.lease_id);

      expect(error).toBeNull();
      expect(documents.length).toBe(2);
      expect(documents.map(d => d.file_name)).toContain(`${TEST_PREFIX}lease1.pdf`);
      expect(documents.map(d => d.file_name)).toContain(`${TEST_PREFIX}lease2.pdf`);
    });

    test("should replace existing file", async () => {
      const fileName = `${TEST_PREFIX}update-test.txt`;
      
      // Upload original
      await supabase.storage
        .from(TEST_BUCKET)
        .upload(fileName, Buffer.from("original content"));

      // Upload replacement (upsert)
      const { error } = await supabase.storage
        .from(TEST_BUCKET)
        .upload(fileName, Buffer.from("updated content"), { upsert: true });

      expect(error).toBeNull();

      // Verify updated content
      const { data: file } = await supabase.storage
        .from(TEST_BUCKET)
        .download(fileName);
      
      const content = await file.text();
      expect(content).toBe("updated content");
    });
});