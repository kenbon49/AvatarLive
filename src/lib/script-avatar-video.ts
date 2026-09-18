export type ScriptAvatarVideoInput = {
  text: string;
  avatarId: string;
  voiceId: string;
  speechRate: number;
  pitchRate: number;
};

export type ScriptAvatarVideoDisplayState =
  | 'missing'
  | 'stale'
  | 'failed'
  | 'processing'
  | 'downloading'
  | 'downloadFailed'
  | 'submitting'
  | 'queued'
  | 'ready';

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function scriptAvatarVideoInputSignature(input: ScriptAvatarVideoInput) {
  const serialized = JSON.stringify([
    input.text.trim(),
    input.avatarId,
    input.voiceId,
    input.speechRate,
    input.pitchRate,
  ]);
  return `v1-${serialized.length.toString(36)}-${hashText(serialized)}`;
}

export function scriptAvatarVideoIsBusy(state: ScriptAvatarVideoDisplayState, submitting = false) {
  return submitting || state === 'processing' || state === 'downloading' || state === 'submitting' || state === 'queued';
}
