# AvatarLive 数字人 API 替代调研

调研日期：2026-10-18。结合项目代码，通过搜索引擎发现候选，再核对厂商官网、接口文档和 API 价格页。本次未购买服务、未调用付费生成接口，因此不对实际画质、中文发音、生成速度和稳定性作实测结论。

## 结论

优先验证 **百度数字员工开放平台（曦灵）和腾讯云智能数智人**。两者的官方文档都明确支持文字/音频驱动、异步任务和透明 WebM，能够承接项目当前“生成视频 → 下载缓存 → 叠加到直播画面”的流程。

海外备选为 **Tavus 和 D-ID V3 Pro**。透明 WebM 已有明确接口依据，但 Tavus 的透明模式限制、D-ID 的尺寸参数，以及两者的中文效果与大陆部署访问情况还要通过样片确认。

AKOOL、Duix、相芯和讯飞也有接口能力，但目前证据不足以把它们列为当前透明视频流程的首选。各厂商都需要编写适配代码，阿里云的形象 ID、音色 ID 和模板不能直接迁移。

## 项目实际需要替换的能力

| 项目现状 | 对供应商的要求 |
| --- | --- |
| 灵眸 SDK `@alicloud/lingmou20250527`，读取模板后提交视频任务 | 需要替换创建、查询任务和错误状态的实现 |
| `ONLY_AVATAR`、`1080p`、`fps: 30`、关闭水印、中文 | 要验证所选形象在透明模式下的真实尺寸、帧率、中文效果和水印 |
| 公共形象与公共音色 | 新供应商要有可用的形象/音色，或支持外部音频驱动 |
| 下载 `.webm` 到本地，浏览器叠加播放 | 优先选择有 Alpha 通道的透明 WebM |
| 单条/批量视频生成 | 需要异步任务、状态查询或回调，明确并发与排队限制 |
| 任务费用冻结、按实际视频时长结算 | 需要重设供应商成本、套餐消耗和计费规则 |

相关代码：

- `src/lib/server/aliyun-avatar-video.ts`：创建任务、查询状态、本地文件位置。
- `src/lib/server/aliyun-avatar-video-cache.ts`：只允许阿里云域名，校验 WebM 容器头。
- `src/lib/live-avatar-catalog.ts`：阿里云形象选择与 ID。
- `src/components/live-studio.tsx`：单条/批量生成调用。

注意：当前 WebM 文件头校验只能证明容器格式，不能证明视频实际含有透明通道。替代样片应在浏览器叠加画面上检查透明效果。

## 候选对比

价格为官网公开口径。人民币/美元不作汇率换算；合成单价不等于包含形象、音色、并发及套餐闲置成本的总价。

| 厂商 | 已核实的接口能力 | 透明背景与分辨率 | 公开价格依据 | 对本项目的判断 |
| --- | --- | --- | --- | --- |
| **百度数字员工开放平台 / 曦灵** | 文字或音频驱动；任务 ID；回调/查询；公共与定制形象 | 明确支持透明 WebM；宽高可配置，最高 4K，不能超过形象底板素材分辨率 | 2D 小样本 **3 元/分钟**；2D 精品 **4 元/分钟**；3D **5 元/分钟**，按时长包购买 | **国内首选验证**，输出形式接近现有流程，起购时长包较小 |
| **腾讯云智能数智人** | 文字/原声音频驱动；任务查询/回调；形象租赁/定制 | 明确支持带 Alpha 的 WebM/MOV；2D 有 1080p 能力，实际跟所选形象资产有关 | 常规 2D 小样本首档 **2000 元/10 小时 ≈ 3.33 元/分钟**；另计形象租赁/定制 | **国内重点备选**，需要把形象费和时长包起购量一起评估 |
| **Tavus** | 文字或音频驱动；异步生成/查询/回调；公共和自建 Face | `transparent_background=true` 输出透明 WebM，**必须同时 `fast=true`**；此模式的 1080p/30fps 本次未核实 | Starter **59 美元/月，含 10 分钟生成**，超额 **1 美元/分钟**；Growth **397 美元/月，含 100 分钟**，超额 **0.90 美元/分钟** | **海外备选**；不要把 CVI 实时对话分钟价格当成视频生成价格 |
| **D-ID V3 Pro / Clips** | 文字/音频脚本；异步创建与查询；公共 Presenter | `config.result_format="webm"` 配合 `background.color=false` 明确支持透明背景；尺寸说明需要复核 | 有独立 API 价格页；本次未读取到完整公开报价，需在 API 控制台核价 | **海外备选**；透明接口明确，尺寸、套餐水印与适用形象要确认 |
| **AKOOL Talking Avatar** | 公共或自备形象，音频驱动，回调/查询；可另调用 TTS | 官方有 1080p/4K 生成档位；本次未找到该接口输出 Alpha WebM 的明确说明 | API 页：1080p **5 credits/10 秒，即 30 credits/分钟**；4K 为 **60 credits/分钟**。积分购买价格另核 | 有视频能力，但透明输出需确认；不能直接套用网页会员折算单价 |
| **Duix（硅基相关产品）** | 官方云端视频生成流程为人物视频+音频；另有实时交互 API/SDK | 官方视频生成示例输出 **MP4**；未核实 Alpha 输出 | 官网可见的 talk time 套餐是对话口径，不能据此计算视频生成 API 成本 | 可作为音频驱动方案研究；现有透明叠加流程需要额外验证/改造 |
| **相芯 FaceUnity / AvatarX** | 官网有云平台、API 文档入口和数字人 SDK/API 服务 | 未核实当前云视频接口的透明格式、分辨率与任务协议 | 商务报价 | 适合同时咨询企业接入、定制或私有部署，暂不按已验证平替处理 |
| **讯飞虚拟数字人** | 官方提供服务端 API、公有云 API；文字/音频输入、实时合成视频流 | 本次核实的是交互/流式能力，未核实同类透明 WebM 文件生成接口 | 商务报价，未获得可对应当前业务的公开单价 | 未来实时问答场景值得评估；当前异步缓存视频业务需另核接口 |

## 四个透明视频候选的具体依据

### 百度：当前最适合先做样片验证

官方基础视频合成文档明确写明“输入文本或音频驱动数字人生成播报视频，支持合成透明背景视频”。

- 服务地址：`https://open.xiling.baidu.com`。
- 创建任务：`POST /api/digitalhuman/open/v1/video/submit`。
- `driveType=TEXT` 使用供应商 TTS，`driveType=VOICE` 使用传入的音频 URL。
- `videoParams.transparent=true` 输出透明 WebM；`false` 输出 MP4；文档默认值为 `true`。
- 宽高最高不超过 4K，也不能超过所选人像底板素材宽高。
- 支持任务结束回调和任务查询；官方倾向使用回调。
- 音频驱动允许 wav/mp3/wma/m4a，最长 90 分钟。

价格指南列出的套餐为：2D 小样本 10 分钟 30 元、2D 精品 10 分钟 40 元、3D 10 分钟 50 元；也提供 100/1000 分钟包。时长包有效期一年，默认使用公共资源池，额外专属并发单独收费。

定制形象另计，例如 2D 小样本通用口型定制为 1000 元/次、专属口型为 2000 元/次。公共形象与定制形象要按实际选用类别计算费用，不能把所有形象统一按 3 元/分钟估算。

来源：[基础视频接口](https://cloud.baidu.com/doc/AI_DH/s/ilywwq0jz)、[价格指南](https://cloud.baidu.com/doc/AI_DH/s/Vlysgbz88)、[人像查询](https://cloud.baidu.com/doc/AI_DH/s/cmdrbo6i4)。

### 腾讯云：形象租赁费用与包规格需要一起比较

官方基础版视频接口支持：

- `POST /v2/ivh/videomaker/broadcastservice/videomake`，正式服务域名见 API 概述 `https://gw.tvs.qq.com`。
- `VideoParam.Format=TransparentWebm`：带 Alpha 通道的 WebM，也是文档默认格式。
- 另支持 `TransparentMov` 和 MP4；部分非抠像形象输出原始素材背景，因此要选对形象资产。
- `DriverType=Text`、`OriginalVoice`、`ModulatedVoice`，分别覆盖文本、原声和变声驱动。
- 通过任务 ID 查询进度，完成后取得 `MediaUrl`，也支持回调。
- 默认成品在内部 COS 仅保存 7 天，项目应及时下载到本地或指定自己的存储。

价格指南中，2D 小样本通用/专属口型的常规首档时长包为 2000 元/10 小时。折算约 3.33 元/分钟，但这是包内摊销价格，采购时仍需购买整个时长包。

公共 2D 小样本通用口型形象租赁为 50 元/个/月或 400 元/个/年；专属口型形象为 125 元/个/月或 1000 元/个/年。定制和额外专属并发另计。不要用大批量购买的最低阶梯价估算初期接入成本。

默认同一用户可同时提交 5 个视频制作任务，使用共享生成资源时可能排队；这是离线生成并发，不代表实时问答延迟。

来源：[API 概述](https://cloud.tencent.com/document/product/1240/81265)、[基础视频接口](https://cloud.tencent.com/document/product/1240/81268)、[进阶接口](https://cloud.tencent.com/document/product/1240/81269)、[进度查询](https://cloud.tencent.com/document/product/1240/81270)、[价格指南](https://cloud.tencent.com/document/product/1240/101944)。

### Tavus：透明 WebM 已确认，但透明模式有条件

- 创建：`POST https://tavusapi.com/v2/videos`。
- 输入 `replica_id`，以及 `script` 或 `audio_url`；支持 `callback_url`。
- 透明视频参数必须组合使用 `transparent_background=true` 和 `fast=true`。
- 官方异步视频概述支持公共 Face、自建 Face 和外部音频，说明支持 42 种语言；具体中文效果要做样片验证。
- 文档同时有 CVI 实时对话产品和 Video Generation 产品；本项目当前对应后者。
- 定价页的 CVI 1080p、并发流等指标，不能自动当作 `fast` 透明文件生成的承诺。此模式的真实尺寸、帧率、可用形象和套餐资格仍需确认。

来源：[创建视频接口](https://docs.tavus.io/api-reference/video-request/create-video)、[异步视频概述](https://docs.tavus.io/sections/video/overview)、[异步调用流程](https://docs.tavus.io/sections/video/quickstart)、[API 价格](https://www.tavus.io/pricing)。

### D-ID：确实有透明文件输出，尺寸说明存在需要核对的地方

本次核实的是 **V3 Pro 的 `/clips` 接口**，不能泛化到所有 V2/V3/V4 形象接口。

- 创建：`POST https://api.d-id.com/clips`；查询：`GET /clips/{id}`。
- `script` 可为文字或音频，支持 `webhook`。
- `config.result_format="webm"`。
- `background.color=false`；官方 schema 明确说明这会使用透明背景，且只支持 WebM。
- 官方快速入门称输出为 Full-HD；但创建接口的 `output_resolution` 描述为最大宽或高，数值上限 1080。不能仅凭“1080”断言它必然返回 1920×1080，应取得实际样片确认。
- 快速入门注明结果 URL 有效期 24 小时，应及时下载。

来源：[V3 Pro 快速入门](https://docs.d-id.com/docs/v3-pro-avatar-quickstart)、[Create Clip 完整接口定义](https://docs.d-id.com/reference/createclip)、[独立 API 价格页](https://www.d-id.com/pricing/api/)。

## 其他候选与未核实项

- **AKOOL**：[Talking Avatar 接口](https://docs.akool.com/ai-tools-suite/talking-avatar)、[API 价格](https://akool.com/api-pricing)。文字通常先通过 TTS 得到音频，再生成视频。成品资源文档注明有效期 7 天。透明背景不是这次已经证实的能力。
- **Duix**：[官方文档](https://docs.duix.com/documentation/introduction)、[官方视频生成示例](https://github.com/duixcom/duix-skills/tree/main/duix-avatar-video-generation)、[价格页](https://www.duix.com/pricing)。官方视频示例明确输出 MP4；官网实时对话套餐的分钟数不能当作离线视频合成分钟数。开源本地部署另有 GPU、运维和许可证评估，不能按免费云 API 理解。
- **相芯**：[官网开发者中心](https://www.faceunity.com/developer/)。能确认有 AvatarX 云平台和 API 文档入口，当前接口的透明输出、报价和交付方式需取得正式规格后再比较。
- **讯飞**：[虚拟数字人官网](https://virtual-man.xfyun.cn/)、[交互平台与能力开放](https://virtual-man.xfyun.cn/interaction)。可确认有 API 和实时视频流接入，尚不能据此推断有同规格的异步透明 WebM 下载接口。
- **HeyGen**：本次尝试访问官方 API 文档和价格页失败，未完成原始文档核验，因此没有把它列为已验证方案。可继续核对其 WebM 接口、可用形象和 API 套餐。
- **蝉镜**：搜索索引发现其官方数字人 API 开放平台页面；当前抓取返回前端页面，未取得可核验的透明输出协议与 API 报价，保留为待补充候选。
- **OmniHuman 等托管模型 API**：图片/视频+音频驱动的模型服务与完整公共数字人平台不同。本次未完成有效托管端点及透明输出核实，未作为当前流程的已验证替代。

## 接入项目时的主要改动

1. **供应商适配**：统一创建任务、查询状态、回调和错误信息。现有阿里云 SDK 和模板流程不能直接换域名复用。
2. **形象与音色目录**：更换目录和供应商 ID。阿里公共形象/音色不等于可导出迁移的资产；自有素材是否能用于新供应商，应按实际授权和素材要求处理。
3. **文件下载与缓存**：当前只允许阿里云 HTTPS 域名，且硬编码 WebM 文件。新供应商需要配置对应的下载域名、URL 有效期和输出校验。
4. **费用计算**：重设供应商成本。套餐采购、形象租赁和计费取整规则不应混作单一“每秒成本”。
5. **画面验收**：验证透明边缘、发丝、手势、真实尺寸/帧率、音画同步及水印。若供应商只能输出 MP4，需要额外的绿幕抠像、分割或调整合成方案；单纯转码为 WebM 不会生成透明通道。

视频合成供应商的选择主要影响上述模块。后续 OCR → 知识检索 → 生成回答 → 插播视频仍需要完成业务串联；能异步生成文件不等于已经具备低延迟实时对话能力。

## 建议的下一步

先用同一段约 30–60 秒的中文文案，在 **百度和腾讯云** 各选一个可商用的透明形象生成样片，按相同条件比较：

- 真实 1080p、是否 30fps、有无水印和音画同步。
- 透明边缘叠加到项目直播背景后的效果。
- 中文数字、金额、行业词汇的发音和口型。
- 单条/批量生成耗时、排队情况及失败后的收费方式。
- 实际账单是否有形象、音色、并发或透明输出附加费用。
- 公共形象在本项目及面向客户业务中的商用范围。

样片通过后，再确定主供应商，并保留第二家作为适配备选。本次调研没有调用这些生成接口，也没有实施迁移。

补充背景：阿里云[退市公告](https://www.aliyun.com/notice/118683)并未明确给出本项目当前后付费播报视频 API 的统一下线日期；迁移准备和确认现有 API 生命周期可以同时推进。当前阿里[视频定价](https://help.aliyun.com/zh/avatar/avatar-application/product-overview/avatar-video-pricing)约 6 元/分钟，可作为合成单价参考，不能据此直接比较所有方案的完整总成本。
