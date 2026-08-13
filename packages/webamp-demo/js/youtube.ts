// YouTube playlist support for the demo.
//
// YouTube provides no way to obtain a raw audio stream that we're permitted to
// use, so the audio you hear always comes from YouTube's own IFrame player.
// That leaves Webamp with nothing to feed its audio graph, which is a problem:
// Webamp's transport, timer and seek bar are all driven by a real <audio>
// element, and a broken source is treated as "track ended" (see
// media/elementSource.ts), which would make every track skip instantly.
//
// So each YouTube track is backed by a single shared *silent* audio file.
// Webamp plays silence while YouTube produces the sound, and `YouTubeBridge`
// below keeps the two in sync. Track durations are corrected in Redux state
// once YouTube reports the real length.

import WebampLazy from "../../webamp/js/webampLazy";
import { Track } from "../../webamp/js/types";

// Browsers reject 1000Hz WAVs (MEDIA_ERR_SRC_NOT_SUPPORTED); 4000Hz decodes
// fine and keeps the shared file down to a few megabytes.
const SILENT_SAMPLE_RATE = 4000;
// Longer than any track we expect. Tracks that somehow run longer will stop
// early in Webamp, though YouTube's own "ended" event still advances us.
const SILENT_SECONDS = 20 * 60;

const OEMBED_URL = "https://www.youtube.com/oembed";
const IFRAME_API_URL = "https://www.youtube.com/iframe_api";

// How many oEmbed lookups to have in flight at once.
const TITLE_CONCURRENCY = 8;

export interface YouTubeTrack {
  videoId: string;
  title: string;
  author: string;
}

/**
 * Pull the playlist id out of a YouTube or YouTube Music URL. Also accepts a
 * bare playlist id.
 */
export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname)) {
      return null;
    }
    const list = url.searchParams.get("list");
    if (list != null && list !== "") {
      return list;
    }
    return null;
  } catch (_e) {
    // Not a URL. Treat it as a bare playlist id if it looks like one.
    return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null;
  }
}

let silentUrl: string | null = null;

/**
 * A single silent WAV, shared by every YouTube track. Generated once.
 */
export function getSilentAudioUrl(): string {
  if (silentUrl != null) {
    return silentUrl;
  }
  const samples = SILENT_SECONDS * SILENT_SAMPLE_RATE;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  writeString(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SILENT_SAMPLE_RATE, true);
  view.setUint32(28, SILENT_SAMPLE_RATE, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples, true);
  // Midpoint is silence for unsigned 8-bit PCM.
  new Uint8Array(buffer, 44).fill(128);

  silentUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return silentUrl;
}

// The player lives outside React, in its own persistent container.
//
// Two reasons: moving an <iframe> in the DOM reloads it (which would restart
// playback), and the player must outlive the dialog that created it -- closing
// the "Load playlist" window should leave your music playing.
let playerHost: HTMLElement | null = null;

export function getPlayerHost(): HTMLElement {
  if (playerHost != null) {
    return playerHost;
  }
  const host = document.createElement("div");
  host.id = "youtube-player-host";
  host.className = "yt-player-host hidden";
  // YouTube's terms require their player stay visible, so this is only ever
  // hidden when nothing is loaded.
  host.innerHTML =
    '<div class="yt-player-host-bar">YouTube</div><div id="youtube-player-mount"></div>';
  document.body.appendChild(host);
  playerHost = host;
  return host;
}

export function showPlayerHost(visible: boolean) {
  getPlayerHost().classList.toggle("hidden", !visible);
}

let apiPromise: Promise<any> | null = null;

/**
 * Load YouTube's IFrame Player API. Safe to call repeatedly.
 */
export function loadIframeApi(): Promise<any> {
  if (apiPromise != null) {
    return apiPromise;
  }
  apiPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.YT != null && w.YT.Player != null) {
      resolve(w.YT);
      return;
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") {
        previous();
      }
      resolve(w.YT);
    };
    const script = document.createElement("script");
    script.src = IFRAME_API_URL;
    script.onerror = () =>
      reject(new Error("Could not load the YouTube player"));
    document.head.appendChild(script);
    setTimeout(
      () => reject(new Error("Timed out loading the YouTube player")),
      15000
    );
  });
  return apiPromise;
}

/**
 * Look up a video's title and uploader. Uses oEmbed, which needs no API key
 * and permits cross-origin requests.
 */
async function fetchTitle(videoId: string): Promise<YouTubeTrack> {
  const fallback = { videoId, title: videoId, author: "YouTube" };
  try {
    const url = `${OEMBED_URL}?format=json&url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}`;
    const response = await fetch(url);
    if (!response.ok) {
      return fallback;
    }
    const payload = await response.json();
    return {
      videoId,
      title: payload.title ?? videoId,
      author: payload.author_name ?? "YouTube",
    };
  } catch (_e) {
    // Private, deleted and region-blocked videos 401/404 here. Keep them in
    // the list rather than silently dropping tracks.
    return fallback;
  }
}

/**
 * Resolve titles for a list of video ids, a few at a time.
 */
export async function fetchTitles(
  videoIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<YouTubeTrack[]> {
  const results: YouTubeTrack[] = new Array(videoIds.length);
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < videoIds.length) {
      const index = cursor++;
      results[index] = await fetchTitle(videoIds[index]);
      done++;
      onProgress?.(done, videoIds.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(TITLE_CONCURRENCY, videoIds.length) }, worker)
  );
  return results;
}

/**
 * YouTube Music publishes album audio ("art tracks") on auto-generated
 * "<Artist> - Topic" channels. Everything else in a curated mix is typically
 * the music video, which has intros, outros and chatter.
 */
export function isAlbumAudio(track: YouTubeTrack): boolean {
  return / - Topic$/.test(track.author);
}

/**
 * How many tracks in a playlist are album audio rather than music videos.
 */
export function albumAudioCount(tracks: YouTubeTrack[]): number {
  return tracks.filter(isAlbumAudio).length;
}

export function tracksFromYouTube(ytTracks: YouTubeTrack[]): Track[] {
  const url = getSilentAudioUrl();
  return ytTracks.map((track) => ({
    url,
    metaData: { title: track.title, artist: track.author },
  }));
}

// Values roughly match what a real analyser produces, so the bars look sane.
const VIZ_BINS = 16;
const VIZ_MAX = 12;

/**
 * Synthetic visualizer data.
 *
 * IMPORTANT: this is NOT real analyser output. YouTube's audio lives in a
 * cross-origin iframe, so it cannot be measured. These numbers are invented so
 * the spectrum analyzer animates instead of sitting flat. Do not mistake this
 * for a reading of the actual audio.
 */
function makeFakeVizData(phase: number): { [key: number]: number } {
  const data: { [key: number]: number } = {};
  for (let i = 0; i < VIZ_BINS; i++) {
    // Falls off toward the high end, like real music, plus some wobble.
    const falloff = 1 - i / VIZ_BINS;
    const wobble =
      Math.sin(phase / 5 + i) * 0.3 + Math.sin(phase / 2.3 + i * 2) * 0.2;
    const value = Math.max(0, VIZ_MAX * falloff * (0.55 + wobble));
    data[i * 8] = value;
  }
  return data;
}

// Lets the playlist's YTLIST menu entry (handled deep inside Webamp) ask the
// demo's React tree to open the load dialog.
let openRequestHandler: (() => void) | null = null;

export function onOpenRequested(handler: (() => void) | null) {
  openRequestHandler = handler;
}

export function requestOpen() {
  openRequestHandler?.();
}

let controller: YouTubeBridge | null = null;

/**
 * The single, persistent bridge. Survives the dialog being closed and
 * reopened, so playback isn't interrupted.
 */
export async function getController(
  webamp: WebampLazy
): Promise<YouTubeBridge> {
  if (controller != null) {
    return controller;
  }
  const YT = await loadIframeApi();
  getPlayerHost();
  const player = await new Promise<any>((resolve, reject) => {
    const p = new YT.Player("youtube-player-mount", {
      // 200x200 is YouTube's documented minimum embedded-player size. The
      // player must stay visible and unobscured under their API terms, so this
      // is as unobtrusive as it can legitimately get.
      width: 200,
      height: 200,
      playerVars: {
        // Hide related-video clutter and chrome we don't need.
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
      },
      events: {
        onReady: () => resolve(p),
        onError: (e: any) =>
          reject(new Error(`YouTube player error ${e.data}`)),
      },
    });
    setTimeout(() => reject(new Error("The YouTube player timed out")), 15000);
  });
  controller = new YouTubeBridge(webamp, player);
  // Exposed for debugging and integration tests, like `window.__webamp`.
  (window as any).__ytBridge = controller;
  return controller;
}

/**
 * Keeps Webamp's transport and YouTube's player in step.
 */
export class YouTubeBridge {
  _webamp: WebampLazy;
  _player: any;
  // Parallel to the playlist order Webamp ends up with.
  _ytTracks: YouTubeTrack[] = [];
  _currentVideoId: string | null = null;
  _unsubscribe: (() => void) | null = null;
  _vizTimer: number | null = null;
  _vizPhase = 0;
  _disposed = false;

  constructor(webamp: WebampLazy, player: any) {
    this._webamp = webamp;
    this._player = player;
  }

  /**
   * Replace Webamp's playlist with the given YouTube tracks.
   */
  /**
   * Cue a playlist and read back its video ids. `getPlaylist()` stays empty
   * until the player has actually fetched the list, so poll for it.
   */
  async readPlaylist(listId: string): Promise<string[]> {
    this._safe(() =>
      this._player.cuePlaylist({ listType: "playlist", list: listId })
    );
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const ids = this._safe(() => this._player.getPlaylist());
      if (Array.isArray(ids) && ids.length > 0) {
        return ids;
      }
    }
    return [];
  }

  load(ytTracks: YouTubeTrack[]) {
    this._ytTracks = ytTracks;
    this._webamp.setTracksToPlay(tracksFromYouTube(ytTracks));
    this._subscribe();
    this._sync();
  }

  /**
   * Which video backs a given Webamp track.
   *
   * Resolved by playlist position rather than captured up front:
   * `setTracksToPlay` loads tracks asynchronously, so the ids don't exist yet
   * when `load` returns, and the user can reorder or remove rows afterwards.
   */
  _videoIdForTrack(trackId: number | null): string | null {
    if (trackId == null) {
      return null;
    }
    const state = this._webamp.store.getState() as any;
    const index = state.playlist.trackOrder.indexOf(trackId);
    if (index < 0) {
      return null;
    }
    return this._ytTracks[index]?.videoId ?? null;
  }

  _subscribe() {
    if (this._unsubscribe != null) {
      return;
    }
    this._unsubscribe = this._webamp.store.subscribe(() => this._sync());

    this._player.addEventListener("onStateChange", (e: any) => {
      // 0 == ENDED. Let Webamp move the playlist along so its UI stays honest.
      if (e.data === 0 && !this._disposed) {
        this._webamp.nextTrack();
      }
    });
  }

  _sync() {
    if (this._disposed) {
      return;
    }
    const state = this._webamp.store.getState() as any;
    const trackId: number | null = state.playlist.currentTrack;
    const videoId = this._videoIdForTrack(trackId);

    // Not a YouTube track (user loaded their own music) -- stand down.
    if (videoId == null) {
      if (this._currentVideoId != null) {
        this._currentVideoId = null;
        this._safe(() => this._player.stopVideo());
        this._stopFakeViz();
      }
      return;
    }

    const status = state.media.status;
    const playing = status === "PLAYING";

    if (videoId !== this._currentVideoId) {
      this._currentVideoId = videoId;
      this._safe(() =>
        playing
          ? this._player.loadVideoById(videoId)
          : this._player.cueVideoById(videoId)
      );
      // Real duration replaces the silent file's 20:00 once YouTube knows it.
      this._adoptDuration(trackId!);
    }

    this._safe(() => {
      const ytState = this._player.getPlayerState();
      if (playing && ytState !== 1 && ytState !== 3) {
        this._player.playVideo();
      } else if (!playing && ytState === 1) {
        this._player.pauseVideo();
      }
    });

    // Correct drift, and follow Webamp's seek bar.
    this._safe(() => {
      const ytTime = this._player.getCurrentTime() ?? 0;
      const elapsed = state.media.timeElapsed ?? 0;
      if (Math.abs(ytTime - elapsed) > 2) {
        this._player.seekTo(elapsed, true);
      }
    });

    if (playing) {
      this._startFakeViz();
    } else {
      this._stopFakeViz();
    }
  }

  // YouTube only knows a video's length once it has loaded metadata, so poll
  // briefly rather than guessing.
  _adoptDuration(trackId: number) {
    let attempts = 0;
    const tick = () => {
      if (this._disposed || attempts++ > 20) {
        return;
      }
      const duration = this._safe(() => this._player.getDuration());
      if (typeof duration === "number" && duration > 0) {
        this._webamp.store.dispatch({
          type: "SET_MEDIA_DURATION",
          duration,
          id: trackId,
        } as any);
        return;
      }
      window.setTimeout(tick, 500);
    };
    tick();
  }

  _startFakeViz() {
    if (this._vizTimer != null) {
      return;
    }
    this._vizTimer = window.setInterval(() => {
      this._vizPhase++;
      this._webamp.store.dispatch({
        type: "SET_DUMMY_VIZ_DATA",
        data: makeFakeVizData(this._vizPhase),
      } as any);
    }, 50);
  }

  _stopFakeViz() {
    if (this._vizTimer == null) {
      return;
    }
    window.clearInterval(this._vizTimer);
    this._vizTimer = null;
    this._webamp.store.dispatch({
      type: "SET_DUMMY_VIZ_DATA",
      data: null,
    } as any);
  }

  // The YouTube player throws if it isn't ready yet; none of these calls are
  // worth crashing the sync loop over.
  _safe<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (_e) {
      return undefined;
    }
  }

  dispose() {
    this._disposed = true;
    this._stopFakeViz();
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}
