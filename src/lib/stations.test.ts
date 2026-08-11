import { describe, expect, it } from "vitest";
import { STATIONS, findStation } from "./stations";

// The dial is hand-edited config, so these are the invariants that would bite
// silently: a duplicated id makes two rows highlight as one, a mislabelled
// `kind` sends an .m3u8 into a plain <audio> (silence on Chrome, fine on
// Safari — the nastiest kind of bug to notice), and an http:// URL is blocked
// as mixed content on the deployed https site.
describe("station registry", () => {
  it("has unique ids", () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every station a name, a note and a homepage", () => {
    for (const s of STATIONS) {
      expect(s.name.length, s.id).toBeGreaterThan(0);
      expect(s.note.length, s.id).toBeGreaterThan(0);
      expect(s.homepage, s.id).toMatch(/^https:\/\//);
    }
  });

  it("uses https for every stream, so nothing is blocked as mixed content", () => {
    for (const s of STATIONS) {
      if (s.stream) expect(s.stream.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it("labels m3u8 playlists as hls and nothing else", () => {
    for (const s of STATIONS) {
      if (!s.stream) continue;
      const looksLikeHls = s.stream.url.includes(".m3u8");
      expect(s.stream.kind === "hls", `${s.id} kind vs url`).toBe(looksLikeHls);
    }
  });

  it("finds stations by id and shrugs at anything else", () => {
    expect(findStation("kexp")?.name).toBe("KEXP");
    expect(findStation("nope")).toBeNull();
    expect(findStation(null)).toBeNull();
  });
});
