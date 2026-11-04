export type VideoDecodeSelection = {
  nextPts: number | null;
  stalePts: number[];
};

export function decodedVideoFrameLimit(
  fps: number,
  bufferSeconds = 2,
): number {
  const normalizedFps = Number.isFinite(fps) ? Math.max(1, fps) : 1;
  const normalizedBufferSeconds = Number.isFinite(bufferSeconds)
    ? Math.max(0, bufferSeconds)
    : 0;
  return Math.max(1, Math.ceil(normalizedFps * normalizedBufferSeconds));
}

export function hasVideoDecodeCapacity(
  decodedFrames: number,
  pendingDecodes: number,
  fps: number,
  bufferSeconds = 2,
): boolean {
  const occupiedSlots = Math.max(0, Math.floor(decodedFrames))
    + Math.max(0, Math.floor(pendingDecodes));
  return occupiedSlots < decodedVideoFrameLimit(fps, bufferSeconds);
}

export function selectVideoFrameForDecode(
  timestamps: Iterable<number>,
  mediaPts: number | null,
): VideoDecodeSelection {
  const ordered = [...timestamps].sort((left, right) => left - right);
  if (!ordered.length) return { nextPts: null, stalePts: [] };

  if (mediaPts !== null) {
    const due = ordered.filter((pts) => pts <= mediaPts);
    if (due.length) {
      return {
        nextPts: due.at(-1) ?? null,
        stalePts: due.slice(0, -1),
      };
    }
  }

  return { nextPts: ordered[0], stalePts: [] };
}

export function selectVideoFramesToDrop(
  timestamps: Iterable<number>,
  maximumFrames: number,
): number[] {
  const ordered = [...timestamps].sort((left, right) => left - right);
  const limit = Math.max(0, Math.floor(maximumFrames));
  return ordered.slice(0, Math.max(0, ordered.length - limit));
}
