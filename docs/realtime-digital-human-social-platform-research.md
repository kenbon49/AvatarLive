# 实时数字人直播：社交平台案例、技术拆解与 SynLive 实施建议

> 调研日期：2026-07-20
>
> 实施状态更新：2026-07-21
>
> 覆盖范围：YouTube、Bilibili、Reddit、知乎、Instagram/TikTok 可公开访问内容，以及对应的代码仓库、官方 API 文档和论文。
>
> 本文也汇总了此前围绕 SynLive、LiveAct、FlashHead、人物切换、肢体动作和 OpenTalking 的讨论与实测结果。
>
> 后续先完成了“FlashHead 完整生成脸 + 真人动作底片”PoC，但实测确认两套独立头脸/下颌运动无法靠 2D 对齐彻底贴合；该文现作为失败记录保留在 `docs/flashhead-body-motion-poc-implementation.md`。当前动作主播已经改为“真人目标视频当前帧 + MuseTalk 1.5 只重建嘴部/下半脸”，实现与本机 benchmark 见 `docs/musetalk-action-avatar-implementation.md`。

## 1. 执行结论

社交平台上看起来同时具备“真人感、实时对话、准确口型、自然肢体动作”的数字人，通常不是一个模型从弹幕开始端到端实时生成整个人。当前可验证的主流实现是把系统拆开：

```text
弹幕 / 麦克风
  -> 审核、去重和优先级
  -> FAQ / 商品知识库 / LLM
  -> 回复文本 + 情绪标签 + 动作标签
  -> 流式 TTS
  -> 嘴型与面部渲染
  -> 动作素材或 3D 动画状态机
  -> WebRTC 预览
  -> OBS / RTMP / SRT 推流
```

最重要的结论如下：

1. **在本文核验的固定机位写实方案中，最容易兼顾照片级观感和消费级 GPU 实时性的，是“真人动作底片 + 实时换嘴”。** 身体、衣服、手势和商品来自预录真人视频，MuseTalk、Wav2Lip 或 QuickTalk 只修改脸部/嘴部；动作状态机切换 `idle`、`wave`、`thank`、`point_product` 等片段。
2. **需要语义动作、场景交互和可控打断时，目前更成熟灵活的路线是 3D 数字人。** MetaHuman、Unity 或 Omniverse 实时渲染人物；Audio2Face、ARKit 或 viseme 驱动脸和嘴；Animation Blueprint、Montage、状态机、动捕资产负责身体。LLM 只选择 `Wave`、`Point`、`PickUp` 等动作，不逐帧生成骨骼。
3. **社交平台上一些动作尤其自然的全身直播，实际使用真人动捕或隐藏操作者。** CodeMiko、VTuber 等可以真正实时做任意动作，但身体不是自主生成的。
4. **真正逐帧生成脸、手、衣服和全身的视频模型已经出现，但还不是 SynLive 当前硬件上的生产主线。** LiveAct、FlashTalk、Alibaba LiveAvatar、FlowAct-R1、StreamAvatar 等通常需要 H100/H800/A100 级多卡，或只有论文和演示，没有可部署的代码、权重与直播连接器。
5. **一段社交媒体视频只能证明“展示了这个画面”，不能证明它是实时生成。** 必须继续寻找代码、API、动作接口、硬件、首帧延迟、持续 FPS、连续录屏和打断测试。很多“AI 直播”实际是预生成视频、录屏、离线扩散或真人接管。

SynLive 已按这一判断拆成三条明确路径：FlashHead 保留为低延迟纯头肩模式；MuseTalk 1.5 使用真人动作当前帧实时/半实时重建嘴部；LiveAct 保留为离线高质量生成。下一阶段重点不再是继续调整 FlashHead 贴脸参数，而是重录授权、静默且下颌中性的真人动作库，并完成 MuseTalk 端到端与长时间验收。只有在业务必须支持任意走动、拿取商品和空间交互时，再建设 UE5/MetaHuman 路线。

## 2. 调研方法与证据等级

### 2.1 证据等级

| 等级 | 可以证明什么 | 典型材料 |
| --- | --- | --- |
| A：可复核实现 | 能确认实际机制，部分情况下可复现 | 源码、历史 commit、manifest、官方 API 参数、论文方法与硬件 |
| B：官方能力说明 | 厂商明确说明产品能力，但性能未必独立验证 | 官方开发文档、官方技术文章、SDK 示例 |
| C：连续演示 | 可以确认交互链路存在，但不能确认内部实现和性能口径 | 连续录屏、真人现场交互、作者演示 |
| D：营销或二次传播 | 只能作为线索，不能据此选型 | 剪辑成片、转载、没有硬件/延迟/代码的宣传文章 |

本文将“厂商宣称”“代码可证”“合理推断”分开表述。特别是：

- `render_fps` 只是模型生成吞吐，不等于用户说完后看到画面的端到端延迟。
- 屏幕录制为 60 FPS，不代表数字人模型以 60 FPS 推理。
- 嘴型准确不等于面部、头部和身体由同一个模型生成。
- 身体持续自然晃动不等于它能根据任意语义实时生成新动作。
- TTFF 通常从模型收到条件开始计算，不一定包含弹幕、LLM、TTS 和网络。

### 2.2 平台访问边界

- YouTube 的标题与作者可通过公开页面和 oEmbed 核验，但部分媒体流会触发机器人校验。
- Bilibili 搜索页容易返回 412；本文核心案例通过官方 view/playurl API 核对，且对两个 LiveTalking 动作演示下载抽查。
- Reddit 正文 API 在当前网络环境返回 403。相关案例通过公开搜索索引、embed、历史代码和关联仓库交叉核验；不把未核实评论当作事实。
- 知乎正文经常触发登录或验证码。核心文章通过公开缓存、论文和项目仓库交叉验证；无法稳定读取的内容只列为弱证据。
- Instagram 多数帖子需要登录，部分账号返回限流；因此没有把 Instagram 二次转载作为核心技术证据。
- TikTok 单条公开内容偶尔可读，但短视频本身通常不披露模型、硬件、延迟和剪辑方式。

因此，“覆盖了平台”不等于“认可了平台视频中的技术声明”。

## 3. 此前对话与 SynLive 演进

| 用户关注点 | 调查或实施结果 | 当前判断 |
| --- | --- | --- |
| 先理解当前项目 | 核对了 Next.js 直播中控、FastAPI 业务层、TTS/LLM、数字人渲染适配器、WebRTC/HLS 和部署脚本 | SynLive 是“中控与编排层”，数字人渲染应保持可插拔 |
| LiveAct 前端按钮灰色、无法点击 | 前端增加了服务探活、同源代理、超时和状态提示；同时规避 SSR/客户端主机名不一致导致的 hydration 问题 | LiveAct 不是单纯的按钮样式问题，服务预热、跨域/混合内容和 UI 状态都必须处理 |
| 自己打开前端验证 | 增加了浏览器级验证，覆盖连接、播报、Q&A、模式切换、人物切换和移动端 | 只看 API 200 不足以验收，必须确认浏览器实际解码音视频和按钮可操作 |
| LiveAct 生成感觉慢 | 引入 FlashHead Lite WebRTC 模式，并把它设为默认实时入口；LiveAct 保留为高质量生成模式 | “实时互动”和“高质量生成”应是两个明确模式，不应伪装成同一延迟等级 |
| 人物能否替换 | FlashHead 增加 5 个可切换人物；LiveAct 增加 4 个参考形象和上传入口 | 单张图可以换脸/身份，但不能凭一张图获得可靠的全身动作资产 |
| 能否支持上半身或全身动作 | 分析了预录真人底片、3D 骨骼动画、动捕和全帧生成路线 | 单 3090 上优先做真人动作片段；需要任意动作时使用 3D/动捕 |
| OpenTalking 示例为什么真实 | 审计示例文档、manifest、视频和仓库能力 | 可追溯的带货案例是 Wav2Lip 替换嘴部，身体动作来自短真人底片循环 |
| 市面产品如何实时回复弹幕 | 调研社交平台、商业 SDK、开源项目与论文 | 商业系统通常把弹幕、LLM、TTS、嘴型、动作和推流拆成独立服务 |
| FlashHead 脸层为什么张嘴时脱离头部 | 复查完整脸 compositor、逐帧运动源和公开项目边界 | FlashHead 生成脸与真人底片各自驱动头姿/下颌，2D affine 与羽化无法统一两套三维运动 |
| 改用哪条动作主播路线 | 已实现独立 MuseTalk 1.5 服务、25 FPS 动作 planner 和 jaw-mask 融合 | 保留真人当前帧，只重建嘴部/下半脸；FlashHead 不再参与身体合成 |

本节前半部分记录最初调研过程；截至 2026-07-21，推荐的 MuseTalk 路线已经在工作区实现，但当前 `motion-host` 素材仍只限内部 PoC，不能视为生产人物验收完成。

## 4. SynLive 当前实测状态

以下表格是 2026-07-20 在当前主机直接核对的 FlashHead/LiveAct 状态，不是目标值或宣传值：

| 项目 | 当前结果 |
| --- | --- |
| 前端 | `http://127.0.0.1:8018/app/live` 返回 HTTP 200 |
| FlashHead 服务 | `:8030` 健康状态为 `ok` |
| FlashHead 输出 | 512 x 512、20 FPS、WebRTC 音视频 |
| 可切换人物 | 5 个；当前为 `calm-host` |
| 最近一次 TTS | 1952.7 ms |
| 最近一次首视频 | 2782.5 ms |
| 最近一次首音频 | 2773.3 ms |
| 最近一次音画起播偏差 | 9.2 ms |
| LiveAct | `:5071` 根页面返回 HTTP 200，生成任务通过 HLS 播放 |
| LiveAct 参考形象 | 4 个预置形象，并支持前端上传参考图 |
| GPU | 4 x NVIDIA RTX 3090 24GB；FlashHead 默认绑定 GPU 0 |

2026-07-21 新增的当前架构如下：

| 路径 | 当前职责 | 服务/资源隔离 |
| --- | --- | --- |
| FlashHead Lite | 纯头肩实时头像，不再贴到真人身体底片 | 独立 `:8030`，默认 GPU 0 |
| MuseTalk 1.5 | 真人动作当前帧 + 嘴部/下半脸重建，360 x 624 @ 25 FPS | 独立 `:8031`，默认物理 GPU 2，batch 8 |
| LiveAct | 高质量全帧生成和成片 | 独立 `:5071`，离线任务/HLS |

MuseTalk 动作资产共 353 帧：`idle` 75、`talk_subtle` 75、`welcome` 100、`point` 65、`thank` 38。GPU 2 上的模型路径实测为 batch 4 预热后 34.89 FPS、batch 8 预热后 45.07 FPS；batch 8 首个实跑 batch 为 369 ms，PyTorch reserved 显存为 7.10 GiB。`jaw` mask 使用 `upper_boundary_ratio=0.55`，逐像素检查 mask 外变化为 0。

这些是 MuseTalk 推理与融合路径的本机结果，不包含 Azure TTS、WebRTC 和浏览器解码，不能当作完整回复首响或长时间直播结论。当前底片中的演员本身正在说话，原有下颌运动仍可能和新音频冲突；人物也没有随源仓库提供独立的生产肖像授权。正式视觉验收必须先重录静默、中性下颌且授权完整的素材。

此前完整浏览器验收还覆盖：

- 5 个人物逐一切换并成功播报；
- 各人物音画起播偏差约 0.5-29.4 ms；
- WebRTC 收到音频包和已解码视频帧；
- GPT 问答结果可继续驱动数字人播报；
- 桌面和移动视口可用；
- 三种模式切换不会重建无关状态或留下明显竞态。

### 4.1 实测复现口径

浏览器验收快照生成于 2026-07-20 17:09（Asia/Shanghai），使用 Playwright 1.51.1 和 Chromium 140.0.7339.16。仓库基线 HEAD 为 `09bd996`，但 FlashHead/LiveAct 集成位于未提交工作区中，因此该 commit 不能单独代表本次结果；正式 benchmark 应在提交后重新记录完整 SHA。

当前环境可用以下方式复查服务和浏览器链路：

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8018/app/live
curl -fsS http://127.0.0.1:8030/health | jq

NODE_PATH=/tmp/synlive-pw-run/node_modules \
PLAYWRIGHT_CHROMIUM_PATH=/home/super/.cache/ms-playwright/chromium-1187/chrome-linux/chrome \
node scripts/verify-live-flashhead.cjs
```

浏览器脚本会逐一切换人物并播报“你好，我是{人物名}”，然后测试固定实时播报、GPT 问答、模式切换和 390 x 844 移动视口。它依赖当前已配置的 Azure TTS、LLM 和正在运行的服务；`/tmp` 下的 Playwright 路径是本机临时测试依赖，不是项目安装契约。桌面和移动截图也只保存在 `/tmp`，没有作为产品素材提交。

本节精确延迟来自健康端点的最近一次请求记录，不是多轮统计分布。它适合确认链路和音画同步，不应替代固定 commit、固定输入、P50/P95/P99 和长时间压测的正式报告。

这里要区分两个指标：FlashHead 能持续以 20 FPS 播放，并不表示一句新回复会在 50 ms 内出现。当前最近一次从请求到首音视频约 2.78 秒，主要时间在 TTS 和首段生成；音频和视频真正开始播放时，两者只有 9.2 ms 偏差。下一步优化目标应是“首响”，不是只提高稳态 FPS。

当前 5 张 FlashHead 图片只用于内部切换验证。`current.png` 来源未记录，3 张测试肖像来自 thispersondoesnotexist.com 且生产许可不够清晰；公开直播前必须替换成具有肖像授权和明确商用许可的素材。

## 5. “实时对话 + 对口型 + 自然肢体”的六种实现

### 5.1 单图音频驱动神经头像

FlashHead 属于这一类：输入一张人物参考图和音频特征，模型直接生成连续的头像视频帧。它不需要像 ER-NeRF、GaussianTalker 那样先用某个真人的长视频逐人物训练或优化场景，也不只是把一小块嘴贴回原视频。

这条路线换人快、首个 PoC 成本低，适合正脸头肩像、嘴型、表情和轻微头动。它的边界同样明确：一张头像没有手臂、腿、衣服背面、场景几何和动作轨迹信息，模型也没有语义动作控制层，所以不能仅靠换图得到可靠的挥手、指商品或全身走动。

与其他路线的区别是：

- 相比真人动作底片，它会生成头像区域的连续像素，但没有真实演员全身动作可继承；
- 相比 ER-NeRF/GaussianTalker，它不要求为每个人重新训练一个专属辐射场或高斯场，人物切换更快；
- 相比 LiveAct/FlashTalk 等全帧扩散，它模型更轻、实时性更高，但生成范围和动作自由度小得多。

因此当前 FlashHead 继续作为 SynLive 的低延迟默认纯头肩模式，不再参与真人动作身体合成，也不能单独承担“自然上半身/全身动作”的目标。

### 5.2 真人动作底片 + 实时换嘴

```text
授权演员动作视频
  -> 预处理为 idle / talk / wave / point / thank 等片段
  -> 动作调度器选择片段
  -> MuseTalk / Wav2Lip / QuickTalk 修改脸部区域
  -> 字幕、商品卡和背景单独合成
```

身体、手指、衣服褶皱和商品包装都来自真实摄影，因此最容易获得“像真人”的观感。模型只承担较小的面部区域，消费级 GPU 可以实时运行。

代价是动作不是无限的。每个演员、机位、服装和商品都要制作自己的动作库；切换片段时要处理姿态、光照和嘴部边界连续性。它特别适合固定机位的直播带货、客服和课程讲解。

SynLive 当前已经按此结构实现 MuseTalk 1.5：每个输出帧先由动作 planner 选择一张真人目标帧，MuseTalk 只重建其 jaw mask 内的嘴部/下半脸，再融回同一帧；mask 外像素保持原值。这个结构消除了“生成完整脸”和“真人身体”分别运动的根本冲突，但模型仍可能产生牙齿错误、局部磨皮、唇色变化或单帧 jitter，底片本身若在说话也会留下下颌节奏冲突。

### 5.3 3D 数字人 + 骨骼动画状态机

```text
TTS 音频 -> Audio2Face / viseme -> 面部 blendshape
回复语义 -> LLM/规则 -> emotion + action tag
action tag -> UE/Unity 状态机 -> mocap / 动画片段
面部 + 身体 -> MetaHuman/自定义角色 -> 实时渲染
```

身体动作可以自由组合、打断和混合。人物可以转身、走动、指向商品或拿起场景物体，但“动作正确”依靠高质量骨骼、动画资产、IK、碰撞和场景逻辑，不是 LLM 自动画出每一帧。

它最适合需要空间交互和任意动作的项目。缺点是角色仍有 3D CGI 感，制作质量取决于扫描资产、皮肤、头发、灯光、动捕清理和 UE 渲染预算。

### 5.4 真人动捕或隐藏操作者

CodeMiko 和大量 VTuber 直播使用面捕、身体动捕、手指追踪和真人现场表演。LLM 可以辅助对话，但身体动作直接来自人，因此能保留真人的临场反应。这是真实时，也可以随意走动，却不是“无人值守、自动生成动作”。

如果业务允许人工接管，这条路线是处理高价值观众、突发问题和复杂商品展示的可靠兜底。

### 5.5 音频/文本生成 3D 手势

GestureBot、Gesticulator、EMAGE、Audio2Gesture 等从音频韵律和文本生成或预测骨骼运动。它们可以生成比固定动作标签更连续的共语手势，但常见限制包括：

- 输出是 SMPL-X/FLAME 或关节旋转，仍需 3D 角色重定向和渲染；
- 手指、物体接触和身体稳定性较弱；
- 训练语音与实际 TTS 的差异会降低自然度；
- 有些工具是离线导出 FBX，而不是流式直播；
- 研究演示的 20 FPS 不等于完整对话链路低延迟。

它适合作为 3D 路线的增强项，不建议直接替代第一期动作库。

### 5.6 全帧生成式视频

LiveAct、FlashTalk、Alibaba LiveAvatar、FlowAct-R1 和 StreamAvatar 尝试从参考图、音频和文本连续生成整帧，因此理论上可以同时改变脸、身体、衣服和手势。

这条路线自由度最高，但目前仍有四个生产障碍：

1. 显存和算力通常远高于单张 RTX 3090；
2. 首帧通常在 1-3 秒或更高，且未必包含 LLM/TTS；
3. 手、商品、文字、长时身份和动作连续性仍可能漂移；
4. 论文项目常没有代码、权重、RTMP、弹幕连接器、打断和长期稳定性数据。

因此它适合高配实验、预生成营销片和未来评估，不适合当前默认直播模式。

## 6. 社交平台案例核验

### 6.1 YouTube

| 案例 | 画面展示 | 可验证机制 | 结论与证据 |
| --- | --- | --- | --- |
| [NVIDIA ACE + Convai](https://www.youtube.com/watch?v=psrXGPh80UM) | 实时对话、口型、NPC 执行动作 | Riva ASR、Convai 对话/动作决策、Audio2Face、UE/MetaHuman；Convai 返回 `Move To`、`Follow`、`Dance` 等动作 | 动作由 UE 预制动画或游戏逻辑执行，不是视频模型逐帧生成；A/B 级 |
| [Unreal：AI Digital Humans](https://www.youtube.com/watch?v=uwuT8ERswHo) | UE5 中的 AI 数字人工作流 | MetaHuman、面部动画和 UE 动画系统 | 能证明 3D 技术路线，不提供 SynLive 硬件上的端到端基准；B 级 |
| [Convai MetaHuman 实时对话教程](https://www.youtube.com/watch?v=4fMCKkrfyaA) | 实时语音和面部动画 | 服务端生成按帧 blendshape；Unity/UE 客户端播放脸部数据；身体从 `idle/listening/thinking/speaking/reacting` 动画池选择 | 脸和身体是两个模块；实现证据强，性能口径不足；A/B 级 |
| [HeyGen LiveAvatar](https://www.youtube.com/watch?v=4hVvW4tHFJY) | 实时 AI 头像 | WebRTC；FULL 模式托管对话，LITE 模式接收外部 PCM | 可证实实时头肩像，不能证实自由全身动作；B 级 |
| [LiveKit + Tavus](https://www.youtube.com/watch?v=iuX5PDP73bQ) | 实时视频 Agent | CVI 对话链 + Phoenix 人物渲染 + WebRTC | 强项是脸、情绪、头动和倾听状态；公开 API 没有通用语义手势列表；B 级 |
| [CodeMiko 制作揭秘](https://www.youtube.com/watch?v=e818LgnJ9rI) / [Xsens 动捕](https://www.youtube.com/watch?v=8eTmHGv0z8o) | 非常自然的全身实时动作 | 真人表演、动捕服和实时 3D 渲染 | 真实实时，但身体来自操作者；A 级 |
| [GestureBot](https://www.youtube.com/watch?v=jhgUBS0125A) | 对话 Agent 生成手臂动作 | [代码](https://github.com/nagyrajmund/gesturebot) 与 [论文](https://arxiv.org/abs/2102.12302) 显示 Gesticulator 根据音频和文本生成 3D 关节，ActiveMQ 发送 Unity | 真生成手势，但研究级 20 FPS、无手指、对话有数秒处理；A 级 |
| [Audio2Gesture 社区成片](https://www.youtube.com/watch?v=fJfSS0i6qos) | 连续自然全身共语动作 | 作者描述为录好音频后生成动作、导出 FBX、导入 iClone，再生成脸并剪辑；[官方节点文档](https://docs.omniverse.nvidia.com/extensions/latest/ext_omnigraph/node-library/nodes/omni-audio2gesture-core/a2gstreaminginstancenode-1.html) 说明输出是 3D joints | 该演示明确是离线流程，是“画面自然不等于实时”的典型反例；演示 C 级、机制 B 级 |
| [中国 AI 直播报道](https://www.youtube.com/watch?v=6J6KvBVqae0) / [AI 克隆主播报道](https://www.youtube.com/watch?v=aYgrZ9ef5X0) | 中国直播电商中的 AI 主播 | 新闻报道展示业务现象，未公开单个供应商完整实现 | 适合作为市场线索，不可当性能或架构证据；C/D 级 |

Convai 的官方动作机制可继续查阅 [How character actions work](https://docs.convai.com/api-docs/plugins-and-integrations/convai-unreal-engine-plugin/features/character-actions/how-character-actions-work) 和 [Configuring actions](https://docs.convai.com/api-docs/plugins-and-integrations/convai-unreal-engine-plugin/features/character-actions/configuring-actions)。其面部同步见 [How lip sync works](https://docs.convai.com/api-docs/plugins-and-integrations/convai-unreal-engine-plugin/features/lip-sync/how-lip-sync-works)。

### 6.2 Bilibili

LiveTalking 作者 lipku 的公开视频与源码可以形成较完整的证据链：

| 案例 | 公开说明 | 代码核验后的判断 |
| --- | --- | --- |
| [高清 Wav2Lip 模型](https://www.bilibili.com/video/BV1scwBeyELA) | 升级 Wav2Lip，可集成实时数字人 | Wav2Lip 修改脸/嘴，身体来自模板视频 |
| [MuseTalk 实时数字人效果](https://www.bilibili.com/video/BV1bUwezvEnG) | 实时切换动作、音色和语音对话 | 绿幕真人全身在动作素材间切换，MuseTalk 实时处理脸部；机制有代码可证 |
| [实时交互数字人动作编排](https://www.bilibili.com/video/BV1KtdBYeE1g) | “不说话时手部不动，说话时手部有动作” | `custom_config.json` 定义动作资源，`/set_audiotype` 选择预定义动作，图片序列 ping-pong 循环 |
| [实时交互数字人全功能演示](https://www.bilibili.com/video/BV1Jyd6YhESn) | 语音、打断、字幕、待机/唤醒/思考/休眠 | 状态机营造“会反应”，不表示能生成任意新手势 |
| [商业基础版实时对话](https://www.bilibili.com/video/BV1AcDMBpEuQ) | 实时对话、打断、动作切换 | 与动作库/状态机路线一致 |
| [Wav2Lip + GPT-SoVITS + 千问](https://www.bilibili.com/video/BV1CbVczbEk1) | 标题宣称约 2 秒实时对话 | 没有延迟起止点、硬件和统计分布；只能把“2 秒”视为单次演示口径 |
| [NVIDIA Audio2Gesture 教程](https://www.bilibili.com/video/BV1RM411z7GB) | 音频驱动身体动作 | 输出 3D joints 的平移、旋转和缩放；与 Audio2Face 组合，而非生成真人像素 |
| [Audio2Gesture 能力边界说明](https://www.bilibili.com/video/BV1w1LQ6tECk) | 只生成身体/上半身，不驱脸、不做物体交互 | 说明社媒中 3D 的脸、身体、场景通常来自多个独立模块 |
| [MetaHuman + MHC Talker](https://www.bilibili.com/video/BV1nwQfYMEt1) | LLM、ASR、TTS、语音转口型 | 公开仓库只足以证明脸部链路；身体更可能来自 UE 动画，但证据不足，不能写成已证实 |

[LiveTalking](https://github.com/lipku/LiveTalking) 当前 README 明确支持动作编排、WebRTC、RTMP、虚拟摄像头和打断。源码读取自定义图片帧与可选音频，并按 `audiotype` 播放；它没有让 LLM 连续生成骨骼。

[lipku/livestream](https://github.com/lipku/livestream) 进一步展示了“话术循环中插入弹幕回复”的编排方式，包括 B 站 WebSocket、抖音本地弹幕 WebSocket、视频号回调和高优先队列。它证明这条链路可以实现：

```text
平台弹幕 -> LLM/RAG -> TTS -> LiveTalking -> OBS/RTMP
```

但仓库当前能力不能反推早期视频在发布时已经具备全部连接器。

### 6.3 Reddit

Reddit 当前网络不可直读，以下链接只作为可追踪入口，核心判断由关联源码或明确标题交叉验证：

| 案例 | 核验结果 |
| --- | --- |
| [Amica：本地 LLM Avatar](https://www.reddit.com/r/LocalLLaMA/comments/1837tvr/hey_guys_check_out_amica_open_source_locally_run/) | 发帖版本身体使用 `idle_loop.vrma`；嘴型按音频响度驱动单个 `aa` blendshape；回答中的情绪标签切换表情。当前版本增加 greeting、peace、dance 等 VRMA，仍是动作片段库 |
| [ChatGPT + ASR + Audio2Face + TTS + MetaHuman](https://www.reddit.com/r/unrealengine/comments/125u8et/chatgpt_asr_audio2face_tts_metahuman/) | 连续实拍支持“交互链路存在”，但只展示头肩，没有源码、GPU、FPS 或全身动作证据 |
| [早期 ChatGPT MetaHuman 原型](https://www.reddit.com/r/unrealengine/comments/11xjf6w/chatgpt_metahuman_w_tts_and_lipsync_early/) | 作者明确表示当时只完成口型，头部和身体动画还要另行集成 |
| [ComfyUI + Vision Pro Avatar 控制](https://www.reddit.com/r/comfyui/comments/1fyokln/) | 搜索摘要显示使用自制 OSC 控制节点并计划接 Unreal，属于控制/动捕路线；正文未能直读 |
| [实时 Q&A 口型讨论](https://www.reddit.com/r/comfyui/comments/1m8utlz/) / [Unity TTS 口型讨论](https://www.reddit.com/r/Unity3D/comments/1l7vlvp/) | 可作为社区需求线索，不能作为已验证产品能力 |

Amica 发帖时的实现可以从固定 commit 的 [lipSync.ts](https://github.com/semperai/amica/blob/22cfb919e77d70fe50290b36040396e483a0dda5/src/features/lipSync/lipSync.ts) 和 [model.ts](https://github.com/semperai/amica/blob/22cfb919e77d70fe50290b36040396e483a0dda5/src/features/vrmViewer/model.ts) 复核。

### 6.4 知乎

| 内容 | 核验结果 | 证据 |
| --- | --- | --- |
| [CVPR 2024：EMAGE 面部与肢体动画](https://zhuanlan.zhihu.com/p/689954520) | 音频和动作掩码生成 FLAME 脸与 SMPL-X 身体/手/全局运动；输出 3D 参数，需要后续渲染 | 与 [PantoMatrix](https://github.com/PantoMatrix/PantoMatrix) 交叉核验；没有流式直播声明，A 级 |
| [开源嘴型/动态视频项目合集](https://zhuanlan.zhihu.com/p/23646481805) | 汇总 Sonic、EchoMimicV2、AniPortrait 等漂亮案例，但未给实时 benchmark | EchoMimicV2 官方数据中，A100 生成 120 帧即使加速后仍约 50 秒；Sonic 只说明在单张 32GB GPU 上测试，未给 24GB 配置或实时 FPS，不能当 3090 实时直播证据 |
| [HeyGem 开源带货攻略](https://zhuanlan.zhihu.com/p/1918351480265642408) | 正文流程是上传视频、提交“合成视频”、在作品页预览/下载 | [Duix-Avatar](https://github.com/duixcom/Duix-Avatar) 官方也写明 offline/non-real-time video synthesis；属于离线任务，A 级反证 |
| [数字人直播技术和运营策略](https://zhuanlan.zhihu.com/p/668587044) | 泛称实时渲染和评论回复，没有模型、硬件、FPS、延迟、代码或连续录屏 | 营销材料，D 级 |
| [数字人直播到底怎么做](https://www.zhihu.com/question/603149455) | 搜索摘要以声音克隆和一站式服务为主，没有可重复配置 | 需求和市场线索，D 级 |

知乎案例最重要的提醒是：文章标题中的“数字人”“带货”“逼真”不等于“流式实时”。先检查它输出的是视频文件、3D 参数、WebRTC 轨道，还是可被打断的连续直播流。

### 6.5 Instagram、TikTok 与 X

Instagram 公开页面受登录墙和限流影响，无法稳定核验帖子正文、原始视频和发布时间。本次没有为了凑平台数量而引用无法验证的搬运内容。

TikTok 的 [Symphony Digital Avatars 官方帖子](https://www.tiktok.com/@tiktoknewsroom/video/7382934469679959342) 和 [Newsroom 说明](https://newsroom.tiktok.com/announcing-symphony-avatars?lang=en) 展示了具有大量手势的写实人物，但官方定位是品牌广告内容制作、Stock Avatar、Custom Avatar 和多语言配音，没有说明 WebRTC、弹幕、打断或实时动作调度。它不能作为直播实时性的证据。

HeyGen/LiveAvatar 曾在 X 展示“观看比赛、读取聊天并评论”的 AI 主播：[官方帖子](https://x.com/TryLiveAvatar/status/2065636387852833025)。官方宣称并展示了聊天到播报的实时链路，但营销录屏不足以独立验证端到端实时性；画面主要是头肩/半身小窗，也没有可核验的手臂语义动作。屏幕录制为 60 FPS 不等于头像模型为 60 FPS。

## 7. OpenTalking 带货示例专项审计

用户关注的仓库是 [datascale-ai/opentalking](https://github.com/datascale-ai/opentalking)。首页呈现的两个带货视频不能视为同一实现，也不能仅凭画面认定为实时全身生成。

### 7.1 可追溯的竖版“带货主播”

[官方案例教程](https://github.com/datascale-ai/opentalking/blob/main/docs/zh/examples/product-demo-live-sales.md) 明确写明：

- 工作流是实时对话；
- 选择“带货主播”形象；
- 驱动模型是 **Wav2Lip**；
- 启动 WebRTC；
- LLM 依据人设回答，TTS 输出语音，Wav2Lip 驱动口型。

[人物 manifest](https://github.com/datascale-ai/opentalking/blob/main/examples/avatars/live-broadcast/manifest.json) 提供了更直接的证据：

| 字段 | 值 |
| --- | --- |
| `model_type` | `wav2lip` |
| 分辨率 | 720 x 1280 |
| 帧率 | 24 FPS |
| 原视频帧数 | 241 |
| 提取帧数 | 125 |
| 人物模式 | single |

原视频约 10.04 秒，而实际提取的 125 帧只有约 5.21 秒。运行时循环这些帧，Wav2Lip 修改脸/嘴。身体、衣服、手势和镜头质感都来自原始底片，所以看起来很真实。这正是成熟的“真人动作底片 + 实时换嘴”方案，而不是模型实时生成完整身体。

### 7.2 横版 SK-II 高质量成片

[B 站展示视频](https://www.bilibili.com/video/BV1jhT76hENu) 约 71.68 秒、1350 x 1080、30 FPS。仓库和视频没有提供对应的：

- 生成脚本或任务配置；
- Prompt、参考图和模型参数；
- 推理日志、首帧和持续 FPS；
- GPU 型号和数量；
- WebRTC 连续录屏、打断或弹幕交互；
- 可复现的素材目录。

OpenTalking 页面推荐 OmniRT/FlashTalk，不等于该成片已经被证明由 FlashTalk 实时生成。评论区有人询问模型，截至检查没有作者答复。因此该视频最多是高质量展示，不能用来承诺实时性能。

### 7.3 OpenTalking 已有与缺失能力

已有的核心能力包括会话、LLM、TTS、字幕事件、打断、WebRTC 和多个嘴型 backend 的编排。当前没有完成的直播产品能力包括：

- 抖音/B 站等正式弹幕连接器；
- RTMP/SRT 生产推流闭环；
- 根据语义选择身体动作的调度器；
- 商品卡、库存、优惠和订单事件编排；
- 长时间连续直播稳定性与自动恢复。

弹幕路由仍是 open issue：[Feature: live chat / danmaku routing](https://github.com/datascale-ai/opentalking/issues/68)。因此 OpenTalking 的“直播带货 demo”更准确的说法是“浏览器内实时对话数字人示例”，不是开箱即用的抖音/B 站无人直播系统。

### 7.4 OpenTalking 公开 benchmark

[官方 benchmark](https://github.com/datascale-ai/opentalking/blob/main/docs/zh/reference/benchmark.md) 在 RTX 3090 上记录：

| Backend | 稳态生成 | 输出 | 首轮总延迟 | TTFV | 推理峰值显存 |
| --- | ---: | --- | ---: | ---: | ---: |
| Wav2Lip | 37.269 FPS | 498 x 832 @ 30 FPS | 3002.526 ms | 1625.962 ms | 7.928 GB |
| QuickTalk | 29.23 FPS | 540 x 900 @ 25 FPS | 3356.019 ms | 1800.524 ms | 1.662 GB |
| MuseTalk | 28.868 FPS | 512 x 512 @ 25 FPS | 3235.518 ms | 1769.484 ms | 5.078 GB |

这组数据最有价值的地方，是同时列出了稳态 FPS 和首轮延迟。测试输入类型是 `audio+image`，所以 3.0-3.4 秒表示首轮音画处理/输出总延迟，不包含弹幕、STT、LLM 或实时 TTS。它说明 3090 可以维持目标播放帧率，但不能只引用“29 FPS”并宣称观众会在几十毫秒内得到回答；完整对话首响还要叠加上游耗时。

## 8. 商业系统公开资料揭示的真实架构

### 8.1 腾讯云 2D 端渲染

腾讯云公开文档几乎直接说明了国内写实直播数字人的常见做法：

- [2D 端渲染说明](https://cloud.tencent.com/document/product/1240/118294)
- [Android SDK 接口](https://cloud.tencent.com/document/product/1240/118295)
- [驱动与动作说明](https://cloud.tencent.com/document/product/1240/118722)

官方说明包括：

- 人物包包含约 1 分 30 秒动态视频素材；
- 流式 PCM 实时驱动嘴型；
- `getAppendableActionList()` 获取人物支持的固定动作；
- `appendAction(actionCode, timestampMs)` 在指定时间插入动作；
- `interrupt()` 打断播放。

所以“很像真人、动作自然”的原因很直接：身体本来就是演员视频，系统只在已授权素材范围内插入动作并实时驱嘴。这比让扩散模型实时重画手和商品稳定得多。

### 8.2 HeyGen LiveAvatar

- [Avatar Realtime](https://developers.heygen.com/avatar-realtime.md) 面向实时头像流；应用可以自行处理 STT/LLM。
- [LiveAvatar 概念](https://docs.liveavatar.com/docs/core-concepts/avatars.md) 和 [LITE 事件](https://docs.liveavatar.com/docs/lite-mode/events.md) 说明 WebRTC 与外部 PCM 接入。
- [Avatar V](https://developers.heygen.com/avatar-v.md) 支持 `motion_prompt` 控制身体和手势，但走异步视频生成接口，不是实时对话。

其实时接口主要围绕 speak、interrupt、语音和轮次；公开资料没有任意全身动作 API。人物训练指南反而要求身体稳定、减少移动与手势。不能把 Avatar V 的高质量异步动作能力和 LiveAvatar 的实时能力合并宣传。

### 8.3 Tavus CVI / Phoenix

- [CVI 总览](https://docs.tavus.io/sections/conversational-video-interface/overview-cvi) 描述实时对话和 WebRTC 管线。
- [人物训练说明](https://docs.tavus.io/sections/faces/train-with-a-video) 即使支持 Full Body Face，也要求站立稳定并避免大动作。

Tavus 官方资料称其能低延迟生成口型、表情、头动、倾听状态和情绪微表情，但公开 API 没有通用动作选择列表。文档中的 `low-latency utterance-to-utterance` 是厂商口径，不能在没有明确起止点和独立测试时换算成所有网络环境下的固定毫秒值。

### 8.4 DeepBrain AI Human

[Gesture API](https://docs.aistudios.com/aihuman/web-sdk/aiplayer/advanced-features) 把动作库方案写得很清楚：人物支持 `hi`、`bow`、`twohand` 等固定 gesture，可发送文本和 `gst` 动作名；片段分为 speech、gesture、speech+gesture。

实际编排就是：

```text
LLM 回复 -> 规则/LLM 选择 gesture -> SDK 播放对应动作资产 -> 返回 idle
```

这不是自由身体生成，但可控、可预加载、不会让商品和手指突然畸变，非常适合直播带货。

### 8.5 Soul Machines

[Real-Time Gesturing](https://support.soulmachines.com/support/solutions/articles/101000544271-real-time-gesturing) 公开描述了较完整的 3D 语义手势：情绪、象征、节拍、指向、倾听反馈和内容指向。系统根据文本和语音选择动作，再驱动 3D 骨骼。这是能够自动选择语义上半身动作的商业范例，但它是闭源云端 CGI 平台，不是可直接集成的本地开源模型。

### 8.6 NVIDIA ACE / Audio2Face / Animation Graph

[Audio2Face-3D SDK](https://github.com/NVIDIA/Audio2Face-3D-SDK) 负责音频到面部 blendshape，公开资料称面部参数生成可超过 60 FPS；它不负责全身。身体由 [Animation Graph](https://docs.nvidia.com/ace/animation-graph-microservice/latest/index.html)、UE 动画、动捕或其他动作模型负责。

这条路线说明一个重要工程原则：嘴型、表情、身体和场景交互要分别验收。一个模块“实时”不能替其他模块背书。

## 9. 开源与研究方案对比

| 方案 | 实时部分 | 身体动作来源 | 公开硬件/性能 | 适合当前 SynLive 吗 |
| --- | --- | --- | --- | --- |
| [FlashHead](https://github.com/Soul-AILab/SoulX-FlashHead) | 单图头肩像、音频驱动脸部 | 轻微头动/面部，不提供语义全身动作 | 官方称 Lite 在 RTX 4090 约 96 FPS 或三路 25+ FPS；本机实测 3090 输出 20 FPS | **当前默认纯头肩模式** |
| [QuickTalk](https://github.com/datascale-ai/opentalking) adapter | 视频底片实时换嘴 | 真人模板视频 | OpenTalking：3090 稳态 29.23 FPS，TTFV 约 1.80 秒 | MuseTalk 视觉不达标时的 A/B 候选 |
| [MuseTalk](https://github.com/TMElyralab/MuseTalk) | 视频底片实时处理脸部 | 真人模板视频/动作库 | 本机 GPU 2：batch 4 为 34.89 FPS、batch 8 为 45.07 FPS；首个 batch 369 ms；reserved 7.10 GiB | **当前真人动作主播实现** |
| [Wav2Lip](https://github.com/Rudrabha/Wav2Lip) | 脸部/嘴部同步 | 原视频身体 | OpenTalking 3090 稳态 37.269 FPS | 技术成熟，但公共权重不可商用 |
| [LiveTalking](https://github.com/lipku/LiveTalking) | WebRTC、TTS、嘴型 backend、打断 | 自定义视频/帧动作与状态切换 | 作者宣称 3090 MuseTalk 约 45 FPS，需本机复测 | 很好的编排参考 |
| [LiveAct](https://github.com/Soul-AILab/SoulX-LiveAct) | 全帧音频/文本条件生成 | 模型生成 | 18B；官方约 2 x H100/H200 达 20 FPS，单 RTX 5090 约 6 FPS | 保留为高质量生成，不作弹幕默认路径 |
| [FlashTalk](https://github.com/Soul-AILab/SoulX-FlashTalk) | 全帧长视频生成 | 模型生成 | 14B；官方 README 只把实时速度标为 8 x H800 或更高配置，单卡脚本不等于实时 | 当前不适合 |
| [Alibaba LiveAvatar](https://github.com/Alibaba-Quark/LiveAvatar) | 全帧长视频生成 | 模型生成身体、衣服、手和脸 | 论文报告 5 x H800、45 FPS、TTFF 1.21 秒；标准单卡脚本写明 80GB，2026-01 更新称 FP8 可在 48GB GPU 推理并可能轻微降质 | 跟踪研究，不作 3090 主线 |
| [FlowAct-R1](https://grisoon.github.io/FlowAct-R1/) | MLLM 规划动作 + MMDiT 全帧生成 | 根据近期语音和参考图生成 | 论文称 A100 平台 480p、25 FPS、TTFF 约 1.5 秒；没有可用代码/权重 | 跟踪研究 |
| [StreamAvatar](https://streamavatar.github.io/) | 流式全帧生成与说话/倾听行为 | 模型生成 | 论文报告 2 x H800、928 x 704、25 FPS、TTFF 约 1.20 秒 | 跟踪研究 |
| [EMAGE/PantoMatrix](https://github.com/PantoMatrix/PantoMatrix) | 音频到 3D 动作参数 | 生成 SMPL-X/FLAME | 未声明流式直播；还需重定向和渲染 | 可作 3D 离线动作研究 |
| [EchoMimicV2](https://github.com/antgroup/echomimic_v2) | 半身扩散视频 | 模型生成 | 官方数据中 A100 生成 120 帧加速后仍约 50 秒 | 不实时 |
| [Sonic](https://github.com/jixiaozhong/Sonic) | 音频驱动视频 | 模型生成 | 官方只说明在单张 32GB GPU 上测试，未给实时 FPS 或 24GB 可用结论 | 不作为 24GB 3090 实时主线 |
| [Duix/HeyGem](https://github.com/duixcom/Duix-Avatar) | 视频任务合成 | 原视频与离线合成 | 官方明确 non-real-time/offline | 不作为直播 renderer |

上述数字来自不同项目、分辨率和测试口径，不能直接横向排名。SynLive 应用同一人物、同一音频、同一输出分辨率，在本机记录冷启动、TTFA、TTFV、稳态 FPS、显存、音画偏差和 30 分钟稳定性。

## 10. 弹幕实时回复的完整工程链路

### 10.1 平台接入

```text
抖音 / B站 / 视频号 / YouTube Live
  -> 官方 API、WebSocket 或合规的平台代理
  -> 统一事件格式
  -> 审核、去重、合并、限流、优先级
  -> 问答调度器
```

统一事件至少应包含：`platform`、`room_id`、`event_id`、`user_id`、`type`、`text`、`gift`、`timestamp`。弹幕洪峰时不能每条都调用 LLM；应先聚类相似问题、FAQ 命中、过滤刷屏，并优先处理购买意图、商品问题和高价值事件。

平台接入必须遵守平台 API、直播规范和自动化政策。能从非官方工具抓到弹幕，不代表可以直接用于正式商业部署。

### 10.2 回复生成

建议按三条路径分流：

1. **快速路径**：问候、价格、库存、尺码、发货等由结构化商品数据和 FAQ 直接回答。
2. **RAG 路径**：产品说明、售后条款和课程知识先检索，再让 LLM 组织口语化回复。
3. **人工路径**：医疗功效、价格承诺、投诉、敏感内容和模型低置信度问题交给人工。

LLM 不只输出文本，建议输出受限结构：

```json
{
  "reply_text": "这款有两种容量，我给大家指一下右侧参数。",
  "emotion": "friendly",
  "action": "point_right",
  "interruptible": true,
  "source_ids": ["sku_102_capacity"]
}
```

`action` 必须来自白名单，不能让模型任意写脚本或路径。商品价格、库存和优惠必须来自业务系统，不能由 LLM 猜测。

### 10.3 流式 TTS 与打断

等待整段回答完成再合成会显著增加首响。更合理的做法是：

- LLM 流式输出；
- 在短句、逗号或语义边界分段；
- TTS 边合成边输出 PCM；
- 数字人边收音频边渲染；
- 新的高优先问题到来时，停止旧 TTS、清理 avatar 队列并平滑回到 idle。

短句过碎会让韵律差、动作频繁切换；长句又会增加等待。建议以 12-30 个中文字的自然短句为初始范围，再根据 TTS 实测调整。

### 10.4 动作调度器

第一版每个人物至少准备：

| 状态/动作 | 用途 |
| --- | --- |
| `idle_neutral` | 中性待机、呼吸和眨眼 |
| `idle_listen` | 倾听观众或等待模型 |
| `think` | 检索或生成回复时的短思考状态 |
| `welcome_wave` | 新观众、关注或开场 |
| `nod_agree` | 肯定回答 |
| `talk_subtle_1/2` | 普通讲解，避免完全静止 |
| `emphasis_1/2` | 卖点强调 |
| `point_left/right` | 指向商品卡或参数区 |
| `show_product` | 展示固定商品 |
| `thank_order` | 下单或礼物感谢 |
| `heart` | 可选的直播互动动作 |
| `goodbye` | 下播或用户离开 |

素材制作规则：

- 所有片段以同一机位、镜头、曝光、服装和背景拍摄；
- 每段首尾回到同一个中性姿态；
- 记录安全切换帧，不在手遮脸或大幅转头时换片；
- 动作设置冷却时间，避免每句话挥手；
- 手持商品动作按 SKU 或商品尺寸单独制作；
- 嘴型层持续覆盖在动作底片脸部，而不是每切动作就重启整条 WebRTC。

动作调度优先级可以是：人工接管 > 安全提示 > 打断 > 订单/礼物 > 语义动作 > 普通 talk > idle。相邻动作之间需要淡化、姿态匹配或短过渡片段。

### 10.5 延迟预算

下面是建议的工程目标，不是当前实测或厂商保证：

| 阶段 | 快速目标 |
| --- | ---: |
| 弹幕接收、去重、调度 | 50-150 ms |
| FAQ/RAG 或 LLM 首 token | 100-800 ms |
| TTS 首段 PCM | 150-500 ms |
| Avatar 首帧 | 300-1000 ms |
| WebRTC 缓冲与浏览器播放 | 100-300 ms |
| 简短 FAQ 总首响 | 0.8-1.5 s |
| 常规 LLM 回复总首响 | 1.2-2.5 s |

当前 FlashHead 最近一次首音视频约 2.78 秒，已实现很好的音画起播同步，但首响仍有优化空间。MuseTalk 的 45.07 FPS 是 batch 8 预热后模型吞吐，不能与端到端首响混用；它当前仍需等待整段 Azure TTS、Whisper 特征和首个 batch。两条实时路径都应分别拆分 TTS、首视频 batch、浏览器首音频/首视频和排队时间，再决定是流式 TTS、分句、缓存常用句，还是调整 avatar 缓冲。

### 10.6 直播输出

WebRTC 适合中控预览和互动；平台正式直播通常还需要：

```text
Avatar WebRTC / 原始帧
  + 字幕
  + 商品卡 / 价格 / 库存
  + 背景 / 片头 / 告警
  -> OBS / GStreamer / FFmpeg 合成
  -> RTMP / SRT
  -> 直播平台
```

必须保留人工预览、静音、紧急停播、切真人、固定兜底话术和推流重连。

## 11. SynLive 分阶段实施建议

### P0：稳定两条实时模式

- FlashHead 保持默认纯头肩模式，不再开启“完整生成脸 + 真人身体贴合”。
- MuseTalk 作为独立真人动作模式运行在 `:8031`；LiveAct 明确标为离线高质量生成模式。
- 继续记录 TTS、首音频、首视频、音画偏差、队列和错误原因。
- 把当前测试头像替换为拥有明确授权的生产人物和声音。
- 做 30 分钟、2 小时和 8 小时持续播报测试，而不只测一句话。

### P1：真人半身动作底片生产化

- 当前 MuseTalk 1.5 PoC 已实现 25 FPS、353 帧动作资产和独立 WebRTC 服务，模型路径达到目标吞吐；下一步先完成端到端验收并更换素材，而不是继续扩大完整脸 mask。
- 重录授权演员静默、嘴和下颌中性的绿幕视频；使用同一音频、同一分辨率做视觉 A/B。
- 首批只做 `idle`、`talk_subtle`、`welcome_wave`、`point_left/right`、`thank`。
- 检查脸部贴合、牙齿、遮挡、转头、切片毛刺和长时间循环感。

选择建议：当前先以已经集成的 MuseTalk 1.5 完成授权素材和端到端验收；若牙齿、唇色、磨皮或 jitter 仍不合格，再用相同素材接 QuickTalk 做盲测。最终仍以本机端到端数据和视觉结果决定，不按 README FPS 决定。

### P2：动作调度和弹幕闭环

- 建立动作 manifest、状态机、优先级、冷却、打断和安全切换点。
- 接一个平台的合规弹幕源，先完成去重、FAQ 和人工接管。
- LLM 输出受限的 `reply_text + emotion + action`。
- 增加 OBS/RTMP 或 SRT 输出、字幕和商品卡合成。

### P3：UE5/MetaHuman 高动作自由度路线

当需求明确包含走动、拿取不同商品、转身、与 3D 场景互动或实时动捕时，再建设：

- MetaHuman 或授权扫描角色；
- Audio2Face/ARKit/viseme 面部；
- Animation Blueprint、Montage、IK 和 mocap 动作库；
- LLM 动作白名单；
- Pixel Streaming 或 SDI/NDI/OBS 输出；
- 多 GPU 资源隔离。

4 x RTX 3090 提供了试验空间，但 24GB 显存仍需分卡：UE 渲染、面部模型、LLM/TTS 和视频编码不要默认挤在同一张卡上。先做单角色场景基准，再决定是否生产化。

### P4：全帧生成研究模式

LiveAct 保留用于高质量片段或准实时演示；持续跟踪 Alibaba LiveAvatar、FlowAct-R1、StreamAvatar 和 FlashTalk。只有满足以下条件才进入生产候选：

- 代码和权重可合法部署；
- 当前硬件或明确预算内能持续达到目标 FPS；
- 端到端首响、打断和重连通过；
- 手、商品、文字和身份长时稳定；
- 能运行至少 8 小时且没有显存泄漏；
- 许可允许目标商业场景。

## 12. 人物替换与肢体素材怎么准备

### 12.1 当前 FlashHead

当前前端已经有 5 个人物切换入口，服务端切换当前参考图，不重建 WebRTC 连接。新增人物需要：

1. 一张符合模型要求、正脸、清晰、无遮挡的 512 x 512 图片；
2. 把图片放入 `public/assets/flashhead-avatars/`；
3. 在 `public/assets/flashhead-avatars/manifest.json` 中增加唯一 `id`、显示名称和缩略图；
4. 重载或重启人物服务；
5. 逐人测试脸部稳定性、嘴型、音画偏差和切换耗时。

前端通过 `GET /flashhead-api/avatars` 读取列表，通过 `POST /flashhead-api/avatar` 和 `{"avatar_id":"..."}` 切换人物。API 客户端在 `src/lib/api.ts`，选择器和切换状态在 `src/components/live-console.tsx`；服务启动时由 `FLASHHEAD_AVATAR_DIR` 指向上述人物目录。

但 FlashHead 的定位是头肩像和轻微头动；换一张照片不会自动产生可信的手臂或全身。

LiveAct 的 4 张预置图位于 `public/assets/liveact-avatars/`，前端 `src/components/live-console.tsx` 中的 `LIVEACT_AVATARS` 数组定义显示名称和 URL；用户上传的图片只用于当次生成，不会自动写回预置资产目录。

### 12.2 真人半身/全身视频人物

每个生产人物至少需要：

- 肖像和声音授权；
- 统一机位、灯光、背景/绿幕、服装和画幅；
- 干净的 idle 和普通说话循环；
- 业务需要的动作片段；
- 口部无遮挡、不过度侧脸；
- 每段动作首尾姿态匹配；
- 商品展示时固定商品位置和方向；
- 录制原片、剪辑版本、动作 manifest 和授权证明一起归档。

如果要换人物，不能只换头像；整套身体动作底片也要由该人物重新录制，否则头、肤色、衣服和身体身份会不一致。

### 12.3 3D 人物

换人意味着更换模型、材质、毛发、骨骼和面部 rig，并校准 blendshape/viseme。身体动作库可以在骨架兼容时重定向复用，但仍要逐动作检查脚滑、穿模、手指和持物 IK。

## 13. 建议验收指标

### 13.1 交互与延迟

- 文本提交到 TTS 首包；
- 文本提交到 avatar 首帧；
- 浏览器首音频、首视频及两者偏差；
- 弹幕到首响的 P50/P95/P99；
- 打断生效时间；
- 连续排队时的最大队列和丢弃策略。

### 13.2 画面与动作

- 25 FPS 目标下的持续生成吞吐和实际播放帧率；
- 嘴型主观盲测和 SyncNet 等辅助指标；
- 牙齿、下巴、脸部边缘、遮挡和侧脸失败率；
- 动作切换跳变、重复感、语义匹配和冷却是否正确；
- 手、商品包装、文字和品牌标识是否稳定；
- 头/身体身份是否一致。

### 13.3 稳定性

- 30 分钟、2 小时、8 小时连续运行；
- GPU 显存峰值和增长趋势；
- WebRTC/RTMP 断线重连；
- TTS、LLM 或 avatar backend 超时后的降级；
- 服务重启后前端能否自动恢复；
- 平台弹幕洪峰、重复事件和限流。

所有 benchmark 必须记录 commit、模型权重、GPU、分辨率、输入长度、冷/热启动、网络拓扑和统计口径。

## 14. 许可、肖像和平台合规

- OpenTalking 框架为 Apache-2.0，但不自动覆盖模型权重、第三方依赖和人物素材。
- FlashHead 代码仓库为 Apache-2.0；[模型权重](https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B)、wav2vec2 等依赖和示例图片仍需分别归档许可证。完成该审计前，P0 只能视为内部验证。
- QuickTalk adapter 随 Apache-2.0 的 OpenTalking 发布，但 [QuickTalk 权重包](https://huggingface.co/datascale-ai/quicktalk) 还包含 HuBERT、InsightFace `buffalo_l` 等组件。正式采用 P1 前必须逐项确认权重、依赖和模板视频的商用条款，不能用 OpenTalking 的许可证一并代替。
- MuseTalk 代码为 MIT，官方说明模型可商用；仍需核对第三方依赖和测试素材。
- Wav2Lip 公共仓库/权重明确限制为研究、学术和个人用途，不能直接用于商业产品。
- LiveTalking 框架为 Apache-2.0，但每个接入模型、声音和平台连接器要单独审查。
- LiveAct 顶层许可证和商业边界在正式使用前应取得书面确认，不能只根据 GitHub 可下载推定可商用。
- NVIDIA ACE、Tokkio、Audio2Face、MetaHuman 和 Unreal Engine 各有独立条款，不等于全部 MIT 或免费商用。
- 人物肖像、声音克隆、演员全身视频、动作表演、服装、商品商标和背景音乐都需要授权。
- 当前 FlashHead 测试肖像只限内部技术验证，不能直接公开或商用。
- 当前 4 张 LiveAct 参考图来自上游示例；在 LiveAct 顶层许可和素材授权明确前，同样只用于内部验证。
- 自动化直播、弹幕抓取、录播标识、AI 内容标识和推流方式必须符合目标平台及所在地区的规定。

技术许可和素材许可是两件事。即使模型允许商用，也不代表示例人物、训练视频、声音或商品素材允许商用。

## 15. 最终判断

OpenTalking 的带货示例之所以显得真实，核心不是一个神奇模型把主播全身实时生成出来，而是使用了真实人物动作视频，实时链路只生成回答、语音和嘴型。Bilibili 的 LiveTalking 动作演示、腾讯云动作 API、DeepBrain gesture API 都证明了同一类工程方法：**预制真实动作 + 实时嘴型 + 动作调度**。

YouTube 上 ACE/Convai、MetaHuman 和 Soul Machines 展示的是另一条成熟路线：**实时 3D 脸部驱动 + 骨骼动画状态机/动捕**。它能实现更自由的动作，但照片级真实感和制作成本取决于 3D 资产质量。

真正全帧生成身体的研究已经能展示很好的效果，却仍依赖高端多卡或缺少可部署代码。在当前 SynLive 的 4 x RTX 3090 环境中，已经落地且最稳妥的产品路径是：

```text
FlashHead：低延迟纯头肩像

MuseTalk 1.5：授权真人动作当前帧 + 嘴部/下半脸重建
  -> 有限动作调度器
  -> 合规弹幕 + FAQ/RAG/LLM + 后续流式 TTS
  -> WebRTC 中控 + OBS/RTMP 推流

LiveAct：离线高质量生成

需要任意空间动作时，再增加 UE5/MetaHuman
```

这套分层能在真实感、实时性、动作可控性、商品稳定性和当前硬件成本之间取得较好平衡，也最接近已被商业数字人平台验证的实现方式。当前剩余的主要风险已经从“双运动源贴合”转为生产素材质量、MuseTalk 的牙齿/局部纹理误差、端到端首响和长时间稳定性；这些必须分别验收，不能由 45.07 FPS 的模型吞吐替代。
