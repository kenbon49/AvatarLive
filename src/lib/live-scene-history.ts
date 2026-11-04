export type LiveSceneHistory<T> = {
  past: T[];
  future: T[];
  lastCoalesceKey: string | null;
  lastRecordedAt: number;
};

type HistoryOptions<T> = {
  coalesceKey?: string;
  coalesceWindowMs?: number;
  equals?: (left: T, right: T) => boolean;
  limit?: number;
  now?: number;
};

type HistoryTransition<T> = {
  history: LiveSceneHistory<T>;
  snapshot: T | null;
};

export function createLiveSceneHistory<T>(): LiveSceneHistory<T> {
  return {
    past: [],
    future: [],
    lastCoalesceKey: null,
    lastRecordedAt: 0,
  };
}

export function canUndoLiveScene(history: LiveSceneHistory<unknown>): boolean {
  return history.past.length > 0;
}

export function canRedoLiveScene(history: LiveSceneHistory<unknown>): boolean {
  return history.future.length > 0;
}

export function recordLiveSceneSnapshot<T>(
  history: LiveSceneHistory<T>,
  snapshot: T,
  options: HistoryOptions<T> = {},
): LiveSceneHistory<T> {
  const {
    coalesceKey,
    coalesceWindowMs = 900,
    equals = Object.is,
    limit = 50,
    now = Date.now(),
  } = options;
  const coalescing = Boolean(
    coalesceKey
    && history.lastCoalesceKey === coalesceKey
    && now - history.lastRecordedAt <= coalesceWindowMs,
  );
  const duplicate = history.past.length > 0 && equals(history.past.at(-1)!, snapshot);
  const past = coalescing || duplicate
    ? history.past
    : [...history.past, snapshot].slice(-Math.max(1, limit));

  return {
    past,
    future: [],
    lastCoalesceKey: coalesceKey ?? null,
    lastRecordedAt: now,
  };
}

export function undoLiveScene<T>(
  history: LiveSceneHistory<T>,
  current: T,
  equals: (left: T, right: T) => boolean = Object.is,
): HistoryTransition<T> {
  const past = [...history.past];
  let snapshot: T | undefined;
  while (past.length > 0) {
    const candidate = past.pop()!;
    if (!equals(candidate, current)) {
      snapshot = candidate;
      break;
    }
  }
  if (snapshot === undefined) {
    return { history: createLiveSceneHistory<T>(), snapshot: null };
  }
  return {
    history: {
      past,
      future: [current, ...history.future],
      lastCoalesceKey: null,
      lastRecordedAt: 0,
    },
    snapshot,
  };
}

export function redoLiveScene<T>(
  history: LiveSceneHistory<T>,
  current: T,
  equals: (left: T, right: T) => boolean = Object.is,
): HistoryTransition<T> {
  const future = [...history.future];
  let snapshot: T | undefined;
  while (future.length > 0) {
    const candidate = future.shift()!;
    if (!equals(candidate, current)) {
      snapshot = candidate;
      break;
    }
  }
  if (snapshot === undefined) {
    return {
      history: {
        ...history,
        future: [],
        lastCoalesceKey: null,
        lastRecordedAt: 0,
      },
      snapshot: null,
    };
  }
  return {
    history: {
      past: [...history.past, current],
      future,
      lastCoalesceKey: null,
      lastRecordedAt: 0,
    },
    snapshot,
  };
}
