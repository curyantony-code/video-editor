import { describe, expect, it } from "vitest";
import { applyOperations, timelineProblem, type MediaInfo } from "./timeline";

const media: MediaInfo[] = [
  { id: "m1", name: "boats.mp4", kind: "video", duration: 2 },
  { id: "m2", name: "gulls.wav", kind: "audio", duration: 1 },
];

describe("timeline rules", () => {
  it("adds clips end to end and keeps them inside the file", () => {
    const t = applyOperations({ tracks: [] }, [
      { op: "add_clip", mediaId: "m1" },
      { op: "add_clip", mediaId: "m1" },
      { op: "add_clip", mediaId: "m2" },
    ], media, 30);
    expect(t.tracks.map((x) => x.kind)).toEqual(["video", "audio"]);
    expect(t.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 60]);
    expect(timelineProblem(t, media, 30)).toBeNull();
  });

  it("refuses overlaps and clips past the media's end", () => {
    const t = applyOperations({ tracks: [] }, [{ op: "add_clip", mediaId: "m1" }, { op: "add_clip", mediaId: "m1" }], media, 30);
    const overlap = applyOperations(t, [{ op: "move_clip", clipId: t.tracks[0]!.clips[1]!.id, start: 30 }], media, 30);
    expect(timelineProblem(overlap, media, 30)).toMatch(/overlap/);
    const long = applyOperations(t, [{ op: "trim_clip", clipId: t.tracks[0]!.clips[0]!.id, duration: 90 }], media, 30);
    expect(timelineProblem(long, media, 30)).toMatch(/past the end/);
  });

  it("splits a clip into two that keep their source points", () => {
    const t = applyOperations({ tracks: [] }, [{ op: "add_clip", mediaId: "m1" }], media, 30);
    const s = applyOperations(t, [{ op: "split_clip", clipId: t.tracks[0]!.clips[0]!.id, at: 20 }], media, 30);
    expect(s.tracks[0]!.clips.map((c) => [c.start, c.in, c.duration])).toEqual([[0, 0, 20], [20, 20, 40]]);
    expect(timelineProblem(s, media, 30)).toBeNull();
  });

  it("refuses media from elsewhere", () => {
    expect(() => applyOperations({ tracks: [] }, [{ op: "add_clip", mediaId: "other" }], media, 30)).toThrow();
  });
});
