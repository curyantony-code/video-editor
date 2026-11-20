// Renders the timeline to an MP4 in the browser: frames are drawn on a
// canvas and encoded as H.264, the audio is mixed offline.
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";
import { timelineFrames, type Clip, type Timeline } from "@/lib/timeline";

interface RenderMedia {
  id: string;
  kind: string;
}

export function outputSize(aspect: string): [number, number] {
  if (aspect === "9:16") return [720, 1280];
  if (aspect === "1:1") return [1080, 1080];
  return [1280, 720];
}

const SAMPLE_RATE = 48000;

export async function renderMp4(
  { timeline, media, aspect, fps }: { timeline: Timeline; media: RenderMedia[]; aspect: string; fps: number },
  onProgress: (fraction: number) => void,
): Promise<{ blob: Blob; duration: number }> {
  const frames = timelineFrames(timeline);
  if (frames === 0) throw new Error("The timeline is empty.");
  const duration = frames / fps;
  const [width, height] = outputSize(aspect);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const byId = new Map(media.map((m) => [m.id, m]));

  // Load each visual file once.
  const images = new Map<string, ImageBitmap>();
  const videos = new Map<string, HTMLVideoElement>();
  for (const track of timeline.tracks) {
    if (track.kind !== "video") continue;
    for (const clip of track.clips) {
      const m = clip.mediaId ? byId.get(clip.mediaId) : undefined;
      if (!m || images.has(m.id) || videos.has(m.id)) continue;
      if (m.kind === "image") images.set(m.id, await createImageBitmap(await (await fetch(`/api/media/${m.id}`)).blob()));
      else videos.set(m.id, await loadVideo(`/api/media/${m.id}`));
    }
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const at = (clips: Clip[], f: number) => clips.find((c) => f >= c.start && f < c.start + c.duration);
  for (let f = 0; f < frames; f++) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    // The topmost video track with a clip at this frame shows.
    for (const track of timeline.tracks) {
      if (track.kind !== "video") continue;
      const clip = at(track.clips, f);
      if (!clip?.mediaId) continue;
      const source: CanvasImageSource | undefined = images.get(clip.mediaId) ?? (await seek(videos.get(clip.mediaId), (clip.in + f - clip.start) / fps));
      if (source) drawContained(ctx, source, width, height);
      break;
    }
    for (const track of [...timeline.tracks].reverse()) {
      if (track.kind !== "text") continue;
      const clip = at(track.clips, f);
      if (clip?.text) drawText(ctx, clip.text, clip.position, width, height);
    }
    await video.add(f / fps, 1 / fps);
    if (f % 10 === 0) onProgress((f / frames) * 0.9);
  }
  video.close();

  if (audio) {
    await audio.add(await mixAudio(timeline, byId, fps, duration));
    audio.close();
  }
  await output.finalize();
  onProgress(1);
  for (const v of videos.values()) v.removeAttribute("src");
  return { blob: new Blob([output.target.buffer!], { type: "video/mp4" }), duration };
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = src;
  return new Promise((resolve, reject) => {
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("A video on the timeline couldn't be read."));
  });
}

async function seek(v: HTMLVideoElement | undefined, time: number) {
  if (!v) return undefined;
  if (Math.abs(v.currentTime - time) > 0.001) {
    const done = new Promise((r) => (v.onseeked = r));
    v.currentTime = Math.min(time, Math.max(0, v.duration - 0.001));
    await done;
  }
  return v;
}

function drawContained(ctx: OffscreenCanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number) {
  const sw = "videoWidth" in source ? source.videoWidth : (source as ImageBitmap).width;
  const sh = "videoHeight" in source ? source.videoHeight : (source as ImageBitmap).height;
  const scale = Math.min(width / sw, height / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
}

function drawText(ctx: OffscreenCanvasRenderingContext2D, text: string, position: string, width: number, height: number) {
  const size = Math.round(height / 14);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const y = position === "top" ? size * 1.5 : position === "bottom" ? height - size * 1.5 : height / 2;
  ctx.lineWidth = Math.max(2, size / 8);
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(text, width / 2, y, width * 0.9);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, width / 2, y, width * 0.9);
}

async function mixAudio(timeline: Timeline, byId: Map<string, RenderMedia>, fps: number, duration: number) {
  const offline = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  for (const track of timeline.tracks) {
    if (track.kind === "text") continue;
    for (const clip of track.clips) {
      const m = clip.mediaId ? byId.get(clip.mediaId) : undefined;
      if (!m || m.kind === "image") continue;
      if (!decoded.has(m.id)) {
        const bytes = await (await fetch(`/api/media/${m.id}`)).arrayBuffer();
        decoded.set(m.id, await offline.decodeAudioData(bytes).catch(() => null));
      }
      const buffer = decoded.get(m.id);
      if (!buffer) continue;
      const source = offline.createBufferSource();
      source.buffer = buffer;
      const gain = offline.createGain();
      gain.gain.value = clip.volume;
      source.connect(gain).connect(offline.destination);
      source.start(clip.start / fps, clip.in / fps, clip.duration / fps);
    }
  }
  return offline.startRendering();
}
