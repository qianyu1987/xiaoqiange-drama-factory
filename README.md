# 小钱哥短剧工厂

面向家庭创作者和短剧工作室的 AI 动画短剧生产工具集。仓库同时提供
“短剧双语字幕同步”Skill 和 Windows 客户版 ZIP 发布包。

## 当前能力

- 按真实语音时间显示字幕，不按镜头时长平均铺字幕
- 中文第一行、英文第二行、小字号、底部安全区
- 本地 MLX Whisper 词级时间码，不上传视频、不消耗 API 余额
- 双语 SRT 时间一致性、重叠和空字幕校验
- ASS 样式生成与 H.264/AAC 成片导出
- 对白帧、静音帧、画幅、编码和音轨 QA
- 视频生成提示词自动禁止字幕、文字、Logo 和水印

## 安装

需要 Python 3.11+、FFmpeg/FFprobe。macOS Apple Silicon 推荐安装
`mlx-whisper`。

```bash
python3 install.py
```

安装后可在 Codex 中说：

> 按小钱哥短剧字幕规格处理这个视频，中文在上英文在下。

Skill 源文件位于
[`skills/sync-short-drama-subtitles`](skills/sync-short-drama-subtitles)。

## 商业版

“小钱哥短剧工厂”客户版为 **99 元 / 31 天**，人工收款后为每位客户单独开通一套
上游 Token Plan，并生成一次性授权码，绑定一台 Windows 10/11 电脑。客户 ZIP
不包含 EXE 安装器，解压后运行 `start.bat`，需要 Node.js 22 LTS。

客户版只显示产品授权和通用生成状态，不要求客户填写模型地址或 API 密钥。上游主密钥
由云端控制面保管，客户之间不共享额度；套餐到期后已有项目仍可打开、备份和导出。

最新 ZIP 请在 GitHub Releases 下载，并用同目录的 `SHA256SUMS.txt` 校验。Windows
发布工作流位于 `.github/workflows/windows-zip.yml`，只生成 ZIP，不生成 Electron/EXE 安装器。

## 联系方式

- QQ：3184958887
- 官方网站：[www.hhtc.top](https://www.hhtc.top)

## 目录说明

- `start.bat` / `stop.bat`：Windows 本地工作台启动和停止
- `backend/`：客户版本地运行服务，生产依赖在 Release ZIP 中安装
- `frontend/`：客户版构建产物
- `tools/ffmpeg/`：Windows FFmpeg 与许可证说明
- `docs/`：隐私政策、订阅条款、AI 内容责任和第三方服务说明

仓库不包含控制面源码、开发数据库、客户肖像、生成媒体、环境变量或上游密钥。

## 授权

本仓库不是开源软件。查看 [LICENSE](LICENSE) 了解试用、商业授权和禁止转售条款。
第三方组件仍分别受其原始许可证约束。
