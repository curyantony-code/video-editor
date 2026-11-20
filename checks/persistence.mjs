// Persistence: what was written survives a restart.
import { startRuntime, expect } from '/home/user/oss-new/control/runtime/index.mjs';
import { wav, createProject, uploadMedia } from './fixtures.mjs';

const runtime = await startRuntime();
try {
  let page = await (await runtime.context('owner')).newPage();
  const projectId = await createProject(page, 'Studio interview', { expect });
  const audio = wav(1);
  const up = await uploadMedia(runtime, 'owner', projectId, { name: 'interview.wav', mime: 'audio/wav', body: audio, kind: 'audio', duration: 1 });
  expect(up.status).toBe(201);
  const mediaId = (await up.json()).id;
  await page.goto(`/projects/${projectId}/script`);
  await page.getByTestId('script-title').fill('Studio interview');
  await page.getByTestId('add-scene').click();
  await page.getByTestId('scene').first().getByTestId('scene-heading').fill('INT. STUDIO - DAY');
  await page.getByTestId('save-script').click();
  await expect(page.getByTestId('script-saved')).toBeVisible();
  // With no AI provider, AI help shows its off state and manual writing goes on.
  await page.getByTestId('script-brief').fill('A short interview');
  await page.getByTestId('draft-script').click();
  await expect(page.getByTestId('ai-off')).toBeVisible();
  await page.goto(`/projects/${projectId}`);
  await page.getByTestId('bin-item').filter({ hasText: 'interview.wav' }).getByTestId('add-to-timeline').click();
  await expect(page.getByTestId('revision')).toHaveText('Revision 1');

  await runtime.restart();

  page = await (await runtime.context('owner')).newPage();
  await page.goto('/');
  await expect(page.getByTestId('project-card').filter({ hasText: 'Studio interview' })).toBeVisible();
  await page.goto(`/projects/${projectId}/script`);
  await expect(page.getByTestId('scene').first().getByTestId('scene-heading')).toHaveValue('INT. STUDIO - DAY');
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByTestId('revision')).toHaveText('Revision 1');
  await expect(page.locator('[data-testid="clip"][data-kind="audio"]')).toHaveCount(1);
  const file = await runtime.fetch(`/api/media/${mediaId}`, { role: 'owner' });
  expect(file.status).toBe(200);
  expect(Buffer.from(await file.arrayBuffer()).equals(audio)).toBe(true);
  console.log('persistence: ok');
} finally {
  await runtime.close();
}
