import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { requireRequestUser } from '@/lib/server/user-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exec = promisify(execFile);
const ROOT = process.cwd();
const REPOSITORY = process.env.UPDATE_GITHUB_REPOSITORY || 'kenbon49/AvatarLive';

async function git(...args: string[]) {
  const result = await exec('git', args, { cwd: ROOT, timeout: 10_000, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

async function updateState() {
  try {
    const raw = await readFile(path.join(ROOT, '.system-update', 'state.json'), 'utf8');
    return JSON.parse(raw) as { status?: string; message?: string; version?: string; updatedAt?: string };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const user = requireRequestUser(request);
    const packageInfo = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as { version?: string };
    const [commit, branch] = await Promise.all([
      git('rev-parse', 'HEAD'),
      git('branch', '--show-current'),
    ]);
    const updateBranch = process.env.UPDATE_BRANCH || branch || 'feat/avatar-design';
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/${encodeURIComponent(updateBranch)}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AvatarLive-Updater' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`远程版本服务返回 HTTP ${response.status}`);
    const latest = await response.json() as {
      sha?: string;
      html_url?: string;
      commit?: { message?: string; committer?: { date?: string } };
    };
    if (!latest.sha) throw new Error('远程版本服务没有返回版本号');
    const currentVersion = packageInfo.version || '0.0.0';
    let latestVersion = currentVersion;
    try {
      const packageResponse = await fetch(
        `https://raw.githubusercontent.com/${REPOSITORY}/${latest.sha}/package.json`,
        { cache: 'no-store', signal: AbortSignal.timeout(5000) },
      );
      if (packageResponse.ok) {
        const remotePackage = await packageResponse.json() as { version?: string };
        if (remotePackage.version) latestVersion = remotePackage.version;
      }
    } catch {
      // The commit identifier still provides an exact version when raw content is unavailable.
    }
    return Response.json({
      currentVersion: `${currentVersion}+${commit.slice(0, 7)}`,
      latestVersion: `${latestVersion}+${latest.sha.slice(0, 7)}`,
      currentCommit: commit,
      latestCommit: latest.sha,
      branch: updateBranch,
      updateAvailable: commit !== latest.sha,
      canManage: user.role === 'admin',
      latestMessage: latest.commit?.message?.split('\n')[0] || '',
      latestPublishedAt: latest.commit?.committer?.date || null,
      updateState: await updateState(),
      checkedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    return Response.json(
      { message: cause instanceof Error ? cause.message : '版本检测失败' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
