import { describe, expect, it } from "vitest";
import { LogHub } from "../infra/logHub.js";
import { isServerReadyLine, RuntimeState, type RunEndedInfo, type RunStartedInfo } from "./runtimeState.js";

describe("isServerReadyLine", () => {
  it.each([
    "Dedicated server is now started",
    "Server Steam ID 90289786907103258",
    "LOG : Network > ZNet: Zomboid Server is VAC Secure",
  ])("recognizes a Project Zomboid ready marker: %s", (line) => {
    expect(isServerReadyLine(line)).toBe(true);
  });

  it("does not treat ordinary initialization output as ready", () => {
    expect(isServerReadyLine("LuaNet: Initialization [DONE]")).toBe(false);
  });
});

function makeMockRuntime(hooks: { onRunStarted?: (info: RunStartedInfo) => void; onRunEnded?: (info: RunEndedInfo) => void }) {
  return new RuntimeState({
    installDir: "/tmp/install",
    dataDir: "/tmp/data",
    serverName: "test",
    memoryMinMb: 512,
    memoryMaxMb: 1024,
    rconHost: "127.0.0.1",
    rconPort: 27015,
    rconPassword: "pw",
    adminPassword: "adminpw",
    logHub: new LogHub(),
    mock: true,
    ...hooks,
  });
}

describe("RuntimeState session lifecycle hooks", () => {
  it("fires onRunStarted with a run id when the mock server starts", () => {
    const started: RunStartedInfo[] = [];
    const runtime = makeMockRuntime({ onRunStarted: (info) => started.push(info) });

    runtime.start();

    expect(started).toHaveLength(1);
    expect(started[0].runId).toBe(runtime.getRunId());
    expect(started[0].pid).toBeNull();
  });

  it("fires onRunEnded with reason 'stopped' when stop() is called on the mock server", async () => {
    const ended: RunEndedInfo[] = [];
    const runtime = makeMockRuntime({ onRunEnded: (info) => ended.push(info) });

    runtime.start();
    const runId = runtime.getRunId();
    await runtime.stop();

    expect(ended).toHaveLength(1);
    expect(ended[0].runId).toBe(runId);
    expect(ended[0].reason).toBe("stopped");
    expect(runtime.getRunId()).toBeNull();
  });

  it("does not fire onRunEnded when stop() is called while already idle", async () => {
    const ended: RunEndedInfo[] = [];
    const runtime = makeMockRuntime({ onRunEnded: (info) => ended.push(info) });

    await runtime.stop();

    expect(ended).toHaveLength(0);
  });
});
