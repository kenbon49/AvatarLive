import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exec = promisify(execFile);
const uid = process.getuid?.();
const serviceEnvironment = uid === undefined ? process.env : {
  ...process.env,
  XDG_RUNTIME_DIR: `/run/user/${uid}`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
};

export async function POST(request: Request) {
  try {
    const user = requireRequestUser(request);
    if (user.role !== 'admin') {
      return Response.json({ message: '仅管理员可以执行系统更新' }, { status: 403 });
    }
    const script = path.join(process.cwd(), 'scripts', 'apply-system-update.sh');
    await exec('systemctl', ['--user', 'reset-failed', 'avatarlive-auto-update.service'], {
      timeout: 5000,
      env: serviceEnvironment,
    }).catch(() => undefined);
    await exec('systemd-run', [
      '--user', '--unit=avatarlive-auto-update', '--collect', '--property=TimeoutStartSec=30min', script,
    ], { timeout: 10_000, env: serviceEnvironment });
    return Response.json(
      { status: 'started', message: '系统更新已启动，完成后会重启服务' },
      { status: 202, headers: { 'cache-control': 'no-store' } },
    );
  } catch (cause) {
    return Response.json(
      { message: cause instanceof Error ? cause.message : '无法启动系统更新' },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }
}
