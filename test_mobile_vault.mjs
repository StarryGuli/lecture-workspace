import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHmac, pbkdf2Sync} from 'node:crypto';
import {encryptBlob, decryptBlob, mergeRecordPayload, encryptVaultJSON, decryptVaultJSON, saveVault, loadVault, MAX_PLAIN_BYTES} from './static/mobile-vault.mjs';

// Import source only: replace passphrase() so no credentials or user data are read.
const PYTHON = `
import sys,json,base64,importlib.util,zlib
spec=importlib.util.spec_from_file_location('synthetic_sync','sync_client.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
p=json.load(sys.stdin); pw=p['password'].encode(); m.passphrase=lambda:pw
if p['op']=='encrypt': result=m.encrypt(base64.b64decode(p['data']))
elif p['op']=='decrypt': result=m.decrypt(base64.b64decode(p['data']))
elif p['op']=='bomb':
 ct=m._openssl(False,zlib.compress(b'x'*(32*1024*1024+1)),pw)
 result=m.MAGIC+m.hmac.new(m.mac_key(pw),ct,'sha256').digest()+ct
elif p['op']=='malformed':
 ct=m._openssl(False,b'not zlib',pw)
 result=m.MAGIC+m.hmac.new(m.mac_key(pw),ct,'sha256').digest()+ct
print(base64.b64encode(result).decode())
`;
const pw = 'synthetic-only-credential-测试';
const plain = new TextEncoder().encode(JSON.stringify({schema: 1, text: 'Synthetic lecture 同步\n', values: [0, 1, 2]}));
function python(op, data = new Uint8Array()) {
  const result = spawnSync('python3', ['-B', '-c', PYTHON], {input: JSON.stringify({op, password: pw, data: Buffer.from(data).toString('base64')}), encoding: 'utf8', maxBuffer: 48 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr);
  return new Uint8Array(Buffer.from(result.stdout.trim(), 'base64'));
}
test('real Python/OpenSSL encrypt -> browser decrypt and browser encrypt -> Python/OpenSSL decrypt', async () => {
  assert.deepEqual(await decryptBlob(python('encrypt', plain), pw), plain);
  const encrypted = await encryptBlob(plain, pw);
  assert.equal(new TextDecoder().decode(encrypted.slice(0, 7)), 'LSYNC1\n');
  assert.equal(new TextDecoder().decode(encrypted.slice(39, 47)), 'Salted__');
  assert.deepEqual(python('decrypt', encrypted), plain);
  assert.deepEqual(await decryptBlob(encrypted, pw), plain);
  assert.notDeepEqual(await encryptBlob(plain, pw), encrypted);
});
test('empty and binary data round trip, including sliced typed arrays', async () => {
  for (const data of [new Uint8Array(), Uint8Array.from({length: 256}, (_, i) => i), new Uint8Array([99, 0, 1, 99]).subarray(1, 3)]) {
    const encrypted = await encryptBlob(data, pw);
    assert.deepEqual(await decryptBlob(encrypted, pw), new Uint8Array(data));
    assert.deepEqual(python('decrypt', encrypted), new Uint8Array(data));
  }
});
test('wrong passwords, corruption, truncation and invalid types fail closed', async () => {
  const encrypted = await encryptBlob(plain, pw);
  await assert.rejects(decryptBlob(encrypted, 'wrong'), /Authentication/);
  for (const i of [0, 7, 39, 47, encrypted.length - 1]) {
    const corrupt = encrypted.slice(); corrupt[i] ^= 1;
    await assert.rejects(decryptBlob(corrupt, pw));
  }
  for (const n of [0, 7, 39, 70, encrypted.length - 1]) await assert.rejects(decryptBlob(encrypted.slice(0, n), pw));
  for (const input of [[], 'text', new ArrayBuffer(4), new Uint16Array(4), null]) {
    await assert.rejects(encryptBlob(input, pw), TypeError);
    await assert.rejects(decryptBlob(input, pw), TypeError);
  }
  for (const p of ['', null, 123, 'a\nb', 'a\0b']) await assert.rejects(encryptBlob(plain, p), TypeError);
});
test('authenticated malformed inner envelope and zlib fail; authenticated expansion bomb is bounded', async () => {
  const ct = Buffer.alloc(32);
  const tag = createHmac('sha256', pbkdf2Sync(pw, 'lecture-sync-mac', 200000, 32, 'sha256')).update(ct).digest();
  await assert.rejects(decryptBlob(new Uint8Array(Buffer.concat([Buffer.from('LSYNC1\n'), tag, ct])), pw), /OpenSSL/);
  await assert.rejects(decryptBlob(python('malformed'), pw));
  await assert.rejects(decryptBlob(python('bomb'), pw), /size limit/);
  await assert.rejects(encryptBlob(new Uint8Array(MAX_PLAIN_BYTES + 1), pw), RangeError);
  await assert.rejects(decryptBlob(new Uint8Array(MAX_PLAIN_BYTES + 1024 * 1024 + 1), pw), RangeError);
});
test('exact 32MiB decompression boundary succeeds', async () => {
  const data = new Uint8Array(MAX_PLAIN_BYTES);
  const encrypted = await encryptBlob(data, pw);
  assert.deepEqual(await decryptBlob(encrypted, pw), data);
});
test('merge preserves immutable local rows and manual title, unions all tables without mutating inputs', () => {
  const local = {schema: 1, session: {id: 'session', title: 'Manual title'}};
  const remote = {schema: 1, session: {id: 'session', title: 'Remote title'}};
  for (const t of ['revisions', 'marks', 'documents', 'usage']) {
    local[t] = [{id: 'b', nested: {text: 'original'}}];
    remote[t] = [{id: 'b', nested: {text: 'changed'}}, {id: 'a', nested: {text: 'new'}}];
  }
  const before = structuredClone({local, remote});
  const merged = mergeRecordPayload(local, remote);
  assert.equal(merged.session.title, 'Manual title');
  for (const t of ['revisions', 'marks', 'documents', 'usage']) {
    assert.deepEqual(merged[t].map(r => r.id), ['a', 'b']);
    assert.equal(merged[t][1].nested.text, 'original');
    merged[t][1].nested.text = 'result mutation';
  }
  assert.deepEqual({local, remote}, before);
  for (const title of ['', null, undefined]) assert.equal(mergeRecordPayload({...local, session: {id: 'session', title}}, remote).session.title, 'Remote title');
  assert.throws(() => mergeRecordPayload(local, {...remote, session: {id: 'other'}}));
  assert.throws(() => mergeRecordPayload(local, {...remote, schema: 2}));
});
test('AES-GCM JSON vault stores only ciphertext and rejects tampering/wrong passwords', async () => {
  const value = {token: 'synthetic-secret-marker', nested: [true, null, '中文']};
  const blob = await encryptVaultJSON(value, pw);
  assert.deepEqual(await decryptVaultJSON(blob, pw), value);
  assert.notDeepEqual(await encryptVaultJSON(value, pw), blob);
  await assert.rejects(decryptVaultJSON(blob, 'wrong'));
  for (const i of [0, 8, 24, blob.length - 1]) {
    const corrupt = blob.slice(); corrupt[i] ^= 1;
    await assert.rejects(decryptVaultJSON(corrupt, pw));
  }
  const data = new Map();
  const storage = {setItem: (k, v) => data.set(k, v), getItem: k => data.get(k) ?? null};
  assert.equal(await loadVault(storage, 'missing', pw), null);
  await saveVault(storage, 'test', value, pw);
  const stored = data.get('test');
  assert.ok(!stored.includes(value.token));
  assert.ok(!Buffer.from(stored, 'base64').includes(Buffer.from(value.token)));
  assert.deepEqual(await loadVault(storage, 'test', pw), value);
  await assert.rejects(loadVault(storage, 'test', 'wrong'));
});
