import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import "./App.css";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

/* ══════════════════════════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════════════════════════ */

const AGENT_META = {
  "Social Media Monitor":           { abbr: "MON", color: "#60a5fa", icon: "📡", label: "Monitor" },
  "Crisis Severity Classifier":     { abbr: "SEV", color: "#fbbf24", icon: "⚖️", label: "Severity" },
  "Brand Response Strategist":      { abbr: "STR", color: "#c084fc", icon: "🧭", label: "Strategy" },
  "PR Response Copywriter":         { abbr: "DFT", color: "#34d399", icon: "✍️", label: "Draft" },
  "Post-Response Sentiment Monitor":{ abbr: "FBK", color: "#fb923c", icon: "🔁", label: "Feedback" },
  System:                           { abbr: "SYS", color: "#475569", icon: "⚙️", label: "System" },
};

const SEVERITY_CONFIG = {
  IDLE:     { color: "#334155", glow: "transparent",          label: "STANDBY",  pct: 0   },
  LOW:      { color: "#22c55e", glow: "rgba(34,197,94,0.3)",  label: "LOW",      pct: 25  },
  MODERATE: { color: "#f59e0b", glow: "rgba(245,158,11,0.3)", label: "MODERATE", pct: 60  },
  CRITICAL: { color: "#ef4444", glow: "rgba(239,68,68,0.35)", label: "CRITICAL", pct: 100 },
};

const PIPELINE = [
  { key: "monitor",  label: "Monitor",  agent: "Social Media Monitor",           icon: "📡" },
  { key: "severity", label: "Severity", agent: "Crisis Severity Classifier",     icon: "⚖️" },
  { key: "strategy", label: "Strategy", agent: "Brand Response Strategist",      icon: "🧭" },
  { key: "draft",    label: "Draft",    agent: "PR Response Copywriter",         icon: "✍️" },
  { key: "feedback", label: "Feedback", agent: "Post-Response Sentiment Monitor",icon: "🔁" },
];

const ACTION_META = {
  monitor_only:        { icon: "🛡️", color: "#22c55e", label: "Monitor Only" },
  respond_publicly:    { icon: "📢", color: "#f59e0b", label: "Respond Publicly" },
  respond_and_escalate:{ icon: "🚨", color: "#ef4444", label: "Respond & Escalate" },
};

const TONE_META = {
  apologetic:    { icon: "🙏", color: "#60a5fa", label: "Apologetic" },
  investigative: { icon: "🔍", color: "#c084fc", label: "Investigative" },
  reassuring:    { icon: "💚", color: "#34d399", label: "Reassuring" },
};

/* ══════════════════════════════════════════════════════════════════
   COMPONENTS
   ══════════════════════════════════════════════════════════════════ */

// ── Pipeline Tracker ────────────────────────────────────────────
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
                {done && <span className="pipeline-check">✓</span>}
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

// ── Animated Stat Card ──────────────────────────────────────────
function StatCard({ label, value, color, sublabel, icon }) {
  return (
    <div className="stat-card glass">
      <div className="stat-icon" style={{ color }}>{icon}</div>
      <div className="stat-content">
        <div className="stat-value" style={{ color }}>{value}</div>
        <div className="stat-label">{label}</div>
        {sublabel && <div className="stat-sub">{sublabel}</div>}
      </div>
    </div>
  );
}

// ── Tweet Card ──────────────────────────────────────────────────
function TweetCard({ tweet, responded, draftedReply }) {
  const totalEng = (tweet.likes || 0) + (tweet.retweets || 0);
  const isViral = totalEng > 3000;
  const isMedia = tweet.user?.match(/news|watch|cnn|breaking/i);
  const sentiment = "negative";

  return (
    <div className={`tweet-card ${isViral ? "viral" : ""}`} data-sentiment={sentiment}>
      <div className="tweet-top">
        <div className="tweet-avatar" style={{ background: isMedia ? "rgba(129,140,248,0.2)" : undefined }}>
          {tweet.user?.[1]?.toUpperCase()}
        </div>
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
      {draftedReply && (
        <div className="tweet-reply">
          <div className="tweet-reply-label">🤖 AI Reply</div>
          <div className="tweet-reply-text">{draftedReply}</div>
        </div>
      )}
    </div>
  );
}

// ── Agent Thought (single event) ────────────────────────────────
function AgentThought({ event }) {
  const meta = AGENT_META[event.agent] || { abbr: "???", color: "#64748b", icon: "·" };
  const isSys = event.agent === "System";
  const isTool = event.type === "tool_call" || event.type === "tool_result";
  const isFinal = event.type === "final_answer";
  return (
    <div className={`thought ${isSys ? "thought-sys" : ""} ${isTool ? "thought-tool" : ""} ${isFinal ? "thought-final" : ""}`}>
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
          {isFinal && <span className="tag-final">RESULT</span>}
        </div>
        <div className="thought-msg">{event.message}</div>
      </div>
    </div>
  );
}

// ── Severity Gauge (radial arc) ─────────────────────────────────
function SeverityGauge({ severity, reasoning }) {
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.IDLE;
  const isCritical = severity === "CRITICAL";

  const radius = 70;
  const circumference = Math.PI * radius;
  const dashOffset = circumference - (cfg.pct / 100) * circumference;

  return (
    <div className={`gauge-wrap ${isCritical ? "gauge-critical" : ""}`}>
      <div className="gauge-title">THREAT LEVEL</div>
      <div className="gauge-arc-container">
        <svg viewBox="0 0 180 100" className="gauge-svg">
          <path d="M 10 90 A 70 70 0 0 1 170 90" fill="none" stroke="var(--border2)" strokeWidth="8" strokeLinecap="round" />
          <path d="M 10 90 A 70 70 0 0 1 170 90" fill="none" stroke={cfg.color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={dashOffset}
            style={{ filter: `drop-shadow(0 0 6px ${cfg.glow})`, transition: "stroke-dashoffset 1s ease, stroke 0.5s ease" }}
          />
          <text x="10"  y="99" fill="#6a7e9a" fontSize="7" textAnchor="start">LOW</text>
          <text x="90"  y="30" fill="#6a7e9a" fontSize="7" textAnchor="middle">MOD</text>
          <text x="170" y="99" fill="#6a7e9a" fontSize="7" textAnchor="end">CRIT</text>
        </svg>
        <div className="gauge-center-label" style={{ color: cfg.color, filter: `drop-shadow(0 0 12px ${cfg.glow})` }}>
          {cfg.label}
        </div>
      </div>
      {reasoning && <div className="gauge-reasoning">{reasoning}</div>}
    </div>
  );
}

// ── Strategy Decision Card ──────────────────────────────────────
function StrategyCard({ strategy }) {
  if (!strategy) {
    return (
      <div className="strategy-card glass strategy-placeholder">
        <div className="strategy-title">🧭 RESPONSE STRATEGY</div>
        <div className="strategy-waiting">Awaiting strategist agent…</div>
      </div>
    );
  }

  const actionCfg = ACTION_META[strategy.action] || { icon: "❓", color: "#64748b", label: strategy.action };
  const toneCfg   = TONE_META[strategy.tone]     || { icon: "❓", color: "#64748b", label: strategy.tone };

  return (
    <div className="strategy-card glass">
      <div className="strategy-title">🧭 RESPONSE STRATEGY</div>
      <div className="strategy-fields">
        <div className="strategy-field">
          <span className="strategy-field-label">ACTION</span>
          <span className="strategy-pill" style={{ borderColor: actionCfg.color, color: actionCfg.color }}>
            {actionCfg.icon} {actionCfg.label}
          </span>
        </div>
        <div className="strategy-field">
          <span className="strategy-field-label">TONE</span>
          <span className="strategy-pill" style={{ borderColor: toneCfg.color, color: toneCfg.color }}>
            {toneCfg.icon} {toneCfg.label}
          </span>
        </div>
        <div className="strategy-field">
          <span className="strategy-field-label">ESCALATE</span>
          <span className={`strategy-escalate ${strategy.escalate ? "yes" : "no"}`}>
            {strategy.escalate ? "🔴 YES" : "🟢 NO"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Agent Insight Summary Panel ─────────────────────────────────
function AgentInsightPanel({ decisions, responses }) {
  const insights = [
    {
      agent: "Social Media Monitor",
      summary: decisions?.monitor_summary
        ? `${decisions.monitor_summary.flagged_count} mentions flagged · ${decisions.monitor_summary.total_engagement?.toLocaleString()} engagement`
        : null,
    },
    {
      agent: "Crisis Severity Classifier",
      summary: decisions?.severity ? decisions.severity.level : null,
      badge: decisions?.severity?.level,
      badgeColor: SEVERITY_CONFIG[decisions?.severity?.level]?.color,
    },
    {
      agent: "Brand Response Strategist",
      summary: decisions?.strategy
        ? `${(ACTION_META[decisions.strategy.action]?.label || decisions.strategy.action)} · ${(TONE_META[decisions.strategy.tone]?.label || decisions.strategy.tone)} tone`
        : null,
    },
    {
      agent: "PR Response Copywriter",
      summary: responses?.length > 0 ? `${responses.length} replies drafted & posted` : null,
    },
    {
      agent: "Post-Response Sentiment Monitor",
      summary: decisions?.recommendation ? `${decisions.recommendation.status}` : null,
      badge: decisions?.recommendation?.status,
      badgeColor: decisions?.recommendation?.status === "ESCALATE" ? "#ef4444"
                : decisions?.recommendation?.status === "FOLLOW UP" ? "#f59e0b" : "#22c55e",
    },
  ];

  const hasAny = insights.some(i => i.summary);
  if (!hasAny) return null;

  return (
    <div className="insight-panel glass">
      <div className="insight-title">⚡ Agent Decision Summary</div>
      <div className="insight-cards">
        {insights.map(ins => {
          const meta = AGENT_META[ins.agent];
          return (
            <div key={ins.agent} className="insight-card" style={{ borderLeftColor: meta.color }}>
              <span className="insight-icon">{meta.icon}</span>
              <span className="insight-label">{meta.label}</span>
              {ins.badge && (
                <span className="insight-badge" style={{ color: ins.badgeColor, borderColor: ins.badgeColor }}>
                  {ins.badge}
                </span>
              )}
              {!ins.badge && ins.summary && (
                <span className="insight-summary">{ins.summary}</span>
              )}
              {!ins.summary && <span className="insight-summary insight-pending">pending…</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Engagement Chart ────────────────────────────────────────────
function EngagementChart({ tweets }) {
  const chartData = useMemo(() => {
    let cumulative = 0;
    return tweets.map(t => {
      const eng = (t.likes || 0) + (t.retweets || 0);
      cumulative += eng;
      return {
        time: t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
        engagement: eng,
        cumulative,
        wave: t.wave || 1,
        user: t.user,
      };
    });
  }, [tweets]);

  if (chartData.length === 0) return null;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="chart-tooltip glass">
        <div className="chart-tooltip-user">{d.user}</div>
        <div>Engagement: <strong>{d.engagement.toLocaleString()}</strong></div>
        <div>Cumulative: <strong>{d.cumulative.toLocaleString()}</strong></div>
        <div className="chart-tooltip-wave">Wave {d.wave}</div>
      </div>
    );
  };

  return (
    <div className="chart-container glass">
      <div className="chart-header">
        <span className="chart-title">📈 Engagement Escalation</span>
        <span className="chart-subtitle">Cumulative reach over time</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="engGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(34,47,72,0.5)" />
          <XAxis dataKey="time" tick={{ fill: "#6a7e9a", fontSize: 10 }} axisLine={{ stroke: "#222f48" }} />
          <YAxis tick={{ fill: "#6a7e9a", fontSize: 10 }} axisLine={{ stroke: "#222f48" }} width={50} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="cumulative" stroke="#ef4444" fill="url(#cumGrad)" strokeWidth={2}
            dot={{ r: 4, fill: "#ef4444", stroke: "#0d1220", strokeWidth: 2 }} animationDuration={1200} />
          <Area type="monotone" dataKey="engagement" stroke="#f59e0b" fill="url(#engGrad)" strokeWidth={2}
            dot={{ r: 3, fill: "#f59e0b", stroke: "#0d1220", strokeWidth: 2 }} animationDuration={1200} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Crisis Timeline ─────────────────────────────────────────────
function CrisisTimeline({ tweets, events, crewStatus }) {
  const milestones = useMemo(() => {
    const m = [];
    if (tweets.length > 0) {
      const first = tweets[0];
      m.push({ time: first.timestamp ? new Date(first.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
        label: "First complaint detected", color: "#ef4444", icon: "🔴" });
    }
    const mediaPost = tweets.find(t => t.user?.match(/news|watch|cnn|breaking/i));
    if (mediaPost) {
      m.push({ time: mediaPost.timestamp ? new Date(mediaPost.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
        label: `Media pickup (${mediaPost.user})`, color: "#f59e0b", icon: "🟡" });
    }
    const crewStart = events.find(e => e.type === "system" && e.message?.includes("triggered"));
    if (crewStart) {
      m.push({ time: new Date(crewStart.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        label: "AI Crew activated", color: "#22c55e", icon: "🟢" });
    }
    const wave2tweet = tweets.find(t => (t.wave || 1) === 2);
    if (wave2tweet) {
      m.push({ time: wave2tweet.timestamp ? new Date(wave2tweet.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
        label: "Crisis escalates — Wave 2", color: "#ef4444", icon: "🔴" });
    }
    if (crewStatus === "completed") {
      m.push({ time: "", label: "Response deployed", color: "#34d399", icon: "✅" });
    }
    return m;
  }, [tweets, events, crewStatus]);

  if (milestones.length === 0) return null;

  return (
    <div className="timeline">
      <div className="timeline-title">⏱ Crisis Timeline</div>
      {milestones.map((ms, i) => (
        <div key={i} className="tl-item">
          <div className="tl-line-wrap">
            <div className="tl-dot" style={{ background: ms.color, boxShadow: `0 0 8px ${ms.color}` }} />
            {i < milestones.length - 1 && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <span className="tl-time">{ms.time}</span>
            <span className="tl-label">{ms.icon} {ms.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Status Badge ────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    idle:      { label: "STANDBY",   cls: "idle" },
    running:   { label: "RUNNING",   cls: "running" },
    completed: { label: "COMPLETED", cls: "completed" },
    error:     { label: "ERROR",     cls: "error" },
  };
  const s = map[status] || map.idle;
  return (
    <div className={`status-badge status-${s.cls}`}>
      <span className="status-dot" />{s.label}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN APP
   ══════════════════════════════════════════════════════════════════ */

export default function App() {
  const [status, setStatus]             = useState("idle");
  const [tweets, setTweets]             = useState([]);
  const [wave, setWave]                 = useState(1);
  const [events, setEvents]             = useState([]);
  const [severity, setSeverity]         = useState("IDLE");
  const [responses, setResponses]       = useState([]);
  const [decisions, setDecisions]       = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [stats, setStats]               = useState({ tweets: 0, reach: 0, responses: 0 });

  const pollingRef = useRef(null);
  const logRef     = useRef(null);
  const sseRef     = useRef(null);

  useEffect(() => {
    connectStream();
    return () => { if (sseRef.current) sseRef.current.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectStream() {
    if (sseRef.current) sseRef.current.close();
    setTweets([]);
    setWave(1);
    setStats(prev => ({ ...prev, tweets: 0, reach: 0 }));

    const es = new EventSource(`${API}/stream`);
    sseRef.current = es;
    es.addEventListener("tweet", (e) => {
      try {
        const post = JSON.parse(e.data);
        setTweets(prev => [...prev, post]);
        setWave(post.wave || 1);
        setStats(prev => ({
          ...prev,
          tweets: prev.tweets + 1,
          reach: prev.reach + (post.likes || 0) + (post.retweets || 0),
        }));
      } catch (err) { console.error("SSE parse error", err); }
    });
    es.onerror = () => console.warn("SSE connection lost – will auto-reconnect");
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  function parseResponses(txt) {
    if (!txt) return [];
    return txt.split("\n")
      .filter(l => l.trim().startsWith("TWEET"))
      .map(l => {
        const m = l.match(/TWEET\s*(\d+)\s*\((@[\w_]+)\):\s*(.+)/);
        return m ? { id: m[1], user: m[2], text: m[3].trim() } : null;
      })
      .filter(Boolean);
  }

  async function poll() {
    try {
      const [evtRes, statusRes] = await Promise.all([
        axios.get(`${API}/events`),
        axios.get(`${API}/status`),
      ]);
      const evts = evtRes.data.events || [];
      setEvents(evts);

      try {
        const decRes = await axios.get(`${API}/decisions`);
        const dec = decRes.data;
        setDecisions(dec);
        if (dec.severity?.level) setSeverity(dec.severity.level);
        if (dec.recommendation?.status) setRecommendation(dec.recommendation.status);
      } catch (_) {}

      const crewStatus = statusRes.data.status;
      if (crewStatus === "completed" || crewStatus === "error") {
        setStatus(crewStatus);
        clearInterval(pollingRef.current);
        if (crewStatus === "completed") {
          const logsRes = await axios.get(`${API}/logs`);
          const parsed = parseResponses(logsRes.data.logs);
          setResponses(parsed);
          setStats(prev => ({ ...prev, responses: parsed.length }));

          try {
            const decRes = await axios.get(`${API}/decisions`);
            setDecisions(decRes.data);
            if (decRes.data.severity?.level) setSeverity(decRes.data.severity.level);
            if (decRes.data.recommendation?.status) setRecommendation(decRes.data.recommendation.status);
          } catch (_) {}

          try { await axios.post(`${API}/inject-crisis/2`); }
          catch (err) { console.warn("Wave 2 inject failed", err); }
        }
      }
    } catch (e) { console.error(e); }
  }

  async function handleRun() {
    setEvents([]); setResponses([]); setRecommendation(null); setDecisions(null);
    setSeverity("IDLE"); setStatus("running");
    pollingRef.current = setInterval(poll, 1200);
    try {
      await axios.post(`${API}/run`);
      // POST /run returns after crew finishes — do one final poll + decisions fetch
      await poll();
      // Delayed re-fetch to ensure decisions populated after extraction
      setTimeout(async () => {
        try {
          const decRes = await axios.get(`${API}/decisions`);
          const dec = decRes.data;
          setDecisions(dec);
          if (dec.severity?.level) setSeverity(dec.severity.level);
          if (dec.recommendation?.status) setRecommendation(dec.recommendation.status);
        } catch (_) {}
      }, 800);
    }
    catch (e) { setStatus("error"); clearInterval(pollingRef.current); }
  }

  async function handleInject() {
    clearInterval(pollingRef.current);
    setStatus("idle"); setEvents([]); setResponses([]);
    setRecommendation(null); setDecisions(null); setSeverity("IDLE");
    connectStream();
  }

  const REC_CFG = {
    "ESCALATE":  { color: "#ef4444", bg: "rgba(239,68,68,0.08)",  icon: "🚨", text: "ESCALATE — HUMAN PR TEAM REQUIRED IMMEDIATELY" },
    "FOLLOW UP": { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", icon: "⏰", text: "FOLLOW UP — SECOND RESPONSE NEEDED IN 30 MIN" },
    "RESOLVED":  { color: "#22c55e", bg: "rgba(34,197,94,0.08)",  icon: "✅", text: "RESOLVED — CRISIS CONTAINED, MONITOR PASSIVELY" },
  };
  const recCfg = recommendation ? REC_CFG[recommendation] : null;

  const responseMap = useMemo(() => {
    const map = {};
    responses.forEach(r => { map[r.user] = r.text; });
    return map;
  }, [responses]);

  const vignetteClass = severity === "CRITICAL" ? "vignette-critical"
                      : severity === "MODERATE" ? "vignette-moderate" : "";

  return (
    <div className={`app ${vignetteClass}`}>

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

      {recCfg && (
        <div className="alert-bar" style={{ background: recCfg.bg, borderBottomColor: recCfg.color }}>
          <span className="alert-icon">{recCfg.icon}</span>
          <span style={{ color: recCfg.color, fontWeight: 700 }}>{recCfg.text}</span>
          {decisions?.recommendation?.reason && (
            <span className="alert-reason">{decisions.recommendation.reason}</span>
          )}
        </div>
      )}

      <div className="metrics-row">
        <div className="stats-grid">
          <StatCard icon="📡" label="Mentions Flagged" value={stats.tweets} color="#60a5fa" />
          <StatCard icon="📊" label="Total Reach" value={stats.reach.toLocaleString()} color="#f59e0b" sublabel="engagements" />
          <StatCard icon="✍️" label="Responses Drafted" value={stats.responses} color="#34d399" />
          <StatCard icon="🌊" label="Active Wave" value={`#${wave}`} color="#c084fc" />
        </div>
        <EngagementChart tweets={tweets} />
      </div>

      <div className="workspace">

        <section className="pane">
          <div className="pane-header">
            <span className="pane-title">📡 Live Feed</span>
            <span className="pane-meta">Wave {wave} · {tweets.length} tweets</span>
          </div>
          <div className="scroll-area">
            <CrisisTimeline tweets={tweets} events={events} crewStatus={status} />
            {tweets.length === 0 && <div className="empty">No data yet.<br />Click <strong>Inject Crisis</strong> to begin.</div>}
            {tweets.map((t, i) => (
              <TweetCard key={t.id || i} tweet={t} responded={!!responseMap[t.user]} draftedReply={responseMap[t.user] || null} />
            ))}
          </div>
        </section>

        <section className="pane pane-wide">
          <div className="decision-strip">
            <SeverityGauge severity={severity} reasoning={decisions?.severity?.reasoning} />
            <StrategyCard strategy={decisions?.strategy} />
          </div>

          <AgentInsightPanel decisions={decisions} responses={responses} />
        </section>

      </div>

      <div className="bottom-panels">
        <section className="bottom-pane">
          <div className="pane-header">
            <span className="pane-title">🤖 Agent Activity</span>
            <span className="pane-meta">{events.length} events</span>
          </div>
          <div className="scroll-area log-area" ref={logRef}>
            {events.length === 0 && <div className="empty">Crew is idle. Hit <strong>Run Crew</strong> to begin.</div>}
            {events.map(e => <AgentThought key={e.id} event={e} />)}
            {status === "running" && (
              <div className="typing"><span /><span /><span /></div>
            )}
          </div>
        </section>

        <section className="bottom-pane">
          <div className="pane-header">
            <span className="pane-title">✍️ Drafted Responses</span>
            <span className="pane-meta">{responses.length} posted</span>
          </div>
          <div className="scroll-area resp-area">
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