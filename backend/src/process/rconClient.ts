import { Socket } from "node:net";

/**
 * Minimal Source RCON protocol client (the protocol PZ's built-in RCON
 * server implements). Packet format: int32 length | int32 id | int32 type |
 * body (null-terminated) | empty-string terminator.
 */
const TYPE_AUTH = 3;
const TYPE_AUTH_RESPONSE = 2;
const TYPE_COMMAND = 2;
const TYPE_RESPONSE_VALUE = 0;

export function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf-8");
  const size = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + size);
  let offset = 0;
  buf.writeInt32LE(size, offset);
  offset += 4;
  buf.writeInt32LE(id, offset);
  offset += 4;
  buf.writeInt32LE(type, offset);
  offset += 4;
  bodyBuf.copy(buf, offset);
  offset += bodyBuf.length;
  buf.writeInt8(0, offset);
  offset += 1;
  buf.writeInt8(0, offset);
  return buf;
}

export interface DecodedPacket {
  id: number;
  type: number;
  body: string;
}

export function decodePacket(buf: Buffer): DecodedPacket {
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  const body = buf.toString("utf-8", 12, buf.length - 2);
  return { id, type, body };
}

export class RconAuthError extends Error {}
export class RconConnectionError extends Error {}

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
}

/** Opens a connection, authenticates, sends one command, closes. */
export async function rconCommand(options: RconOptions, command: string): Promise<string> {
  const { host, port, password, timeoutMs = 5000 } = options;
  const socket = new Socket();

  return new Promise<string>((resolve, reject) => {
    let stage: "connecting" | "authenticating" | "commanding" = "connecting";
    let responseBuffer = Buffer.alloc(0);

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new RconConnectionError(`RCON timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("error", (err) => {
      clearTimeout(timer);
      cleanup();
      reject(new RconConnectionError(err.message));
    });

    socket.on("connect", () => {
      stage = "authenticating";
      socket.write(encodePacket(1, TYPE_AUTH, password));
    });

    socket.on("data", (chunk) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      while (responseBuffer.length >= 4) {
        const size = responseBuffer.readInt32LE(0);
        if (responseBuffer.length < size + 4) return;

        const packet = decodePacket(responseBuffer.subarray(0, size + 4));
        responseBuffer = responseBuffer.subarray(size + 4);

        if (stage === "authenticating") {
          // Source RCON commonly sends an empty RESPONSE_VALUE packet before
          // AUTH_RESPONSE, often coalesced into one TCP chunk. Ignore the
          // prelude and wait for the actual authentication result.
          if (packet.type !== TYPE_AUTH_RESPONSE) continue;
          if (packet.id === -1) {
            clearTimeout(timer);
            cleanup();
            reject(new RconAuthError("RCON authentication failed"));
            return;
          }
          stage = "commanding";
          socket.write(encodePacket(2, TYPE_COMMAND, command));
          continue;
        }

        if (stage === "commanding" && packet.type === TYPE_RESPONSE_VALUE) {
          clearTimeout(timer);
          cleanup();
          resolve(packet.body);
          return;
        }
      }
    });

    socket.connect(port, host);
  });
}
