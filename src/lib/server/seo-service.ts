import 'server-only';

export function seoServiceConfig() {
  const configured = (process.env.SEO_VOICE_API_BASE_URL || process.env.SEO_IMAGE_API_BASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.SEO_VOICE_API_KEY || process.env.SEO_IMAGE_API_KEY || '';
  const upstreams = [configured];
  if (configured.includes('host.docker.internal')) {
    upstreams.push(configured.replace('host.docker.internal', '127.0.0.1'));
  }
  return { apiKey, upstreams: [...new Set(upstreams.filter(Boolean))] };
}

export async function fetchSeoService(path: string, init: RequestInit) {
  const { apiKey, upstreams } = seoServiceConfig();
  if (!apiKey || !upstreams.length) throw new Error('智能内容服务尚未配置');

  let lastError: unknown;
  for (const upstream of upstreams) {
    try {
      const response = await fetch(`${upstream}${path}`, {
        ...init,
        headers: { 'X-API-Key': apiKey, ...init.headers },
        cache: 'no-store',
      });
      return { response, upstream };
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('智能内容服务暂时不可用');
}
