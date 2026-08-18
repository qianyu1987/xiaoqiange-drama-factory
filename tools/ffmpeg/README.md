# Windows FFmpeg runtime

本目录包含客户版使用的 Windows x64 LGPL shared FFmpeg 运行文件：`ffmpeg.exe`、`ffprobe.exe` 及必要 DLL。来源、归档校验值和源码获取方式见 `SOURCE.txt`，许可证见 `LICENSE.txt`。

`verify-commercial-build.js` 会拒绝 `--enable-gpl` 或 `--enable-nonfree` 构建。仓库现有 `backend-node/tools/ffmpeg/ffmpeg` 是 macOS arm64 GPL 文件，不能复制到 Windows 商品包。Windows 上的编码器和运行行为仍需在干净 Windows 10/11 虚拟机验收。
