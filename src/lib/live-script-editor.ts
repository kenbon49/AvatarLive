export const SCRIPT_EDITOR_LIMIT = 12_000;
export const MAX_SCRIPT_MATERIAL_IMAGES = 4;

export function appendScriptMaterialImages<T>(current: T[], incoming: T[]): T[] {
  if (current.length + incoming.length > MAX_SCRIPT_MATERIAL_IMAGES) {
    throw new Error(`最多上传 ${MAX_SCRIPT_MATERIAL_IMAGES} 张图片，请先移除已有图片`);
  }
  return [...current, ...incoming];
}

export function estimateScriptSeconds(text: string, speed = 1): number {
  const rate = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  return Math.round(Array.from(text.trim()).length * 0.35 / rate);
}

export function formatScriptDuration(seconds: number): string {
  const duration = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;
}

export function replaceScriptSelection(text: string, start: number, end: number, replacement: string) {
  const from = Math.max(0, Math.min(text.length, start));
  const to = Math.max(from, Math.min(text.length, end));
  const value = text.slice(0, from) + replacement + text.slice(to);
  if (value.length > SCRIPT_EDITOR_LIMIT) throw new Error(`脚本不能超过 ${SCRIPT_EDITOR_LIMIT} 字`);
  return { text: value, cursor: from + replacement.length };
}

export function reviseStoryboardScript<T extends { text: string; duration: string; state: string }>(script: T, text: string, speed: number): T {
  if (script.text === text) return script;
  return { ...script, text, duration: formatScriptDuration(estimateScriptSeconds(text, speed)), state: 'ready' };
}

export function duplicateStoryboardScript<T extends { id: number; title: string; state: string }>(script: T, id: number): T {
  return { ...script, id, title: `${script.title} 副本`, state: 'ready' };
}
