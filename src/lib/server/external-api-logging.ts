import 'server-only';
import path from 'node:path';
import { headers } from 'next/headers';
import { createExternalApiLogger, createExternalApiLogStore } from './external-api-log';

const store = createExternalApiLogStore(path.join(/*turbopackIgnore: true*/ process.cwd(), 'runtime', 'external-api-logs'));
export const readWebApiLogs = store.list;
export const externalApi = createExternalApiLogger({
  write: store.write,
  secrets: () => Object.entries(process.env).filter(([key]) => /KEY|TOKEN|PASSWORD|SECRET/i.test(key)).map(([, value]) => value || ''),
  context: async () => {
    const incoming = await headers();
    return { userId: incoming.get('x-synlive-user-id'), route: incoming.get('x-synlive-request-path') };
  },
});
