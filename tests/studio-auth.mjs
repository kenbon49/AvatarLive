import assert from 'node:assert/strict';

export async function loginStudio(context, baseUrl) {
  const session = process.env.LIVE_STUDIO_TEST_SESSION;
  if (session) {
    await context.addCookies([{ name: 'synlive_session', value: session, url: baseUrl }]);
    return;
  }
  const email = process.env.LIVE_STUDIO_TEST_EMAIL;
  const password = process.env.LIVE_STUDIO_TEST_PASSWORD;
  assert.ok(email && password, 'Set LIVE_STUDIO_TEST_EMAIL and LIVE_STUDIO_TEST_PASSWORD for an approved test account');
  const response = await context.request.post(`${baseUrl}/api/v1/auth/login`, {
    data: { email, password },
  });
  assert.equal(response.ok(), true, `Test login failed: HTTP ${response.status()}`);
}

export async function firstStudioRoom(context, baseUrl) {
  const response = await context.request.get(`${baseUrl}/api/v1/live-rooms?limit=1`);
  assert.equal(response.ok(), true, `Authenticated room fixture request failed: HTTP ${response.status()}`);
  const [room] = await response.json();
  assert.ok(room, 'The test account needs at least one existing room fixture');
  return room;
}
