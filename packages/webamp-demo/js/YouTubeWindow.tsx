import { useCallback, useState } from "react";
import WebampLazy from "../../webamp/js/webampLazy";
import * as YouTube from "./youtube";
import { log } from "./logger";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "loaded"; count: number; albumAudio: number }
  | { kind: "error"; message: string };

interface Props {
  webamp: WebampLazy;
  onClose: () => void;
}

/**
 * Dialog for loading a YouTube playlist.
 *
 * Deliberately owns no player state: the player and the Webamp bridge are
 * module-level singletons (see youtube.ts), so closing this window leaves the
 * music playing.
 */
const YouTubeWindow = ({ webamp, onClose }: Props) => {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const loadPlaylist = useCallback(async () => {
    const listId = YouTube.parsePlaylistId(url);
    if (listId == null) {
      setStatus({
        kind: "error",
        message: "That doesn't look like a YouTube playlist link.",
      });
      return;
    }

    log({ category: "YouTube", action: "loadPlaylist", label: listId });
    setStatus({ kind: "loading", message: "Starting the YouTube player..." });

    try {
      const bridge = await YouTube.getController(webamp);
      YouTube.showPlayerHost(true);

      setStatus({ kind: "loading", message: "Reading the playlist..." });
      const videoIds = await bridge.readPlaylist(listId);
      if (videoIds.length === 0) {
        setStatus({
          kind: "error",
          message:
            "No videos found. Private playlists (including Liked Music) can't be read this way.",
        });
        return;
      }

      setStatus({
        kind: "loading",
        message: `Found ${videoIds.length} tracks. Fetching titles...`,
      });
      const tracks = await YouTube.fetchTitles(videoIds, (done, total) => {
        setStatus({
          kind: "loading",
          message: `Fetching titles... ${done}/${total}`,
        });
      });

      bridge.load(tracks);
      setStatus({
        kind: "loaded",
        count: tracks.length,
        albumAudio: YouTube.albumAudioCount(tracks),
      });
    } catch (e: any) {
      setStatus({
        kind: "error",
        message: e?.message ?? "Something went wrong",
      });
    }
  }, [url, webamp]);

  return (
    <div className="yt-window">
      <div className="yt-title-bar">
        <span>Load YouTube Playlist</span>
        <button
          type="button"
          className="yt-close"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="yt-body">
        <div className="yt-toolbar">
          <input
            className="yt-input"
            type="text"
            value={url}
            placeholder="Paste a YouTube playlist link..."
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                loadPlaylist();
              }
            }}
          />
          <button type="button" className="yt-button" onClick={loadPlaylist}>
            Load
          </button>
        </div>

        <div className="yt-status">
          {status.kind === "loading" && status.message}
          {status.kind === "error" && (
            <span className="yt-error">{status.message}</span>
          )}
          {status.kind === "loaded" && (
            <>
              {`${status.count} tracks loaded. You can close this window.`}
              <br />
              {status.albumAudio === status.count
                ? "All tracks are album audio."
                : `${status.albumAudio}/${status.count} are album audio; the rest are music videos.`}
            </>
          )}
          {status.kind === "idle" &&
            "Tracks load into the Winamp playlist. Audio plays from YouTube."}
        </div>

        <div className="yt-note">
          For album versions rather than music videos, use a YouTube Music album
          playlist (its link starts <code>list=OLAK5uy_</code>). Curated mixes (
          <code>RDCLAK5uy_</code>) are mostly official videos.
        </div>

        <div className="yt-note">
          The spectrum analyzer is simulated for YouTube tracks — their audio is
          in a cross-origin frame and can't be measured.
        </div>
      </div>
    </div>
  );
};

export default YouTubeWindow;
