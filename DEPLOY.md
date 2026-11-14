> **发布副本提醒**：下文是原部署拓扑的维护参考；域名、IP、源码路径已替换为示例值。历史日期和验收结果不证明新环境已部署。首次部署需准备自己的主机、HTTPS、运行用户、目录和站点登记，检查全部脚本后执行。当前账户网关以 ACCOUNT_DEPLOY.md 为准。

# 部署文档 · 记录工作台同步仓库（CMIN2）

> 给后续要修改并重新部署的人或模型：**先读「硬约束」和「更新部署」两节**，其余按需查。
> 最近一次部署：2026-11-10。PWA 版本 `5d3d0db9eae8a89324714cd43fba52df0cf1ddd6b70bfddcabc309bb1ef2a762`（本地录音恢复日志、原会话续录、录音中查看历史）；站点审计 128 项、失败 0。恢复日志留在设备端，不新增服务器音频存储或同步。

> **2026-11-04 登录方案变更：用户明确要求“直接搞个账号密码，或者数字密码，密钥可以放服务器”。** 公网 PWA 默认改用一个共享密码及独立 `lecture-account` 服务（127.0.0.1:8792）。该服务保存模型 Key 和同步解密凭据，并在内存中转发必要音频及模型请求；不保存原音。既有 `lecture-sync`（8791）的加密存储及出网禁止保持不变。下文“模型只从设备发、服务器没有密钥”的旧约束仅适用于旧直连／同步模式，不适用于本次明确授权的新账户网关。当前完整流程见 [ACCOUNT_DEPLOY.md](ACCOUNT_DEPLOY.md)。

## 一、这是什么

记录工作台现在有两种运行方式：Mac 本地服务（`python3 server.py`，监听 `127.0.0.1:8766`），以及由 CMIN2 提供静态文件的设备端 PWA 网页。PWA 的录音、原音保存、静音判断、模型请求都在打开网页的手机／平板／电脑上进行。

CMIN2 的 Python 服务仍然只是「加密同步仓库」，不运行 `server.py`，不接收录音或转发模型请求；首页由 nginx 提供 PWA，`/v1/` 和 `/healthz` 保留原同步服务。手机前端的构建、发布、回滚与连接步骤见 [MOBILE_DEPLOY.md](MOBILE_DEPLOY.md)。

```
 用户 Mac（数据主人）                                         CMIN2（只存密文）
┌──────────────────────────────┐                      ┌────────────────────────────────────┐
│ server.py :8766  ←浏览器       │                      │ nginx 443 SNI 分流 → 8445 vhost      │
│   │  模型请求只从这里发出 ──→ 平台 │                      │   lecture.example.com   │
│ data/  录音 .wav  ← 永远留本机   │   HTTPS + Bearer     │        ↓                            │
│ sync_client.py push / pull ───┼─────────────────────→│ 127.0.0.1:8791 sync_server.py        │
│   本机加密（口令不出本机）        │      只传密文          │ /var/lib/lecture-sync/ (700)        │
└──────────────────────────────┘                      └────────────────────────────────────┘
```

## 二、硬约束（改任何东西前先确认没有违反）

1. **录音永远不上传。** 客户端不读 `*.wav`、不导出 `chunks` 表；服务端按名字拒绝音频扩展名。`test_sync.py::test_audio_never_leaves_the_machine` 守着这条，改同步逻辑必须保持它通过。
2. **模型请求只从录制／分析设备发。** CMIN2 上没有 `server.py`、没有任何平台密钥明文、也**不能**对外联网：systemd 单元用 `IPAddressAllow=127.0.0.0/8 ::1` + `IPAddressDeny=any`，系统层只放行回环（已实测连 1.1.1.1 与 api.siliconflow.cn 都被拒）。**不要放宽，也不要把 `server.py` 部署到 CMIN2。**
3. **用户数据只存密文。** 公开的 PWA 静态资源不含用户数据。配置、密钥、分析结果都在本机用 openssl AES-256-CBC（PBKDF2 20 万轮）加密并附 HMAC 后才上传。服务器没有口令；服务器被拿下也读不到密钥和文稿。
4. **不要把 token、口令、密钥值打印到终端、日志、文档或 git。** 它们只在 Mac 的 `~/.lecture-sync/`（权限 600）。文档里只写位置。
5. **改 CMIN2 的站点登记必须跑自检**：`python3 /root/webserver/site_audit.py`，❌ 为 0 才算完成（见 CMIN2 `/root/webserver/SITES-RUNBOOK.md`）。
6. 对服务器的发布需要用户授权；本次手机网页版上线已获用户明确“做”的授权。其他项目或访问权限变更仍不属于这次范围。

## 三、同步什么 / 不同步什么

| 内容 | 来源（本机 `data/`） | 是否同步 | 备注 |
|---|---|---|---|
| 设置（模型默认值等） | `settings.json` | ✅ 加密 | 命名空间 `config` |
| 平台定义（含自定义 header） | `web-providers.json` | ✅ 加密 | `config` |
| API 密钥 | `keys/*`、`search-key` | ✅ 加密 | 命名空间 `keys` |
| 分析结果 | `records.sqlite`：`sessions` `revisions` `marks` `usage` `documents`(仅文件名与页码偏移) | ✅ 加密，每会话一份 | 命名空间 `records`，名字是会话 id |
| **录音** | `*.wav`、`<会话>/chunk-*.wav`、`original.wav`、`uploaded-audio/` | ❌ | 留本机 |
| 音频索引 | `chunks` 表 | ❌ | 只是本机文件路径 |
| 资料正文 | `documents.pages`、`<会话>/*.txt` | ❌ | 教材/版权内容；拉回的设备上该字段为 `[]` |
| 实时逐字稿中间态 | `partial-transcript.json` | ❌ | 最终结果已在 `revisions` |
| 测试数据 | `test-runs/`、`question-test-clips-*`、`*.before-extraction.sqlite` | ❌ | |
| 录音中的会话 | `sessions.status='recording'` | ❌ | 结束后再同步，避免半成品 |

## 四、位置清单（不含任何秘密）

| 什么 | 在哪 |
|---|---|
| 项目源码 | Mac：`/path/to/lecture-workspace`（目前没有 git remote） |
| 同步客户端 / 服务端 | `sync_client.py`（本机运行）/ `sync_server.py`（部署到 CMIN2） |
| 部署文件 | `deploy/`：`lecture-sync.service`、`nginx-vhost.conf`、`site-entry.json`、`deploy.sh` |
| 本机连接配置 | `~/.lecture-sync/config.json`（url + token）、`passphrase`（加密口令）、`state.json`（各项已同步的版本） |
| 服务器代码 | CMIN2 `/opt/lecture-sync/sync_server.py`（root 所有，发布时自动留 `.bak-<时间>`） |
| 服务器数据 | CMIN2 `/var/lib/lecture-sync/`（700，属主 `lecture-sync`）：`config/ keys/ records/` + `token.sha256`（只存 token 的哈希） |
| 服务 | systemd `lecture-sync`，监听 `127.0.0.1:8791`，用户 `lecture-sync`，内存上限 96M |
| 公网入口 | `https://lecture.example.com/`（泛解析子域名，DNS 与证书自动覆盖） |
| nginx | `/etc/nginx/sites-available/lecture-sync`（软链到 `sites-enabled/`）；分流行在 `/etc/nginx/streams-enabled/443-split.conf` |
| 后台登记 | `/root/webserver/sites.json` 中名为「记录工作台 · 同步仓库」的条目（控制台 → 站点入口） |
| 首次安装时的备份 | CMIN2 `/root/443-split.conf.bak-20261104-101126-lecture`、`/root/webserver/sites.json.bak-20261104-101126-lecture` |

## 五、日常使用（在 Mac 上，项目目录里）

```bash
python3 sync_client.py status      # 对照本机与服务器：会推什么、会拉什么、哪些明确不上传
python3 sync_client.py push        # 本机 → 服务器（--dry-run 只预演）
python3 sync_client.py pull        # 服务器 → 本机（--dry-run 只预演）
```

- **应用不会自动同步**，需要时手动跑；没有定时任务（用户不要自动化清理类任务，同步也保持手动）。
- 推送是幂等的：内容没变就是「N 项已一致」。
- **冲突规则**：
  - `records`（分析结果）：两边都改过同一会话 → 按 id 取并集合并，不会丢，不需要人工处理。
  - `config` / `keys`：两边都改过 → **不覆盖**，报告冲突。以本机为准用 `push --prefer local`，以服务器为准用 `pull --prefer remote`（本机旧文件先备份到 `data/.sync-backup/<时间>/`）。
- **新设备**：把 `~/.lecture-sync/config.json` 和 `passphrase` 安全地拷过去（口令是解密一切的唯一钥匙，丢了服务器上的密文就废了），先启动一次应用让它建库，再 `pull`。
- 同步不处理删除：本机删掉的会话不会从服务器删，服务器的也不会反向删；会话改名不会覆盖已存在的会话；`documents` 在新设备上没有正文。

## 六、更新部署（最常用）

设备端网页：`python3 tools/build_mobile.py` → `bash deploy/mobile.sh deploy`，详见 MOBILE_DEPLOY.md。它只部署公开静态文件并保留同步服务限制；不要把应用 Python 后端放到服务器。


只改了 `sync_client.py`、`test_sync.py`、文档 → **不需要部署**（客户端只在本机运行）。
改了 `sync_server.py` 或 `deploy/lecture-sync.service` → 按下面做：

```bash
cd /path/to/lecture-workspace
python3 -m unittest test_sync            # 先全过（10 项，约 15 秒）
./deploy/deploy.sh update                # 备份旧文件 → 上传 → 重启 → 冒烟测试 → 站点自检
./deploy/deploy.sh status                # 只读：服务状态、各命名空间份数、冒烟测试
```

`update` 完成的判据：冒烟测试里公网 `/healthz` 是 200、无 token 取 `/v1/index` 是 401；自检合计 ❌ 为 0。
改了 `deploy/lecture-sync.service`：`deploy.sh update` **不会**同步它，要手动：

```bash
scp deploy/lecture-sync.service root@203.0.113.10:/etc/systemd/system/lecture-sync.service
ssh root@203.0.113.10 'systemctl daemon-reload && systemctl restart lecture-sync && systemctl is-active lecture-sync'
```

**应用的数据库表结构变了**（`server.py` 里的 `CREATE TABLE`）→ 同步客户端要跟着改：`sync_client.py` 顶部的 `SESSION_COLS` / `TABLES`（导出列）、`test_sync.py` 的 `SCHEMA`；新增表要决定是否同步，凡是指向音频文件路径或资料正文的列都不能导出。改完跑测试。

**轮换 token**：`python3 sync_client.py init --url https://lecture.example.com --force`（口令不变）→ `./deploy/deploy.sh token`。
**不要**轻易换口令（`--new-passphrase`）：旧密文会全部解不开，要清空服务器 `records/ keys/ config/` 后重推。

## 七、首次安装（已完成；灾难恢复或换服务器时照做）

在项目目录里，服务器 `root@203.0.113.10`（CMIN2）：

1. 本机初始化：`python3 sync_client.py init --url https://lecture.example.com`，记下输出的 token 哈希。
2. 服务器：建系统用户与目录，装代码和单元，写入 token 哈希，启动。
   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin lecture-sync
   install -d -m 755 /opt/lecture-sync
   install -d -m 700 -o lecture-sync -g lecture-sync /var/lib/lecture-sync
   # scp 上传 sync_server.py、deploy/lecture-sync.service 后：
   install -m 644 sync_server.py /opt/lecture-sync/sync_server.py
   install -m 644 lecture-sync.service /etc/systemd/system/lecture-sync.service
   echo <token 哈希> > /var/lib/lecture-sync/token.sha256
   chown lecture-sync:lecture-sync /var/lib/lecture-sync/token.sha256; chmod 600 /var/lib/lecture-sync/token.sha256
   systemctl daemon-reload && systemctl enable --now lecture-sync
   ```
3. nginx（按 `SITES-RUNBOOK.md`「新增站点标准流程」；**先备份**，`nginx -t` 不过就还原）：
   - `deploy/nginx-vhost.conf` → `/etc/nginx/sites-available/lecture-sync`，软链到 `sites-enabled/`（不要直接在 `sites-enabled/` 写实体文件）。
   - `/etc/nginx/streams-enabled/443-split.conf` 的「已登记自家站点」区加一行：`lecture.example.com  127.0.0.1:8445;`（要在正则行上面）。
   - `nginx -t && systemctl reload nginx`。
   - 后端只监听 `127.0.0.1`，不需要 iptables 封端口。
4. **后台登记**：把 `deploy/site-entry.json` 追加进 `/root/webserver/sites.json`（数组），5 秒内控制台「站点入口」、访客统计、状态卡自动生效。`stats_name` 一旦定了不要改。JS 埋点已决定 `skip`（纯接口无页面）。
5. 跑自检：`python3 /root/webserver/site_audit.py`，❌ 必须为 0。
6. 推送并验证：见下一节。

## 八、验收（每次部署后都可以重跑）

| 检查 | 命令 / 期望 |
|---|---|
| 服务与端口 | `./deploy/deploy.sh status`：`active`、`enabled`、监听 8791 |
| 公网可达且受保护 | `curl -s https://lecture.example.com/healthz` → `{"ok": true}`；`curl -o /dev/null -w '%{http_code}' https://lecture.example.com/v1/index` → `401` |
| 本机与服务器一致 | `python3 sync_client.py status` → 推/拉都是 0 项待处理 |
| 服务器只有密文 | 服务器上 `cd /var/lib/lecture-sync && grep -rlaE 'RIFF.{4}WAVE\|siliconflow\|"title"' .` → 无输出；每个 blob 以 `LSYNC1` 开头 |
| 不能外联 | 服务器上用同样限制起临时进程 `systemd-run --wait --pipe -p User=lecture-sync -p IPAddressDeny=any -p 'IPAddressAllow=127.0.0.0/8 ::1' python3 <连外网脚本>` → 连 1.1.1.1 失败 |
| 干净设备能还原 | 用临时目录 + 临时 `LECTURE_SYNC_HOME`（拷 config.json 和 passphrase）+ 建好空表的库，`pull --data <临时目录>`，对比各表行数与设置/密钥的哈希（**不要用真实 HOME，会改 state.json**） |
| 站点登记 | `python3 /root/webserver/site_audit.py` → ❌ 0；控制台「站点入口」能看到「记录工作台 · 同步仓库」 |

2026-11-04 首次部署的实测结果：23 项上传（设置 1、平台 1、密钥 1、会话 20）；服务器 0 个含音频头/明文的文件；干净设备还原 sessions 20、revisions 1028、marks 7、usage 725、documents 5 全部逐行一致；356 个本机 wav、338 行 chunks 均未上传。

## 九、排错

| 现象 | 原因 / 处理 |
|---|---|
| `连不上同步服务器` | 先 `curl https://lecture.example.com/healthz`。Mac 开着 Shadowrocket 的 TUN 时本地测试可能被扭曲，换网络或关代理对比；服务器侧 `deploy.sh status` |
| `服务器拒绝了 token` | 服务器的 `token.sha256` 与 `~/.lecture-sync/config.json` 不一致 → `./deploy/deploy.sh token`。短时间大量 401 可能触发 CMIN2 的 fail2ban（`nginx-4xx-flood`）暂时封 IP |
| `校验失败：口令不对，或密文被改动` | 本机 `passphrase` 与加密时的不同（新设备没拷口令，或被 `--new-passphrase` 换过） |
| push 报 `服务器上有另一台设备的修改` | 见「冲突规则」：先 `pull`，或明确选 `--prefer local/remote` |
| push 报 `上传瞬间服务器版本变了` | 两台设备同时推，重跑一次 |
| `HTTP 413` | 单份密文超过 8 MiB；`LECTURE_SYNC_MAX_BODY` 可调，同时要改 nginx `client_max_body_size` |
| pull 提示本机没有数据库 | 先启动一次 `python3 server.py` 建表 |
| 服务起不来 | `ssh root@203.0.113.10 'journalctl -u lecture-sync -n 30 --no-pager'`；常见是 `/var/lib/lecture-sync` 属主不对（应为 `lecture-sync`，700） |
| 想回滚服务器代码 | `/opt/lecture-sync/sync_server.py.bak-<时间>` 拷回去再 `systemctl restart lecture-sync`；单个数据项有 `<名字>.prev`（上一版密文） |

## 十、常见坑（来自这台服务器和 Mac 的经验）

- Mac 的 shell 是 zsh：没有 `timeout` 命令，未加引号的变量不会按空格拆分，没匹配上的通配符会让整条命令中止。长脚本写成文件再 `ssh … 'bash -s' < 文件` 最稳。
- CMIN2 内存只有 ~1G、磁盘余 3.6G：同步仓库很小（全部数据约 0.5 MB），别在上面放大文件。
- 不要在 CMIN2 上用 `pm2 update`（会让 MES 掉线，见该服务器手册）；本服务是 systemd，不受影响。
- 改 `443-split.conf` 之前一定先备份，`nginx -t` 通过才 `reload`。
- 全局文档 `~/.claude/CLAUDE.md` 的「站点 → 服务器对照」表里已登记本站，改域名要同步改。

## 十一、变更记录

- 2026-11-04：首次部署。同步仓库上线，登记「记录工作台 · 同步仓库」；`sync_client.py init --force` 只轮换 token。
