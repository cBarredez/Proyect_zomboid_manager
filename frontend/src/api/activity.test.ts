import { describe, expect, it, vi } from "vitest";
import { recordApiActivity, subscribeApiActivity } from "./activity.js";

describe("api activity pub-sub", () => {
  it("delivers recorded entries to subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeApiActivity(listener);

    recordApiActivity({ method: "POST", path: "/api/server/install", status: 200, durationMs: 42, timestamp: "t" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ method: "POST", path: "/api/server/install", status: 200 });
    unsubscribe();
  });

  it("assigns increasing ids across entries", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeApiActivity((entry) => seen.push(entry.id));

    recordApiActivity({ method: "GET", path: "/a", status: 200, durationMs: 1, timestamp: "t" });
    recordApiActivity({ method: "GET", path: "/b", status: 200, durationMs: 1, timestamp: "t" });

    expect(seen[1]).toBeGreaterThan(seen[0]);
    unsubscribe();
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeApiActivity(listener);
    unsubscribe();

    recordApiActivity({ method: "GET", path: "/x", status: 200, durationMs: 1, timestamp: "t" });

    expect(listener).not.toHaveBeenCalled();
  });
});
