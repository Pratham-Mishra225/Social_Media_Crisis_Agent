import { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./App.css";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

const AGENT_META = {
  "Social Media Monitor": { abbr: "MON", color: "#60a5fa", icon: "📡" },
  "Crisis Severity Classifier": { abbr: "SEV", color: "#fbbf24", icon: "⚖️" },
  "Brand Response Strategist": { abbr: "STR", color: "#c084fc", icon: "🧭" },
  "PR Response Copywriter": { abbr: "DFT", color: "#34d399", icon: "✍️" },
  "Post-Response Sentiment Monitor": { abbr: "FBK", color: "#fb923c", icon: "🔁" },
  "System": { abbr: "SYS", color: "#475569", icon: "⚙️" },
};

const SEVERITY_CONFIG = {
  IDLE: { color: "#334155", glow: "transparent", label: "STANDBY" },
  LOW: { color: "#22c55e", glow: "rgba(34,197,94,0.3)", label: "LOW" },
  MODERATE: { color: "#f59e0b", glow: "rgba(245,158,11,0.3)", label: "MODERATE" },
  CRITICAL: { color: "#ef4444", glow: "rgba(239,68,68,0.35)", label: "CRITICAL" },
};

const PIPELINE = [
  { key: "monitor", label: "Monitor", agent: "Social Media Monitor", icon: "📡" },
  { key: "severity", label: "Severity", agent: "Crisis Severity Classifier", icon: "⚖️" },
  { key: "strategy", label: "Strategy", agent: "Brand Response Strategist", icon: "🧭" },
  { key: "draft", label: "Draft", agent: "PR Response Copywriter", icon: "✍️" },
  { key: "feedback", label: "Feedback", agent: "Post-Response Sentiment Monitor", icon: "🔁" },
];

function PipelineTracker({ events, crewStatus }) {
  const completedAgents = new Set(
    events.filter(e => e.type === "agent_complete").map(e => e.agent)
  );
  const activeAgent = events.filter(e => e.type === "agent_start").slice(-1)[0]?.agent;

  return (
    <div className="pipeline">
      <div className="pipeline-nodes-row">
        {PIPELINE.map((step, i) => {
          const done = completedAgents.has(step.agent);
          const active = activeAgent === step.agent && crewStatus === "running";
          return (
            <div key={step.key} className="pipeline-node-wrap">
              <div className={`pipeline-node ${done ? "done" : active ? "active" : "pending"}`}>
                <span className="pipeline-icon">{step.icon}</span>
                {active && <span className="pipeline-pulse" />}
              </div>
              {i < PIPELINE.length - 1 && (
                <div className={`pipeline-line ${done ? "done" : ""}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="pipeline-labels-row">
        {PIPELINE.map((step) => {
          const done = completedAgents.has(step.agent);
          const active = activeAgent === step.agent && crewStatus === "running";
          return (
            <div key={step.key} className="pipeline-label-wrap">
              <span className={`pipeline-label ${done ? "done" : active ? "active" : ""}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, sublabel }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sublabel && <div className="stat-sub">{sublabel}</div>}
    </div>
  );
}

function TweetCard({ tweet, responded }) {
  const totalEng = (tweet.likes || 0) + (tweet.retweets || 0);
  const isViral = totalEng > 3000;
  const isMedia = tweet.user?.match(/news|watch|cnn|breaking/i);
  return (
    <div className={`tweet-card ${isViral ? "viral" : ""}`}>
      <div className="tweet-top">
        <div className="tweet-avatar">{tweet.user?.[1]?.toUpperCase()}</div>
        <div className="tweet-meta">
          <span className="tweet-user">{tweet.user}</span>
          <span className="tweet-time">
            {tweet.timestamp ? new Date(tweet.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
          </span>
        </div>
        <div className="tweet-tags">
          {isMedia && <span className="tag tag-media">MEDIA</span>}
          {isViral && <span className="tag tag-viral">VIRAL</span>}
          {responded && <span className="tag tag-replied">REPLIED</span>}
        </div>
      </div>
      <div className="tweet-body">{tweet.text}</div>
      <div className="tweet-stats">
        <span>♥ {tweet.likes?.toLocaleString()}</span>
        <span>↻ {tweet.retweets?.toLocaleString()}</span>
        <span className="tweet-reach">{totalEng.toLocaleString()} reach</span>
      </div>
    </div>
  );
}

function AgentThought({ event }) {
  const meta = AGENT_META[event.agent] || { abbr: "???", color: "#64748b", icon: "·" };
  const isSys = event.agent === "System";
  const isTool = event.type === "tool_call" || event.type === "tool_result";
  return (
    <div className={`thought ${isSys ? "thought-sys" : ""} ${isTool ? "thought-tool" : ""}`}>
      <div className="thought-left">
        <span className="thought-icon">{meta.icon}</span>
        <span className="thought-abbr" style={{ color: meta.color }}>{meta.abbr}</span>
      </div>
      <div className="thought-right">
        <div className="thought-toprow">
          <span className="thought-agent" style={{ color: meta.color }}>{event.agent}</span>
          <span className="thought-time">
            {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          {isTool && <span className="tag-tool">TOOL</span>}
        </div>
        <div className="thought-msg">{event.message}</div>
      </div>
    </div>
  );
}

function SeverityGauge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.IDLE;
  const pct = severity === "CRITICAL" ? 100 : severity === "MODERATE" ? 60 : severity === "LOW" ? 25 : 0;
  return (
    <div className="gauge-wrap">
      <div className="gauge-title">THREAT LEVEL</div>
      <div className="gauge-value" style={{ color: cfg.color, filter: `drop-shadow(0 0 8px ${cfg.glow})` }}>
        {cfg.label}
      </div>
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: `${pct}%`, background: cfg.color, boxShadow: `0 0 10px ${cfg.glow}` }} />
      </div>
      <div className="gauge-ticks">
        {["LOW", "MODERATE", "CRITICAL"].map(lvl => (
          <span key={lvl} style={{
            color: SEVERITY_CONFIG[lvl].color,
            fontWeight: severity === lvl ? 700 : 400,
            opacity: severity === lvl ? 1 : 0.4
          }}>
            {lvl}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    idle: { label: "STANDBY", cls: "idle" },
    running: { label: "RUNNING", cls: "running" },
    completed: { label: "COMPLETED", cls: "completed" },
    error: { label: "ERROR", cls: "error" },
  };
  const s = map[status] || map.idle;
  return (
    <div className={`status-badge status-${s.cls}`}>
      <span className="status-dot" />{s.label}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [status, setStatus] = useState("idle");
  const [tweets, setTweets] = useState([]);
  const [wave, setWave] = useState(1);
  const [events, setEvents] = useState([]);
  const [severity, setSeverity] = useState("IDLE");
  const [responses, setResponses] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [stats, setStats] = useState({ tweets: 0, reach: 0, responses: 0 });
  const pollingRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => { loadTweets(1); }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  async function loadTweets(w) {
    try {
      const res = await axios.get(`${API}/tweets/${w}`);
      const data = res.data.tweets || [];
      setTweets(data);
      setWave(w);
      const reach = data.reduce((s, t) => s + (t.likes || 0) + (t.retweets || 0), 0);
      setStats(prev => ({ ...prev, tweets: data.length, reach }));
    } catch (e) { console.error(e); }
  }

  function parseSeverity(evts) {
    for (const e of [...evts].reverse()) {
      if (e.message?.includes("CRITICAL")) return "CRITICAL";
      if (e.message?.includes("MODERATE")) return "MODERATE";
      if (e.message?.includes("LOW") && !e.message?.includes("FOLLOW")) return "LOW";
    }
    return null;
  }

  function parseResponses(txt) {
    if (!txt) return [];
    return txt.split("\n")
      .filter(l => l.trim().startsWith("TWEET"))
      .map(l => { const m = l.match(/TWEET (\d+) \((@[\w_]+)\):\s*(.+)/); return m ? { id: m[1], user: m[2], text: m[3].trim() } : null; })
      .filter(Boolean);
  }

  function parseRecommendation(evts) {
    for (const e of [...evts].reverse()) {
      if (e.message?.includes("ESCALATE")) return "ESCALATE";
      if (e.message?.includes("FOLLOW UP")) return "FOLLOW UP";
      if (e.message?.includes("RESOLVED")) return "RESOLVED";
    }
    return null;
  }

  async function poll() {
    try {
      const [evtRes, statusRes] = await Promise.all([
        axios.get(`${API}/events`),
        axios.get(`${API}/status`),
      ]);
      const evts = evtRes.data.events || [];
      setEvents(evts);
      const sev = parseSeverity(evts);
      if (sev) setSeverity(sev);

      const crewStatus = statusRes.data.status;
      if (crewStatus === "completed" || crewStatus === "error") {
        setStatus(crewStatus);
        clearInterval(pollingRef.current);
        if (crewStatus === "completed") {
          const logsRes = await axios.get(`${API}/logs`);
          const parsed = parseResponses(logsRes.data.logs);
          setResponses(parsed);
          setStats(prev => ({ ...prev, responses: parsed.length }));
          setRecommendation(parseRecommendation(evts));
          await loadTweets(2);
        }
      }
    } catch (e) { console.error(e); }
  }

  async function handleRun() {
    setEvents([]); setResponses([]); setRecommendation(null);
    setSeverity("IDLE"); setStatus("running");
    pollingRef.current = setInterval(poll, 1200);
    try { await axios.post(`${API}/run`); }
    catch (e) { setStatus("error"); clearInterval(pollingRef.current); }
  }

  function handleInject() {
    clearInterval(pollingRef.current);
    setStatus("idle"); setEvents([]); setResponses([]);
    setRecommendation(null); setSeverity("IDLE");
    loadTweets(1);
  }

  const REC_CFG = {
    "ESCALATE": { color: "#ef4444", bg: "rgba(239,68,68,0.08)", icon: "🚨", text: "ESCALATE — HUMAN PR TEAM REQUIRED IMMEDIATELY" },
    "FOLLOW UP": { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", icon: "⏰", text: "FOLLOW UP — SECOND RESPONSE NEEDED IN 30 MIN" },
    "RESOLVED": { color: "#22c55e", bg: "rgba(34,197,94,0.08)", icon: "✅", text: "RESOLVED — CRISIS CONTAINED, MONITOR PASSIVELY" },
  };
  const recCfg = recommendation ? REC_CFG[recommendation] : null;

  return (
    <div className="app">

      {/* ── Topbar ─────────────────────────────────────────── */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-bolt">⚡</span>
          <div>
            <div className="brand-name">NovaBrew Crisis Command</div>
            <div className="brand-sub">Multi-Agent Social Media Response · CrewAI</div>
          </div>
        </div>

        <PipelineTracker events={events} crewStatus={status} />

        <div className="topbar-right">
          <StatusBadge status={status} />
          <button className="btn-ghost" onClick={handleInject}>💥 Inject Crisis</button>
          <button className={`btn-run ${status === "running" ? "btn-run-active" : ""}`}
            onClick={handleRun} disabled={status === "running"}>
            {status === "running" ? <><span className="spin">◌</span> Running…</> : "▶ Run Crew"}
          </button>
        </div>
      </header>

      {/* ── Alert Banner ───────────────────────────────────── */}
      {recCfg && (
        <div className="alert-bar" style={{ background: recCfg.bg, borderBottomColor: recCfg.color }}>
          <span className="alert-icon">{recCfg.icon}</span>
          <span style={{ color: recCfg.color }}>{recCfg.text}</span>
        </div>
      )}

      {/* ── Stats ──────────────────────────────────────────── */}
      <div className="stats-row">
        <StatCard label="Mentions Flagged" value={stats.tweets} color="#60a5fa" />
        <StatCard label="Total Reach" value={stats.reach.toLocaleString()} color="#f59e0b" sublabel="engagements" />
        <StatCard label="Responses Drafted" value={stats.responses} color="#34d399" />
        <StatCard label="Active Wave" value={`#${wave}`} color="#c084fc" />
      </div>

      {/* ── Workspace ──────────────────────────────────────── */}
      <div className="workspace">

        {/* Feed */}
        <section className="pane">
          <div className="pane-header">
            <span className="pane-title">📡 Live Feed</span>
            <span className="pane-meta">Wave {wave} · {tweets.length} tweets</span>
          </div>
          <div className="scroll-area">
            {tweets.length === 0 && <div className="empty">No data yet.<br />Click Inject Crisis.</div>}
            {tweets.map((t, i) => (
              <TweetCard key={t.id || i} tweet={t} responded={responses.some(r => r.user === t.user)} />
            ))}
          </div>
        </section>

        {/* Agent Log */}
        <section className="pane pane-wide">
          <div className="pane-header">
            <span className="pane-title">🤖 Agent Activity</span>
            <span className="pane-meta">{events.length} events</span>
          </div>
          <div className="scroll-area log-area" ref={logRef}>
            {events.length === 0 && <div className="empty">Crew is idle.<br />Hit Run Crew to begin.</div>}
            {events.map(e => <AgentThought key={e.id} event={e} />)}
            {status === "running" && (
              <div className="typing"><span /><span /><span /></div>
            )}
          </div>
        </section>

        {/* Right column */}
        <section className="pane">
          <SeverityGauge severity={severity} />
          <div className="pane-divider" />
          <div className="pane-header">
            <span className="pane-title">✍️ Drafted Responses</span>
            {responses.length > 0 && <span className="pane-meta">{responses.length} posted</span>}
          </div>
          <div className="scroll-area">
            {responses.length === 0 && <div className="empty">Waiting for drafter agent…</div>}
            {responses.map(r => (
              <div key={r.id} className="resp-card">
                <div className="resp-meta">
                  <span className="resp-to">→ {r.user}</span>
                  <span className="resp-badge">POSTED</span>
                </div>
                <div className="resp-body">{r.text}</div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}