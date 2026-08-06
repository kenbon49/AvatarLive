# MuseTalk PCM 流输入与 WebRTC 播放

当前 MuseTalk 服务保留原有文本播报接口，同时增加无需 Azure TTS 的实时音频入口：

```text
浏览器/外部客户端 -- WebSocket PCM --> /stream --> MuseTalk 1.5
                                                     |
页面 <video>       <-- WebRTC audio + video ----------+
```

## 页面使用

1. 切换到 MuseTalk 模式并选择人物与动作。
2. 点击“麦克风流输入”，允许浏览器使用麦克风。
3. 再次点击“停止并驱动画面”。
4. 页面在已有 WebRTC 播放器中同步播放原音频和生成的人物视频。

麦克风路径直接上传 PCM，不调用 Azure，因此没有配置 Azure Speech Key 时也可使用。文本播报仍需要 Azure Key。

## WebSocket 协议

连接 `ws://HOST:8031/stream` 或兼容地址 `/v1/stream`。建立 WebRTC `/offer` 后，服务返回：

```json
{
  "type": "ready",
  "sample_rate": 16000,
  "channels": 1,
  "audio_format": "pcm_s16le",
  "max_audio_seconds": 120,
  "transport": "websocket_input_webrtc_output"
}
```

一次语音的顺序为：

1. 发送 `{"type":"start","action":"auto","interrupt":true}`。
2. 发送任意数量的二进制 PCM 块；每个样本为 signed 16-bit little-endian。
3. 发送 `{"type":"commit"}`。
4. 收到 `queued` 后，音视频通过此前建立的 WebRTC 连接播放。

`cancel` 丢弃尚未提交的 PCM；`interrupt` 同时丢弃 PCM 并停止当前播放。每次提交最多 120 秒。输入 WebSocket 只承载原始音频，避免将 JPEG 图片序列放进 JavaScript 主线程；最终画面继续使用浏览器原生 WebRTC 解码、时钟和音画同步。

## 实时边界

这里的“流输入”指音频可以分块上传，不需要先生成 WAV 文件。当前仍以一次 `commit` 为一个推理片段，首帧要等待该片段提交、Whisper 特征提取和第一个 MuseTalk batch。它不是逐采样、零延迟推理。需要更低延迟时，应在客户端用语音活动检测切成约 0.8 至 2 秒的自然语音片段，并依次提交；不建议任意切断音节。

人物视频仍来自已经预处理的动作素材，不接收任意摄像头视频作为实时底片。摄像头底片需要持续做人脸检测、latent/mask 缓存失效处理和背压控制，是另一条推理模式，不能由参考目录中的 `accelerated` 协议直接获得。

## 部署

HTTP 页面默认直连 `ws://页面主机:8031/stream`。HTTPS 页面默认尝试同源 `wss://.../musetalk-api/stream`；反向代理必须允许 WebSocket Upgrade。也可以在构建前显式配置：

```dotenv
NEXT_PUBLIC_MUSETALK_STREAM_URL=wss://example.com/musetalk-api/stream
```
