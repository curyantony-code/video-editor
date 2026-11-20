// A local stand-in for the Gateway's AI route, so the checks can see what
// the app does with a model's answer. Each prompt names its task.
const ANSWERS = {
  agent: { reply: 'Added a title card at the start.', operations: [
    { op: 'add_text', start: 0, duration: 45, text: 'Harbor Morning Walk', position: 'center' },
  ] },
  script_draft: { title: 'Harbor Morning Walk', scenes: [
    { heading: 'EXT. HARBOR - DAWN', action: 'Fishing boats rock at the pier as the sun comes up.', dialogue: 'NARRATOR: Every morning starts here.' },
    { heading: 'EXT. MARKET STREET - MORNING', action: 'Stalls open and the first customers arrive.', dialogue: 'NARRATOR: By seven, the street is awake.' },
  ] },
  scene_rewrite: { heading: 'EXT. HARBOR - SUNRISE', action: 'Gulls circle the boats while nets are hauled in.', dialogue: 'NARRATOR: The day begins before the town does.' },
  breakdown: { shots: [
    { scene: 1, description: 'Boats at the pier with the sun rising behind them', framing: 'wide', move: 'slow pan right', duration: 4 },
    { scene: 2, description: 'A vendor stacks oranges on a stall', framing: 'close-up', move: 'static', duration: 3 },
  ] },
  media_note: { note: 'Pier at sunrise with fishing boats moored in calm water.' },
};
const SOURCE = `const ANSWERS = ${JSON.stringify(ANSWERS)};
export default { async fetch(request) {
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/chat/completions')) {
    return Response.json({ code: 'integration_not_configured' }, { status: 503, headers: { 'x-everyapp-error': 'integration_not_configured' } });
  }
  const body = await request.json();
  const text = body.messages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\\n');
  const task = (text.match(/TASK:([a-z_]+)/) || [])[1];
  const answer = ANSWERS[task];
  if (!answer) return Response.json({ error: 'unknown task' }, { status: 400 });
  return Response.json({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }] });
} };`;

export const fakeAi = {
  workers: [{ config: { name: 'fake-ai', compatibilityDate: '2026-06-01', manifest: { mainModule: 'ai.mjs', modules: { 'ai.mjs': { type: 'esm', contents: Buffer.from(SOURCE) } } } } }],
  bindings: { EVERY_APP_GATEWAY: { type: 'worker', worker: 'fake-ai' } },
};
