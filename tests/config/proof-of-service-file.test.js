import {
  isAllowedProofOfServiceFile,
  normalizeProofOfServiceFiles,
  proofOfServiceFileLabel,
  PROOF_OF_SERVICE_DOCUMENT_TYPE,
} from '../../src/utils/proof-of-service-file.js';
import { formatDocumentTypeLabel } from '../../src/config/document-types.js';

describe('proof-of-service file helpers', () => {
  test('accepts PDF and common image types, including empty iPhone MIME with extension', () => {
    expect(
      isAllowedProofOfServiceFile({ type: 'application/pdf', name: 'receipt.pdf' })
    ).toBe(true);
    expect(
      isAllowedProofOfServiceFile({ type: 'image/jpeg', name: 'door.jpg' })
    ).toBe(true);
    expect(isAllowedProofOfServiceFile({ type: '', name: 'IMG_1234.HEIC' })).toBe(
      true
    );
    expect(
      isAllowedProofOfServiceFile({ type: 'application/zip', name: 'x.zip' })
    ).toBe(false);
  });

  test('labels uploaded file metadata', () => {
    expect(proofOfServiceFileLabel(null)).toBe('');
    expect(
      proofOfServiceFileLabel({ file_name: 'certified-mail.pdf', document_id: 9 })
    ).toBe('certified-mail.pdf');
  });

  test('normalizes a single file or a list', () => {
    expect(normalizeProofOfServiceFiles(null)).toEqual([]);
    expect(normalizeProofOfServiceFiles({ file_name: 'a.pdf', document_id: 1 })).toEqual([
      { file_name: 'a.pdf', document_id: 1 },
    ]);
    expect(
      normalizeProofOfServiceFiles([
        { file_name: 'a.pdf', document_id: 1 },
        { file_name: 'b.jpg', document_id: 2 },
        null,
      ])
    ).toEqual([
      { file_name: 'a.pdf', document_id: 1 },
      { file_name: 'b.jpg', document_id: 2 },
    ]);
  });

  test('catalog includes proof_of_service', () => {
    expect(PROOF_OF_SERVICE_DOCUMENT_TYPE).toBe('proof_of_service');
    expect(formatDocumentTypeLabel('proof_of_service')).toBe('Proof of Service');
  });
});
