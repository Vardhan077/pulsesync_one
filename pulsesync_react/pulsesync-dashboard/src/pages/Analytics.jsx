import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  RefreshCw,
  Users,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const Metric = ({ label, value, note, icon: Icon }) => (
  <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
    <div className="flex items-center justify-between">
      <span className="text-sm font-semibold text-[#64748B]">{label}</span>
      <Icon size={17} className="text-[#64748B]" />
    </div>
    <div className="mt-3 text-2xl font-bold tracking-tight text-[#0F172A]">{value}</div>
    <div className="mt-1 text-xs font-medium text-[#64748B]">{note}</div>
  </div>
);

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${API_URL}/api/analytics/overview`);
      if (!res.ok) throw new Error(`Analytics API returned ${res.status}`);
      setData(await res.json());
    } catch (err) {
      console.error(err);
      setError("Analytics could not be loaded. Check the backend connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totals = data?.totals || {};
  const objectionThemes = data?.objection_themes || [];
  const callTypes = useMemo(() => Object.entries(data?.calls_by_type || {}).sort((a, b) => b[1] - a[1]), [data]);
  const recent = data?.recent_meetings || [];
  const hasData = Number(totals.meetings || 0) > 0;

  if (loading) {
    return <div className="p-7 text-sm text-[#64748B]">Loading analytics…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] p-7 space-y-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-[#0D9488]">Workspace analytics</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0F172A]">Conversation intelligence</h1>
          <p className="mt-1 text-sm text-[#64748B]">Live metrics calculated from processed meetings and verified transcript data.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-bold text-[#475569] hover:bg-[#F8FAFC]">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>}

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-12 text-center">
          <Activity size={24} className="mx-auto text-[#94A3B8]" />
          <h2 className="mt-3 text-base font-bold text-[#0F172A]">No processed meeting data yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#64748B]">Complete a meeting capture and verify its transcript. Analytics will populate automatically from real meeting records.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Processed meetings" value={totals.meetings} note="Completed or review-ready meetings" icon={MessageSquareText} />
            <Metric label="Accounts represented" value={totals.accounts} note="Meetings linked to a company" icon={Users} />
            <Metric label="Conversation time" value={formatDuration(totals.duration_seconds)} note="Across processed meetings" icon={Clock3} />
            <Metric label="Action items" value={totals.action_items} note={`${totals.risks || 0} risks · ${totals.objections || 0} objections captured`} icon={CheckCircle2} />
          </div>

          <div className="grid grid-cols-[1.4fr_.8fr] gap-5">
            <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
              <div className="border-b border-[#F1F5F9] px-5 py-4">
                <h2 className="font-bold text-[#0F172A]">Recent processed meetings</h2>
                <p className="mt-0.5 text-xs text-[#64748B]">Directly backed by the meetings and analytics tables.</p>
              </div>
              <div className="divide-y divide-[#F1F5F9]">
                {recent.map((meeting) => (
                  <div key={meeting.id} className="grid grid-cols-[1.5fr_.7fr_.7fr_.8fr] items-center gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-[#0F172A]">{meeting.title || "Untitled meeting"}</div>
                      <div className="mt-1 text-xs text-[#64748B]">{formatDate(meeting.date)} · {formatDuration(meeting.duration_seconds)}</div>
                    </div>
                    <div className="text-xs font-semibold text-[#475569]">{meeting.call_type?.replaceAll("_", " ") || "Unknown"}</div>
                    <div className="text-xs text-[#64748B]">{meeting.template_used || "No profile"}</div>
                    <div className="text-right text-[11px] font-semibold text-[#64748B]">{meeting.action_items} actions · {meeting.objections} objections</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center gap-2"><CalendarClock size={17} className="text-[#64748B]" /><h2 className="font-bold text-[#0F172A]">Call mix</h2></div>
              <div className="mt-5 space-y-3">
                {callTypes.map(([type, count]) => {
                  const pct = Math.round((count / totals.meetings) * 100);
                  return <div key={type}><div className="flex justify-between text-xs"><span className="font-semibold capitalize text-[#475569]">{type.replaceAll("_", " ")}</span><span className="font-bold text-[#0F172A]">{count} · {pct}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F1F5F9]"><div className="h-full rounded-full bg-[#0D9488]" style={{ width: `${pct}%` }} /></div></div>;
                })}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center gap-2"><AlertTriangle size={17} className="text-[#64748B]" /><h2 className="font-bold text-[#0F172A]">Objection themes</h2></div>
              {objectionThemes.length ? <div className="mt-5 flex flex-wrap gap-2">{objectionThemes.map(({ theme, count }) => <span key={theme} className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs font-semibold capitalize text-[#475569]">{theme} · {count}</span>)}</div> : <p className="mt-5 text-sm text-[#94A3B8]">No objection themes have been captured yet.</p>}
            </section>
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center gap-2"><Activity size={17} className="text-[#64748B]" /><h2 className="font-bold text-[#0F172A]">Data coverage</h2></div>
              <div className="mt-5 grid grid-cols-3 gap-4 text-center">
                <div><div className="text-2xl font-bold text-[#0F172A]">{totals.risks}</div><div className="mt-1 text-xs text-[#64748B]">Risks</div></div>
                <div><div className="text-2xl font-bold text-[#0F172A]">{totals.objections}</div><div className="mt-1 text-xs text-[#64748B]">Objections</div></div>
                <div><div className="text-2xl font-bold text-[#0F172A]">{totals.action_items}</div><div className="mt-1 text-xs text-[#64748B]">Actions</div></div>
              </div>
              <p className="mt-5 text-xs text-[#94A3B8]">These counts are evidence-backed outputs stored for the workspace; no synthetic KPI targets are displayed.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
