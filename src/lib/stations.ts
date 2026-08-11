// The radio dial.
//
// Two kinds of entry:
//   - `stream` present  → plays inside the app through one shared <audio>
//   - `stream` absent   → link-out only, because there's no open stream to point
//                         at (BBC Sounds extensions, web-player-only services)
//
// `kind: "hls"` means an .m3u8 playlist: Safari and iOS play those natively,
// Chrome and Electron need hls.js, which radio.ts lazy-loads on first use.
// Every stream URL below was checked for CORS `*` — hls.js fetches segments
// with XHR, so a stream without it would fail in the desktop app while working
// fine in Safari.

export type StationStream = {
  url: string;
  kind: "direct" | "hls";
};

export type Station = {
  id: string;
  name: string;
  // One line, shown under the name. Says what you're tuning into, not marketing.
  note: string;
  group: "dial" | "more";
  stream?: StationStream;
  // Where to send the browser: the fallback when there's no stream, and the
  // "open the real site" escape hatch when there is.
  homepage: string;
};

const BBC_HLS = (id: string) =>
  `https://as-hls-ww-live.akamaized.net/pool_81827798/live/ww/${id}/${id}.isml/${id}-audio%3d128000.norewind.m3u8`;

const RTS_HLS = (id: string) =>
  `https://rtsradio-live.morescreens.com/${id}/playlist.m3u8`;

export const STATIONS: Station[] = [
  {
    id: "kexp",
    name: "KEXP",
    note: "Seattle · 90.3 FM",
    group: "dial",
    stream: { url: "https://kexp.streamguys1.com/kexp160.aac", kind: "direct" },
    homepage: "https://www.kexp.org/listen/",
  },
  {
    id: "bbc6",
    name: "BBC 6 Music",
    note: "Alternative · UK",
    group: "dial",
    stream: { url: BBC_HLS("bbc_6music"), kind: "hls" },
    homepage: "https://www.bbc.co.uk/sounds/play/live:bbc_6music",
  },
  {
    id: "bbc6-indie",
    name: "6 Music Indie Forever",
    note: "Indie, 80s to now · BBC Sounds",
    group: "dial",
    // No open stream: this one is a Sounds-exclusive extension, and the BBC's
    // stream lookup returns "selectionunavailable" for it. Link-out it is.
    homepage: "https://www.bbc.co.uk/sounds/play/live:bbc_radio_six_indie_forever",
  },
  {
    id: "rb1",
    name: "Radio Beograd 1",
    note: "RTS · speech and culture",
    group: "dial",
    stream: { url: RTS_HLS("RTS_2_001"), kind: "hls" },
    homepage: "https://rtsplaneta.rs/live/radio/15918/radio-beograd-1",
  },
  {
    id: "rb2",
    name: "Radio Beograd 2",
    note: "RTS · arts and classical",
    group: "dial",
    stream: { url: RTS_HLS("RTS_2_002"), kind: "hls" },
    homepage: "https://rtsplaneta.rs/live/radio/16086/radio-beograd-2",
  },
  {
    id: "doble-nueve",
    name: "Doble Nueve",
    note: "Lima · rock and indie",
    group: "dial",
    stream: { url: "https://conectperu.com:7000/stream", kind: "direct" },
    homepage: "https://doblenuevelive.com/",
  },
  {
    id: "freelance-radio",
    name: "Freelance Radio",
    note: "Focus music · web player",
    group: "dial",
    homepage: "https://www.freelancerad.io/",
  },

  // Suggestions. Delete any line here and it's gone — nothing else refers to them.
  {
    id: "fip",
    name: "FIP",
    note: "Paris · eclectic, barely any talking",
    group: "more",
    stream: { url: "https://icecast.radiofrance.fr/fip-midfi.mp3", kind: "direct" },
    homepage: "https://www.radiofrance.fr/fip",
  },
  {
    id: "nts1",
    name: "NTS 1",
    note: "London · leftfield, KEXP-adjacent",
    group: "more",
    stream: { url: "https://stream-relay-geo.ntslive.net/stream", kind: "direct" },
    homepage: "https://www.nts.live/",
  },
  {
    id: "soma-groove",
    name: "Groove Salad",
    note: "SomaFM · instrumental",
    group: "more",
    // No in-app stream on purpose: SomaFM's Icecast servers 403 any request
    // carrying an Origin header, which is how they turn away third-party web
    // players. Their own player is the way in.
    homepage: "https://somafm.com/groovesalad/",
  },
  {
    id: "rp-mellow",
    name: "Radio Paradise Mellow",
    note: "Hand-picked, low-key",
    group: "more",
    stream: { url: "https://stream.radioparadise.com/mellow-128", kind: "direct" },
    homepage: "https://radioparadise.com/player",
  },
];

export function findStation(id: string | null): Station | null {
  if (!id) return null;
  return STATIONS.find((s) => s.id === id) ?? null;
}
