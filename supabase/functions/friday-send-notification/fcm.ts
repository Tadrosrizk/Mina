// Firebase Cloud Messaging (HTTP v1) helpers. The service-account key only ever lives in the function's secrets.
export interface ServiceAccount { project_id: string; client_email: string; private_key: string }

export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.project_id === 'string' && typeof j.client_email === 'string' && typeof j.private_key === 'string' && j.private_key.includes('BEGIN PRIVATE KEY')) return j;
  } catch (_) { /* fall through */ }
  return null;
}

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function makeJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging', iat: nowSec, exp: nowSec + 3600,
  }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claims));
  return head + '.' + claims + '.' + b64url(sig);
}

let cached: { token: string; exp: number } | null = null;
export async function getAccessToken(sa: ServiceAccount, f: typeof fetch = fetch, now: number = Date.now()): Promise<string> {
  if (cached && cached.exp - 60_000 > now) return cached.token;
  const jwt = await makeJwt(sa, Math.floor(now / 1000));
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('fcm_auth_failed:' + (j.error || r.status));
  cached = { token: j.access_token, exp: now + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}
export function _resetTokenCache() { cached = null; }

export function buildMessage(token: string, n: { id: string; title: string; body: string; screen: string }) {
  return {
    message: {
      token,
      notification: { title: n.title, body: n.body },
      data: { screen: n.screen, notification_id: n.id },            // FCM data values must be strings
      android: { priority: 'HIGH', notification: { channel_id: 'friday_alerts', sound: 'default' } },
    },
  };
}

export type SendResult =
  | { status: 'sent_to_provider'; messageId: string }
  | { status: 'invalid_token' | 'failed'; code: string; message: string; retryable: boolean };

// FCM tells us in error.details[].errorCode whether the token is dead (UNREGISTERED) or the failure is temporary.
export function classifyFcmError(httpStatus: number, body: any): SendResult & { status: 'invalid_token' | 'failed' } {
  const err = body && body.error ? body.error : {};
  const details = Array.isArray(err.details) ? err.details : [];
  const fcmCode = (details.find((d: any) => d && d.errorCode) || {}).errorCode || err.status || String(httpStatus);
  const message = String(err.message || '').slice(0, 200);
  if (fcmCode === 'UNREGISTERED' || fcmCode === 'SENDER_ID_MISMATCH' || httpStatus === 404) return { status: 'invalid_token', code: String(fcmCode), message, retryable: false };
  if (fcmCode === 'INVALID_ARGUMENT' && /registration token|token/i.test(message)) return { status: 'invalid_token', code: String(fcmCode), message, retryable: false };
  const retryable = httpStatus === 429 || httpStatus >= 500 || ['UNAVAILABLE', 'INTERNAL', 'QUOTA_EXCEEDED'].includes(String(fcmCode));
  return { status: 'failed', code: String(fcmCode), message, retryable };
}

export async function sendOne(sa: ServiceAccount, accessToken: string, token: string,
  n: { id: string; title: string; body: string; screen: string }, f: typeof fetch = fetch): Promise<SendResult> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try {
      r = await f(url, { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(buildMessage(token, n)) });
    } catch (e) {
      if (attempt === 0) continue;
      return { status: 'failed', code: 'network', message: String((e as Error).message || e).slice(0, 200), retryable: true };
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.name) return { status: 'sent_to_provider', messageId: String(j.name) };
    const c = classifyFcmError(r.status, j);
    if (c.retryable && attempt === 0) { await new Promise(res => setTimeout(res, 400)); continue; }
    return c;
  }
  return { status: 'failed', code: 'unknown', message: '', retryable: false };
}
