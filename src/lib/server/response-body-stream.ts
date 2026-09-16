import type { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

export function responseBodyStream(source: Readable) {
  const iterator = source[Symbol.asyncIterator]();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        // Cancellation can close the controller while a file read is pending.
        if (cancelled) return;
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (cause) {
        if (!cancelled) controller.error(cause);
      }
    },
    async cancel() {
      cancelled = true;
      source.destroy();
      await iterator.return?.().catch(() => undefined);
    },
  });
}
