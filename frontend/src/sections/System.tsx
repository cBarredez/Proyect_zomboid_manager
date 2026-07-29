import { useEffect, useState } from "react";
import { GET, POST } from "../api/client.js";
import { IconRestart, IconWarning } from "../icons.js";

const CONFIRMATION_PHRASE = "RESET ALL ZOMBOID DATA";
const WORLD_CONFIRMATION_PHRASE = "ERASE CURRENT WORLD";

export function System() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worldExists, setWorldExists] = useState(false);
  const [worldConfirmation, setWorldConfirmation] = useState("");

  const refreshWorld = () =>
    GET<{ exists: boolean }>("/api/system/world").then((result) => setWorldExists(result.exists));

  useEffect(() => {
    refreshWorld().catch(() => {});
  }, []);

  const restart = async () => {
    await POST("/api/system/restart");
    setMessage("Restart scheduled.");
  };

  const factoryReset = async () => {
    setError(null);
    setMessage(null);
    try {
      await POST("/api/system/factory-reset", { currentPassword, confirmation });
      setMessage("Factory reset scheduled. The panel will restart shortly.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const eraseWorld = async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await POST<{ erased: boolean }>("/api/system/world/erase", {
        confirmation: worldConfirmation,
      });
      setMessage(
        result.erased
          ? "Current world erased. A recovery backup was created first."
          : "No current world save was found.",
      );
      setWorldConfirmation("");
      await refreshWorld();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <section>
        <h2>Panel</h2>
        {message && <p>{message}</p>}
        <div className="row">
          <button onClick={restart}>
            <IconRestart />
            Restart panel
          </button>
        </div>
      </section>

      <section className="danger-zone">
        <h2>
          <IconWarning style={{ color: "var(--danger)", verticalAlign: "-3px", marginRight: "0.4rem" }} />
          Current world
        </h2>
        <p>
          {worldExists ? "A saved multiplayer world exists." : "No saved multiplayer world was detected."}{" "}
          Stop the server, then type <code>{WORLD_CONFIRMATION_PHRASE}</code> to erase the map and
          player database. The panel creates a backup first and keeps the installation, settings,
          and mods.
        </p>
        <div className="row" style={{ flexDirection: "column", alignItems: "stretch", maxWidth: 360 }}>
          <input
            placeholder={WORLD_CONFIRMATION_PHRASE}
            value={worldConfirmation}
            onChange={(e) => setWorldConfirmation(e.target.value)}
          />
          <button
            className="btn-danger"
            disabled={!worldExists || worldConfirmation !== WORLD_CONFIRMATION_PHRASE}
            onClick={eraseWorld}
            style={{ justifyContent: "center" }}
          >
            <IconWarning />
            Erase current world
          </button>
        </div>
      </section>

      <section className="danger-zone">
        <h2>
          <IconWarning style={{ color: "var(--danger)", verticalAlign: "-3px", marginRight: "0.4rem" }} />
          Factory reset
        </h2>
        {error && <p role="alert">{error}</p>}
        <p>
          This permanently deletes the install dir, data dir, and SteamCMD dir. Type{" "}
          <code>{CONFIRMATION_PHRASE}</code> to confirm.
        </p>
        <div className="row" style={{ flexDirection: "column", alignItems: "stretch", maxWidth: 360 }}>
          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            placeholder={CONFIRMATION_PHRASE}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <button
            className="btn-danger"
            disabled={confirmation !== CONFIRMATION_PHRASE}
            onClick={factoryReset}
            style={{ justifyContent: "center" }}
          >
            Reset everything
          </button>
        </div>
      </section>
    </>
  );
}
