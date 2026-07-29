import { useState } from "react";
import { PUT } from "../api/client.js";

export function Settings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await PUT<{ username: string }>("/api/settings/account", {
        currentPassword,
        newUsername: newUsername || undefined,
        newPassword: newPassword || undefined,
      });
      setMessage(`Account updated (username: ${result.username})`);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section>
      <h2>Account settings</h2>
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="row" style={{ flexDirection: "column", alignItems: "stretch", maxWidth: 320 }}>
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label>
          New username
          <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
        </label>
        <label>
          New password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <button className="btn-primary" onClick={save} style={{ justifyContent: "center" }}>
          Save
        </button>
      </div>
    </section>
  );
}
