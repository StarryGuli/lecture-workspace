# 开发协作

在此私有仓库的 Issues 说明问题，在 feature 分支修改后提交 pull request。先检查 README 的运行要求。

提交前运行 `python3 -m unittest test_sync test_mobile_build` 和 `node --test test_mobile_*.mjs`；修改服务逻辑时补充相关测试。

禁止提交真实录音、逐字稿、密钥、密码、cookie 或生产数据库。复现资料使用合成样例。部署占位符不得替换成个人基础设施后提交。
