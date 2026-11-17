> **发布副本提醒**：下文是原部署拓扑的维护参考；域名、IP、源码路径已替换为示例值。历史日期和验收结果不证明新环境已部署。首次部署需准备自己的主机、HTTPS、运行用户、目录和站点登记，检查全部脚本后执行。当前账户网关以 ACCOUNT_DEPLOY.md 为准。

# 单密码登录与服务器托管模型 Key

2026-11-04 用户明确要求简化为账号／数字密码，并允许模型密钥放在服务器。本次保留一个共享密码，支持至少 6 位数字，不额外要求用户名、设备保险库或导入文件。沿用现有浅色／深色和三个独立页面。登录弹窗采用现有卡片令牌及参照库 adisoft-modal-form 的简短说明、字段分组，不增加装饰插图。

## 真实边界

- `lecture-account` 是新服务，监听 **127.0.0.1:8792**，nginx 只代理 `/account/`。它持有模型 Key 及同步解密凭据，可访问配置的 HTTPS 模型平台。
- `lecture-sync` 仍监听 **127.0.0.1:8791**，保留 `IPAddressDeny=any`，仅回环可访问；它仍只保存加密内容，不直接调模型。
- 完整原音和资料正文继续在录制设备 IndexedDB 保存。仅所需的音频片段经过账户网关内存转发，nginx 请求和响应缓冲关闭，网关不写录音临时文件或请求正文日志。
- 账户密码只保存 scrypt 盐和哈希；随机登录会话只保存 token 哈希，浏览器使用 Secure、HttpOnly、SameSite=Strict Cookie，勾选记住登录最多 30 天。修改密码撤销旧会话。
- 网关按源和 CSRF token 校验写请求，限制登录失败次数和并发。平台 URL 必须 HTTPS，拒绝私网地址、跳转及客户端任意转发地址。接口不会回传模型 Key。
- **信任边界已改变**：服务器现在能使用 Key，也能解密同步文稿；不能再宣称服务器失陷后仍无法读取它们。这是用户本次明确选择的集中管理方式。

## 可选：自有 GPU 语音识别（经 Tailscale）

手机不需要加入 Tailscale：识别片段走 **手机 → HTTPS → 账户网关 → Tailscale → 自有 GPU 主机上的 OpenAI 兼容 ASR 服务**（原部署为一台 Windows 笔记本上的 Qwen3-ASR）。

- 上游只由运维在 `deploy/lecture-account.service` 的 `LECTURE_PRIVATE_ASR_URL` 设置，格式 `http://<私网或 Tailscale IP>:<端口>`，不带路径（示例值 `100.100.100.100:11500` 需替换）。客户端只能按 id `windows-asr` 选择，看不到也改不了地址；用户自填平台仍只允许公网 HTTPS。
- 网关每段先查上游 `/health`（缓存约 5 秒）：模型已加载且网关在途请求少于 2 个 → 发给 GPU 主机；未加载 → 触发 `/warmup`（每分钟最多一次），本段改发备用平台 `LECTURE_PRIVATE_ASR_FALLBACK`（默认 `siliconflow`，同名模型，按量计费）；离线、排队过长、503、出错或超时 → 同样改发备用平台。
- 响应头 `X-Lecture-ASR-Backend` / `X-Lecture-ASR-Fallback` 告诉手机实际由谁识别；用量表按实际平台记账：自有设备记为 0 并写明来源，备用平台按其单价，并显示回退原因。
- 选择自有 GPU 时不做“连续原音上下文”重识别：原部署实测热机约 0.6 倍实时（14 秒音频 GPU 8.4 秒，经网关端到端 10–12 秒），重复送上下文会超过实时。冷启动 1–3 分钟，期间由备用平台识别。
- `/account/` 的 nginx 读写超时为 600 秒（`tools/route_account.py` 只替换受管块），以容纳长分组的复核。
- GPU 主机上的 ASR 服务应开机/登录自启、不设运行时限（Windows 计划任务默认 72 小时会终止）、断线后自动重启；主机须开机联网且不睡眠。网关与 GPU 主机若只能经 Tailscale 中继连接，每次往返会增加数百毫秒。

## 第一次只设置一个密码

由本人在 Mac 的一次性页面输入两遍密码，代理不会替用户填写新密码：

```sh
python3 tools/set_login_password.py --web
# 用浏览器打开 http://127.0.0.1:8772/ ，本人输入密码
```

该页面只监听回环，校验精确 Host 和不可预测的一次性 nonce（兼容内置浏览器表单导航不带 Origin），不保存密码；通过已授权 SSH 的标准输入设置服务器密码。提交后确认服务器已配置才跳转正式网站；刷新采用重定向后的 GET，不重放密码提交。每次打开先检查服务器，已配置时只显示完成状态，不再提供覆盖密码的表单。也可运行 `python3 tools/set_login_password.py` 在终端隐藏输入。

手机只需打开 https://lecture.example.com/ ，输入这个密码。可选择记住登录；无需粘贴模型 Key。旧原音不会因登录、退出或同步被删除。

## 位置与更新

| 内容 | 位置 |
|---|---|
| 网关代码 | `/opt/lecture-account/cloud_server.py` 与兼容同步算法模块 `sync_client.py` |
| 私密文件 | `/var/lib/lecture-account/credentials.json`、`auth.json`、`sessions.sqlite`；目录 700、文件 600、用户 lecture-account |
| 系统服务 | `/etc/systemd/system/lecture-account.service` |
| 路由 | 现有 `/etc/nginx/sites-available/lecture-sync` 的 `/account/` 专用块 |
| 站点 | 原域名、TLS、SNI、统计名及旧同步路由保留 |

```sh
bash deploy/account.sh update          # 测试、备份代码/单元、安装/重启新服务、首次迁移密钥
python3 tools/route_account.py         # 幂等安装单一路由，关闭录音缓冲
python3 tools/build_mobile.py
bash deploy/mobile.sh deploy
```

`tools/provision_account.py` 仅在服务器尚无已配置密钥时迁移本机平台、模型、Key 和同步凭据；正文不进入 Git、参数或日志。已配置服务器默认保留，只有明确刷新时才用 `--refresh`。不得复制录音目录或整个 data/ 到服务器。

本机 Apple 系统 Python 可能没有 scrypt；账户测试脚本会使用可用的 Homebrew Python。服务器 `/usr/bin/python3` 需具备 scrypt。Python 服务端变更先跑账户与同步测试，原 `sync_server.py` 变更仍执行 `python3 -m unittest test_sync`、`./deploy/deploy.sh update`。

## 验收与排错

1. 匿名 `/account/status` 只返回配置／登录布尔状态；bootstrap、模型、文稿接口都应 401。错误密码限流；缺 Origin/CSRF 的写请求为 403。
2. 正常登录后默认模型就绪；设置中可更换平台、模型和参数，页面不出现服务器 Key 值。修改模型后另一个设备重新登录／加载应读到设置。
3. 并发提问及 SSE 首字不中途缓冲；校订／判题仍默认不 Thinking，追问可选强度。tokens、maxTokens 等普通字段不得被密钥脱敏规则误删。
4. 同步仅传文本表白名单，拒绝 chunks、音频文件和资料正文。退出／401 后本地原音和已完成文稿仍在。
5. 确认 nginx 请求缓冲关闭，新服务只监听回环，旧 sync 服务出网限制未改；站点自检失败项必须 0。
6. 若未设置密码，网站显示管理员初始化提示；只在 Mac 的设置页设置，不开放公网注册。若登录后模型 502，检查服务日志中的路由/状态及平台配置，不能打印请求正文或 Key 排查。
7. 手机锁屏、切后台、来电及长课存储配额仍需真机验收，网页不能承诺系统持续开放麦克风。课后导出原音备份。

登录入口修复：内置浏览器曾因缺少 Origin 被本机页误拒，导致密码未写入；`test_password_setup.py` 用真实 HTTP 表单覆盖缺失／null Origin、错误 nonce、Host、重复提交和已配置状态。公共构建为入口及整条模块依赖附加同一版本号，避免旧离线缓存继续使用八位密码表单。手机始终使用正式 HTTPS 域名，不能使用 Mac 的 127.0.0.1。

本次已通过 72 项 Node 测试、21 项账户／同步 Python 测试及 4 项打包测试；公网发布的 128 项站点自检失败为 0。通过临时、随后撤销的运维测试会话验证：服务器 Key 可获取 99 个模型，20 条既有文字记录可解密读取，bootstrap 无 Key 值。该检查没有调用付费生成接口。真实新密码仍须由用户本人设置，代理不会生成默认口令或替用户填写。

参考实现原则：[OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[OWASP 登录保护](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)。
