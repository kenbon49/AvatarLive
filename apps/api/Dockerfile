# SynLive API 镜像
# REGISTRY 可指向私有仓库（带尾斜杠）���如 harbor-develop.zuzuche.net/dockerhub/
ARG REGISTRY=
FROM ${REGISTRY}python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=1000 \
    PIP_RETRIES=20 \
    PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

WORKDIR /app

# The API owns the process-isolated media supervisor in the MVP. Keep FFmpeg
# in the image so a live run can publish a test source and restream targets.
RUN sed -i \
        -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
        -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖（利用层缓存）
COPY requirements.txt .
RUN pip install -r requirements.txt

# 再拷业务代码
COPY app ./app
COPY alembic.ini ./alembic.ini
COPY migrations ./migrations

EXPOSE 8000

# 启动前迁移数据库，避免新部署实例缺少业务表。
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
