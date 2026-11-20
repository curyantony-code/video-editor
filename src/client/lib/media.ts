// Browser-side media work: measuring a file before upload, uploading it,
// and sampling frames for a note.

export type Kind = "video" | "audio" | "image";

export function kindOf(file: File): Kind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

interface Measured {
  duration?: number;
  width?: number;
  height?: number;
}

export function measure(file: File, kind: Kind): Promise<Measured> {
  const url = URL.createObjectURL(file);
  return new Promise<Measured>((resolve) => {
    const done = (m: Measured) => {
      URL.revokeObjectURL(url);
      resolve(m);
    };
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
      return;
    }
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const m: Measured = { duration: Number.isFinite(el.duration) ? el.duration : undefined };
      if (el instanceof HTMLVideoElement) Object.assign(m, { width: el.videoWidth || undefined, height: el.videoHeight || undefined });
      done(m);
    };
    el.onerror = () => done({});
    el.src = url;
  });
}

export async function uploadFile(projectId: string, file: File): Promise<void> {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name} isn't a video, audio or image file.`);
  const m = await measure(file, kind);
  const q = new URLSearchParams({ name: file.name, kind });
  if (m.duration) q.set("duration", String(m.duration));
  if (m.width) q.set("width", String(m.width));
  if (m.height) q.set("height", String(m.height));
  const res = await fetch(`/api/projects/${projectId}/media?${q}`, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${file.name} couldn't be uploaded.`);
  }
}

/** Up to `count` JPEG frames from a video or image, as data URLs. */
export async function sampleFrames(src: string, kind: string, count = 4): Promise<string[]> {
  const canvas = document.createElement("canvas");
  const draw = (source: CanvasImageSource, w: number, h: number) => {
    const scale = Math.min(1, 512 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  };
  if (kind === "image") {
    const img = new Image();
    img.src = src;
    await img.decode();
    return [draw(img, img.naturalWidth, img.naturalHeight)];
  }
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = src;
  await new Promise((r, j) => {
    video.onloadeddata = r;
    video.onerror = () => j(new Error("The video couldn't be read."));
  });
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    video.currentTime = (video.duration * (i + 0.5)) / count;
    await new Promise((r) => (video.onseeked = r));
    frames.push(draw(video, video.videoWidth, video.videoHeight));
  }
  return frames;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
