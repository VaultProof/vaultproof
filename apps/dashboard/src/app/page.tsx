const ACCENT = "#d97706";
const RULE = "1px solid #e7e5de";
const HAIR = "1px solid #eeece5";

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
};
const DISPLAY: React.CSSProperties = {
  fontFamily: "var(--font-inter-tight), 'Inter Tight', 'Inter', system-ui, sans-serif",
  fontWeight: 600,
};
const BODY: React.CSSProperties = {
  fontFamily: "var(--font-inter), 'Inter', system-ui, sans-serif",
};

type Project = {
  id: string;
  name: string;
  env: "production" | "staging" | "development";
  keys: number;
  callsMo: string;
  lastCall: string;
  status: "healthy" | "warning" | "alert" | "idle";
  exposed: number;
};

const PROJECTS: Project[] = [
  { id: "vp-proj-7Yx9qL", name: "acme-web",       env: "production",  keys: 7,  callsMo: "412,908", lastCall: "2s ago",  status: "healthy", exposed: 0 },
  { id: "vp-proj-K4nZpR", name: "acme-dashboard",  env: "production",  keys: 4,  callsMo: "84,220",  lastCall: "14s ago", status: "healthy", exposed: 0 },
  { id: "vp-proj-m9hQx2", name: "acme-worker",     env: "production",  keys: 9,  callsMo: "1.2M",    lastCall: "1s ago",  status: "warning", exposed: 1 },
  { id: "vp-proj-Lp03Rn", name: "acme-mobile",     env: "staging",     keys: 3,  callsMo: "18,402",  lastCall: "2m ago",  status: "healthy", exposed: 0 },
  { id: "vp-proj-bT5eVc", name: "acme-ml-infer",   env: "production",  keys: 12, callsMo: "3.8M",    lastCall: "0s ago",  status: "alert",   exposed: 3 },
  { id: "vp-proj-q2NfYh", name: "acme-analytics",  env: "production",  keys: 2,  callsMo: "2,104",   lastCall: "4h ago",  status: "idle",    exposed: 0 },
  { id: "vp-proj-u8MnBd", name: "acme-internal",   env: "development", keys: 1,  callsMo: "0",       lastCall: "—",       status: "idle",    exposed: 0 },
];

const STATUS_COLOR: Record<string, string> = {
  healthy: "#16a34a",
  warning: "#d97706",
  alert:   "#b91c1c",
  idle:    "#8a8a82",
};

const ENV_STYLE: Record<string, { bg: string; fg: string }> = {
  production:  { bg: "rgba(22,163,74,0.08)",   fg: "#15803d" },
  staging:     { bg: "rgba(217,119,6,0.08)",   fg: "#b45309" },
  development: { bg: "rgba(100,116,139,0.1)",  fg: "#475569" },
};

function spark(id: string): number[] {
  const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return Array.from({ length: 24 }, (_, i) => {
    const v = (Math.sin(seed + i * 0.8) + 1) * 0.5;
    return Math.round(8 + v * 26);
  });
}

function Sparkline({ id, status }: { id: string; status: string }) {
  const values = spark(id);
  const color =
    status === "alert"   ? "#b91c1c" :
    status === "warning" ? "#d97706" :
    status === "idle"    ? "#c4c4bd" : ACCENT;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: v,
            background: color,
            opacity: i > 18 ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

const NAV_GROUPS = [
  { h: "overview", items: [["projects", true], ["activity"], ["alerts · 4"]] },
  { h: "vault",    items: [["keys"], ["providers"], ["origins"]] },
  { h: "scanner",  items: [["repos"], ["findings"], ["allowlist"]] },
  { h: "admin",    items: [["team"], ["billing"], ["audit log"], ["api tokens"]] },
] as const;

const ACTIVITY = [
  ["00:14:02", "proxy",   "acme-ml-infer → openai/chat · 200 · 612ms",                          "#171717"],
  ["00:14:01", "proxy",   "acme-web → stripe/charge · 200 · 244ms",                             "#171717"],
  ["00:13:58", "scanner", "acme-worker · found 1 exposed anthropic key in .env.production",      "#b91c1c"],
  ["00:13:55", "vault",   "key rotated · openai/sk-proj-7Yx9 → sk-proj-K4nZ",                   "#15803d"],
  ["00:13:40", "proxy",   "acme-dashboard → supabase/query · 200 · 81ms",                       "#171717"],
  ["00:13:31", "auth",    "new developer key issued for acme-mobile",                            "#15803d"],
  ["00:13:12", "proxy",   "acme-ml-infer → anthropic/messages · 200 · 488ms",                   "#171717"],
  ["00:13:08", "alert",   "acme-ml-infer proxy p95 > 2× baseline for 5m",                       "#d97706"],
] as const;

const ALERTS = [
  { t: "exposed openai key",      p: "acme-ml-infer", s: "critical", a: "12m ago" },
  { t: "exposed stripe key",      p: "acme-ml-infer", s: "critical", a: "12m ago" },
  { t: "anthropic key in README", p: "acme-ml-infer", s: "high",     a: "2h ago"  },
  { t: "proxy p95 anomaly",       p: "acme-worker",   s: "medium",   a: "18m ago" },
] as const;

const ALERT_COLOR: Record<string, string> = {
  critical: "#b91c1c",
  high:     "#c2410c",
  medium:   "#a16207",
};

export default function ProjectsDashboard() {
  const activeCount = PROJECTS.filter(p => p.status !== "idle").length;

  return (
    <div style={{ ...BODY, color: "#171717", background: "#fafaf7", minHeight: "100vh" }}>

      {/* TOP BAR */}
      <div style={{
        ...MONO, fontSize: 12,
        display: "flex", alignItems: "center",
        padding: "14px 28px", borderBottom: RULE,
        background: "#fafaf7",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <span style={{ color: ACCENT, marginRight: 8 }}>◆</span>
        <span style={{ fontWeight: 600, letterSpacing: 0.5 }}>vaultproof</span>
        <span style={{ marginLeft: 14, color: "#a3a39a" }}>/</span>
        <span style={{ marginLeft: 14 }}>dashboard</span>
        <span style={{ marginLeft: 14, color: "#a3a39a" }}>/</span>
        <span style={{ marginLeft: 14, color: "#525252" }}>acme-inc</span>
        <div style={{ flex: 1 }} />
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          border: RULE, borderRadius: 4, padding: "6px 10px",
          background: "#fff", width: 260,
        }}>
          <span style={{ color: "#a3a39a" }}>/</span>
          <span style={{ color: "#8a8a82", flex: 1 }}>jump to a project or key</span>
          <span style={{ color: "#a3a39a", fontSize: 10 }}>⌘K</span>
        </div>
        <div style={{ width: 20 }} />
        <div style={{ display: "flex", gap: 24, color: "#525252" }}>
          <a href="/docs" style={{ color: "inherit", textDecoration: "none" }}>docs</a>
          <span style={{ cursor: "pointer" }}>changelog</span>
        </div>
        <div style={{ width: 20 }} />
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: ACCENT, color: "#fafaf7",
          display: "flex", alignItems: "center", justifyContent: "center",
          ...MONO, fontSize: 11, fontWeight: 700,
        }}>NY</div>
      </div>

      {/* SIDEBAR + MAIN */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr" }}>

        {/* SIDEBAR */}
        <aside style={{ borderRight: RULE, padding: "20px 16px", minHeight: "calc(100vh - 53px)", background: "#fafaf7" }}>
          {NAV_GROUPS.map((g) => (
            <div key={g.h} style={{ marginBottom: 22 }}>
              <div style={{
                ...MONO, fontSize: 10, letterSpacing: 0.8,
                textTransform: "uppercase", color: "#8a8a82",
                padding: "6px 8px",
              }}>{g.h}</div>
              {g.items.map(([name, active]) => (
                <div key={name} style={{
                  ...MONO, fontSize: 12.5,
                  color: active ? "#171717" : "#525252",
                  padding: "7px 10px", borderRadius: 3,
                  background: active ? "#fff" : "transparent",
                  border: active ? RULE : "1px solid transparent",
                  display: "flex", alignItems: "center", gap: 8,
                  cursor: "pointer",
                }}>
                  <span style={{ color: active ? ACCENT : "#c4c4bd", fontSize: 8 }}>●</span>
                  <span>{name}</span>
                </div>
              ))}
            </div>
          ))}

          {/* Usage meter */}
          <div style={{ marginTop: 40, padding: 14, border: RULE, borderRadius: 4, background: "#fff" }}>
            <div style={{ ...MONO, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: "#8a8a82", marginBottom: 8 }}>
              pro plan
            </div>
            <div style={{ ...MONO, fontSize: 12, color: "#171717", display: "flex", justifyContent: "space-between" }}>
              <span>calls</span><span>352k / 500k</span>
            </div>
            <div style={{ height: 4, background: "#eeece5", borderRadius: 99, marginTop: 8 }}>
              <div style={{ width: "70%", height: "100%", background: ACCENT, borderRadius: 99 }} />
            </div>
            <div style={{ ...MONO, fontSize: 11, color: "#8a8a82", marginTop: 8 }}>
              resets in 12d
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main style={{ padding: "28px 32px" }}>

          {/* HEADER */}
          <div style={{ display: "flex", alignItems: "baseline", marginBottom: 4 }}>
            <h1 style={{ ...DISPLAY, fontSize: 30, letterSpacing: -0.8, margin: 0 }}>
              Projects
            </h1>
            <span style={{ ...MONO, fontSize: 12, color: "#8a8a82", marginLeft: 10 }}>
              / {PROJECTS.length} total · {activeCount} active
            </span>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{
                ...MONO, fontSize: 12,
                padding: "7px 12px", border: RULE, borderRadius: 3, background: "#fff",
                cursor: "pointer",
              }}>import .env</span>
              <span style={{
                ...MONO, fontSize: 12,
                padding: "7px 12px", background: "#171717", color: "#fafaf7",
                borderRadius: 3, cursor: "pointer",
              }}>+ new project</span>
            </div>
          </div>
          <p style={{ ...BODY, fontSize: 13, color: "#525252", margin: "4px 0 24px", maxWidth: 720 }}>
            Every project holds split keys, proxy routes, and a scan history. Alerts fire when a key re-surfaces in a new commit.
          </p>

          {/* KPI GRID */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            border: RULE, borderRadius: 4, overflow: "hidden", background: "#fff",
            marginBottom: 28,
          }}>
            {[
              { k: "active projects",    v: "6",     sub: "+1 this week",          c: null       },
              { k: "proxied calls · 24h",v: "2.41M", sub: "p50 41ms · p95 96ms",  c: null       },
              { k: "keys under vault",   v: "38",    sub: "across 9 providers",    c: null       },
              { k: "open alerts",        v: "4",     sub: "3 scanner · 1 anomaly", c: "#b91c1c"  },
            ].map((kpi, i) => (
              <div key={i} style={{ padding: 20, borderLeft: i === 0 ? "none" : RULE }}>
                <div style={{ ...MONO, fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase", color: "#8a8a82" }}>
                  {kpi.k}
                </div>
                <div style={{ ...DISPLAY, fontSize: 30, letterSpacing: -0.5, marginTop: 6, color: kpi.c ?? "#171717" }}>
                  {kpi.v}
                </div>
                <div style={{ ...MONO, fontSize: 11, color: "#525252", marginTop: 4 }}>
                  {kpi.sub}
                </div>
              </div>
            ))}
          </div>

          {/* FILTER BAR */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", marginBottom: 12 }}>
            {["all", "production", "staging", "development", "idle"].map((f, i) => (
              <span key={f} style={{
                ...MONO, fontSize: 12,
                padding: "5px 10px", borderRadius: 3,
                border: RULE,
                background: i === 0 ? "#171717" : "#fff",
                color: i === 0 ? "#fafaf7" : "#262626",
                cursor: "pointer",
              }}>{f}</span>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ ...MONO, fontSize: 11, color: "#8a8a82" }}>sort · last activity ↓</span>
          </div>

          {/* PROJECT TABLE */}
          <div style={{ border: RULE, borderRadius: 4, overflow: "hidden", background: "#fff" }}>
            {/* header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 110px",
              padding: "11px 18px", background: "#fafaf7", borderBottom: RULE,
              ...MONO, fontSize: 10, letterSpacing: 0.8,
              textTransform: "uppercase", color: "#8a8a82",
            }}>
              <span>project</span>
              <span>env</span>
              <span>keys</span>
              <span>calls · 30d</span>
              <span>trend</span>
              <span>last call</span>
              <span style={{ textAlign: "right" }}>status</span>
            </div>

            {PROJECTS.map((p, i) => {
              const env = ENV_STYLE[p.env];
              return (
                <div key={p.id} style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 110px",
                  padding: "16px 18px", alignItems: "center",
                  borderBottom: i < PROJECTS.length - 1 ? HAIR : "none",
                  background: p.status === "alert" ? "rgba(185,28,28,0.025)" : "#fff",
                  cursor: "pointer",
                }}>
                  <div>
                    <div style={{ ...DISPLAY, fontSize: 15, letterSpacing: -0.2 }}>{p.name}</div>
                    <div style={{ ...MONO, fontSize: 11, color: "#8a8a82", marginTop: 2 }}>
                      {p.id}
                      {p.exposed > 0 && (
                        <span style={{ color: "#b91c1c", marginLeft: 10 }}>
                          ● {p.exposed} exposed in last scan
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{
                    justifySelf: "start",
                    ...MONO, fontSize: 11,
                    padding: "2px 8px", borderRadius: 3,
                    background: env.bg, color: env.fg,
                    textTransform: "uppercase", letterSpacing: 0.5,
                  }}>{p.env}</span>
                  <span style={{ ...MONO, fontSize: 13, color: "#171717" }}>{p.keys}</span>
                  <span style={{ ...MONO, fontSize: 13, color: "#171717" }}>{p.callsMo}</span>
                  <Sparkline id={p.id} status={p.status} />
                  <span style={{ ...MONO, fontSize: 12, color: "#525252" }}>{p.lastCall}</span>
                  <span style={{
                    textAlign: "right",
                    ...MONO, fontSize: 11, letterSpacing: 0.5,
                    textTransform: "uppercase",
                    color: STATUS_COLOR[p.status],
                  }}>
                    <span style={{ marginRight: 5 }}>●</span>{p.status}
                  </span>
                </div>
              );
            })}
          </div>

          {/* BOTTOM: activity + alerts */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginTop: 28 }}>

            {/* Activity feed */}
            <div style={{ border: RULE, borderRadius: 4, background: "#fff" }}>
              <div style={{
                padding: "12px 18px", borderBottom: RULE,
                display: "flex", alignItems: "center",
                ...MONO, fontSize: 11, letterSpacing: 0.6,
                textTransform: "uppercase", color: "#8a8a82",
              }}>
                <span>recent activity</span>
                <div style={{ flex: 1 }} />
                <span style={{ color: ACCENT, textTransform: "none", letterSpacing: 0 }}>● live</span>
              </div>
              <div style={{ padding: "8px 18px" }}>
                {ACTIVITY.map(([ts, tag, msg, c], i) => (
                  <div key={i} style={{
                    display: "grid",
                    gridTemplateColumns: "72px 80px 1fr",
                    padding: "6px 0",
                    ...MONO, fontSize: 12,
                    borderTop: i === 0 ? "none" : `1px dashed #eeece5`,
                    alignItems: "baseline",
                  }}>
                    <span style={{ color: "#8a8a82" }}>{ts}</span>
                    <span style={{ color: "#525252", textTransform: "uppercase", letterSpacing: 0.4, fontSize: 10 }}>{tag}</span>
                    <span style={{ color: c }}>{msg}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Alerts */}
            <div style={{ border: RULE, borderRadius: 4, background: "#fff" }}>
              <div style={{
                padding: "12px 18px", borderBottom: RULE,
                display: "flex", alignItems: "center",
                ...MONO, fontSize: 11, letterSpacing: 0.6,
                textTransform: "uppercase", color: "#8a8a82",
              }}>
                <span>open alerts · 4</span>
                <div style={{ flex: 1 }} />
                <span style={{ color: "#b91c1c", textTransform: "none", letterSpacing: 0 }}>needs review</span>
              </div>
              {ALERTS.map((alert, i) => {
                const sc = ALERT_COLOR[alert.s];
                return (
                  <div key={i} style={{
                    padding: "14px 18px",
                    borderTop: i === 0 ? "none" : HAIR,
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <span style={{ color: sc, ...MONO, fontSize: 11, fontWeight: 700, width: 16 }}>!!</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ ...BODY, fontSize: 13, color: "#171717" }}>{alert.t}</div>
                      <div style={{ ...MONO, fontSize: 11, color: "#8a8a82", marginTop: 2 }}>
                        {alert.p} · {alert.a}
                      </div>
                    </div>
                    <span style={{
                      ...MONO, fontSize: 10, letterSpacing: 0.5,
                      textTransform: "uppercase", color: sc,
                      padding: "2px 7px",
                      background: `${sc}22`,
                      borderRadius: 3,
                    }}>{alert.s}</span>
                    <span style={{ ...MONO, fontSize: 11, color: ACCENT, cursor: "pointer" }}>review →</span>
                  </div>
                );
              })}
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
