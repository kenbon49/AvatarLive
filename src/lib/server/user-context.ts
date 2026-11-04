import 'server-only';

export function requireRequestUser(request: Request) {
  const id = request.headers.get('x-synlive-user-id');
  const role = request.headers.get('x-synlive-user-role');
  if (!id || !/^[a-f0-9-]{36}$/.test(id) || !['admin', 'user'].includes(role || '')) {
    throw new Error('用户身份无效');
  }
  return { id, role: role as 'admin' | 'user' };
}
