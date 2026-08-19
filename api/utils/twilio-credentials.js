function trimEnv(env, key) {
  const value = env?.[key];
  return value == null ? '' : String(value).trim();
}

function isAccountSid(value) {
  return /^AC[0-9a-f]{32}$/i.test(value) || value.startsWith('AC');
}

function isApiKeySid(value) {
  return value.startsWith('SK');
}

/**
 * Twilio accepts either Account SID + Auth Token, or API key + secret + Account SID.
 * Deployments often put an SK… API key in TWILIO_ACCOUNT_SID; the SDK then throws.
 */
export function resolveTwilioCredentials(env = process.env) {
  const accountSidRaw = trimEnv(env, 'TWILIO_ACCOUNT_SID');
  const authToken = trimEnv(env, 'TWILIO_AUTH_TOKEN');
  const apiKeyEnv =
    trimEnv(env, 'TWILIO_API_KEY') || trimEnv(env, 'TWILIO_API_KEY_SID');
  const apiSecret =
    trimEnv(env, 'TWILIO_API_SECRET') || trimEnv(env, 'TWILIO_API_KEY_SECRET');

  let accountSid = isAccountSid(accountSidRaw) ? accountSidRaw : '';
  if (!accountSid) {
    const alt = trimEnv(env, 'TWILIO_SID');
    if (isAccountSid(alt)) accountSid = alt;
  }

  const apiKey = isApiKeySid(apiKeyEnv)
    ? apiKeyEnv
    : isApiKeySid(accountSidRaw)
      ? accountSidRaw
      : '';

  if (apiKey && accountSid && (apiSecret || authToken)) {
    return {
      mode: 'api_key',
      accountSid,
      apiKey,
      apiSecret: apiSecret || authToken,
    };
  }

  if (apiKey && !accountSid) {
    return {
      configured: true,
      error:
        'TWILIO_ACCOUNT_SID is an API key (SK…). Set TWILIO_ACCOUNT_SID to the Account SID (AC…) and put the API key in TWILIO_API_KEY, with TWILIO_API_SECRET (or TWILIO_AUTH_TOKEN) as the key secret.',
    };
  }

  if (accountSid && authToken) {
    return {
      mode: 'auth_token',
      accountSid,
      authToken,
    };
  }

  return { configured: false };
}
