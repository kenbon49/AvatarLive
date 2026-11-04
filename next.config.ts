import type { NextConfig } from 'next';

const apiUpstream = (process.env.API_UPSTREAM ?? 'http://localhost:8000').replace(/\/$/, '');
const srsApiUpstream = (process.env.SRS_API_UPSTREAM ?? 'http://localhost:1985').replace(/\/$/, '');

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  experimental: {
    proxyClientMaxBodySize: '64mb',
  },
  // Hide Next.js development-only toolbar and its diagnostics panel.
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  // dev 下从非 localhost(局域网 IP / 远程)打开页面时,Next 16 默认阻断跨 origin 的 dev 资源
  // (/_next/webpack-hmr 等),客户端不 hydrate → 按钮点击无响应。放行本机常用入口。
  allowedDevOrigins: ['localhost', '127.0.0.1', '10.2.42.21', 'avator.ipaperview.com'],
  async headers() {
    return [
      {
        source: '/assets/aliyun-avatars/covers/:path*',
        headers: [{
          key: 'Cache-Control',
          value: 'public, max-age=86400, stale-while-revalidate=604800',
        }],
      },
      ...['/login', '/register'].map((source) => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      })),
    ];
  },
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
    ];
  },
};

export default nextConfig;
