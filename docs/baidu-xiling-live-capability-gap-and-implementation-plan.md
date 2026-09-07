# 百度曦灵能力对标与 AvatarLive 实施计划

> 对标日期：2026-09-01。本文只记录已经核对过的能力和当前仓库可验证的实现状态；未实现项目不得标记为“已完成”。

## 1. 参考资料

- [曦灵营销内容创作平台产品介绍](https://xiling.cloud.baidu.com/doc/AI_DH_CLOUD/s/Alx39396g)
- [AI 主播使用手册](https://xiling.cloud.baidu.com/doc/AI_DH_CLOUD/s/Zlx3cdhq4)
- [快速入门](https://xiling.cloud.baidu.com/doc/AI_DH_CLOUD/s/Ylx39dvr8)
- [数字员工开放平台产品概述](https://xiling.cloud.baidu.com/doc/AI_DH/s/llysbp3td)
- [云渲染直播推流接口](https://xiling.cloud.baidu.com/doc/AI_DH/s/Sm1h9a4dh)
- [云渲染交互 H5 SDK](https://xiling.cloud.baidu.com/doc/AI_DH/s/ylywx77oh)
- [SSML](https://xiling.cloud.baidu.com/doc/AI_DH/s/rlyyduk53)

## 2. 能力矩阵

| 能力 | 百度曦灵 | AvatarLive 当前状态 | 结论 |
| --- | --- | --- | --- |
| 直播间搭建、模板、图层、主播 | 一键搭建并编辑 | 已有 `live-studio`，配置可保存 | 保留并补持久化 |
| 2D/3D/照片数字人、克隆声音 | PaaS 提供文本/音频驱动、SSML、状态回调 | MuseTalk 文本播报和有限动作已接入；克隆仍为演示 | P0 先闭合直播运营，P2 再扩展 3D |
| AI 整场脚本、脚本库、问答库 | SaaS 原生能力 | 脚本库和商品库已持久化，问答库仍在直播间配置中 | P0 基础闭环已完成 |
| 自动连续播报 | 支持整场自动播报、暂停/接管 | 已支持队列、循环、跳过、失败重试和接管恢复 | P0-1 已完成 |
| 动态话术、弹幕互动 | 结合问答库和直播事件动态生成 | LLM 动态话术已接入；平台事件已统一入库，尚未自动触发回复 | P1 继续联动 |
| 商品导入、商品卡、订单 | 平台商品导入、自建商品、商品卡 | 可复用商品库、三来源选品、自建商品、商品话术和节目商品卡已完成；真实平台导入/订单适配未完成 | P1 接平台 |
| 真人一键接管 | 播报可打断并切换真人 | 麦克风接管及节目输出音轨切换已接入 | P0-3 已完成 |
| 平台授权、弹幕/点赞/关注/礼物 | OAuth 与数据回传 | 已有通用签名事件入口；真实 OAuth 和各平台协议适配未完成 | P1 |
| 输出方式 | RTMP/BRTC 或官方伴侣窗口采集 | SRS/WHIP/FFmpeg + 独立节目输出浮窗 | 已具备差异化优势，继续复用 |
| 7x24、录像、复盘报表 | 直播管理与数据分析 | 运行状态和心跳已有，录像/报表缺失 | P1 |

## 3. 实施顺序与验收标准

### P0-1：自动播报编排器

- 支持顺序/随机、循环、暂停、继续、停止、跳过。
- 自动队列与手动单条播放互斥；单条失败可重试，不阻塞后续队列。
- 当前项状态同步为 `playing/done/ready`，停播或真人接管时安全取消。
- 验收：队列模块单元测试覆盖顺序、随机、循环、取消、失败重试；`npm run typecheck` 通过。

### P0-2：商品与脚本库持久化

- 新增商品字段：标题、SKU、图片、价格/原价、卖点、库存、售后、平台商品 ID、风险词。
- 新增按直播间关联的脚本库 CRUD；“保存到脚本库”和“从脚本库选择”调用真实 API。
- 商品资源与直播间选品已拆分为 `products` 和 `live_room_product_selections`；商品可跨直播间复用，选品单单独保存顺序。
- 验收：Alembic migration、API CRUD 测试、前端保存/加载测试；已有直播间配置向后兼容。

### P0-3：真人接管

- 新版控制台接入 `MuseTalkMicrophoneStream`，接管时打断播报、发送 16 kHz 单声道 PCM，节目窗口/WHIP 音画链路不断开。
- 停止接管后恢复数字人状态和自动队列；界面显示“真人接管中”和退出按钮。
- 验收：麦克风权限拒绝、开始/停止、播报打断和恢复场景可重复验证。

### P1：运营闭环

- 动态话术 LLM 任务、事实字段锁定、禁用词/相似度检查。
- 平台 OAuth、统一弹幕/点赞/关注/礼物事件模型、验签/去重/限流。
- 商品卡调度、字幕/BGM/音量混音、真实 MinIO/S3 资产、录像和推流质量报表。

#### P1-2：节目输出商品卡基础

- 当前商品可同步绘制到控制台画布和节目输出合成画布，窗口采集与 WHIP 输出看到同一张卡片。
- 商品卡开关可控制显示，内容使用持久化商品的名称、价格和前两条卖点。
- 商品脚本保存 `productId`；播报关联话术时显示对应商品卡，话术结束后自动隐藏。
- 下一阶段补充平台原生可点击商品卡映射；画面合成商品卡不等同于平台购物组件。

#### P1-4：百度同类选品流程

- “添加商品”改为完整选品弹窗，包含平台商品、脚本库、自建商品三个来源，以及搜索、刷新、多选、右侧商品单、移除和排序。
- 自建商品必须填写真实资料后保存，不再创建带时间戳的空白占位商品；名称、SKU、图片、价格、卖点、库存、售后和风险词完整重载。
- 新商品加入直播间后生成三段事实型基础话术；已有商品脚本从脚本库恢复，且话术与商品 ID 绑定。
- 平台商品页在没有商家 OAuth 凭据时显示真实空状态，不复用 RTMP 连接，也不伪造授权或商品。
- migration `20260901_0007` 将原 `live_room_products` 数据无损迁移到商品目录和选品关联，并提供可逆 downgrade。

#### P1-3：统一平台事件接入基础

- `POST /api/v1/platform-events/webhooks/{platform}` 接收统一事件，支持 `comment`、`viewer_enter`、`follow`、`like`、`gift`、`order`、`product_click` 和 `system`。
- 连接器使用 `X-SynLive-Timestamp` 与 `X-SynLive-Signature: sha256=<hex>`；签名原文为 `<timestamp>.<raw-body>`，算法为 HMAC-SHA256。
- `PLATFORM_WEBHOOK_SECRETS` 使用 JSON 对象按连接器 slug 配置密钥；未配置时端点安全失败并返回 503。
- 数据库对“平台 + 直播间 + 外部事件 ID”设置唯一约束，并提供 `GET /api/v1/live-rooms/{room_id}/platform-events` 增量查询。
- 当前限流为单 API 进程内的分钟窗口；扩展到多副本部署前需迁移到 Redis 分布式限流。
- 本阶段只定义 SynLive 连接器协议，不代表已经兼容抖音、快手、视频号等平台私有回调或签名算法。

### P2：平台扩展

- 照片/视频训练、多人主播、3D 动捕、课程/PPT/短视频、翻译、MCP、多租户权限/计费/审计。

## 4. 验证命令

```bash
npm run typecheck
npm run build
npm run test:avatar-motion
npm run test:avatar-selection
npm run test:musetalk-video-queue
npm run test:live-playback-queue
npm run test:live-dynamic-script
npm run test:live-product-scripts
git diff --check
```

Python API 测试应在项目 API 容器中执行（宿主环境可能没有 `fastapi`/数据库驱动）：

```bash
docker compose -f infra/docker-compose.yml run --rm \
  -v "$PWD/apps/api/tests:/app/tests:ro" \
  api python -m unittest tests.test_live_rooms
```

## 5. 本轮实现记录

- [x] P0-1 自动播报队列：顺序/随机、循环、暂停/继续、跳过、停止、失败重试。
- [x] P0-2 商品与脚本库：数据库模型、migration、FastAPI CRUD、控制台保存/加载。
- [x] P0-3 真人接管：麦克风 PCM 流、播报打断、窗口采集/WHIP 音频轨替换与恢复。
- [x] 输入控件字号统一提升到 14px，覆盖控制台和创作模块的文本输入、文本域、下拉框。
- [x] P1-1 动态话术基础闭环：调用现有 LLM 服务、携带商品/已播上下文，并执行风险词与重复度拦截。
- [x] P1-2 商品卡输出基础：控制台预览与节目输出合成画布使用同一商品信息。
- [x] P1-3 平台事件接入基础：统一事件 schema、HMAC 验签、时间窗防重放、唯一约束去重、限流和查询 API。
- [x] P1-4 商品选品重构：可复用商品目录、直播间选品关联、三来源弹窗、自建商品表单、商品脚本绑定和选品排序。
- [ ] P1/P2 项目仍按下方“当前明确未实现”列表推进，不能因为 UI 开关存在而视为运行时能力完成。

## 6. 当前明确未实现

真实平台 OAuth、抖音/快手/视频号等平台私有事件适配、事件到问答/氛围播报的自动调度、平台原生商品/订单同步、持久化声音克隆、对象存储上传、字幕/BGM 混音、录像/复盘报表以及 3D/多人数字人仍未完成。
