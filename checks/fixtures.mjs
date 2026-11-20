// Small media files generated on the fly, so the checks carry no binary.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A PNG with a sky-to-sea gradient, width × height. */
export function png(width = 640, height = 360) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const t = y / height;
      row[1 + x * 3] = Math.round(240 - 200 * t);
      row[2 + x * 3] = Math.round(170 - 60 * t + (x % 64 < 2 ? 40 : 0));
      row[3 + x * 3] = Math.round(120 + 100 * t);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A mono 16-bit WAV tone of `seconds`. */
export function wav(seconds = 2, rate = 22050) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 330) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** The email the Gateway signs a role in with. */
export async function emailOf(runtime, role) {
  const res = await runtime.fetch('/health', { role });
  const body = await res.json();
  return body.user;
}

/** Creates a project through the page and returns its id. */
export async function createProject(page, title, { expect }) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-title').fill(title);
  await Promise.all([
    page.waitForURL(/\/projects\/[0-9a-f-]{36}/),
    page.getByTestId('create-project').click(),
  ]);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return page.url().match(/\/projects\/([0-9a-f-]{36})/)[1];
}

/** Uploads a file to a project through the media route, as the page does. */
export async function uploadMedia(runtime, role, projectId, { name, mime, body, kind, duration = '', width = '', height = '' }) {
  const q = new URLSearchParams({ name, kind, duration: String(duration), width: String(width), height: String(height) });
  return runtime.fetch(`/api/projects/${projectId}/media?${q}`, {
    role, method: 'PUT', headers: { 'content-type': mime }, body,
  });
}
