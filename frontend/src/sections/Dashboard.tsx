import { useCallback, useEffect, useRef, useState } from "react";
import { GET, POST, statusPresentation, type ServerStatusResponse } from "../api/client.js";
import {
  IconActivity,
  IconDownload,
  IconMap,
  IconPlay,
  IconRestart,
  IconStop,
  IconSystem,
} from "../icons.js";
import { formatSize } from "./Backups.js";
import { MetricsChart } from "./MetricsChart.js";
import type { MetricsSnapshot } from "./Metrics.js";

const KNOWN_BRANCHES = [
  { value: "", label: "Build 42 stable (default)" },
  { value: "legacy41", label: "Build 41 legacy" },
  { value: "unstable", label: "Build 42 unstable / test" },
  { value: "42.19", label: "Build 42.19 legacy save" },
  { value: "custom", label: "Custom branch name…" },
] as const;

type BranchChoice = (typeof KNOWN_BRANCHES)[number]["value"];

export function Dashboard() {
  const [status, setStatus] = useState<ServerStatusResponse | null>(null);
  const [branchChoice, setBranchChoice] = useState<BranchChoice>("");
  const [customBranch, setCustomBranch] = useState("");
  const [installedBranch, setInstalledBranch] = useState("");
  const [eraseForSwitch, setEraseForSwitch] = useState(false);
  const [switchConfirmation, setSwitchConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const cpuHistory = useRef<number[]>([]);
  const memoryHistory = useRef<number[]>([]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await GET<ServerStatusResponse>("/api/server/status"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    GET<{ betaBranch: string }>("/api/server-settings")
      .then((data) => {
        setInstalledBranch(data.betaBranch);
        const known = KNOWN_BRANCHES.find((b) => b.value === data.betaBranch && b.value !== "custom");
        if (known) {
          setBranchChoice(known.value);
        } else if (data.betaBranch) {
          setBranchChoice("custom");
          setCustomBranch(data.betaBranch);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await GET<MetricsSnapshot>("/api/metrics");
        if (cancelled) return;
        setMetrics(data);
        cpuHistory.current = [...cpuHistory.current, data.cpu.percent].slice(-30);
        memoryHistory.current = [...memoryHistory.current, data.memory.percent].slice(-30);
      } catch {
        // The server status error remains the primary dashboard error.
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const runAction = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await POST(path, body);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const effectiveBranch = branchChoice === "custom" ? customBranch.trim() : branchChoice;
  const changingBuild = effectiveBranch !== installedBranch;
  const presentation = status ? statusPresentation(status.status) : null;
  const browserHost = window.location.hostname;
  const joinHost =
    status?.connection.publicAddress ||
    browserHost ||
    "localhost";
  const joinAddress = status ? `${joinHost}:${status.connection.gamePort}` : "—";

  const copyJoinAddress = async () => {
    await navigator.clipboard.writeText(joinAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="dashboard-page">
      <section className="server-control-card">
        <h2>Server control</h2>
        {error && <p role="alert">{error}</p>}
        {status?.installation.simulated && (
          <p className="notice-warning" role="status">
            Simulation mode is enabled. Install and update actions do not download server files.
          </p>
        )}

        <div className="server-control">
          <div className="status-ring" data-tone={presentation?.tone ?? "neutral"}>
            {status?.running ? <IconStop /> : <IconPlay />}
          </div>
          <div style={{ flex: 1 }}>
            <div className="server-control-title">Project Zomboid Dedicated Server</div>
            <div className="server-control-status">{presentation?.label ?? "Loading…"}</div>
          </div>
        </div>

        <div className="row">
          <button
            className="btn-ctrl btn-ctrl-start"
            disabled={
              busy ||
              status?.running ||
              (status !== null && !status.mockServer && !status.installation.installed)
            }
            onClick={() => runAction("/api/server/start")}
          >
            <IconPlay />
            Start
          </button>
          <button
            className="btn-ctrl btn-ctrl-stop"
            disabled={busy || !status?.running}
            onClick={() => runAction("/api/server/stop")}
          >
            <IconStop />
            Stop
          </button>
          <button
            className="btn-ctrl btn-ctrl-restart"
            disabled={busy}
            onClick={() => runAction("/api/server/restart")}
          >
            <IconRestart />
            Restart
          </button>
        </div>
      </section>

      <div className="dashboard-metric-grid">
        <article className="metric-card">
          <div className="metric-icon"><IconActivity /></div>
          <div>
            <div className="metric-value">{metrics ? `${metrics.cpu.percent}%` : "—"}</div>
            <div className="metric-subvalue">
              {metrics ? `${metrics.cpu.cores} core limit` : "Collecting sample"}
            </div>
            <div className="metric-label">CPU usage</div>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><IconSystem /></div>
          <div>
            <div className="metric-value">{metrics ? `${metrics.memory.percent}%` : "—"}</div>
            <div className="metric-subvalue">
              {metrics
                ? `${formatSize(metrics.memory.usedBytes)} / ${formatSize(metrics.memory.totalBytes)}`
                : "Collecting sample"}
            </div>
            <div className="metric-label">Container memory</div>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><IconSystem /></div>
          <div>
            <div className="metric-value">
              {metrics ? formatSize(metrics.process.rssBytes) : "—"}
            </div>
            <div className="metric-subvalue">Manager API resident set</div>
            <div className="metric-label">Panel process</div>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><IconMap /></div>
          <div>
            <div className="metric-value">{status?.connection.maxPlayers ?? "—"}</div>
            <div className="metric-subvalue">
              UDP {status?.connection.gamePort ?? "—"}
            </div>
            <div className="metric-label">Player capacity</div>
          </div>
        </article>
      </div>

      <div className="dashboard-main-grid">
        <section className="resource-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">LIVE · LAST 60 SECONDS</span>
              <h2>Resource history</h2>
            </div>
            <span className="live-indicator"><i />2s refresh</span>
          </div>
          {cpuHistory.current.length > 0 ? (
            <MetricsChart
              series={[
                { label: "CPU %", color: "var(--series-1)", values: cpuHistory.current },
                { label: "Memory %", color: "var(--series-2)", values: memoryHistory.current },
              ]}
            />
          ) : (
            <p className="empty-state">Collecting the first metric sample…</p>
          )}
        </section>

        <section className="server-info-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">CONNECTIVITY</span>
              <h2>Server info</h2>
            </div>
          </div>
          <dl className="info-list">
            <div><dt>Status</dt><dd><span className="status-pill" data-tone={presentation?.tone}>{presentation?.label ?? "Loading"}</span></dd></div>
            <div><dt>Server name</dt><dd>{status?.connection.serverName ?? "—"}</dd></div>
            <div className="info-stack">
              <dt>Join address</dt>
              <dd className="join-address">
                <code>{joinAddress}</code>
                <button onClick={copyJoinAddress} disabled={!status}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </dd>
            </div>
            <div><dt>Panel host</dt><dd>{browserHost || "—"}</dd></div>
            <div><dt>Container IP</dt><dd>{status?.connection.localAddresses.join(", ") || "Not detected"}</dd></div>
            <div><dt>Public address</dt><dd>{status?.connection.publicAddress || "Not configured"}</dd></div>
            <div><dt>Game port</dt><dd><code>{status?.connection.gamePort ?? "—"} / UDP</code></dd></div>
            <div><dt>Player ports</dt><dd><code>{status ? `${status.connection.playerPortStart}–${status.connection.playerPortEnd} / UDP` : "—"}</code></dd></div>
            <div><dt>Steam ports</dt><dd><code>8766–8767 / UDP</code></dd></div>
            <div><dt>RCON</dt><dd><code>{status?.connection.rconPort ?? "—"} / TCP</code></dd></div>
            <div><dt>Web panel</dt><dd><code>{status?.connection.webPort ?? "—"} / TCP</code></dd></div>
            <div><dt>Network</dt><dd>{status?.connection.networkMode ?? "—"}</dd></div>
          </dl>
          <p className="info-help">
            Set <code>public_address</code> in <code>manager.toml</code> for the internet join
            address. Forward the game, player, and Steam UDP ports; keep RCON private.
          </p>
        </section>
      </div>

      <section className="install-panel">
        <h2>Install &amp; update</h2>
        <div className="installation-status" data-installed={status?.installation.installed ?? false}>
          <strong>
            {status?.installation.installed
              ? "Server build installed"
              : status?.installation.simulated
                ? "No real build installed (simulation)"
                : "Server build not installed"}
          </strong>
          {status?.installation.buildId && <span>Steam build {status.installation.buildId}</span>}
          {status?.installation.lastUpdated && (
            <span>Updated {new Date(status.installation.lastUpdated).toLocaleString()}</span>
          )}
        </div>
        {changingBuild && status?.installation.installed && (
          <div className="notice-warning" role="alert">
            <strong>Build switch detected.</strong> Build 41 and Build 42 worlds are incompatible.
            A backup will be created before the current map and player database are erased.
            <label className="row" style={{ marginTop: "0.75rem" }}>
              <input
                type="checkbox"
                checked={eraseForSwitch}
                onChange={(event) => setEraseForSwitch(event.target.checked)}
                style={{ width: "auto" }}
              />
              Erase the current world after the new build downloads
            </label>
            {eraseForSwitch && (
              <label>
                Type ERASE CURRENT WORLD
                <input
                  value={switchConfirmation}
                  onChange={(event) => setSwitchConfirmation(event.target.value)}
                  placeholder="ERASE CURRENT WORLD"
                  style={{ maxWidth: 260 }}
                />
              </label>
            )}
          </div>
        )}
        <div className="row">
          <label>
            Build / branch
            <select
              value={branchChoice}
              onChange={(e) => setBranchChoice(e.target.value as BranchChoice)}
              style={{ maxWidth: 280 }}
            >
              {KNOWN_BRANCHES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          {branchChoice === "custom" && (
            <label>
              Branch name
              <input
                value={customBranch}
                onChange={(e) => setCustomBranch(e.target.value)}
                placeholder="e.g. b41"
                style={{ maxWidth: 200 }}
              />
            </label>
          )}
        </div>
        <div className="row">
          <button
            disabled={busy || status?.running}
            onClick={() => runAction("/api/server/install", { betaBranch: effectiveBranch })}
          >
            <IconDownload />
            {status?.installation.simulated ? "Simulate install" : "Install"}
          </button>
          <button
            disabled={
              busy ||
              status?.running ||
              (changingBuild &&
                status?.installation.installed &&
                (!eraseForSwitch || switchConfirmation !== "ERASE CURRENT WORLD"))
            }
            onClick={() =>
              runAction("/api/server/update", {
                betaBranch: effectiveBranch,
                eraseWorld: changingBuild && eraseForSwitch,
                confirmation: changingBuild ? switchConfirmation : undefined,
              })
            }
          >
            <IconDownload />
            {status?.installation.simulated
              ? "Simulate update"
              : changingBuild
                ? "Switch build"
                : "Update"}
          </button>
        </div>
      </section>
    </div>
  );
}
