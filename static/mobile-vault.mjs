/** Browser-only crypto. LSYNC1 = magic || HMAC(ciphertext) || OpenSSL Salted__ ciphertext. */
export const MAX_PLAIN_BYTES = 32 * 1024 * 1024;
const ITER = 200000;
const encoder = new TextEncoder();
const MAGIC = encoder.encode('LSYNC1\n');
const SALTED = encoder.encode('Salted__');
const VAULT = encoder.encode('LVAULT1\n');
// zlib's worst-case overhead fits comfortably inside this allowance.
const MAX_BLOB_BYTES = MAX_PLAIN_BYTES + 1024 * 1024;
function bytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  if (value.byteLength > MAX_BLOB_BYTES) throw new RangeError('Input exceeds size limit');
  return value.slice();
}
function password(value) {
  if (typeof value !== 'string' || !value || /[\r\n\0]/u.test(value)) throw new TypeError('Expected nonempty single-line password');
  return encoder.encode(value);
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
function starts(value, prefix) { return prefix.every((b, i) => value[i] === b); }
async function derive(pw, salt, length) {
  const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER}, key, length * 8));
}
async function macKey(pw) {
  return crypto.subtle.importKey('raw', await derive(pw, encoder.encode('lecture-sync-mac'), 32), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
async function transform(input, decompress) {
  const stream = new Blob([input]).stream().pipeThrough(decompress ? new DecompressionStream('deflate') : new CompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = []; let size = 0;
  const limit = decompress ? MAX_PLAIN_BYTES : MAX_BLOB_BYTES - 128;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RangeError('Decompressed/compressed payload exceeds size limit');
      chunks.push(value);
    }
    return concat(...chunks);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
export async function encryptBlob(plainUint8Array, passphraseString) {
  const plain = bytes(plainUint8Array), pw = password(passphraseString);
  if (plain.length > MAX_PLAIN_BYTES) throw new RangeError('Plaintext exceeds 32MB');
  const salt = crypto.getRandomValues(new Uint8Array(8));
  const material = await derive(pw, salt, 48);
  const key = await crypto.subtle.importKey('raw', material.slice(0, 32), 'AES-CBC', false, ['encrypt']);
  const compressed = await transform(plain, false);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-CBC', iv: material.slice(32)}, key, compressed));
  const ct = concat(SALTED, salt, encrypted);
  return concat(MAGIC, new Uint8Array(await crypto.subtle.sign('HMAC', await macKey(pw), ct)), ct);
}
export async function decryptBlob(blobUint8Array, passphraseString) {
  const blob = bytes(blobUint8Array), pw = password(passphraseString);
  const offset = MAGIC.length + 32;
  if (!starts(blob, MAGIC) || blob.length < offset + 32) throw new Error('Invalid LSYNC1 envelope');
  const ct = blob.slice(offset);
  // Never decrypt or decompress unauthenticated data.
  if (!await crypto.subtle.verify('HMAC', await macKey(pw), blob.slice(MAGIC.length, offset), ct)) throw new Error('Authentication failed');
  if (!starts(ct, SALTED) || (ct.length - 16) % 16) throw new Error('Invalid OpenSSL ciphertext');
  const material = await derive(pw, ct.slice(8, 16), 48);
  const key = await crypto.subtle.importKey('raw', material.slice(0, 32), 'AES-CBC', false, ['decrypt']);
  const compressed = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-CBC', iv: material.slice(32)}, key, ct.slice(16)));
  return transform(compressed, true);
}
/** Local rows win collisions, matching sync_client.py INSERT OR IGNORE semantics. */
export function mergeRecordPayload(local, remote) {
  for (const p of [local, remote]) {
    if (!p || p.schema !== 1 || !p.session || typeof p.session.id !== 'string') throw new TypeError('Invalid record payload');
  }
  if (local.session.id !== remote.session.id) throw new Error('Session IDs differ');
  const out = {schema: 1, session: structuredClone(local.session)};
  if (out.session.title == null || out.session.title === '') out.session.title = remote.session.title;
  for (const table of ['revisions', 'marks', 'documents', 'usage']) {
    const rows = new Map();
    for (const p of [local, remote]) {
      if (p[table] !== undefined && !Array.isArray(p[table])) throw new TypeError('Invalid record table');
      for (const row of p[table] ?? []) {
        if (!row || !['string', 'number'].includes(typeof row.id) || (typeof row.id === 'number' && !Number.isFinite(row.id))) throw new TypeError('Invalid row ID');
        if (!rows.has(row.id)) rows.set(row.id, structuredClone(row));
      }
    }
    out[table] = [...rows.keys()].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0).map(id => rows.get(id));
  }
  return out;
}
/** Password vault helpers persist only a versioned AES-GCM envelope, never JSON/passwords. */
export async function encryptVaultJSON(value, userPassword) {
  const pw = password(userPassword);
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Expected JSON value');
  const plain = encoder.encode(json);
  if (plain.length > MAX_PLAIN_BYTES) throw new RangeError('Vault exceeds 32MB');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', await derive(pw, salt, 32), 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: VAULT}, key, plain));
  return concat(VAULT, salt, iv, ct);
}
export async function decryptVaultJSON(blobUint8Array, userPassword) {
  const blob = bytes(blobUint8Array), pw = password(userPassword);
  if (!starts(blob, VAULT) || blob.length < VAULT.length + 44 || blob.length > MAX_PLAIN_BYTES + VAULT.length + 44) throw new Error('Invalid vault envelope');
  const n = VAULT.length;
  const key = await crypto.subtle.importKey('raw', await derive(pw, blob.slice(n, n + 16), 32), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: blob.slice(n + 16, n + 28), additionalData: VAULT}, key, blob.slice(n + 28));
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(plain));
}
export async function saveVault(storage, name, value, userPassword) {
  const blob = await encryptVaultJSON(value, userPassword);
  let binary = '';
  for (let i = 0; i < blob.length; i += 8192) binary += String.fromCharCode(...blob.subarray(i, i + 8192));
  storage.setItem(name, btoa(binary));
}
export async function loadVault(storage, name, userPassword) {
  const encoded = storage.getItem(name);
  if (encoded === null) return null;
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_BLOB_BYTES / 3) * 4) throw new RangeError('Invalid stored vault size');
  return decryptVaultJSON(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), userPassword);
}
