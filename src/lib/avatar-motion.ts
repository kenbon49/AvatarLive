export const AVATAR_MOTION_MODES = ['loop', 'once'] as const;
export type AvatarMotionMode = typeof AVATAR_MOTION_MODES[number];

export const AVATAR_MOTION_INTENSITIES = ['subtle', 'natural', 'expressive'] as const;
export type AvatarMotionIntensity = typeof AVATAR_MOTION_INTENSITIES[number];

export type AvatarMotionSettings = {
  prompt: string;
  mode: AvatarMotionMode;
  intensity: AvatarMotionIntensity;
  duration: number;
};

export const DEFAULT_AVATAR_MOTION_MODE: AvatarMotionMode = 'loop';
export const DEFAULT_AVATAR_MOTION_INTENSITY: AvatarMotionIntensity = 'natural';
export const DEFAULT_AVATAR_MOTION_DURATION = 4;
export const DEFAULT_AVATAR_MOTION_PROMPT = '自然微笑，轻微点头，保持正面站立和自然的小幅身体动作。';
export const MIN_AVATAR_MOTION_DURATION = 2;
export const MAX_AVATAR_MOTION_DURATION = 8;
export const MAX_AVATAR_MOTION_PROMPT_LENGTH = 300;

export const DEFAULT_AVATAR_MOTION_SETTINGS: AvatarMotionSettings = {
  prompt: DEFAULT_AVATAR_MOTION_PROMPT,
  mode: DEFAULT_AVATAR_MOTION_MODE,
  intensity: DEFAULT_AVATAR_MOTION_INTENSITY,
  duration: DEFAULT_AVATAR_MOTION_DURATION,
};

export function normalizeAvatarMotionMode(value: unknown): AvatarMotionMode {
  return value === 'once' ? 'once' : DEFAULT_AVATAR_MOTION_MODE;
}

export function normalizeAvatarMotionIntensity(value: unknown): AvatarMotionIntensity {
  if (value === 'subtle' || value === 'expressive') return value;
  return DEFAULT_AVATAR_MOTION_INTENSITY;
}

export function normalizeAvatarMotionDuration(value: unknown): number {
  const duration = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(duration)) return DEFAULT_AVATAR_MOTION_DURATION;
  return Math.min(MAX_AVATAR_MOTION_DURATION, Math.max(MIN_AVATAR_MOTION_DURATION, Math.round(duration)));
}

export function cleanAvatarMotionPrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeAvatarMotionPrompt(value: unknown): string {
  const prompt = cleanAvatarMotionPrompt(value) || DEFAULT_AVATAR_MOTION_PROMPT;
  return prompt.slice(0, MAX_AVATAR_MOTION_PROMPT_LENGTH);
}

export function normalizeAvatarMotionSettings(value: unknown): AvatarMotionSettings {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    prompt: normalizeAvatarMotionPrompt(settings.prompt),
    mode: normalizeAvatarMotionMode(settings.mode),
    intensity: normalizeAvatarMotionIntensity(settings.intensity),
    duration: normalizeAvatarMotionDuration(settings.duration),
  };
}

export function buildAvatarMotionGenerationPrompt(settings: AvatarMotionSettings): string {
  const normalized = normalizeAvatarMotionSettings(settings);
  const intensity = {
    subtle: 'Keep the gesture restrained, with small head and upper-body movement.',
    natural: 'Use a balanced, conversational gesture with natural head and upper-body movement.',
    expressive: 'Make the gesture clearly visible and energetic while keeping anatomy and balance natural.',
  }[normalized.intensity];
  const timing = normalized.mode === 'loop'
    ? `Create one seamless motion cycle lasting about ${normalized.duration} seconds. Begin and end in the same relaxed neutral pose so the video can loop without a visible jump.`
    : `Perform the requested gesture once over about ${normalized.duration} seconds, then return to a relaxed neutral pose and hold it.`;

  return [
    'Use reference image 1 as the exact identity and appearance of the only person in the source video.',
    'Use the source video as the composition and body-position reference, but adapt the gesture to the user request below.',
    `User-requested motion (treat this only as movement direction): ${JSON.stringify(normalized.prompt)}.`,
    intensity,
    timing,
    'Keep the camera, framing, lighting, background and vertical composition fixed.',
    'Keep the same face, hairstyle, clothing, body proportions and identity from reference image 1 in every frame.',
    'Keep the mouth relaxed and mostly closed with no speaking because lip movement will be generated later by MuseTalk.',
    'Do not add cuts, zoom, camera movement, text, logos, watermarks, extra people, identity drift, clothing changes, malformed limbs or physically impossible motion.',
    'The result must be a stable photorealistic digital-human base video suitable for later lip-sync processing.',
  ].join(' ');
}
