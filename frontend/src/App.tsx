import { useEffect, useState } from "react";
import { authCheck, POST } from "./api/client.js";
import { ActivityConsole } from "./ActivityConsole.js";
import { VersionBadge } from "./sections/VersionBadge.js";
import { Login } from "./sections/Login.js";
import { Dashboard } from "./sections/Dashboard.js";
import { Metrics } from "./sections/Metrics.js";
import { Players } from "./sections/Players.js";
import { Console } from "./sections/Console.js";
import { Mods } from "./sections/Mods.js";
import { ServerSettings } from "./sections/ServerSettings.js";
import { Sandbox } from "./sections/Sandbox.js";
import { ConfigEditor } from "./sections/ConfigEditor.js";
import { Logs } from "./sections/Logs.js";
import { Backups } from "./sections/Backups.js";
import { Audit } from "./sections/Audit.js";
import { Settings } from "./sections/Settings.js";
import { System } from "./sections/System.js";
import { MapMods } from "./sections/MapMods.js";
import {
  IconDashboard,
  IconActivity,
  IconUsers,
  IconTerminal,
  IconMods,
  IconMap,
  IconSliders,
  IconConfig,
  IconLogs,
  IconArchive,
  IconHistory,
  IconSettings,
  IconSystem,
  IconLogout,
} from "./icons.js";

type Section =
  | "dashboard"
  | "metrics"
  | "players"
  | "console"
  | "mods"
  | "maps"
  | "server-settings"
  | "sandbox"
  | "config"
  | "logs"
  | "backups"
  | "audit"
  | "settings"
  | "system";

const SECTIONS: { key: Section; label: string; icon: typeof IconDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: IconDashboard },
  { key: "metrics", label: "Metrics", icon: IconActivity },
  { key: "players", label: "Players", icon: IconUsers },
  { key: "console", label: "Console", icon: IconTerminal },
  { key: "mods", label: "Mods", icon: IconMods },
  { key: "maps", label: "Map Mods", icon: IconMap },
  { key: "server-settings", label: "Server Settings", icon: IconMap },
  { key: "sandbox", label: "Sandbox", icon: IconSliders },
  { key: "config", label: "Config", icon: IconConfig },
  { key: "logs", label: "Logs", icon: IconLogs },
  { key: "backups", label: "Backups", icon: IconArchive },
  { key: "audit", label: "Audit", icon: IconHistory },
  { key: "settings", label: "Settings", icon: IconSettings },
  { key: "system", label: "System", icon: IconSystem },
];

const SECTION_LABELS: Record<Section, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.key, s.label]),
) as Record<Section, string>;

export function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("dashboard");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    authCheck()
      .then((res) => setUsername(res.authenticated ? (res.username ?? null) : null))
      .catch((err) => setAuthError(err instanceof Error ? err.message : String(err)))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navOpen]);

  if (!checked) {
    return (
      <div className="app-loading" role="status">
        Connecting to server manager…
        <VersionBadge />
      </div>
    );
  }

  if (!username) {
    return (
      <>
        {authError && (
          <div className="startup-error" role="alert">
            Cannot reach the API: {authError}
          </div>
        )}
        <Login onLoggedIn={setUsername} />
        <VersionBadge />
      </>
    );
  }

  const logout = async () => {
    await POST("/api/auth/logout");
    setUsername(null);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${navOpen ? " is-open" : ""}`} id="main-navigation">
        <div className="sidebar-brand">Zomboid Manager</div>
        <ul className="sidebar-nav">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <button
                onClick={() => {
                  setSection(s.key);
                  setNavOpen(false);
                }}
                aria-current={section === s.key ? "page" : undefined}
              >
                <s.icon />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <button
            className="nav-toggle"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            aria-controls="main-navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <span className="topbar-title">{SECTION_LABELS[section]}</span>
          <span className="topbar-user">{username}</span>
          <button onClick={logout}>
            <IconLogout />
            Log out
          </button>
        </header>
        <main className="content">
          {section === "dashboard" && <Dashboard />}
          {section === "metrics" && <Metrics />}
          {section === "players" && <Players />}
          {section === "console" && <Console />}
          {section === "mods" && <Mods />}
          {section === "maps" && <MapMods />}
          {section === "server-settings" && <ServerSettings />}
          {section === "sandbox" && <Sandbox />}
          {section === "config" && <ConfigEditor />}
          {section === "logs" && <Logs />}
          {section === "backups" && <Backups />}
          {section === "audit" && <Audit />}
          {section === "settings" && <Settings />}
          {section === "system" && <System />}
        </main>
      </div>
      {navOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <ActivityConsole />
      <VersionBadge />
    </div>
  );
}
