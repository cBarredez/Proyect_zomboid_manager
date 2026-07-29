import { describe, expect, it, vi } from "vitest";
import { fetchCollectionItemIds, parseWorkshopId, SteamWorkshopError } from "./steamWorkshop.js";

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("fetchCollectionItemIds", () => {
  it("returns child Workshop IDs for a valid collection", async () => {
    const fetchImpl = mockFetch(200, {
      response: {
        collectiondetails: [
          {
            publishedfileid: "111",
            result: 1,
            children: [{ publishedfileid: "222" }, { publishedfileid: "333" }],
          },
        ],
      },
    });

    const ids = await fetchCollectionItemIds("111", fetchImpl);
    expect(ids).toEqual(["222", "333"]);
  });

  it("posts the expected form parameters", async () => {
    const fetchImpl = mockFetch(200, {
      response: { collectiondetails: [{ publishedfileid: "111", result: 1, children: [] }] },
    });

    await fetchCollectionItemIds("111", fetchImpl);

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("GetCollectionDetails");
    expect(init.method).toBe("POST");
    expect((init.body as URLSearchParams).get("publishedfileids[0]")).toBe("111");
  });

  it("throws when the HTTP request fails", async () => {
    const fetchImpl = mockFetch(500, {});
    await expect(fetchCollectionItemIds("111", fetchImpl)).rejects.toThrow(SteamWorkshopError);
  });

  it("throws when the collection is not found (result !== 1)", async () => {
    const fetchImpl = mockFetch(200, {
      response: { collectiondetails: [{ publishedfileid: "111", result: 9, children: [] }] },
    });
    await expect(fetchCollectionItemIds("111", fetchImpl)).rejects.toThrow(SteamWorkshopError);
  });
});

describe("parseWorkshopId", () => {
  it("accepts a bare numeric ID", () => {
    expect(parseWorkshopId("3281957664")).toBe("3281957664");
  });

  it("accepts a pasted Workshop URL with ?id=", () => {
    expect(parseWorkshopId("https://steamcommunity.com/sharedfiles/filedetails/?id=3281957664")).toBe(
      "3281957664",
    );
  });

  it("accepts a pasted Workshop URL with &id= after other params", () => {
    expect(parseWorkshopId("https://steamcommunity.com/sharedfiles/filedetails/?p=1&id=123456")).toBe("123456");
  });

  it("trims surrounding whitespace", () => {
    expect(parseWorkshopId("  3281957664  ")).toBe("3281957664");
  });

  it("returns null for unparseable input", () => {
    expect(parseWorkshopId("not-an-id")).toBeNull();
    expect(parseWorkshopId("")).toBeNull();
  });
});
