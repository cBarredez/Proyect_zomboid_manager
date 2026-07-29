import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { decodePacket, encodePacket, rconCommand } from "./rconClient.js";

describe("RCON packet encode/decode", () => {
  it("round-trips a simple command", () => {
    const packet = encodePacket(2, 2, "players");
    const decoded = decodePacket(packet);
    expect(decoded).toEqual({ id: 2, type: 2, body: "players" });
  });

  it("round-trips an empty body", () => {
    const packet = encodePacket(1, 3, "");
    const decoded = decodePacket(packet);
    expect(decoded).toEqual({ id: 1, type: 3, body: "" });
  });

  it("preserves the declared length prefix", () => {
    const packet = encodePacket(5, 0, "hello world");
    const declaredSize = packet.readInt32LE(0);
    expect(packet.length).toBe(declaredSize + 4);
  });

  it("handles a coalesced auth prelude and auth response", async () => {
    const server = createServer((socket) => {
      let requests = 0;
      socket.on("data", () => {
        requests += 1;
        if (requests === 1) {
          socket.write(
            Buffer.concat([
              encodePacket(1, 0, ""),
              encodePacket(1, 2, ""),
            ]),
          );
        } else {
          socket.write(encodePacket(2, 0, "Players connected (0):"));
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");

    try {
      await expect(
        rconCommand(
          { host: "127.0.0.1", port: address.port, password: "secret", timeoutMs: 1000 },
          "players",
        ),
      ).resolves.toBe("Players connected (0):");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
