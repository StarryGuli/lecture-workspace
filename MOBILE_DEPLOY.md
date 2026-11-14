> **发布副本提醒**：下文是原部署拓扑的维护参考；域名、IP、源码路径已替换为示例值。历史日期和验收结果不证明新环境已部署。首次部署需准备自己的主机、HTTPS、运行用户、目录和站点登记，检查全部脚本后执行。当前账户网关以 ACCOUNT_DEPLOY.md 为准。

# Mobile PWA packaging

> 公网登录已按用户新要求简化为单密码＋服务器托管 Key。当前设置密码和账户服务部署见 [ACCOUNT_DEPLOY.md](ACCOUNT_DEPLOY.md)。本文件中设备保险库／连接文件为旧直连模式的可选高级路径，不再是公网首次使用步骤。音频仍在设备保存，但用于识别的片段现在经过新网关内存转发，不落服务器录音库。

Only public browser assets are packaged. Run from the repository root:

```sh
python3 -m unittest test_mobile_build
python3 tools/build_mobile.py
```

The deterministic SHA-256 version identifies transformed public content. Output is
`build/mobile`; `release.json` records original source checksums and final file
checksums (it does not hash itself). Do not commit generated output. The explicit
allowlist lives in `tools/build_mobile.py`; all top-level `mobile-*.mjs` modules
are included. Vendor dependencies are pinned by filename, not copied recursively.
Adding a vendor dependency requires an allowlist update. No data directories,
keys, configuration, Python sources, tests or audio are packaged. Symlinks and
empty required assets fail the build. Files in the public allowlist must themselves
remain public; the builder is not a secret-content scanner.

Supply the matching public ONNX Runtime loader and
`vendor/ort/ort-wasm-simd-threaded.wasm`, PDF.js `pdf.mjs` and
`pdf.worker.mjs`, their licenses, and `models/silero_vad.onnx` under `static/`.
The builder never downloads dependencies. Required mobile modules include
`mobile-vad.mjs`. Missing dependencies stop packaging before replacing output.
Optional PNG icons (`icon.png`, `icon-192.png`, `icon-512.png`,
`apple-touch-icon.png`) are copied when present; otherwise the Apple link uses SVG.
For reliable iOS installation, supply an appropriately sized PNG. Manifest icon
entries remain owned by the application team.

# Operator deployment

Deployment is an explicit external action; obtain release authorization before
running it. This release is authorized by the user's explicit instruction to proceed.
Use existing operator SSH access; no credentials belong in this repository.

```sh
bash deploy/mobile.sh deploy
```

If a slow connection cannot upload the full vendor bundle, use
`LECTURE_MOBILE_REUSE_VENDOR=1 bash deploy/mobile.sh deploy`. This uploads the
new application files and manifest, then reuses only existing `vendor/` and
`models/` files whose SHA-256 matches that new manifest. Missing or changed
vendor files abort before switching the release. Final complete-tree checks,
atomic publication, health checks and rollback remain the same. The normal
full deployment is required on first installation or after vendor changes.

The script runs `test_sync`, Python mobile fixture tests, and each root
`test_mobile_*.mjs` with Node. Sync tests use temporary local loopback servers;
mobile build tests use fixtures without networking. It independently rebuilds and
compares the complete tree against an existing build, rejecting stale or modified
output. Rebuild explicitly before retrying. Only a tar of the fresh public tree is
uploaded to the fixed host `root@203.0.113.10`.

Prerequisites: Python 3, Node, tar, diff and existing SSH tools locally; Python 3,
nginx, systemd, curl and the existing site auditor remotely. The installed auditor
exposes counters rather than a `--json` option. A read-only import adapter checks
its exit status and serializes its actual `nfail`, `nwarn` and `results` counters.
Missing counters or failed checks abort and roll back. This interface was verified
against the existing server before release.

The remote operator needs existing write access to the one vhost and release
root. Releases live under `/var/www/lecture-workspace/releases/<content-hash>`;
`current` switches by atomic symlink rename. Existing releases/backups are never
overwritten; a byte-identical release from a rolled-back attempt may be reused
after verifying every file. Each attempt has its own timestamped vhost backup.
The script backs up only
`/etc/nginx/sites-available/lecture-sync`, changes its root location, and retains
its domain, listeners, TLS, SNI and other server directives. The first migration
adds `/v1/` and exact `/healthz` proxies to `127.0.0.1:8791`, and denies `/api`
and `/api/`. Ambiguous preexisting endpoint routing requires manual review.
MJS and WASM MIME types are set explicitly. SPA navigation falls back to index;
public assets use revalidation. No service, other vhost, network restriction,
model relay or audio relay is changed. Registry metadata, including `stats_name`
and tracked service fields, stays unchanged.

`nginx -t` must pass before reload. The page marker is polled briefly because
nginx acknowledges reload before new workers accept connections. Public page, health and API-denial checks and
structured site audit must all pass; failures restore the vhost and prior symlink,
validate nginx and reload. Output reports the version, prior target, backup path
and audit evidence for the main owner to review and update registration separately.
A failed new release is retained for inspection. Upload temporary files are cleaned
on normal shell exit. SSH interruption or host loss can prevent automatic rollback;
inspect remote state before retrying. Concurrent deployments are unsupported.

# Manual rollback and onboarding

Using existing authorized operator access, select the backup and previous current
target from deployment output. Restore the vhost backup, create a temporary symlink
to that previous release and rename it over `current` on the same filesystem.
For the first migration with no previous target, remove only the `current` symlink.
Run `nginx -t` before reloading nginx; stop and repair configuration if validation
fails. Recheck the page, `/healthz`, `/v1/` authorization and structured site audit.
Never alter another site or the sync service. Keep backups until the release is
accepted; retention cleanup is an operator task.

On phones, open the existing HTTPS domain, then use the browser's install/Add to
Home Screen action. Allow microphone access when recording. Initial load and
large public model/WASM downloads require connectivity; browser storage quotas,
eviction and background recording limits still apply. Keep device backups and
verify offline readiness on each target browser. This packaging does not verify
physical iPhone/iPad background recording or storage eviction behavior.

## 旧直连模式首次使用（历史说明，非当前公网默认）

1. 用 Safari 打开 https://lecture.example.com/ ，分享 → 添加到主屏幕。
2. 点“解锁密钥”，自己设置此设备的加密密码，再输入硅基流动 Key。默认语音识别和校订/答题模型随即可用；模型设置仍可修改。设备密码不发送服务器。
3. 如果沿用 Mac 的同步仓库，在 Mac 项目目录运行 `python3 tools/mobile_pairing.py`，自己输入连接文件密码。将生成的加密 `.lecture` 文件传到自己的手机，在“连接／同步”导入，再拉取设置和文字记录。文件不包含原音。
4. 第一次录音同意麦克风授权，观察顶部“自动收音：已就绪”。录音中不要刷新页面；课后从记录库导出原音作为备份。

完整音频分片写入 IndexedDB，处理完成不会自动删除；空间不足、清理网站数据或系统回收仍可能丢失。锁屏、切后台、来电后的持续录音需要真机验收，网页无法保证系统不暂停麦克风。

## 本次验收

- 2026-11-05 长录音与快速模型版本：100 项 Node、26 项 Python 测试通过；一小时以上压缩录音按十分钟分片处理，普通记录顶部显示用量与费用，当前模型可快速切换并标注已核实免费候选。本轮未调用付费模型。
- 66 项 Node 测试、14 项 Python 同步/打包测试通过。
- 浏览器直连硅基流动的真实 12 秒样本：ASR 0.47 秒、校订 0.97 秒、答案首字 0.42 秒；3 次模型请求估算 CNY 0.00343。样本不代表持续网络或真机性能。
- 62.7 秒课堂音频在浏览器本机保存与分析成功，Silero 保护人声后建议阈值 −40 dBFS，无云端分析调用。
- 320–1920 像素三种页面共 18 种响应式组合无横向溢出。
- Brave 搜索尚未用真实搜索密钥验证；iPhone/iPad 后台录音和持久存储需真机检查。
