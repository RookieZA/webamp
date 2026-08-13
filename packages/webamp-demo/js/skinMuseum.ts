// Access to the full collection of ~100k classic Winamp skins hosted by the
// Winamp Skin Museum (https://skins.webamp.org).
//
// Two different backends, for two different jobs:
//
// - Browsing (no search query) goes through the Museum's GraphQL API, which
//   supports true offset pagination over the whole collection.
// - Searching goes through the same public Algolia index the Museum's own
//   client uses. It's typo tolerant and fast, but Algolia only paginates
//   through the first 1,000 matches of any given query.

const GRAPHQL_URL = "https://skins.webamp.org/graphql";
const MUSEUM_URL = "https://skins.webamp.org";
const CDN_URL = "https://r2.webampskins.org";

// Public search-only credentials. These are the same ones the Skin Museum ships
// in its own client bundle.
const ALGOLIA_APP_ID = "HQ9I5Z6IM5";
const ALGOLIA_API_KEY = "6466695ec3f624a5fccf46ec49680e51";

export const PAGE_SIZE = 30;

// Algolia refuses to paginate past this many hits for a single query.
const ALGOLIA_MAX_HITS = 1000;

export interface MuseumSkin {
  md5: string;
  fileName: string;
}

export interface SkinPage {
  skins: MuseumSkin[];
  // Total number of skins matching, if the backend told us. Not all do.
  count: number | null;
  hasMore: boolean;
}

export function getSkinUrl(md5: string): string {
  return `${CDN_URL}/skins/${md5}.wsz`;
}

export function getScreenshotUrl(md5: string): string {
  return `${CDN_URL}/screenshots/${md5}.png`;
}

export function getMuseumUrl({ md5, fileName }: MuseumSkin): string {
  return `${MUSEUM_URL}/skin/${md5}/${encodeURIComponent(fileName)}/`;
}

// "Some_Cool_Skin.wsz" => "Some Cool Skin"
export function getSkinName({ fileName }: MuseumSkin): string {
  return fileName.replace(/\.(wsz|zip|wal)$/i, "").replace(/[_+]/g, " ");
}

/**
 * Page through every skin in the Museum, in the Museum's own curated order.
 */
async function browseSkins(
  page: number,
  signal: AbortSignal
): Promise<SkinPage> {
  const query = `
    query BrowseSkins($first: Int!, $offset: Int!) {
      skins(first: $first, offset: $offset, sort: MUSEUM) {
        count
        nodes {
          ... on ClassicSkin {
            md5
            filename(normalize_extension: true)
            nsfw
          }
        }
      }
    }
  `;
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      query,
      variables: { first: PAGE_SIZE, offset: page * PAGE_SIZE },
    }),
  });
  if (!response.ok) {
    throw new Error(`Skin Museum responded with ${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors != null) {
    throw new Error(payload.errors.map((e: any) => e.message).join(", "));
  }
  const connection = payload.data?.skins;
  const nodes: any[] = connection?.nodes ?? [];
  const count: number | null = connection?.count ?? null;

  return {
    // `nodes` includes "modern" skins, which Webamp can't render, and those get
    // returned as empty objects since they don't match our inline fragment.
    skins: nodes
      .filter((node) => node?.md5 != null && !node.nsfw)
      .map((node) => ({ md5: node.md5, fileName: node.filename })),
    count,
    // Trust the page size rather than the filtered length, since dropping NSFW
    // and modern skins leaves holes that shouldn't end the list.
    hasMore: nodes.length === PAGE_SIZE,
  };
}

/**
 * Search the Museum's Algolia index by file name.
 */
async function searchSkins(
  query: string,
  page: number,
  signal: AbortSignal
): Promise<SkinPage> {
  // Passing credentials as query params (rather than headers) keeps this a
  // "simple" CORS request, so the browser skips the preflight round trip.
  const url =
    `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/Skins/query` +
    `?x-algolia-api-key=${ALGOLIA_API_KEY}` +
    `&x-algolia-application-id=${ALGOLIA_APP_ID}`;

  const response = await fetch(url, {
    method: "POST",
    // Ditto: an "actually JSON" body sent as form-urlencoded avoids preflight.
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
    body: JSON.stringify({
      query,
      page,
      hitsPerPage: PAGE_SIZE,
      filters: "nsfw=0",
      attributesToRetrieve: ["objectID", "fileName"],
      attributesToHighlight: [],
      // "min": Retrieve records with the smallest number of typos.
      typoTolerance: "min",
    }),
  });
  if (!response.ok) {
    throw new Error(`Skin search responded with ${response.status}`);
  }
  const payload = await response.json();
  const hits: any[] = payload.hits ?? [];

  return {
    skins: hits.map((hit) => ({ md5: hit.objectID, fileName: hit.fileName })),
    count: payload.nbHits ?? null,
    hasMore:
      hits.length === PAGE_SIZE &&
      (page + 1) * PAGE_SIZE < Math.min(payload.nbHits ?? 0, ALGOLIA_MAX_HITS),
  };
}

/**
 * Get a page of skins, either the whole collection or the ones matching
 * `query`. Pages are zero indexed.
 */
export function getSkins(
  query: string,
  page: number,
  signal: AbortSignal
): Promise<SkinPage> {
  return query.trim() === ""
    ? browseSkins(page, signal)
    : searchSkins(query.trim(), page, signal);
}
