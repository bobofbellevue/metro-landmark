export async function readApiJson(response) {
  const status = response?.status;
  const statusText = response?.statusText || '';
  const statusLabel = [status, statusText].filter(Boolean).join(' ');

  let text = '';
  try {
    text = await response.text();
  } catch {
    return {
      success: false,
      error: statusLabel
        ? `Could not read the server response (${statusLabel}).`
        : 'Could not read the server response.',
    };
  }

  if (!text) {
    return {
      success: false,
      error: statusLabel
        ? `Empty response from the server (${statusLabel}).`
        : 'Empty response from the server.',
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      success: false,
      error: statusLabel
        ? `Server returned ${statusLabel} instead of a result: ${snippet}`
        : `Server returned an unreadable result: ${snippet}`,
    };
  }
}
