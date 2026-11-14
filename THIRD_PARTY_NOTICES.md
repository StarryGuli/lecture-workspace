# Phosphor Icons

Navigation icons use unmodified SVG paths from https://github.com/phosphor-icons/core .

MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Silero VAD（可选本地模型）

来源：https://github.com/snakers4/silero-vad
固定提交：066409f3d9db45a30d21dfcbf9147826ffdd7052
MIT 许可全文见 tools/SILERO_LICENSE.txt。模型由 tools/setup_vad.py 下载至 Git 忽略的 data/models/，通过 ONNX Runtime 在本机推理，不上传用户录音。

## 手机端浏览器依赖

- ONNX Runtime Web 1.23.2，MIT，官方 npm 发行物经 jsDelivr 下载后本地托管；许可全文 `static/vendor/ort/LICENSE`。
- PDF.js / pdfjs-dist 5.4.394，Apache-2.0，官方 npm 发行物经 jsDelivr 下载后本地托管；许可全文 `static/vendor/pdfjs/LICENSE`。
- Silero 模型沿用上方固定版本，在设备 Web Worker 中运行；完整许可证为 `tools/SILERO_LICENSE.txt`。

网页不向 CDN 加载执行脚本。发布物的逐文件 SHA-256 写入 `release.json`；不包含任何用户录音、密钥或数据库。
