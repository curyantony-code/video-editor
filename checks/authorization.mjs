// Authorization: who may reach what.
import { startRuntime, expect } from '/home/user/oss-new/control/runtime/index.mjs';
import { png, emailOf, createProject, uploadMedia } from './fixtures.mjs';

const step = (name) => console.log(`- ${name}`);
const runtime = await startRuntime();
try {
  step('private paths refuse anonymous and outsider');
  await runtime.assertPrivateAccess(['/', '/health']);

  const owner = await (await runtime.context('owner')).newPage();
  const member = await (await runtime.context('member')).newPage();
  const memberEmail = await emailOf(runtime, 'member');
  const projectId = await createProject(owner, 'Quarterly recap', { expect });
  const up = await uploadMedia(runtime, 'owner', projectId, { name: 'still.png', mime: 'image/png', body: png(32, 18), kind: 'image', width: 32, height: 18 });
  expect(up.status).toBe(201);
  const mediaId = (await up.json()).id;

  step('private API routes refuse anonymous and outsider');
  for (const role of [undefined, 'outsider']) {
    for (const p of [`/api/media/${mediaId}`, `/api/projects/${projectId}/timeline.otio`, `/api/rooms/${projectId}`]) {
      const res = await runtime.fetch(p, role ? { role } : {});
      expect([401, 403, 302]).toContain(res.status);
    }
  }

  step('a member cannot read or change another member\'s project');
  expect((await runtime.fetch(`/api/media/${mediaId}`, { role: 'member' })).status).toBe(404);
  expect((await runtime.fetch(`/api/projects/${projectId}/timeline.otio`, { role: 'member' })).status).toBe(404);
  expect((await runtime.fetch(`/api/projects/${projectId}/timeline.xml`, { role: 'member' })).status).toBe(404);
  expect((await uploadMedia(runtime, 'member', projectId, { name: 'x.png', mime: 'image/png', body: png(8, 8), kind: 'image' })).status).toBe(404);
  expect((await runtime.fetch(`/api/projects/${projectId}/exports?duration=1`, { role: 'member', method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('x') })).status).toBe(404);
  expect((await runtime.fetch(`/api/rooms/${projectId}`, { role: 'member' })).status).toBe(404);
  await member.goto('/');
  await expect(member.getByTestId('project-card')).toHaveCount(0);
  await member.goto(`/projects/${projectId}`);
  await expect(member.getByTestId('not-found')).toBeVisible();
  await member.goto(`/projects/${projectId}/media`);
  await expect(member.getByTestId('not-found')).toBeVisible();

  step('uploads are limited to media types');
  const bad = await runtime.fetch(`/api/projects/${projectId}/media?name=run.sh&kind=video`, { role: 'owner', method: 'PUT', headers: { 'content-type': 'application/x-sh' }, body: Buffer.from('echo') });
  expect(bad.status).toBe(415);

  step('a viewer reads but cannot change');
  await owner.goto(`/projects/${projectId}/settings`);
  await owner.getByTestId('share-email').fill(memberEmail);
  await owner.getByTestId('share-role').click();
  await owner.getByRole('option', { name: 'Viewer' }).click();
  await owner.getByTestId('share-add').click();
  await expect(owner.getByTestId('share-member').filter({ hasText: memberEmail })).toContainText('Viewer');
  expect((await runtime.fetch(`/api/media/${mediaId}`, { role: 'member' })).status).toBe(200);
  expect((await uploadMedia(runtime, 'member', projectId, { name: 'x.png', mime: 'image/png', body: png(8, 8), kind: 'image' })).status).toBe(403);
  await member.goto(`/projects/${projectId}`);
  await expect(member.getByTestId('read-only')).toBeVisible();
  await expect(member.getByTestId('add-track-video')).toHaveCount(0);
  await expect(member.getByTestId('agent-input')).toHaveCount(0);
  await member.goto(`/projects/${projectId}/settings`);
  await expect(member.getByTestId('share-add')).toHaveCount(0);
  await expect(member.getByTestId('delete-project')).toHaveCount(0);
  await expect(member.getByTestId('create-review-link')).toHaveCount(0);

  step('removing a share takes access away');
  await owner.goto(`/projects/${projectId}/settings`);
  await owner.getByTestId('share-member').filter({ hasText: memberEmail }).getByTestId('member-remove').click();
  await expect(owner.getByTestId('share-member')).toHaveCount(0);
  expect((await runtime.fetch(`/api/media/${mediaId}`, { role: 'member' })).status).toBe(404);

  step('admin-only moderation');
  const memberProject = await createProject(member, 'Member draft cut', { expect });
  await member.goto('/');
  await expect(member.getByTestId('org-projects')).toHaveCount(0);
  await owner.goto('/');
  await expect(owner.getByTestId('project-card').filter({ hasText: 'Member draft cut' })).toHaveCount(0);
  const row = owner.getByTestId('org-project-row').filter({ hasText: 'Member draft cut' });
  await expect(row).toBeVisible();
  await row.getByTestId('org-project-delete').click();
  await owner.getByRole('button', { name: 'Delete project' }).click();
  await expect(owner.getByTestId('org-project-row').filter({ hasText: 'Member draft cut' })).toHaveCount(0);
  await member.goto(`/projects/${memberProject}`);
  await expect(member.getByTestId('not-found')).toBeVisible();

  step('review links expose only the project\'s export and review comments');
  expect((await runtime.fetch('/r/0123456789abcdef0123456789abcdef')).status).toBe(404);
  await owner.goto(`/projects/${projectId}/settings`);
  await owner.getByTestId('create-review-link').click();
  const reviewPath = new URL(await owner.getByTestId('review-link').textContent()).pathname;
  const pageRes = await runtime.fetch(reviewPath);
  expect(pageRes.status).toBe(200);
  const html = await pageRes.text();
  expect(html).toContain('Quarterly recap');
  expect(html).not.toContain('still.png');
  expect(html).not.toContain(memberEmail);
  expect((await runtime.fetch(`${reviewPath}/video`)).status).toBe(404);
  const long = await runtime.fetch(`${reviewPath}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'A', body: 'x'.repeat(5000), time: 0 }) });
  expect(long.status).toBe(400);
  const ok = await runtime.fetch(`${reviewPath}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sam', body: 'Looks good', time: 1.5 }) });
  expect(ok.status).toBe(201);
  expect((await runtime.fetch(`/api/media/${mediaId}`)).status).not.toBe(200);
  await owner.getByTestId('revoke-review-link').click();
  await expect(owner.getByTestId('review-link')).toHaveCount(0);
  expect((await runtime.fetch(reviewPath)).status).toBe(404);
  expect((await runtime.fetch(`${reviewPath}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sam', body: 'Again', time: 0 }) })).status).toBe(404);
  const anon = await (await runtime.context(null)).newPage();
  await anon.goto(reviewPath);
  await expect(anon.getByTestId('not-found')).toBeVisible();

  step('no sign-in page of the app\'s own');
  for (const p of ['/login', '/signin', '/signup', '/logout']) {
    expect((await runtime.fetch(p, { role: 'owner' })).status).toBe(404);
  }
  console.log('authorization: ok');
} finally {
  await runtime.close();
}
