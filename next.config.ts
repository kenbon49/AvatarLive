import type { NextConfig } from 'next';

const apiUpstream = (process.env.API_UPSTREAM ?? 'http://localhost:8000').replace(/\/$/, '');
const srsApiUpstream = (process.env.SRS_API_UPSTREAM ?? 'http://localhost:1985').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Hide Next.js development-only toolbar and its diagnostics panel.
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  // dev 下从非 localhost(局域网 IP / 远程)打开页面时,Next 16 默认阻断跨 origin 的 dev 资源
  // (/_next/webpack-hmr 等),客户端不 hydrate → 按钮点击无响应。放行本机常用入口。
  allowedDevOrigins: ['localhost', '127.0.0.1', '10.2.42.21', 'avator.ipaperview.com'],
  // dev 下前端(https://host:3000)经 Next 反代访问后端(:8000),一次解决:
  // ① https 页面 fetch http 后端的混合内容拦截;② 远程浏览器访问不到 host 的 localhost:8000;
  // ③ 跨源 CORS。前端 API_BASE 设为 ''(同源),fetch('/api/...'、'/health/...') 由这些 rewrite 转后端。
  async rewrites() {
    return [
      { source: '/health/:path*', destination: `${apiUpstream}/health/:path*` },
      { source: '/api/:path*', destination: `${apiUpstream}/api/:path*` },
      { source: '/docs/:path*', destination: `${apiUpstream}/docs/:path*` },
      { source: '/redoc/:path*', destination: `${apiUpstream}/redoc/:path*` },
      { source: '/openapi.json', destination: `${apiUpstream}/openapi.json` },
      { source: '/openapi/:path*', destination: `${apiUpstream}/openapi/:path*` },
      { source: '/rtc/:path*', destination: `${srsApiUpstream}/rtc/:path*` },
      // FlashHead Lite 使用独立 :8030，不占用 LiveTalking :8028。浏览器始终走同源路径，
      // 容器部署时由 FLASHHEAD_UPSTREAM 指向宿主机服务。
      {
        source: '/flashhead-api/:path*',
        destination: `${process.env.FLASHHEAD_UPSTREAM ?? 'http://localhost:8030'}/:path*`,
      },
      // MuseTalk 1.5 动作主播使用独立 :8031，避免影响 :8028/:8030 的现有会话。
      {
        source: '/musetalk-api/:path*',
        destination: `${process.env.MUSETALK_UPSTREAM ?? 'http://localhost:8031'}/:path*`,
      },
      {
        source: '/musetalk-total-api/:path*',
        destination: `${process.env.MUSETALK_TOTAL_UPSTREAM ?? 'http://localhost:8080'}/:path*`,
      },
      {
        source: '/melotts-api/:path*',
        destination: `${process.env.MELOTTS_UPSTREAM ?? 'http://localhost:8084'}/:path*`,
      },
      {
        source: '/musetalk-stream-api/:path*',
        destination: `${process.env.MUSETALK_STREAM_UPSTREAM ?? 'http://localhost:8083'}/:path*`,
      },
      // LiveAct 生成式数字人：浏览器同源 /liveact-api/* → demo.py（默认本机 :5071）。
      // 同源代理一次解决：① 跨源 CORS；② https 页面 fetch http demo 的混合内容拦截；
      // ③ 远程浏览器访问不到 host 的 localhost:5071。不改 demo.py。
      // 容器部署时把 LIVEACT_UPSTREAM 改成 host.docker.internal:5071 或 GPU 机 IP。
      {
        source: '/liveact-api/:path*',
        destination: `${process.env.LIVEACT_UPSTREAM ?? 'http://localhost:5071'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
