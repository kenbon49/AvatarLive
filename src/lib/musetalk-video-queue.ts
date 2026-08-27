export type VideoDecodeSelection = {
  nextPts: number | null;
  stalePts: number[];
};

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
