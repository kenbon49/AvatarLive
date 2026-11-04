export type CaptureRegion = { x: number; y: number; width: number; height: number };

const CHROME_LINES = new Set(['评论', '弹幕', '全部', '发送', '说点什么', '直播间', '互动', '礼物']);

export function extractOcrComments(text: string): string[] {
  return text.split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2 && line.length <= 300 && !CHROME_LINES.has(line) && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line));
}

export function normalizeOcrComment(text: string): string {
  return text.normalize('NFKC').replace(/[\s\p{P}]+/gu, '').toLowerCase();
}

export function newOcrComments(lines: string[], seen: Map<string, number>, now: number, ttlMs = 90_000): string[] {
  for (const [key, time] of seen) if (now - time > ttlMs) seen.delete(key);
  const added: string[] = [];
  for (const line of lines) {
    const key = normalizeOcrComment(line);
    if (key.length < 2) continue;
    if (seen.has(key)) {
      seen.set(key, now);
      continue;
    }
    seen.set(key, now);
    added.push(line);
  }
  return added;
}
