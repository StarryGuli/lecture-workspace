// Local, dependency-free audio utilities. Frame positions always refer to the source PCM.
const RATE = 16000;
const MAX_FRAMES = RATE * 60 * 60; // Bound one browser buffer to one hour (115.2 MB PCM).
const MAX_IMPORT_SECONDS = 12 * 60 * 60;
const rounded = (n, digits = 0) => Number(n.toFixed(digits));
function checkPCM(pcm) {
  if (!(pcm instanceof Int16Array)) throw new TypeError('Expected Int16Array');
  if (pcm.length > MAX_FRAMES) throw new RangeError('单次离线分析最多一小时，请分段处理；实时录音原音仍保留');
}
function checkRate(rate) {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new RangeError('Invalid sample rate');
}
export function settings(cfg = {}) {
  const src = cfg.silence ?? {};
  if (typeof src !== 'object' || Array.isArray(src)) throw new TypeError('Invalid silence settings');
  const opts = {enabled: true, thresholdDb: -55, minSilence: 1.5, padding: .35, thresholdMode: 'manual'};
  if('holdBeforeSkip' in src){if(typeof src.holdBeforeSkip!=='boolean')throw new TypeError('Invalid holdBeforeSkip');opts.holdBeforeSkip=src.holdBeforeSkip;}
  if ('enabled' in src) {
    if (typeof src.enabled !== 'boolean') throw new TypeError('Invalid enabled flag');
    opts.enabled = src.enabled;
  }
  for (const [key, lo, hi] of [['thresholdDb', -80, -20], ['minSilence', .5, 10], ['padding', .15, 1.5], ['preRoll', .15, 3]]) {
    if (key in src) {
      const value = Number(src[key]);
      if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(`Invalid ${key}`);
      opts[key] = value;
    }
  }
  opts.preRoll ??= opts.padding;
  opts.thresholdMode = src.thresholdMode ?? 'manual';
  if (!['auto', 'manual'].includes(opts.thresholdMode)) throw new RangeError('Invalid thresholdMode');
  return opts;
}
export function wavFromPCM(pcm, rate = RATE) {
  checkPCM(pcm); checkRate(rate);
  const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
  const str = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return new Blob([buffer], {type: 'audio/wav'});
}
export function decodeWav(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Expected ArrayBuffer');
  if (buffer.byteLength > MAX_FRAMES * 2 + 1048576) throw new RangeError('WAV 超出单次分析大小，请分段处理');
  const v = new DataView(buffer), bad = () => { throw new Error('WAV 格式不支持或文件不完整，需要 16kHz 单声道 PCM16'); };
  const str = o => String.fromCharCode(...new Uint8Array(buffer, o, 4));
  if (v.byteLength < 12 || str(0) !== 'RIFF' || str(8) !== 'WAVE') bad();
  const limit = v.getUint32(4, true) + 8;
  if (limit !== v.byteLength) bad();
  let format = false, data = null;
  for (let pos = 12; pos < limit;) {
    if (pos + 8 > limit) bad();
    const id = str(pos), size = v.getUint32(pos + 4, true), start = pos + 8, end = start + size;
    if (end + (size % 2) > limit) bad();
    if (id === 'fmt ') {
      if (format || size < 16 || v.getUint16(start, true) !== 1 || v.getUint16(start + 2, true) !== 1 || v.getUint32(start + 4, true) !== RATE || v.getUint32(start + 8, true) !== RATE * 2 || v.getUint16(start + 12, true) !== 2 || v.getUint16(start + 14, true) !== 16) bad();
      format = true;
    } else if (id === 'data') {
      if (data || size % 2 || size / 2 > MAX_FRAMES) bad();
      data = {start, size};
    }
    pos = end + (size % 2);
  }
  if (!format || !data) bad();
  const pcm = new Int16Array(data.size / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = v.getInt16(data.start + i * 2, true);
  return {pcm, rate: RATE};
}
export function resampleTo16k(input, sourceRate) {
  if (!(input instanceof Float32Array)) throw new TypeError('Expected Float32Array');
  checkRate(sourceRate);
  const length = Math.floor(input.length * RATE / sourceRate);
  if (length > MAX_FRAMES) throw new RangeError('PCM size limit');
  const output = new Int16Array(length), ratio = sourceRate / RATE;
  // Area averaging when downsampling avoids dropping source samples; interpolate when upsampling.
  for (let i = 0; i < length; i++) {
    let value = 0;
    if (ratio > 1) {
      const a = i * ratio, b = Math.min(input.length, (i + 1) * ratio);
      for (let j = Math.floor(a); j < Math.ceil(b); j++) value += (Number.isFinite(input[j]) ? input[j] : 0) * (Math.min(b, j + 1) - Math.max(a, j));
      value /= b - a;
    } else {
      const x = i * ratio, j = Math.floor(x), t = x - j;
      value = (input[j] || 0) * (1 - t) + (input[Math.min(j + 1, input.length - 1)] || 0) * t;
    }
    value = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767));
  }
  return output;
}

// Convert decoded browser audio without first allocating another full-length
// interleaved/mixed Float32 buffer. Long imports yield between batches so the
// page can keep painting progress and responding to the user.
export async function audioBufferTo16k(audio, {onProgress} = {}) {
  const sourceRate = Number(audio?.sampleRate), sourceLength = Number(audio?.length);
  const channelCount = Number(audio?.numberOfChannels);
  checkRate(sourceRate);
  if (!Number.isInteger(sourceLength) || sourceLength < 0 || !Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32)
    throw new TypeError('浏览器返回的音频格式无效');
  const length = Math.floor(sourceLength * RATE / sourceRate);
  if (length > MAX_FRAMES) throw new RangeError('单次离线分析最多一小时，请分段处理；导入的原文件仍保存在本设备');
  const channels = Array.from({length: channelCount}, (_, i) => audio.getChannelData(i));
  if (channels.some(data => !(data instanceof Float32Array) || data.length !== sourceLength))
    throw new TypeError('浏览器返回的声道数据无效');
  const output = new Int16Array(length), ratio = sourceRate / RATE;
  const batch = RATE * 5;
  const pause = () => new Promise(resolve => {
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
  for (let i = 0; i < length; i++) {
    let value = 0;
    if (ratio > 1) {
      const a = i * ratio, b = Math.min(sourceLength, (i + 1) * ratio);
      for (let j = Math.floor(a); j < Math.ceil(b); j++) {
        const weight = Math.min(b, j + 1) - Math.max(a, j);
        if (weight <= 0) continue;
        let mixed = 0;
        for (const data of channels) mixed += Number.isFinite(data[j]) ? data[j] : 0;
        value += mixed / channelCount * weight;
      }
      value /= Math.max(Number.EPSILON, b - a);
    } else {
      const x = i * ratio, j = Math.floor(x), t = x - j, next = Math.min(j + 1, sourceLength - 1);
      for (const data of channels) value += ((data[j] || 0) * (1 - t) + (data[next] || 0) * t) / channelCount;
    }
    value = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767));
    if ((i + 1) % batch === 0 && i + 1 < length) {
      onProgress?.({convertedSeconds: (i + 1) / RATE, totalSeconds: length / RATE, ratio: (i + 1) / length});
      await pause();
    }
  }
  onProgress?.({convertedSeconds: length / RATE, totalSeconds: length / RATE, ratio: 1});
  return output;
}

export function audioBufferPlan(audio, chunkSeconds = 600) {
  const sourceRate = Number(audio?.sampleRate), sourceLength = Number(audio?.length);
  const channelCount = Number(audio?.numberOfChannels);
  checkRate(sourceRate);
  if (!Number.isInteger(sourceLength) || sourceLength < 0 || !Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32)
    throw new TypeError('浏览器返回的音频格式无效');
  if (!Number.isFinite(chunkSeconds) || chunkSeconds < 30 || chunkSeconds > 3600)
    throw new RangeError('Invalid import chunk duration');
  if (sourceLength / sourceRate > MAX_IMPORT_SECONDS)
    throw new RangeError('单个导入文件最多十二小时；原文件仍保存在本设备，请按课程分段');
  const sourceChunk = Math.max(1, Math.floor(sourceRate * chunkSeconds));
  const parts = [];
  for (let start = 0; start < sourceLength; start += sourceChunk) parts.push({start, end: Math.min(sourceLength, start + sourceChunk)});
  return {sourceRate, sourceLength, channelCount, parts, totalSeconds: sourceLength / sourceRate};
}

export async function audioBufferTo16kChunks(audio, {chunkSeconds = 600, onChunk, onProgress} = {}) {
  const {sourceRate, sourceLength, channelCount, parts} = audioBufferPlan(audio, chunkSeconds);
  let convertedFrames = 0, seq = 0;
  for (const {start, end} of parts) {
    const part = {
      sampleRate: sourceRate,
      length: end - start,
      numberOfChannels: channelCount,
      getChannelData: channel => audio.getChannelData(channel).subarray(start, end),
    };
    const pcm = await audioBufferTo16k(part, {onProgress: progress => {
      const sourceDone = start + progress.ratio * (end - start);
      onProgress?.({convertedSeconds: sourceDone / sourceRate, totalSeconds: sourceLength / sourceRate, ratio: sourceLength ? sourceDone / sourceLength : 1});
    }});
    const meta = {seq, start: convertedFrames / RATE, duration: pcm.length / RATE};
    await onChunk?.(pcm, meta);
    convertedFrames += pcm.length;
    seq++;
  }
  if (!sourceLength) onProgress?.({convertedSeconds: 0, totalSeconds: 0, ratio: 1});
  return {seconds: convertedFrames / RATE, chunks: seq};
}
export function scanPCM(pcm, rate = RATE) {
  checkPCM(pcm); checkRate(rate);
  const levels = [], step = Math.max(1, Math.round(rate * .02));
  for (let a = 0; a < pcm.length; a += step) {
    const b = Math.min(pcm.length, a + step); let sum = 0;
    for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
    levels.push({startFrame: a, endFrame: b, db: 20 * Math.log10(Math.max(Math.sqrt(sum / (b - a)) / 32768, 10 ** (-96 / 20)))});
  }
  return {rate, total: pcm.length, levels};
}
function fromScan({rate, total, levels}, opts) {
  let active = [];
  if (!opts.enabled) { if (total) active.push([0, total]); }
  else {
    for (const {startFrame: a, endFrame: b, db} of levels) if (db >= opts.thresholdDb) {
      if (active.length && a === active.at(-1)[1]) active.at(-1)[1] = b;
      else active.push([a, b]);
    }
    const pre = Math.round(rate * opts.preRoll), post = Math.round(rate * (opts.holdBeforeSkip?Math.max(opts.padding,opts.minSilence):opts.padding)), gap = Math.round(rate * opts.minSilence), joined = [];
    for (const [a, b] of active) {
      if (joined.length && a - joined.at(-1)[1] < Math.max(gap, pre + post)) joined.at(-1)[1] = b;
      else joined.push([a, b]);
    }
    active = joined.map(([a, b]) => [a < gap ? 0 : Math.max(0, a - pre), total - b < gap ? total : Math.min(total, b + post)]);
  }
  const ranges = [], skipped = []; let cursor = 0, sent = 0;
  const skip = (a, b) => skipped.push({start: a / rate, end: b / rate, skipped: true, text: '【静音跳过，原录音保留】'});
  for (const [a, b] of active) for (let x = a; x < b; x += rate * 90) {
    const end = Math.min(b, x + rate * 90);
    if (x > cursor) skip(cursor, x);
    ranges.push({startFrame: x, endFrame: end, start: x / rate, end: end / rate});
    cursor = end; sent += end - x;
  }
  if (cursor < total) skip(cursor, total);
  const result={settings: {...opts}, duration: total / rate, sentSeconds: sent / rate, skippedSeconds: Math.max(0, (total - sent) / rate), requestCount: ranges.length, peakFrameDb: opts.enabled ? rounded(levels.reduce((m, l) => Math.max(m, l.db), -96), 1) : null, ranges, skipped};
  if(opts.holdBeforeSkip){const last=levels.findLast(l=>l.db>=opts.thresholdDb)?.endFrame;result.holdRemainingSeconds=opts.enabled&&last!=null?Math.max(0,(last+Math.round(rate*opts.minSilence)-total)/rate):0;}
  return result;
}
export function extendInitialHold(gate,seconds){
  if(!Number.isFinite(seconds)||seconds<=0)return gate;
  const end=Math.min(Math.round(gate.duration*RATE),Math.round(seconds*RATE)),ranges=[];
  for(const row of [{startFrame:0,endFrame:end,start:0,end:end/RATE},...gate.ranges]){
    if(row.endFrame<=row.startFrame)continue;
    const previous=ranges.at(-1);if(previous&&row.startFrame<=previous.endFrame){previous.endFrame=Math.max(previous.endFrame,row.endFrame);previous.end=previous.endFrame/RATE;}else ranges.push({...row});
  }
  const skipped=[];let cursor=0,sent=0;
  for(const r of ranges){if(r.start>cursor)skipped.push({start:cursor,end:r.start,skipped:true,text:'【静音跳过，原录音保留】'});sent+=r.end-r.start;cursor=r.end;}
  if(cursor<gate.duration)skipped.push({start:cursor,end:gate.duration,skipped:true,text:'【静音跳过，原录音保留】'});
  return {...gate,ranges,skipped,sentSeconds:sent,skippedSeconds:Math.max(0,gate.duration-sent),requestCount:ranges.length,holdRemainingSeconds:Math.max(gate.holdRemainingSeconds||0,seconds-gate.duration)};
}
export function gatePCM(pcm, cfg = {}, {speech = null, report = null} = {}) {
  const scan = scanPCM(pcm), opts = settings(cfg);
  if (!opts.enabled || opts.thresholdMode !== 'auto') return fromScan(scan, opts);
  report ??= analyzeScan(scan, cfg, speech);
  const rawEffective=report.recommendedDb??-80;
  const effective = opts.holdBeforeSkip?Math.min(rawEffective,-55):rawEffective;
  if (!Number.isFinite(effective) || effective < -80 || effective > -20) throw new RangeError('Invalid calibration threshold');
  const result = fromScan(scan, {...opts, thresholdDb: effective});
  result.calibration = structuredClone(Object.fromEntries(['curve', 'cliff', 'recommendedDb', 'recommendationReason', 'quality', 'duration', 'speechProtection', 'distribution'].map(k => [k, report[k]])));
  if(opts.holdBeforeSkip){result.calibration.uncappedRecommendedDb=report.recommendedDb;result.calibration.recommendedDb=effective;result.calibration.autoSafetyCeilingDb=-55;}
  return result;
}
function retention(ranges, voiced) {
  let kept = 0, total = 0, i = 0;
  for (const {startFrame: a, endFrame: b} of voiced) {
    total += b - a;
    while (i < ranges.length && ranges[i].endFrame <= a) i++;
    for (let j = i; j < ranges.length && ranges[j].startFrame < b; j++) kept += Math.max(0, Math.min(b, ranges[j].endFrame) - Math.max(a, ranges[j].startFrame));
  }
  return total ? kept / total : 0;
}
export function analyzePCM(pcm, cfg = {}, {speech = null} = {}) { return analyzeScan(scanPCM(pcm), cfg, speech); }
export function analyzePCMParts(parts, cfg = {}, {speech = null} = {}) {
  if (!Array.isArray(parts) || !parts.length) throw new TypeError('No PCM parts');
  const levels = []; let total = 0;
  for (const pcm of parts) {
    const scan = pcm instanceof Int16Array ? scanPCM(pcm) : pcm;
    if (scan.rate !== RATE || !Number.isInteger(scan.total) || !Array.isArray(scan.levels)) throw new TypeError('Invalid PCM scan');
    for (const level of scan.levels) levels.push({...level, startFrame: level.startFrame + total, endFrame: level.endFrame + total});
    total += scan.total;
  }
  return analyzeScan({rate: RATE, total, levels}, cfg, speech);
}
function analyzeScan(scan, cfg, speech) {
  const {rate, total, levels} = scan, opts = settings(cfg), result = fromScan(scan, opts), points = [], plans = [];
  for (let db = -80; db <= -20; db++) {
    const plan = fromScan(scan, {...opts, enabled: true, thresholdDb: db});
    plans.push(plan); points.push({db, sentSeconds: rounded(plan.sentSeconds, 3)});
  }
  const drops = points.slice(1).map((p, i) => ({db: p.db, dropSeconds: rounded(points[i].sentSeconds - p.sentSeconds, 3)})).filter(d => d.dropSeconds > 0).sort((a, b) => b.dropSeconds - a.dropSeconds);
  const meaningful = drops.filter(d => d.dropSeconds >= Math.max(1, total / rate * .08) && d.db > -78 && d.db < -22);
  const ordered = levels.map(l => l.db).sort((a, b) => a - b), quantile = q => ordered[Math.floor((ordered.length - 1) * q)] ?? -96;
  const peak = ordered.at(-1) ?? -96, cliff = meaningful[0] ?? null;
  const quality = {floorDb: rounded(quantile(.1), 1), medianDb: rounded(quantile(.5), 1), loudDb: rounded(quantile(.9), 1), peakDb: rounded(peak, 1), rangeDb: rounded(quantile(.9) - quantile(.1), 1), confidence: 'insufficient'};
  let recommendation = null, reason = '尚无可靠的背景与声音分界，自动模式暂用 −80 dBFS 保守保留轻声。';
  const minimum = Math.max(50, Math.round(ordered.length * .1)); let split = null;
  for (let i = minimum; i < ordered.length - minimum; i++) {
    const gap = ordered[i] - ordered[i - 1];
    if (gap >= 6 && (!split || gap >= split.gap)) split = {gap, i};
  }
  if (total / rate >= 8 && peak > -78 && split) {
    const low = ordered[split.i - 1], quiet = ordered[split.i];
    recommendation = Math.round(Math.max(-80, Math.min(-20, low + 3, quiet - 6)));
    if (cliff) recommendation = Math.min(recommendation, Math.max(-80, cliff.db - 4));
    Object.assign(quality, {noiseCeilingDb: rounded(low, 1), quietSoundDb: rounded(quiet, 1), confidence: 'separated'});
    reason = '本段存在分离的音量组，建议低于较轻声音，并避开时长骤降处。仅凭音量不能确认人声，请回听核对。';
  } else if (peak <= -80) {
    quality.confidence = 'near-silence'; reason = '接近全静音，无法估计人声边界；自动模式暂用 −80 dBFS，请检查麦克风。';
  } else if (total / rate < 8) reason = '校准样本不足 8 秒，暂用 −80 dBFS 保留轻声，不沿用上一段录音的阈值。';
  let protection = {method: 'energy-only', available: speech !== null};
  if (speech !== null && (!Array.isArray(speech) || speech.length > Math.ceil(total / 160) + 1)) throw new TypeError('Invalid speech scores');
  const voiced = []; let previous = 0;
  for (const row of speech ?? []) {
    const {startFrame: a, endFrame: b, probability: p} = row;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < previous || b <= a || b > total || !Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('Invalid speech score interval');
    previous = b;
    if (p >= .35) voiced.push(row);
  }
  const voicedSeconds = voiced.reduce((sum, v) => sum + v.endFrame - v.startFrame, 0) / rate;
  if (total / rate >= 8 && voicedSeconds >= 2) {
    const energy = v => levels[Math.floor(v.startFrame / Math.round(rate * .02))]?.db ?? -96;
    const quiet = [...voiced].sort((a, b) => energy(a) - energy(b)).slice(0, Math.max(1, Math.floor(voiced.length / 4))).sort((a, b) => a.startFrame - b.startFrame);
    const safe = [];
    points.forEach((point, i) => {
      const recall = retention(plans[i].ranges, voiced), quietRecall = retention(plans[i].ranges, quiet);
      Object.assign(point, {speechRetained: rounded(recall, 5), quietSpeechRetained: rounded(quietRecall, 5)});
      if (recall >= .995 && quietRecall >= .995) safe.push(point.db);
    });
    if (safe.length) {
      const boundary = Math.max(...safe); recommendation = Math.max(-80, boundary - 3);
      protection = {method: 'local-silero', available: true, speechSeconds: rounded(voicedSeconds, 2), targetRetention: .995, marginDb: 3, boundaryDb: boundary};
      quality.confidence = 'speech-protected';
      reason = '以本地人声检测为参照，保留至少 99.5% 的疑似人声及较轻人声，再留 3 dB 保守余量。最大下降仅供观察，仍需回听核对轻声。';
    }
  }
  if (speech !== null && voicedSeconds < 2 && recommendation === null) reason = '本窗口检测到的人声不足 2 秒，尚不能确定轻声边界，自动模式保守保留。';
  if (speech === null && recommendation === null) reason += ' 本地人声模型尚未就绪，当前使用保守能量校准；不会为此调用云端模型。';
  if(opts.holdBeforeSkip&&opts.thresholdMode==='auto'&&recommendation!==null){recommendation=Math.min(recommendation,-55);reason+=' 课堂保守保护：自动阈值最高 −55 dBFS，低音量先保留完整等待时长，再跳过后续静音。';}
  const distribution = Array.from({length: 39}, (_, i) => ({fromDb: -96 + i * 2, toDb: -94 + i * 2, seconds: 0, percent: 0}));
  for (const l of levels) {
    const index = Math.floor((l.db + 96) / 2);
    if (index >= 0 && index < distribution.length) distribution[index].seconds += (l.endFrame - l.startFrame) / rate;
  }
  for (const band of distribution) { band.percent = rounded(100 * band.seconds / Math.max(1 / rate, total / rate), 1); band.seconds = rounded(band.seconds, 3); }
  quality.dominantBand = distribution.reduce((a, b) => b.seconds > a.seconds ? b : a);
  return {...result, curve: points, cliff, cliffs: meaningful.slice(0, 4), recommendedDb: recommendation, recommendationReason: reason, quality, distribution, speechProtection: protection,
    levels: levels.filter((_, i) => i % Math.max(1, Math.ceil(levels.length / 500)) === 0).map(l => ({start: l.startFrame / rate, end: l.endFrame / rate, db: rounded(l.db, 1)}))};
}
