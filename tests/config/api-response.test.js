import { readApiJson } from '../../src/utils/api-response.js';

describe('readApiJson', () => {
  test('parses JSON bodies', async () => {
    const response = new Response(JSON.stringify({ success: true, message: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(readApiJson(response)).resolves.toEqual({
      success: true,
      message: 'ok',
    });
  });

  test('does not throw on HTML error pages', async () => {
    const response = new Response('<html>FUNCTION_INVOCATION_FAILED</html>', {
      status: 500,
      statusText: 'Internal Server Error',
    });
    await expect(readApiJson(response)).resolves.toEqual({
      success: false,
      error:
        'Server returned 500 Internal Server Error instead of a result: <html>FUNCTION_INVOCATION_FAILED</html>',
    });
  });

  test('does not throw on empty bodies', async () => {
    const response = new Response('', { status: 502, statusText: 'Bad Gateway' });
    await expect(readApiJson(response)).resolves.toEqual({
      success: false,
      error: 'Empty response from the server (502 Bad Gateway).',
    });
  });
});
