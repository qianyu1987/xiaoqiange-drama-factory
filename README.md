# 小钱哥短剧工厂

面向家庭创作者和短剧工作室的 AI 动画短剧生产工具集。当前仓库提供
“短剧双语字幕同步”Skill：使用本地 Whisper 获取真实对白时间码，生成
中文在上、英文在下的双语字幕，并通过 FFmpeg 确定性导出成片。

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

商业版“小钱哥短剧工厂”计划提供脚本、角色一致性、分镜、图片、10 秒视频、
对白字幕、配乐、合成和发布包的一键生产流程。模型生成费用与软件订阅分开计费，
上游主密钥不会进入客户安装包。

## 联系方式

- QQ：3184958887
- 官方网站：[www.hhtc.top](https://www.hhtc.top)

## 授权

本仓库不是开源软件。查看 [LICENSE](LICENSE) 了解试用、商业授权和禁止转售条款。
第三方组件仍分别受其原始许可证约束。
