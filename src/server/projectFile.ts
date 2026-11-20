// Editable project files: OpenTimelineIO JSON and FCP7 XML. Media is
// referenced by file name, as it sits beside the file in the zip.
import type { Timeline } from "@/lib/timeline";

interface FileMedia {
  id: string;
  name: string;
  kind: string;
  duration: number | null;
  width: number | null;
  height: number | null;
}

const rt = (value: number, rate: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start: number, duration: number, rate: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(duration, rate) });

export function toOtio(title: string, fps: number, timeline: Timeline, media: FileMedia[]) {
  const byId = new Map(media.map((m) => [m.id, m]));
  const tracks = timeline.tracks.map((track) => {
    const children: unknown[] = [];
    let cursor = 0;
    for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
      if (clip.start > cursor) children.push({ OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, clip.start - cursor, fps), metadata: {} });
      const m = clip.mediaId ? byId.get(clip.mediaId) : undefined;
      children.push({
        OTIO_SCHEMA: "Clip.2",
        name: m ? m.name : clip.text,
        source_range: range(clip.in, clip.duration, fps),
        media_references: {
          DEFAULT_MEDIA: m
            ? { OTIO_SCHEMA: "ExternalReference.1", target_url: `media/${m.name}`, available_range: m.duration ? range(0, Math.round(m.duration * fps), fps) : null, metadata: {} }
            : { OTIO_SCHEMA: "GeneratorReference.1", generator_kind: "text", parameters: { text: clip.text, position: clip.position }, metadata: {} },
        },
        active_media_reference_key: "DEFAULT_MEDIA",
        metadata: { volume: clip.volume },
      });
      cursor = clip.start + clip.duration;
    }
    return { OTIO_SCHEMA: "Track.1", name: track.name, kind: track.kind === "audio" ? "Audio" : "Video", children, metadata: { kind: track.kind } };
  });
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: title,
    global_start_time: rt(0, fps),
    tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", children: tracks, metadata: {} },
    metadata: {},
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toFcp7Xml(title: string, fps: number, aspect: string, timeline: Timeline, media: FileMedia[]) {
  const byId = new Map(media.map((m) => [m.id, m]));
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const [w, h] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];
  const seen = new Set<string>();
  let n = 0;
  const item = (clip: Timeline["tracks"][number]["clips"][number]) => {
    n++;
    const m = clip.mediaId ? byId.get(clip.mediaId) : undefined;
    const common = `<start>${clip.start}</start><end>${clip.start + clip.duration}</end><in>${clip.in}</in><out>${clip.in + clip.duration}</out>${rate}`;
    if (!m) {
      return `<generatoritem id="text-${n}"><name>${esc(clip.text)}</name>${common}<effect><name>Text</name><effectid>Text</effectid><effectcategory>Text</effectcategory><effecttype>generator</effecttype><mediatype>video</mediatype><parameter><parameterid>str</parameterid><name>Text</name><value>${esc(clip.text)}</value></parameter></effect></generatoritem>`;
    }
    const file = seen.has(m.id)
      ? `<file id="file-${m.id}"/>`
      : `<file id="file-${m.id}"><name>${esc(m.name)}</name><pathurl>media/${encodeURIComponent(m.name)}</pathurl>${rate}${m.duration ? `<duration>${Math.round(m.duration * fps)}</duration>` : ""}</file>`;
    seen.add(m.id);
    const level = clip.volume !== 1 ? `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><parameter><parameterid>level</parameterid><value>${clip.volume}</value></parameter></effect></filter>` : "";
    return `<clipitem id="clip-${n}"><name>${esc(m.name)}</name>${common}${file}${level}</clipitem>`;
  };
  const video = timeline.tracks.filter((t) => t.kind !== "audio").reverse();
  const audio = timeline.tracks.filter((t) => t.kind === "audio");
  const track = (t: Timeline["tracks"][number]) => `<track>${t.clips.map(item).join("")}</track>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5"><sequence id="sequence-1"><name>${esc(title)}</name>${rate}<media><video><format><samplecharacteristics><width>${w}</width><height>${h}</height></samplecharacteristics></format>${video.map(track).join("")}</video><audio>${audio.map(track).join("")}</audio></media></sequence></xmeml>
`;
}
