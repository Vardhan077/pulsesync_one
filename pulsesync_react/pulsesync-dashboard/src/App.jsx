import { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("pulsesync.apiToken") || "");
  const [needsToken, setNeedsToken] = useState(() => Boolean(import.meta.env.PROD && !localStorage.getItem("pulsesync.apiToken")));
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handler = () => {
      localStorage.removeItem("pulsesync.apiToken");
      setToken("");
      setDraft("");
      setNeedsToken(true);
      setMessage("The API token was rejected or has expired. Enter the configured PulseSync API token.");
    };
    window.addEventListener("pulsesync-auth-required", handler);
    return () => window.removeEventListener("pulsesync-auth-required", handler);
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) { setMessage("Enter the API token configured by your administrator."); return; }
    localStorage.setItem("pulsesync.apiToken", value);
    setToken(value);
    setNeedsToken(false);
    setMessage("");
  };

  if (needsToken) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 font-bold text-white">PS</div><div><h1 className="text-xl font-semibold text-slate-900">PulseSync AI</h1><p className="text-sm text-slate-500">Secure workspace access</p></div></div>
        <label htmlFor="api-token" className="mb-2 block text-sm font-medium text-slate-700">API access token</label>
        <input id="api-token" type="password" autoComplete="current-password" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Paste the token supplied by your administrator" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
        <button type="submit" className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800">Continue securely</button>
        <p className="mt-4 text-xs leading-5 text-slate-500">This build uses a self-hosted, single-tenant API token. It is not a substitute for per-user SSO, roles, or tenant isolation.</p>
      </form>
    </div>
  );
  return <Dashboard key={token || "development"} />;
}
