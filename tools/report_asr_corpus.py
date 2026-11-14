"""Render private ASR comparison outputs without remote calls or a fabricated truth set."""
import json,pathlib,sys

def normalized(text):return ''.join(c.lower() for c in text if c.isalnum())
def distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        nxt=[i]
        for j,y in enumerate(b,1):nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
        row=nxt
    return row[-1]
def stamp(s):return f'{int(s)//60:02d}:{s%60:04.1f}'

p=pathlib.Path(sys.argv[1]).resolve()
rows=json.loads((p/'results.json').read_text());ledger=json.loads((p/'ledger.json').read_text())
manifest=json.loads((p/'manifest.json').read_text());controls=json.loads((p/'results-pause-2.json').read_text())
metrics=[]
for r in rows:
    if r.get('skipped'):continue
    base=normalized(r['arms']['full'].get('text',''));m={'id':r['id'],'label':r['label'],'characters':len(base),'segments':len(r['boundaries'])-1}
    for arm in ('endpoint','endpoint-gated'):
        edits=distance(base,normalized(r['arms'][arm].get('text','')))
        m[arm]={'edits':edits,'differencePercent':100*edits/max(1,len(base)),'skippedSeconds':r['arms'][arm]['skippedSeconds']}
    metrics.append(m)
byid={m['id']:m for m in metrics}
reported=sum((r.get('usage')or{}).get('seconds',0) for r in ledger)
all_percent=100*sum(m['endpoint-gated']['edits'] for m in metrics)/sum(m['characters'] for m in metrics)
split=[m for m in metrics if m['segments']>1]
split_percent=100*sum(m['endpoint-gated']['edits'] for m in split)/sum(m['characters'] for m in split)
stats={'realSamples':len(metrics),'selectedSeconds':sum(r['seconds'] for r in rows if not r.get('skipped')),'requests':len(ledger),'reportedSeconds':reported,'estimatedCNY':reported*.00022,'allWeightedDifferencePercent':all_percent,'splitWeightedDifferencePercent':split_percent,'metrics':metrics}
(p/'metrics.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2))
out=['# 本机录音 ASR 分段对照 · 2026-11-05','',
     f'**结论：新分段仍未接近完整输入的稳定性，不能声称正确识别率很高。** 实际发生分段的 6 个片段，与连续输入的文字编辑差异为 5.6%–25.2%，按完整输入字数加权约 {split_percent:.1f}%。这里的差异率不是正确率，也不能换算成“{100-split_percent:.1f}% 正确”。','',
     '没有人工逐字稿。完整输入也存在疑似错词和漏词，因此本报告把它作为比较基线，不作为人工真值。指标去掉标点、空白并统一英文小写，采用字符级 Levenshtein 距离；没有将汉字数字与阿拉伯数字、同义表达、繁简字归一。它衡量输出差别，不判断哪一份更准确。','',
     '## 范围与费用','',
     f'- 本机桌面、下载目录及项目原音中找到 8 份真实音频；两份合成校准音直接排除，一份未标明的合成音经本机检测排除，未付费识别。不同文件可能含同一课程的重叠内容，不当作 8 个独立课程。',
     f'- 真实音频源合计约 {sum(s["sourceSeconds"] for s in manifest["samples"] if s["id"] in byid)/60:.1f} 分钟，在本机扫描后选取 {stats["selectedSeconds"]:.1f} 秒关键内容。长录音只测关键片段，未整份上传。',
     '- 每段对比：同一 PCM 连续输入、生产 SpeechEndpoint（默认 1.2 秒结束确认）分段、分段后执行生产静音过滤。另对两个难样本测试 2 秒结束确认。',
     f'- 模型固定 Qwen/Qwen3-ASR-1.7B，音频接口固定硅基流动。共 {len(ledger)} 次真实请求，API 返回计费时长 {reported} 秒，按 ¥0.00022/秒估算 **¥{reported*.00022:.5f}**。硬预算上限 1500 秒（¥0.33）。没有调用整理、校订或答题 LLM。',
     '- 请求按音频字节及模型缓存，音频相同直接复用，避免关闭/开启静音过滤但未改变音频时重复计费。原音、结果与本报告留在本机，不上传同步仓库或 Git。','',
     '## 各文件结果','',
     '| 样本 | 源文件/场景 | 原音位置 | 片段秒数 | 自然分段数 | 分段差异率 | 加静音过滤后差异率 | 跳过秒数 |',
     '|---|---|---|---:|---:|---:|---:|---:|']
for r in rows:
    if r.get('skipped'):continue
    m=byid[r['id']]
    out.append(f'| {r["id"]} | {r["label"]} | {stamp(r["start"])}–{stamp(r["end"])} | {r["seconds"]:.1f} | {m["segments"]} | {m["endpoint"]["differencePercent"]:.1f}% | {m["endpoint-gated"]["differencePercent"]:.1f}% | {m["endpoint-gated"]["skippedSeconds"]:.2f} |')
out+=['',f'包含两个未实际分段的样本时，加权差异约 {all_percent:.1f}%；只计算实际分段的 6 个样本时约 {split_percent:.1f}%。单段样本的 0% 是同一音频请求的缓存复用结果，不能当作独立准确率验证。','',
      '## 2 秒结束确认对照','',
      '| 样本 | 1.2 秒分段数 | 2 秒分段数 | 原差异率（含静音过滤） | 2 秒差异率（含静音过滤） |','|---|---:|---:|---:|---:|']
for r in controls:
    m=byid[r['id']];base=normalized(r['arms']['full']['text']);d=distance(base,normalized(r['arms']['endpoint-gated']['text']))/max(1,len(base))*100
    out.append(f'| {r["id"]} | {m["segments"]} | {len(r["boundaries"])-1} | {m["endpoint-gated"]["differencePercent"]:.1f}% | {d:.1f}% |')
out+=['','机械课堂难片段从 10 段减少到 2 段，差异从 25.2% 降至 10.1%；政治课样本仅从 19.0% 降至 18.6%。说明延长结束确认可以减轻部分碎片化，但不是通用修复。等待更久也会延后实时提醒。','',
      '## 发现与建议','',
      '1. 人声结束不等于语义结束。老师停下来指课件、换气、重复半句话时，声学 VAD 仍会结束当前段；独立 ASR 因而失去上一段声音上下文。',
      '2. 6 个样本静音过滤没有实际改变送出的声音；政治课样本跳过 3.574 秒、另一课堂样本跳过 0.94 秒。过滤前后的文本也有差异，未听写标注这些区间，不能断言删掉的全是无用声音。',
      '3. 完整输入自身也有术语疑点。例如铸造内容中“行星/型芯”“上行下行/上型下型”“分形面/分型面”等需要回听。不要用一个有错的整段 ASR 去计算另一个 ASR 的真实准确率。',
      '4. 后续更值得验证的是给新段保留跨段声音上下文、将实时文字标为暂定并在上下文充分时更新，同时保留回听和校订来源；这会增加音频重复发送量，需要计算成本。本轮只测试，未修改生产默认设置。',
      '5. 没有模拟 Safari 麦克风降噪、通话中断或实际公网账户代理。这里隔离的是同一音频经过分段/过滤后的效果。','',
      '## 逐样本原始输出与回听','']
for r in rows:
    if r.get('skipped'):continue
    out += [f'### {r["id"]} · {r["label"]}','',f'[回听选中的片段]({p/(r["id"]+".wav")}) · 原音时间 {stamp(r["start"])}–{stamp(r["end"])}','']
    for arm,title in [('full','完整连续输入'),('endpoint','1.2 秒结束确认分段'),('endpoint-gated','分段 + 静音过滤')]:out += [f'**{title}**','',r['arms'][arm].get('text')or r['arms'][arm].get('error',''), '']
    control=next((c for c in controls if c['id']==r['id']),None)
    if control:out+=['**2 秒结束确认 + 静音过滤**','',control['arms']['endpoint-gated']['text'],'']
out+=['## 原始数据','',f'[metrics.json]({p/"metrics.json"}) · [results.json]({p/"results.json"}) · [ledger.json]({p/"ledger.json"}) · [manifest.json]({p/"manifest.json"})','']
if len(sys.argv)>2:
    q=pathlib.Path(sys.argv[2]).resolve();extra=json.loads((q/'results.json').read_text());extra_ledger=json.loads((q/'ledger.json').read_text());inventory=json.loads((q/'manifest.json').read_text()).get('inventory',{})
    extra_seconds=sum((x.get('usage')or{}).get('seconds',0) for x in extra_ledger)
    out+=['## Speakless 日常输入补充','',f'另外在本机找到 {inventory.get("files")} 份 Speakless 录音，合计约 {inventory.get("minutes",0):.1f} 分钟，多数是很短的日常输入。仅以本机时长、技术词和中英混合特征筛选两份较长代表，不把全部历史付费重跑。筛选用的历史文字没有发给模型。','',
          '| 补充样本 | 片段秒数 | 分段数 | 分段差异率 | 加过滤后差异率 | 跳过秒数 |','|---|---:|---:|---:|---:|---:|']
    extra_metrics=[]
    for i,r in enumerate(extra,1):
        if r.get('skipped'):continue
        base=normalized(r['arms']['full'].get('text',''));a=r['arms']['endpoint'];b=r['arms']['endpoint-gated'];d1=distance(base,normalized(a['text']));d2=distance(base,normalized(b['text']))
        em={'id':f'dictation-{i}','characters':len(base),'edits':d2,'differencePercent':100*d2/max(1,len(base))};extra_metrics.append(em)
        out.append(f'| 日常输入 {i} | {r["seconds"]:.1f} | {len(r["boundaries"])-1} | {100*d1/max(1,len(base)):.1f}% | {em["differencePercent"]:.1f}% | {b["skippedSeconds"]:.2f} |')
    out+=['',f'本轮所有测试合计 **{len(ledger)+len(extra_ledger)} 次真实 ASR 请求，API 返回 {reported+extra_seconds} 秒，费用估算 ¥{(reported+extra_seconds)*.00022:.5f}**，没有调用校订、整理或答题模型。','']
    for i,r in enumerate(extra,1):
        if r.get('skipped'):continue
        out += [f'### 日常输入 {i}','',f'[回听片段]({q/(r["id"]+".wav")}) · 源文件内 {stamp(r["start"])}–{stamp(r["end"])}','']
        for arm,title in [('full','完整输入'),('endpoint','按人声结束分段'),('endpoint-gated','分段 + 静音过滤')]:out += [f'**{title}**','',r['arms'][arm].get('text',''),'']
    stats['supplement']={'inventory':inventory,'metrics':extra_metrics,'requests':len(extra_ledger),'reportedSeconds':extra_seconds}
    stats['combinedRequests']=len(ledger)+len(extra_ledger);stats['combinedReportedSeconds']=reported+extra_seconds;stats['combinedEstimatedCNY']=(reported+extra_seconds)*.00022
    (p/'metrics.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2))
(p/'REPORT.md').write_text('\n'.join(out));print(json.dumps(stats,ensure_ascii=False));print(p/'REPORT.md')
