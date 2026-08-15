/**
 * Parse a fetch Response as JSON without throwing on HTML/text error pages
 * (e.g. Vercel "A server error has occurred" when a function crashes on import).
 *
 * @param {Response} response
 * @returns {Promise<{ ok: boolean, status: number, data: object|null, error: string|null }>}
 */
export async function readResponseJson(response) {
  const status = response?.status ?? 0;
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    return {
      ok: false,
      status,
      data: null,
      error: error?.message || 'Failed to read server response',
    };
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      status,
      data: null,
      error: `Server returned an empty response (${status || 'unknown'})`,
    };
  }

  try {
    const data = JSON.parse(trimmed);
    return { ok: true, status, data, error: null };
  } catch {
    const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 160);
    return {
      ok: false,
      status,
      data: null,
      error: `Server returned a non-JSON response (${status}): ${snippet}`,
    };
  }
}
