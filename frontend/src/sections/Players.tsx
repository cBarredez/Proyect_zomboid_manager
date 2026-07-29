import { useCallback, useEffect, useState } from "react";
import { GET, POST } from "../api/client.js";
import { IconBan, IconTrash } from "../icons.js";

export function Players() {
  const [players, setPlayers] = useState<string[]>([]);
  const [unbanName, setUnbanName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await GET<{ players: string[] }>("/api/server/players");
      setPlayers(data.players);
      setError(null);
    } catch (err) {
      setPlayers([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const kick = async (username: string) => {
    setBusy(true);
    try {
      await POST(`/api/server/players/${encodeURIComponent(username)}/kick`);
      setMessage(`Kicked ${username}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ban = async (username: string) => {
    setBusy(true);
    try {
      await POST(`/api/server/players/${encodeURIComponent(username)}/ban`);
      setMessage(`Banned ${username}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const unban = async () => {
    if (!unbanName.trim()) return;
    setBusy(true);
    try {
      await POST("/api/server/players/unban", { username: unbanName.trim() });
      setMessage(`Unbanned ${unbanName.trim()}`);
      setUnbanName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section>
        <h2>Connected players</h2>
        {error && <p role="alert">{error}</p>}
        {message && <p>{message}</p>}

        {players.length === 0 ? (
          <p className="empty-state">No players connected (or the server isn't running).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {players.map((username) => (
                <tr key={username}>
                  <td>{username}</td>
                  <td style={{ textAlign: "right" }}>
                    <button disabled={busy} onClick={() => kick(username)} style={{ marginRight: "0.4rem" }}>
                      <IconTrash />
                      Kick
                    </button>
                    <button className="btn-danger" disabled={busy} onClick={() => ban(username)}>
                      <IconBan />
                      Ban
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Unban a player</h2>
        <p>Unbanning doesn't require the player to be online.</p>
        <div className="row">
          <input
            placeholder="Username"
            value={unbanName}
            onChange={(e) => setUnbanName(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button disabled={busy} onClick={unban}>
            Unban
          </button>
        </div>
      </section>
    </>
  );
}
