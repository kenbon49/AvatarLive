import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export type ExternalApiLog = {
  id: string; createdAt: string; source: 'web' | 'api'; provider: string; operation: string;
  method: string; url: string; status: 'success' | 'error'; httpStatus: number | null;
  durationMs: number; requestId: string; context: Record<string, unknown>;
  request: unknown; response: unknown; error: unknown;
};
export type LogQuery = { provider?: string; status?: string; q?: string; before?: string; limit?: number };
const SENSITIVE = /^(?:authorization|proxyauthorization|cookie|setcookie|password|passwd|secret|apikey|accesskeyid|accesskeysecret|accesskey|token|accesstoken|refreshtoken|securitytoken|credential|credentialid|signature|xapikey|xosscredential|xosssignature|xosssecuritytoken)$/i;
const OMIT = /^(?:data|base64|audiodata|imagedata|filecontent|referenceimages)$/i;
const normalized = (key: string) => key.replace(/[^a-z0-9]/gi, '');

export function sanitizeLogValue(value: unknown, secrets: string[] = []): unknown {
  let budget = 20_000;
  let nodes = 0;
  function clean(input: unknown, depth: number): unknown {
    if (++nodes > 500 || budget <= 0) return '[内容已截断]';
    if (depth > 6) return '[层级已截断]';
    if (typeof input === 'string') {
      let result = input;
      for (const secret of secrets.filter(item => item.length >= 6)) result = result.split(secret).join('[已隐藏]');
      result = result.replace(/data:[^\s"']+;base64,[A-Za-z0-9+/=]+/gi, '[已省略文件内容]')
        .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[已省略长编码内容]')
        .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+)\b/g, '[已隐藏]')
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=_.-]+/gi, '$1 [已隐藏]')
        .replace(/(["']?(?:api[_-]?key|access[_-]?key(?:[_-]?(?:id|secret))?|password|secret|token|signature|authorization|cookie)["']?\s*[:=]\s*)["']?[^\s,;&"'}]+/gi, '$1[已隐藏]')
        .replace(/https?:\/\/[^\s<>"')]+/gi, (raw) => {
          try {
            const url = new URL(raw);
            url.username = ''; url.password = ''; url.hash = '';
            for (const key of [...url.searchParams.keys()]) {
              if (SENSITIVE.test(normalized(key)) || /signature|credential|token|secret/i.test(key)) url.searchParams.set(key, '[已隐藏]');
            }
            return url.toString();
          } catch { return '[无效地址]'; }
        });
      const length = Math.min(4000, budget);
      budget -= Math.min(result.length, length);
      return result.length > length ? `${result.slice(0, length)}…[内容已截断]` : result;
    }
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (input instanceof Error) return clean({ name: input.name, message: input.message, stack: input.stack, cause: input.cause }, depth + 1);
    if (Array.isArray(input)) return input.slice(0, 20).map(item => clean(item, depth + 1));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).slice(0, 40).map(([key, item]) => [
      secrets.filter(item => item.length >= 6).reduce((name, secret) => name.split(secret).join('[已隐藏]'), key).slice(0, 100), SENSITIVE.test(normalized(key)) ? '[已隐藏]'
        : OMIT.test(normalized(key)) && typeof item === 'string' && item.length > 100 ? '[已省略文件内容]' : clean(item, depth + 1),
    ]));
    return null;
  }
  return clean(value, 0);
}

export const logSortKey = (entry: ExternalApiLog) => `${entry.createdAt}|${entry.id}`;
export function providerFailed(value: unknown, depth = 0): boolean {
  if (depth > 2 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.slice(0, 20).some(item => providerFailed(item, depth + 1));
  const body = value as Record<string, unknown>;
  return body.success === false || body.Success === false || Boolean(body.error)
    || (typeof body.code === 'string' && Boolean(body.code) && !['success', 'ok', '200', '0'].includes(body.code.toLowerCase()))
    || (typeof body.status === 'string' && /^(error|failed|failure|cancelled|canceled)$/i.test(body.status))
    || providerFailed(body.data, depth + 1) || providerFailed(body.output, depth + 1);
}
export function filterLogs(entries: ExternalApiLog[], query: LogQuery) {
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const search = query.q?.toLowerCase() || '';
  return entries.filter(entry => entry.createdAt >= cutoff
    && (!query.before || logSortKey(entry) < query.before)
    && (!query.provider || entry.provider === query.provider)
    && (!query.status || entry.status === query.status)
    && (!search || JSON.stringify(entry).toLowerCase().includes(search)))
    .sort((a, b) => logSortKey(b).localeCompare(logSortKey(a)))
    .slice(0, query.limit || 51);
}

export function createExternalApiLogStore(directory: string, maxBytes = 2 * 1024 * 1024, backups = 4) {
  const file = path.join(directory, 'web.log');
  let pending = Promise.resolve();
  let warned = false;
  return {
    async write(entry: ExternalApiLog) {
      pending = pending.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const line = JSON.stringify(entry) + '\n';
        if ((await stat(file).catch(() => ({ size: 0 }))).size + Buffer.byteLength(line) > maxBytes) {
          await unlink(`${file}.${backups}`).catch(() => undefined);
          for (let index = backups - 1; index >= 0; index--) {
            await rename(index ? `${file}.${index}` : file, `${file}.${index + 1}`)
              .catch(error => { if (error.code !== 'ENOENT') throw error; });
          }
        }
        await appendFile(file, line, { mode: 0o600 });
      }).catch(() => {
        if (!warned) console.error('[external-api-log] 无法保存调用日志，请检查 runtime 目录权限和磁盘空间');
        warned = true;
      });
      await pending;
    },
    async list(query: LogQuery) {
      await pending;
      const entries: ExternalApiLog[] = [];
      for (let index = 0; index <= backups; index++) {
        let contents: string;
        try { contents = await readFile(index ? `${file}.${index}` : file, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        for (const line of contents.split('\n')) {
          try {
            const entry = JSON.parse(line) as ExternalApiLog;
            if (entry?.source === 'web' && typeof entry.id === 'string' && typeof entry.createdAt === 'string') entries.push(entry);
          } catch { /* Ignore a partial line while another worker is appending. */ }
        }
      }
      return filterLogs(entries, query);
    },
  };
}

function requestBody(body: RequestInit['body']) {
  if (body instanceof FormData) return Object.fromEntries([...body.entries()].map(([key, value]) => [
    key, typeof value === 'string' ? value : { filename: value.name, type: value.type, bytes: value.size },
  ]));
  if (typeof body === 'string') {
    if (body.length > 2_000_000) return { omitted: '请求内容超过日志上限', characters: body.length };
    try { return JSON.parse(body); } catch { return body; }
  }
  return body ? '[已省略二进制或流内容]' : null;
}

async function responseBody(response: Response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/event-stream') || (!type.includes('json') && response.ok)) return { contentType: type, contentLength: response.headers.get('content-length') };
  const reader = response.clone().body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  // A diagnostic read must not keep a slow or streaming provider request open.
  const timeout = setTimeout(() => { void reader.cancel().catch(() => undefined); }, 1000);
  try {
    while (size < 24_000) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value.subarray(0, 24_000 - size));
      size += value.length;
    }
  } catch { return '[响应内容读取失败]'; }
  finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body); } catch { return body; }
}

export function createExternalApiLogger({ write, fetcher = fetch, context = async () => ({}), secrets = () => [] }: {
  write: (entry: ExternalApiLog) => Promise<void>;
  fetcher?: typeof fetch;
  context?: () => Promise<Record<string, unknown>>;
  secrets?: () => string[];
}) {
  async function call<T>(provider: string, operation: string, url: string, method: string, request: unknown,
    invoke: () => Promise<T>, describe: (value: T) => { httpStatus?: number; response: unknown; requestId?: string; failed?: boolean }, extraSecrets: string[] = []) {
    const started = performance.now();
    const entry: ExternalApiLog = {
      id: `web-${randomUUID()}`, createdAt: new Date().toISOString(), source: 'web', provider, operation,
      method, url, status: 'success', httpStatus: null, durationMs: 0, requestId: '', context: await context().catch(() => ({})),
      request, response: null, error: null,
    };
    try {
      const result = await invoke();
      const detail = describe(result);
      Object.assign(entry, { httpStatus: detail.httpStatus ?? null, response: detail.response, requestId: detail.requestId || '', status: detail.failed ? 'error' : 'success' });
      if (detail.failed) entry.error = detail.response;
      return result;
    } catch (error) {
      entry.status = 'error'; entry.error = error instanceof Error ? error : String(error);
      const details = error as { statusCode?: number; code?: string; requestId?: string; data?: unknown };
      entry.httpStatus = details?.statusCode || null;
      entry.response = details?.data || null;
      entry.requestId = details?.requestId || '';
      throw error;
    } finally {
      entry.durationMs = Math.round(performance.now() - started);
      try {
        const credentials = [...secrets(), ...extraSecrets];
        await write({
          ...sanitizeLogValue({ ...entry, request: null, response: null, error: null }, credentials) as ExternalApiLog,
          request: sanitizeLogValue(entry.request, credentials), response: sanitizeLogValue(entry.response, credentials),
          error: sanitizeLogValue(entry.error, credentials),
        });
      }
      catch { /* Diagnostics must never turn a successful paid request into a failure. */ }
    }
  }
  return {
    call,
    async fetch(provider: string, operation: string, input: string | URL, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      const credentialValues = ['authorization', 'x-api-key'].flatMap(name => {
        const value = headers.get(name); return value ? [value, value.replace(/^(Bearer|Basic)\s+/i, '')] : [];
      });
      return call(provider, operation, String(input), init.method || 'GET', requestBody(init.body), async () => {
        const response = await fetcher(input, init);
        const body = await responseBody(response);
        return { response, body };
      }, ({ response, body }) => ({
        httpStatus: response.status, response: body,
        requestId: response.headers.get('x-request-id') || response.headers.get('x-acs-request-id') || (body && typeof body === 'object' ? String((body as Record<string, unknown>).request_id || '') : ''),
        failed: !response.ok || providerFailed(body),
      }), credentialValues).then(result => result.response);
    },
  };
}
