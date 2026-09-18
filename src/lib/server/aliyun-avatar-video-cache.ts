import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const WEBM_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export async function cacheAliyunWebm({
  url,
  destination,
  maxBytes,
  onProgress,
  fetcher = fetch,
}: {
  url: string;
  destination: string;
  maxBytes: number;
  onProgress: (received: number, total: number) => void;
  fetcher?: typeof fetch;
}) {
  const remote = new URL(url.startsWith('//') ? `https:${url}` : url);
  if (remote.protocol !== 'https:' || !(
    remote.hostname === 'aliyuncs.com'
    || remote.hostname.endsWith('.aliyuncs.com')
    || remote.hostname.endsWith('.alicdn.com')
  )) throw new Error('阿里云返回了不受信任的视频地址');

  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  let offset = await stat(temporary).then((file) => file.size).catch(() => 0);
  if (offset > maxBytes) throw new Error('透明数字人视频超过本地缓存上限');

  const response = await fetcher(remote, {
    cache: 'no-store',
    headers: offset ? { range: `bytes=${offset}-` } : undefined,
    signal: AbortSignal.timeout(30 * 60_000),
  });
  if (!response.ok || !response.body) throw new Error(`透明数字人视频下载失败（HTTP ${response.status}）`);
  if (offset && response.status !== 206) offset = 0;
  if (offset) {
    const range = response.headers.get('content-range');
    if (!range?.startsWith(`bytes ${offset}-`)) throw new Error('透明数字人视频续传范围不匹配');
  }
  const advertised = Number(response.headers.get('content-length'));
  const total = response.headers.get('content-range')?.match(/\/([0-9]+)$/)?.[1];
  const totalBytes = total ? Number(total) : Number.isFinite(advertised) && advertised > 0 ? offset + advertised : 0;
  if (totalBytes > maxBytes) {
    await response.body.cancel();
    throw new Error(`透明数字人视频超过本地 ${Math.floor(maxBytes / 1048576)} MiB 缓存上限`);
  }

  let received = offset;
  onProgress(received, totalBytes);
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > maxBytes) callback(new Error('透明数字人视频超过本地缓存上限'));
        else {
          onProgress(received, totalBytes);
          callback(null, chunk);
        }
      },
    }),
    createWriteStream(temporary, { flags: offset ? 'a' : 'w', mode: 0o600 }),
  );
  if (received < 1024 || (totalBytes && received !== totalBytes)) throw new Error('透明数字人视频下载不完整');
  const header = Buffer.alloc(4);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(temporary, { start: 0, end: 3 });
    stream.on('data', (chunk: Buffer) => chunk.copy(header));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  if (!header.equals(WEBM_HEADER)) {
    await unlink(temporary).catch(() => undefined);
    throw new Error('阿里云没有返回预期的透明 WebM 视频');
  }
  await rename(temporary, destination);
  return received;
}
