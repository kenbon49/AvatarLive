import 'server-only';

import path from 'node:path';

import { ALIYUN_PUBLIC_VOICES } from '@/lib/aliyun-voice-catalog';
import { createBailianTtsClient } from './bailian-tts-client';

export { BailianTtsError } from './bailian-tts-client';

export const bailianTts = createBailianTtsClient({
  apiKey: process.env.BAILIAN_TTS_API_KEY || '',
  runtimeDirectory: path.join(/*turbopackIgnore: true*/ process.cwd(), 'runtime', 'bailian-tts'),
  publicDirectory: path.join(/*turbopackIgnore: true*/ process.cwd(), 'public'),
  voices: ALIYUN_PUBLIC_VOICES,
});
