import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {wavFromPCM, decodeWav, resampleTo16k, audioBufferTo16k, audioBufferPlan, scanPCM, gatePCM, extendInitialHold, analyzePCM, analyzePCMParts, settings} from './static/mobile-audio.mjs';
const rate = 16000;
test('delayed close retains the full waiting interval instead of trimming it retrospectively',()=>{
 const source=signal(14,[[0,1,-35],[9,10,-35]]),cfg={silence:{thresholdDb:-55,minSilence:3,padding:.35,preRoll:1,holdBeforeSkip:true}};
 const result=gatePCM(source,cfg);assert.deepEqual(result.ranges.map(r=>[r.start,r.end]),[[0,4],[8,13]]);
 const scan=scanPCM(source);const py=spawnSync('python3',['-B','-c','import json,sys,audio_gate\np=json.load(sys.stdin)\nprint(json.dumps(audio_gate.from_scan(p["rate"],p["total"],[(l["startFrame"],l["endFrame"],l["db"]) for l in p["levels"]],audio_gate.settings(p["cfg"]))))'],{input:JSON.stringify({...scan,cfg}),encoding:'utf8'});
 assert.equal(py.status,0,py.stderr);assert.deepEqual(result,JSON.parse(py.stdout));
});
test('auto ceiling preserves quiet speech while manual thresholds remain explicit',()=>{
 const source=signal(10,[[0,10,-48]]),report={recommendedDb:-35},silence={holdBeforeSkip:true,thresholdMode:'auto',thresholdDb:-35,minSilence:3};
 const auto=gatePCM(source,{silence},{report});assert.equal(auto.settings.thresholdDb,-55);assert.equal(auto.sentSeconds,10);
 const manual=gatePCM(source,{silence:{...silence,thresholdMode:'manual'}});assert.equal(manual.settings.thresholdDb,-35);assert.equal(manual.sentSeconds,0);
});
test('the pending hold passes across a boundary and expires without moving timestamps',()=>{
 const silent=gatePCM(signal(5),{silence:{thresholdDb:-55,minSilence:3,holdBeforeSkip:true}});
 const extended=extendInitialHold(silent,1.8);assert.equal(extended.sentSeconds,1.8);assert.equal(extended.skipped[0].start,1.8);assert.equal(extended.holdRemainingSeconds,0);
});
function signal(seconds, regions = []) {
  const pcm = new Int16Array(seconds * rate);
  for (const [a, b, db] of regions) {
    const amp = Math.round(32768 * 10 ** (db / 20));
    for (let i = a * rate; i < b * rate; i++) pcm[i] = i % 2 ? amp : -amp;
  }
  return pcm;
}
test('PCM WAV round trip copies sliced input and handles empty PCM', async () => {
  for (const pcm of [new Int16Array(), new Int16Array([99, -32768, 0, 32767, 99]).subarray(1, 4)]) {
    const blob = wavFromPCM(pcm);
    assert.equal(blob.type, 'audio/wav');
    const decoded = decodeWav(await blob.arrayBuffer());
    assert.equal(decoded.rate, rate); assert.deepEqual(decoded.pcm, pcm);
    if (pcm.length) { decoded.pcm[0] = 1; assert.equal(pcm[0], -32768); }
  }
});
test('decoded browser audio mixes channels and converts in yielding batches', async () => {
  const left = Float32Array.from({length: 160001}, (_, i) => i % 2 ? .5 : -.5);
  const right = Float32Array.from({length: 160001}, (_, i) => i % 2 ? -.25 : .25);
  const progress = [];
  const pcm = await audioBufferTo16k({sampleRate: 16000, length: left.length, numberOfChannels: 2, getChannelData: i => [left, right][i]}, {onProgress: p => progress.push(p)});
  assert.equal(pcm.length, left.length);
  assert.ok(pcm.some(x => x !== 0));
  assert.ok(progress.length >= 3);
  assert.equal(progress.at(-1).ratio, 1);
});
test('long decoded audio is planned as bounded chunks without a one-hour rejection', () => {
  const plan = audioBufferPlan({sampleRate: 16000, length: 16000 * 61 * 60, numberOfChannels: 1});
  assert.equal(plan.parts.length, 7);
  assert.equal(plan.totalSeconds, 61 * 60);
  assert.ok(plan.parts.every(part => part.end - part.start <= 16000 * 600));
  assert.throws(() => audioBufferPlan({sampleRate: 16000, length: 16000 * 12 * 60 * 60 + 1, numberOfChannels: 1}), /十二小时/);
});
test('analysis merges bounded PCM parts onto one continuous timeline', () => {
  const first = signal(4, [[0, 2, -40]]), second = signal(4, [[2, 4, -35]]);
  const report = analyzePCMParts([first, second], {silence: {enabled: false}});
  assert.equal(report.duration, 8);
  assert.equal(report.sentSeconds, 8);
  assert.equal(report.levels.at(-1).end, 8);
});
test('WAV standard unknown odd chunks and extended fmt accepted; corruption rejected', async () => {
  const original = new Uint8Array(await wavFromPCM(new Int16Array([1, 2, 3])).arrayBuffer());
  const chunk = new Uint8Array([74, 85, 78, 75, 1, 0, 0, 0, 42, 0]);
  const extended = new Uint8Array(original.length + chunk.length);
  extended.set(original.subarray(0, 12)); extended.set(chunk, 12); extended.set(original.subarray(12), 22);
  new DataView(extended.buffer).setUint32(4, extended.length - 8, true);
  assert.deepEqual(decodeWav(extended.buffer).pcm, new Int16Array([1, 2, 3]));
  const fmt = new Uint8Array(original.length + 2);
  fmt.set(original.subarray(0, 36)); fmt.set(original.subarray(36), 38);
  const fv = new DataView(fmt.buffer); fv.setUint32(4, fmt.length - 8, true); fv.setUint32(16, 18, true);
  assert.equal(decodeWav(fmt.buffer).pcm.length, 3);
  for (const [offset, value] of [[0, 0], [8, 0], [20, 3], [22, 2], [24, 0], [28, 1], [32, 4], [34, 8], [40, 255]]) {
    const bad = original.slice(); bad[offset] = value; assert.throws(() => decodeWav(bad.buffer));
  }
  for (const n of [0, 11, 20, original.length - 1]) assert.throws(() => decodeWav(original.buffer.slice(0, n)));
  assert.throws(() => decodeWav(original));
});
test('resampling is bounded, clipped, deterministic, and does not mutate source', () => {
  const source = Float32Array.from({length: 48000}, (_, i) => i % 2 ? 1 : -1), copy = source.slice();
  const output = resampleTo16k(source, 48000);
  assert.equal(output.length, 16000); assert.deepEqual(source, copy);
  assert.deepEqual(resampleTo16k(new Float32Array([-2, 0, 2]), 16000), new Int16Array([-32768, 0, 32767]));
  assert.equal(resampleTo16k(new Float32Array(8000).fill(.5), 8000).length, 16000);
  assert.throws(() => resampleTo16k(source, 0)); assert.throws(() => scanPCM([]));
});
test('independent pre-roll, padding, minimum silence and source mapping match Python', () => {
  const pcm = signal(15, [[3, 4, -40], [4.8, 6, -40], [10, 11, -40]]);
  const cfg = {silence: {thresholdDb: -55, minSilence: 1, preRoll: .6, padding: .2}};
  const before = pcm.slice(), result = gatePCM(pcm, cfg);
  assert.deepEqual(result.ranges.map(r => [r.start, r.end]), [[2.4, 6.2], [9.4, 11.2]]);
  assert.equal(result.skipped[1].start, 6.2); assert.equal(result.skipped[1].end, 9.4);
  const scan = scanPCM(pcm);
  const py = spawnSync('python3', ['-B', '-c', 'import json,sys,audio_gate\np=json.load(sys.stdin)\nprint(json.dumps(audio_gate.from_scan(p["rate"],p["total"],[(l["startFrame"],l["endFrame"],l["db"]) for l in p["levels"]],audio_gate.settings(p["cfg"]))))'], {input: JSON.stringify({...scan, cfg}), encoding: 'utf8'});
  assert.equal(py.status, 0, py.stderr); assert.deepEqual(result, JSON.parse(py.stdout));
  assert.deepEqual(pcm, before);
});
test('disabled sends all audio in bounded 90-second requests, including quiet and empty input', () => {
  const result = gatePCM(signal(181), {silence: {enabled: false, thresholdMode: 'auto'}});
  assert.equal(result.sentSeconds, 181); assert.equal(result.requestCount, 3);
  assert.deepEqual(result.ranges.map(r => [r.start, r.end]), [[0, 90], [90, 180], [180, 181]]);
  assert.equal(result.peakFrameDb, null); assert.equal(result.skippedSeconds, 0);
  assert.equal(gatePCM(new Int16Array()).requestCount, 0);
});
test('quiet speech survives calibration independently of duration cliff; supplied scores never mutate', () => {
  const pcm = signal(24, [[0, 24, -68], [4, 8, -57], [12, 16, -31]]);
  const speech = [];
  for (const [a, b] of [[4, 8], [12, 16]]) for (let x = a * rate; x < b * rate; x += 320) speech.push({startFrame: x, endFrame: x + 320, probability: .35});
  const before = structuredClone(speech), copy = pcm.slice(), cfg = {silence: {thresholdMode: 'auto'}};
  const report = analyzePCM(pcm, cfg, {speech});
  assert.equal(report.quality.confidence, 'speech-protected');
  assert.equal(report.speechProtection.marginDb, 3);
  assert.equal(report.recommendedDb, report.speechProtection.boundaryDb - 3);
  assert.notEqual(report.recommendedDb, report.cliff.db);
  assert.ok(report.recommendedDb < -57);
  const safe = report.curve.find(p => p.db === report.recommendedDb);
  assert.ok(safe.speechRetained >= .995 && safe.quietSpeechRetained >= .995);
  assert.equal(gatePCM(pcm, cfg, {report}).settings.thresholdDb, report.recommendedDb);
  assert.deepEqual(gatePCM(pcm, cfg, {speech}), gatePCM(pcm, cfg, {report}));
  assert.deepEqual(speech, before); assert.deepEqual(pcm, copy);
});
test('energy split is conservative; unavailable speech and no split explicitly falls back to -80', () => {
  const pcm = signal(12, [[0, 12, -61]]), cfg = {silence: {thresholdMode: 'auto'}};
  const report = analyzePCM(pcm, cfg);
  assert.equal(report.recommendedDb, null); assert.match(report.recommendationReason, /−80/);
  assert.equal(report.speechProtection.available, false);
  assert.equal(gatePCM(pcm, cfg).settings.thresholdDb, -80);
  assert.equal(gatePCM(pcm, cfg).sentSeconds, 12);
  const split = analyzePCM(signal(20, [[0, 20, -70], [5, 10, -40]]));
  assert.equal(split.quality.confidence, 'separated'); assert.ok(split.recommendedDb < -40);
});
test('curve and displayed levels are bounded and use original seconds; invalid scores/settings fail', () => {
  const report = analyzePCM(signal(21, [[2, 3, -45]]));
  assert.equal(report.curve.length, 61); assert.ok(report.levels.length <= 500);
  assert.equal(report.levels[0].start, 0); assert.ok(report.levels.at(-1).end <= 21);
  for (let i = 1; i < report.curve.length; i++) assert.ok(report.curve[i].sentSeconds <= report.curve[i - 1].sentSeconds);
  for (const silence of [{enabled: 1}, {thresholdDb: -90}, {minSilence: .1}, {preRoll: 4}, {padding: NaN}, {thresholdMode: 'bad'}, []]) assert.throws(() => settings({silence}));
  assert.throws(() => analyzePCM(signal(10), {}, {speech: [{startFrame: 0, endFrame: 160001, probability: .9}]}));
});
test('all operations are local and make no network or model calls', () => {
  const old = globalThis.fetch; globalThis.fetch = () => { throw new Error('Unexpected network'); };
  try { assert.equal(analyzePCM(signal(8)).speechProtection.method, 'energy-only'); gatePCM(signal(8), {silence: {thresholdMode: 'auto'}}); }
  finally { globalThis.fetch = old; }
});
test('analysis curve, cliffs, energy quality and speech protection match Python', () => {
  const pcm = signal(24, [[0, 24, -68], [4, 8, -57], [12, 16, -31]]), scan = scanPCM(pcm);
  const speech = [];
  for (const [a, b] of [[4, 8], [12, 16]]) for (let x = a * rate; x < b * rate; x += 320) speech.push({startFrame: x, endFrame: x + 320, probability: .8});
  const cfg = {silence: {thresholdMode: 'auto'}};
  const py = spawnSync('python3', ['-B', '-c', 'import json,sys,audio_gate\np=json.load(sys.stdin)\nprint(json.dumps(audio_gate.analyze_scan(p["rate"],p["total"],[(l["startFrame"],l["endFrame"],l["db"]) for l in p["levels"]],p["cfg"],speech=[(s["startFrame"],s["endFrame"],s["probability"]) for s in p["speech"]])))'], {input: JSON.stringify({...scan, cfg, speech}), encoding: 'utf8'});
  assert.equal(py.status, 0, py.stderr);
  const expected = JSON.parse(py.stdout), actual = analyzePCM(pcm, cfg, {speech});
  for (const key of ['curve', 'cliff', 'cliffs', 'recommendedDb', 'quality', 'distribution', 'speechProtection', 'ranges', 'skipped', 'sentSeconds']) assert.deepEqual(actual[key], expected[key], key);
});
