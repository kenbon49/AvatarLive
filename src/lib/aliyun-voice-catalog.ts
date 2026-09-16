import catalog from '../data/aliyun-public-voices.json' with { type: 'json' };

export type AliyunVoiceLanguage = '中英文' | '英文' | '日文' | '韩文';

export type AliyunPublicVoice = {
  id: string;
  officialId: string;
  name: string;
  gender: '男性' | '女性';
  language: AliyunVoiceLanguage;
  description: string;
  supportSsml: boolean;
  sampleText: string;
  previewAudio: string;
};

export const ALIYUN_PUBLIC_VOICES = catalog as AliyunPublicVoice[];
