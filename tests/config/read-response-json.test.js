import { readResponseJson } from '../../src/utils/read-response-json.js';

function fakeResponse(body, status = 500) {
  return {
    status,
    text: async () => body,
  };
}

describe('readResponseJson', () => {
  test('parses JSON bodies', async () => {
    const parsed = await readResponseJson(
      fakeResponse(JSON.stringify({ success: false, error: 'nope' }), 500)
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.data.error).toBe('nope');
  });

  test('does not throw on Vercel-style HTML/text crashes', async () => {
    const parsed = await readResponseJson(
      fakeResponse('A server error has occurred', 500)
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('A server error has occurred');
    expect(parsed.error).toContain('500');
  });

  test('reports empty responses', async () => {
    const parsed = await readResponseJson(fakeResponse('   ', 502));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('empty response');
  });
});
