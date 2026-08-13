import { useCallback, useEffect, useRef, useState } from "react";
import WebampLazy from "../../webamp/js/webampLazy";
import * as SkinMuseum from "./skinMuseum";
import { MuseumSkin } from "./skinMuseum";
import { log } from "./logger";

const SEARCH_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timeout);
  }, [value, ms]);
  return debounced;
}

interface SkinsState {
  skins: MuseumSkin[];
  count: number | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: SkinsState = {
  skins: [],
  count: null,
  hasMore: true,
  loading: true,
  error: null,
};

function useMuseumSkins(query: string) {
  const [page, setPage] = useState(0);
  const [state, setState] = useState<SkinsState>(INITIAL_STATE);

  // Start over whenever the query changes.
  useEffect(() => {
    setPage(0);
    setState(INITIAL_STATE);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    let canceled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    SkinMuseum.getSkins(query, page, controller.signal).then(
      (result) => {
        if (canceled) {
          return;
        }
        setState((prev) => {
          // Pages can overlap (skins get filtered out, or the collection
          // shifts underneath us), so dedupe as we append.
          const seen = new Set(prev.skins.map((skin) => skin.md5));
          const added = result.skins.filter((skin) => !seen.has(skin.md5));
          return {
            skins: page === 0 ? result.skins : [...prev.skins, ...added],
            count: result.count,
            hasMore: result.hasMore,
            loading: false,
            error: null,
          };
        });
      },
      (error) => {
        if (canceled || controller.signal.aborted) {
          return;
        }
        setState((prev) => ({
          ...prev,
          loading: false,
          hasMore: false,
          error: error.message ?? "Something went wrong",
        }));
      }
    );

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [query, page]);

  const loadMore = useCallback(() => {
    if (!state.loading && state.hasMore && state.error == null) {
      setPage((prev) => prev + 1);
    }
  }, [state.loading, state.hasMore, state.error]);

  return { ...state, loadMore };
}

interface SkinCellProps {
  skin: MuseumSkin;
  selected: boolean;
  onClick: () => void;
}

const SkinCell = ({ skin, selected, onClick }: SkinCellProps) => {
  const name = SkinMuseum.getSkinName(skin);
  return (
    <button
      type="button"
      className={`skin-browser-cell${selected ? " selected" : ""}`}
      onClick={onClick}
      title={`${name}\nClick to try this skin`}
    >
      <img
        className="skin-browser-screenshot"
        src={SkinMuseum.getScreenshotUrl(skin.md5)}
        alt={name}
        loading="lazy"
        draggable={false}
      />
      <span className="skin-browser-cell-name">{name}</span>
    </button>
  );
};

interface Props {
  webamp: WebampLazy;
  onClose: () => void;
}

const SkinBrowser = ({ webamp, onClose }: Props) => {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const [selectedMd5, setSelectedMd5] = useState<string | null>(null);
  const { skins, count, hasMore, loading, error, loadMore } =
    useMuseumSkins(debouncedQuery);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the next page as the bottom of the list comes into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel == null) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { root: scrollRef.current, rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Jump back to the top when the results change out from under us.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [debouncedQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const applySkin = (skin: MuseumSkin) => {
    setSelectedMd5(skin.md5);
    log({
      category: "SkinBrowser",
      action: "applySkin",
      label: skin.fileName,
    });
    webamp.setSkinFromUrl(SkinMuseum.getSkinUrl(skin.md5));
  };

  return (
    <div className="skin-browser">
      <div className="skin-browser-title-bar">
        <span className="skin-browser-title">Winamp Skin Museum</span>
        <button
          type="button"
          className="skin-browser-close"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>
      <div className="skin-browser-toolbar">
        <input
          className="skin-browser-search"
          type="search"
          value={query}
          autoFocus
          placeholder="Search 100,000+ skins..."
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="skin-browser-count">
          {count == null
            ? " "
            : `${count.toLocaleString()} skin${count === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="skin-browser-results" ref={scrollRef}>
        <div className="skin-browser-grid">
          {skins.map((skin) => (
            <SkinCell
              key={skin.md5}
              skin={skin}
              selected={skin.md5 === selectedMd5}
              onClick={() => applySkin(skin)}
            />
          ))}
        </div>
        {error != null && (
          <div className="skin-browser-status skin-browser-error">
            Could not reach the Skin Museum: {error}
          </div>
        )}
        {error == null && loading && (
          <div className="skin-browser-status">Loading skins...</div>
        )}
        {error == null && !loading && skins.length === 0 && (
          <div className="skin-browser-status">
            No skins matched "{debouncedQuery}".
          </div>
        )}
        {/* Sentinel for infinite scroll. */}
        {hasMore && error == null && <div ref={sentinelRef} />}
      </div>
      <div className="skin-browser-footer">
        Click any skin to wear it. Skins from{" "}
        <a
          href="https://skins.webamp.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          skins.webamp.org
        </a>
      </div>
    </div>
  );
};

export default SkinBrowser;
