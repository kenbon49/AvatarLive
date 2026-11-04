export type YijingFont = {
  value: string;
  family: string;
  path: string | null;
};

export const UNAVAILABLE_FONT_FALLBACKS: Record<string, string> = {
  YuMoTi: 'SiYuanHeiTi',
};

export function resolveYijingFontFamily(value: string, fonts: readonly YijingFont[]): string {
  const font = fonts.find(item => item.value === value);
  if (!font) return value;
  return font.path ? font.family : UNAVAILABLE_FONT_FALLBACKS[value] ?? value;
}
