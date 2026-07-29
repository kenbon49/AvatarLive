#!/usr/bin/env bash
# ============================================================================
# 在 GPU 机器上启动 SoulX-LiveAct demo.py（生成式数字人 Flask 服务）。
#
# 与 deploy-livetalking.sh 的区别：LiveAct 是「离线/准实时扩散生成」，不是实时
# talking-head，所以不进 docker、不走 WebRTC——直接用 liveact conda env 在 host
# 跑 demo.py，监听 :5071，前端经 next rewrite /liveact-api/* 同源代理过来。
#
# 前置（memory synlive-liveact-integration 已验证就绪）：
#   - conda env  /data/llm_model/envs/liveact  (py3.10 torch2.6+cu124)
#   - 模型       /data/llm_model/SoulX-LiveAct-models/LiveAct (50.67GB)
#   - wav2vec    /data/llm_model/SoulX-LiveAct-models/chinese-wav2vec2-base
#   - demo.py 已打 --offload_cache 补丁（否则 KV≈24GB 钉死 GPU，3090 放不下）
#   - 系统 sox/libsox-dev、soundfile、/usr/bin/ffmpeg 均已装
#
# 用法：
#   ./run-liveact-demo.sh                 # 默认 GPU1（最空），端口 5071
#   GPU=0 PORT=5072 ./run-liveact-demo.sh # 换卡/换端口
#
# 首次启动需加载 50GB 模型 + warmup，约 3-5 分钟端口才开放；前端会显示「预热中」。
# ============================================================================
set -uo pipefail

# ffmpeg/ffprobe 在 /usr/bin，某些 conda env 的 PATH 不含它（memory 坑9）
export PATH="/usr/bin:$PATH"

# === 环境变量（对应 memory 9 坑）===
export PYTHONUNBUFFERED=1
export TORCHDYNAMO_DISABLE=1              # 坑7: torch.compile(demo.py:138/204) triton 失败 → 退化为 eager
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

GPU="${GPU:-1}"                           # GPU1 当前最空(23.8G free)；满时 GPU=0 覆盖
PORT="${PORT:-5071}"                      # 前端 next rewrite 默认指向 5071
export CUDA_VISIBLE_DEVICES="$GPU"
export USE_CHANNELS_LAST_3D=1

LIVEACT_HOME="${LIVEACT_HOME:-/data/llm_model/SoulX-LiveAct}"
PY="${PY:-/data/llm_model/envs/liveact/bin/python}"
CKPT_DIR="${CKPT_DIR:-/data/llm_model/SoulX-LiveAct-models/LiveAct}"
WAV2VEC_DIR="${WAV2VEC_DIR:-/data/llm_model/SoulX-LiveAct-models/chinese-wav2vec2-base}"
SIZE="${SIZE:-320*576}"                   # 720p 原生；3090+offload 下压到 320×576(memory)

cd "$LIVEACT_HOME" || { echo "ERROR: $LIVEACT_HOME 不存在" >&2; exit 1; }

# 自检：ffmpeg 必须可见，否则白等 5 分钟
command -v ffmpeg >/dev/null 2>&1 || { echo "ERROR: ffmpeg 不可见，PATH=$PATH" >&2; exit 1; }
echo "ffmpeg -> $(command -v ffmpeg)"
echo "GPU${GPU}  PORT=${PORT}  SIZE=${SIZE}  offload_cache=on  t5_cpu=on  block_offload=on"

RUN_TAG="${RUN_TAG:-service_$(date +%s 2>/dev/null || echo manual)}"
echo "=== LiveAct demo ${RUN_TAG} start $(date '+%F %T' 2>/dev/null) ===" | tee -a demo-run.log

# --offload_cache: demo.py 补丁 flag（KV→CPU，单卡 ~8GB）；--t5_cpu: umt5 在 CPU 编码；
# --block_offload: WanModel block 间搬 CPU。注意 --fps 不是 CLI 参数（每次 /start_stream 表单传）。
exec "$PY" -u demo.py \
  --ckpt_dir "$CKPT_DIR" \
  --wav2vec_dir "$WAV2VEC_DIR" \
  --size "$SIZE" \
  --port "$PORT" \
  --seed 42 \
  --t5_cpu --block_offload --offload_cache \
  2>&1 | tee -a demo-run.log
