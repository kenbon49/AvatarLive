import { randomUUID } from 'node:crypto';
import { ALIYUN_PUBLIC_VOICES } from '@/lib/aliyun-voice-catalog';
import { SCRIPT_EDITOR_LIMIT } from '@/lib/live-script-editor';
import { createAliyunAvatarVideo } from '@/lib/server/aliyun-avatar-video';
import { recordAliyunVideoOwner } from '@/lib/server/aliyun-task-ownership';
import { requireRequestUser } from '@/lib/server/user-context';
import { chargeApiUsage, markApiUsage } from '@/lib/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type CreateVideoPayload = {
  name?: unknown;
  text?: unknown;
  voiceKey?: unknown;
  avatarOfficialId?: unknown;
  aspectRatio?: unknown;
  speechRate?: unknown;
  pitchRate?: unknown;
};

export async function POST(request: Request) {
  let usageId = '';
  try {
    const user = requireRequestUser(request);
    const payload = await request.json() as CreateVideoPayload;
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    const voiceKey = typeof payload.voiceKey === 'string' ? payload.voiceKey.trim() : '';
    const avatarOfficialId = typeof payload.avatarOfficialId === 'string' ? payload.avatarOfficialId.trim() : '';
    if (text.length < 8 || text.length > SCRIPT_EDITOR_LIMIT) {
      return Response.json({ message: `口播文本长度必须在 8 到 ${SCRIPT_EDITOR_LIMIT} 个字符之间` }, { status: 400 });
    }
    const voice = ALIYUN_PUBLIC_VOICES.find((item) => item.id === voiceKey);
    if (!voice) return Response.json({ message: '请选择公共音色' }, { status: 400 });
    if (!avatarOfficialId) return Response.json({ message: '请选择阿里云公共数字人形象' }, { status: 400 });
    const speechRate = typeof payload.speechRate === 'number' ? payload.speechRate : 1.1;
    const pitchRate = typeof payload.pitchRate === 'number' ? payload.pitchRate : 3;
    if (!Number.isFinite(speechRate) || speechRate < 0.5 || speechRate > 2) {
      return Response.json({ message: '语速必须在 0.5x 到 2.0x 之间' }, { status: 400 });
    }
    if (!Number.isInteger(pitchRate) || pitchRate < 0 || pitchRate > 5) {
      return Response.json({ message: '语调必须是 0 到 5 之间的整数' }, { status: 400 });
    }
    const name = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 64)
      : `数字人口播-${new Date().toISOString().slice(0, 19)}`;
    const usage = await chargeApiUsage(request, 'storyboard_video', `storyboard:${randomUUID()}`, {
      source: 'aliyun_avatar_video',
      characters: text.length,
    });
    usageId = usage.usageId;
    const result = await createAliyunAvatarVideo({
      name,
      text,
      voiceKey: voice.id,
      voiceOfficialId: voice.officialId,
      avatarOfficialId,
      aspectRatio: payload.aspectRatio === '16:9' ? '16:9' : '9:16',
      speechRate,
      pitchRate,
    });
    await recordAliyunVideoOwner(result.id, user.id);
    await markApiUsage(request, usageId, 'succeeded');
    return Response.json({ video: result }, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    if (usageId) await markApiUsage(request, usageId, 'failed').catch(() => undefined);
    const message = cause instanceof Error ? cause.message : '透明数字人口播提交失败';
    return Response.json({ message }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
