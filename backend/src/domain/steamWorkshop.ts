const COLLECTION_DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";

interface CollectionDetailsResponse {
  response?: {
    collectiondetails?: Array<{
      publishedfileid: string;
      result: number;
      children?: Array<{ publishedfileid: string }>;
    }>;
  };
}

export class SteamWorkshopError extends Error {}

/**
 * Accepts either a bare Workshop/collection ID or a pasted
 * steamcommunity.com/sharedfiles/filedetails/?id=... URL (the far more common
 * way people actually copy these) and returns the numeric ID, or null if
 * neither form matches.
 */
export function parseWorkshopId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const match = /[?&]id=(\d+)/.exec(trimmed);
  return match ? match[1] : null;
}

/**
 * Resolves a Steam Workshop *collection* to the Workshop item IDs it
 * contains, via the unauthenticated ISteamRemoteStorage/GetCollectionDetails
 * endpoint (no API key required). This is what lets the panel accept one
 * collection URL instead of installing mods one Workshop ID at a time.
 */
export async function fetchCollectionItemIds(
  collectionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const body = new URLSearchParams();
  body.set("collectioncount", "1");
  body.set("publishedfileids[0]", collectionId);

  const res = await fetchImpl(COLLECTION_DETAILS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new SteamWorkshopError(`Steam API request failed (${res.status})`);
  }

  const data = (await res.json()) as CollectionDetailsResponse;
  const details = data.response?.collectiondetails?.[0];

  if (!details || details.result !== 1) {
    throw new SteamWorkshopError(`Workshop collection ${collectionId} was not found or is not public`);
  }

  return (details.children ?? []).map((child) => child.publishedfileid);
}
