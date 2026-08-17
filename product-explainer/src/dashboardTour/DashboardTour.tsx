/**
 * DashboardTour — full tour of the CEO dashboard.
 *
 * - 1920x1080, 30 fps
 * - Each beat is one scene: a card with the metric + the Feynman explanation
 * - Three languages shown side-by-side as captions (EN / HI / BN) so the
 *   viewer can read in their own language
 * - No background music, no voiceover file (we keep the source portable —
 *   add voice later with `npx remotion studio` + any TTS)
 */

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import React from "react";
import { BEATS, FPS } from "./narration";

const FONT_EN = '"Inter", "Segoe UI", system-ui, sans-serif';
const FONT_HI = '"Noto Sans Devanagari", "Mangal", "Inter", sans-serif';
const FONT_BN = '"Noto Sans Bengali", "Vrinda", "Inter", sans-serif';

const BG = "linear-gradient(135deg,#0F172A 0%,#1E293B 100%)";
const CARD_BG = "rgba(15,23,42,0.85)";
const CARD_BORDER = "rgba(148,163,184,0.25)";

// ─── Helpers ────────────────────────────────────────────────────────────────
function framesFor(beatIdx: number): number {
  let f = 0;
  for (let i = 0; i < beatIdx; i++) f += BEATS[i].dur * FPS;
  return f;
}

const ALL_STARTS = BEATS.map((_, i) => framesFor(i));
const ALL_DURS = BEATS.map((b) => b.dur * FPS);

// ─── Sub-components ─────────────────────────────────────────────────────────
const Card: React.FC<{ children: React.ReactNode; width?: number }> = ({
  children,
  width = 1500,
}) => (
  <div
    style={{
      width,
      backgroundColor: CARD_BG,
      border: `2px solid ${CARD_BORDER}`,
      borderRadius: 24,
      padding: 50,
      boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
    }}
  >
    {children}
  </div>
);

const BigNumber: React.FC<{ value: string; color: string }> = ({ value, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { stiffness: 110, damping: 14 } });
  return (
    <div
      style={{
        fontFamily: FONT_EN,
        fontSize: 220,
        fontWeight: 900,
        color,
        lineHeight: 1,
        transform: `scale(${scale})`,
        textShadow: `0 0 60px ${color}66`,
      }}
    >
      {value}
    </div>
  );
};

const MetricLabel: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      fontFamily: FONT_EN,
      fontSize: 36,
      fontWeight: 600,
      color: "#94A3B8",
      letterSpacing: 4,
      textTransform: "uppercase",
      marginBottom: 12,
    }}
  >
    {label}
  </div>
);

// Three-language caption block. English on top (biggest), Hindi middle, Bengali bottom.
const TriCaption: React.FC<{ en: string; hi: string; bn: string; hint?: string }> = ({
  en,
  hi,
  bn,
  hint,
}) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });

  const line = (text: string, font: string, size: number, color: string, weight = 600) => (
    <div
      style={{
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        color,
        lineHeight: 1.35,
        marginBottom: 10,
      }}
    >
      {text}
    </div>
  );

  return (
    <div style={{ opacity: fade }}>
      {line(en, FONT_EN, 38, "#F1F5F9", 700)}
      {line(hi, FONT_HI, 32, "#E2E8F0")}
      {line(bn, FONT_BN, 32, "#E2E8F0")}
      {hint && (
        <div
          style={{
            marginTop: 18,
            padding: "14px 20px",
            backgroundColor: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 10,
            fontFamily: FONT_EN,
            fontSize: 22,
            color: "#86EFAC",
            fontStyle: "italic",
            lineHeight: 1.4,
          }}
        >
          💡 {hint}
        </div>
      )}
    </div>
  );
};

// ─── Scene visualizers ──────────────────────────────────────────────────────
const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, config: { stiffness: 100, damping: 14 } });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transform: `scale(${logo})`,
      }}
    >
      <div style={{ fontSize: 200, marginBottom: 30 }}>📊</div>
      <h1
        style={{
          fontFamily: FONT_EN,
          fontSize: 110,
          fontWeight: 900,
          color: "#F8FAFC",
          margin: 0,
        }}
      >
        AbaYa Track
      </h1>
      <h2
        style={{
          fontFamily: FONT_EN,
          fontSize: 50,
          fontWeight: 400,
          color: "#A78BFA",
          marginTop: 20,
        }}
      >
        Dashboard tour
      </h2>
    </div>
  );
};

const KpiScene: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 60 }}>
    <BigNumber value={value} color={color} />
    <div>
      <MetricLabel label={label} />
      <div
        style={{
          fontFamily: FONT_EN,
          fontSize: 28,
          color: "#64748B",
          maxWidth: 400,
        }}
      >
        Real-time, live
      </div>
    </div>
  </div>
);

// Fake pareto / perf / hourly / garment bars
const BarRow: React.FC<{ name: string; pct: number; color: string; delay: number }> = ({
  name,
  pct,
  color,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const w = spring({ frame: frame - delay, fps, config: { stiffness: 90, damping: 18 } });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 12,
        opacity: w,
      }}
    >
      <div
        style={{
          width: 160,
          fontFamily: FONT_EN,
          fontSize: 24,
          color: "#E2E8F0",
          textAlign: "right",
        }}
      >
        {name}
      </div>
      <div
        style={{
          flex: 1,
          height: 28,
          backgroundColor: "rgba(148,163,184,0.1)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct * w}%`,
            height: "100%",
            backgroundColor: color,
            borderRadius: 14,
            transition: "width 0.2s",
          }}
        />
      </div>
      <div
        style={{
          width: 80,
          fontFamily: FONT_EN,
          fontSize: 24,
          color: "#94A3B8",
          fontWeight: 700,
        }}
      >
        {Math.round(pct * 100)}%
      </div>
    </div>
  );
};

const ParetoScene: React.FC = () => (
  <Card width={1300}>
    <MetricLabel label="PARETO — TOP 20% WORKERS" />
    <div style={{ marginTop: 24 }}>
      {[
        { name: "Alazar", pct: 1.0, color: "#22C55E" },
        { name: "Raees", pct: 0.54, color: "#A78BFA" },
        { name: "Anasari", pct: 0.55, color: "#A78BFA" },
        { name: "Ridowan", pct: 0.39, color: "#A78BFA" },
        { name: "Naserulla", pct: 0.1, color: "#64748B" },
        { name: "Amirull", pct: 0.25, color: "#64748B" },
      ].map((r, i) => (
        <BarRow key={r.name} {...r} delay={10 + i * 5} />
      ))}
    </div>
  </Card>
);

const PerfScene: React.FC = () => (
  <Card width={1300}>
    <MetricLabel label="PROCESS EFFICIENCY" />
    <div style={{ marginTop: 24 }}>
      {[
        { name: "Button", pct: 1.0, color: "#22C55E" },
        { name: "Embroidery", pct: 0.55, color: "#F59E0B" },
        { name: "Tailor 02", pct: 0.25, color: "#EF4444" },
        { name: "Hand Work", pct: 0.12, color: "#EF4444" },
        { name: "Stone Work", pct: 0.38, color: "#F59E0B" },
      ].map((r, i) => (
        <BarRow key={r.name} {...r} delay={10 + i * 5} />
      ))}
    </div>
  </Card>
);

const HourlyScene: React.FC = () => {
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const counts = [2, 5, 9, 7, 1, 4, 8, 6, 3, 1]; // illustrative
  const max = Math.max(...counts);
  return (
    <Card width={1500}>
      <MetricLabel label="HOURLY OUTPUT (9AM–7PM)" />
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 14,
          height: 280,
          marginTop: 30,
        }}
      >
        {hours.map((h, i) => {
          const frame = useCurrentFrame();
          const { fps } = useVideoConfig();
          const grow = spring({ frame: frame - i * 3, fps, config: { damping: 16 } });
          return (
            <div
              key={h}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
            >
              <div
                style={{
                  fontFamily: FONT_EN,
                  fontSize: 22,
                  color: "#94A3B8",
                  marginBottom: 8,
                  fontWeight: 700,
                }}
              >
                {counts[i] * grow}
              </div>
              <div
                style={{
                  width: "100%",
                  height: 240 * (counts[i] / max) * grow,
                  backgroundColor:
                    counts[i] === max ? "#22C55E" : counts[i] < 3 ? "#EF4444" : "#A78BFA",
                  borderRadius: "8px 8px 0 0",
                }}
              />
              <div
                style={{
                  fontFamily: FONT_EN,
                  fontSize: 22,
                  color: "#94A3B8",
                  marginTop: 8,
                }}
              >
                {h}h
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const GarmentScene: React.FC = () => (
  <Card width={1500}>
    <MetricLabel label="TOTAL TIME BY ABAYA ITEM CODE" />
    <div style={{ marginTop: 20, fontFamily: FONT_EN, fontSize: 22, color: "#64748B" }}>
      (each row = one garment, all stations summed)
    </div>
    <div style={{ marginTop: 20 }}>
      {[
        { code: "FWAS 1110 STD", time: "6h 22m", color: "#22C55E" },
        { code: "CF111 STD-O", time: "4h 18m", color: "#A78BFA" },
        { code: "FWAS 3332 STD-O", time: "3h 51m", color: "#A78BFA" },
        { code: "FWAS 3523 STD-O", time: "2h 07m", color: "#A78BFA" },
        { code: "AB-908 STD", time: "1h 44m", color: "#64748B" },
      ].map((r, i) => (
        <div
          key={r.code}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 0",
            borderBottom: "1px solid rgba(148,163,184,0.1)",
            fontFamily: FONT_EN,
            fontSize: 26,
          }}
        >
          <div
            style={{
              width: 50,
              height: 50,
              backgroundColor: r.color,
              borderRadius: 8,
              marginRight: 20,
            }}
          />
          <div style={{ flex: 1, color: "#F1F5F9", fontWeight: 600 }}>{r.code}</div>
          <div style={{ color: "#94A3B8", fontWeight: 700 }}>{r.time}</div>
        </div>
      ))}
    </div>
  </Card>
);

const ReportScene: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 50,
      padding: "40px 60px",
      backgroundColor: "rgba(167,139,250,0.1)",
      border: "3px solid " + color,
      borderRadius: 24,
    }}
  >
    <div style={{ fontSize: 120 }}>📅</div>
    <div>
      <MetricLabel label={label} />
      <div
        style={{
          fontFamily: FONT_EN,
          fontSize: 100,
          fontWeight: 900,
          color: color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  </div>
);

const ExportScene: React.FC = () => (
  <div style={{ display: "flex", gap: 40, alignItems: "center" }}>
    {["CSV", "JSON"].map((fmt) => (
      <div
        key={fmt}
        style={{
          padding: "40px 80px",
          backgroundColor: "#1E293B",
          border: "3px solid #22C55E",
          borderRadius: 20,
          fontFamily: FONT_EN,
          fontSize: 80,
          fontWeight: 900,
          color: "#22C55E",
        }}
      >
        ⬇ {fmt}
      </div>
    ))}
  </div>
);

const CloudScene: React.FC = () => {
  const frame = useCurrentFrame();
  const pulse = 1 + 0.15 * Math.abs(Math.sin(frame / 8));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 60,
        padding: 50,
        backgroundColor: "rgba(15,23,42,0.85)",
        borderRadius: 24,
        border: "2px solid #22C55E",
      }}
    >
      <div
        style={{
          fontSize: 180,
          transform: `scale(${pulse})`,
        }}
      >
        ☁️
      </div>
      <div style={{ fontSize: 80, color: "#22C55E" }}>→</div>
      <div style={{ fontSize: 180 }}>🌍</div>
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 16,
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              backgroundColor: "#22C55E",
              boxShadow: "0 0 20px #22C55E",
            }}
          />
          <span
            style={{
              fontFamily: FONT_EN,
              fontSize: 28,
              color: "#22C55E",
              fontWeight: 700,
            }}
          >
            SYNC LIVE
          </span>
        </div>
      </div>
    </div>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { stiffness: 80, damping: 14 } });
  return (
    <div
      style={{
        textAlign: "center",
        transform: `scale(${s})`,
      }}
    >
      <div style={{ fontSize: 180, marginBottom: 20 }}>✅</div>
      <h1
        style={{
          fontFamily: FONT_EN,
          fontSize: 90,
          fontWeight: 900,
          color: "#F8FAFC",
          margin: 0,
        }}
      >
        That's the whole dashboard.
      </h1>
      <h2
        style={{
          fontFamily: FONT_EN,
          fontSize: 40,
          color: "#A78BFA",
          marginTop: 20,
          fontWeight: 400,
        }}
      >
        One screen · Every number · Zero jargon
      </h2>
    </div>
  );
};

// ─── Per-beat scene ─────────────────────────────────────────────────────────
const BeatScene: React.FC<{ beatIdx: number }> = ({ beatIdx }) => {
  const beat = BEATS[beatIdx];
  const frame = useCurrentFrame();
  const dur = beat.dur * FPS;

  // Beat-level fade in/out
  const fade = interpolate(
    frame,
    [0, 12, dur - 12, dur],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Top-left: language tags (stacked horizontally, each in its own column)
  const langTag = (txt: string, font: string, color: string, left: number) => (
    <div
      style={{
        position: "absolute",
        top: 40,
        left,
        fontFamily: font,
        fontSize: 28,
        fontWeight: 700,
        color,
        letterSpacing: 3,
        textTransform: "uppercase",
      }}
    >
      {txt}
    </div>
  );

  // Beat number badge (top-right)
  const beatBadge = (
    <div
      style={{
        position: "absolute",
        top: 40,
        right: 50,
        fontFamily: FONT_EN,
        fontSize: 26,
        color: "#64748B",
        fontWeight: 700,
        letterSpacing: 3,
      }}
    >
      {beatIdx + 1} / {BEATS.length}
    </div>
  );

  // Visual selector
  let visual: React.ReactNode = null;
  switch (beat.visual) {
    case "intro":
      visual = <IntroScene />;
      break;
    case "kpi-card":
      visual = (
        <KpiScene
          label={beat.metric!.label}
          value={beat.metric!.value}
          color={beat.metric!.color || "#22C55E"}
        />
      );
      break;
    case "pareto":
      visual = <ParetoScene />;
      break;
    case "perf":
      visual = <PerfScene />;
      break;
    case "hourly":
      visual = <HourlyScene />;
      break;
    case "garment":
      visual = <GarmentScene />;
      break;
    case "report":
      visual = (
        <ReportScene
          label={beat.metric!.label}
          value={beat.metric!.value}
          color={beat.metric!.color || "#A78BFA"}
        />
      );
      break;
    case "export":
      visual = <ExportScene />;
      break;
    case "cloud":
      visual = <CloudScene />;
      break;
    case "outro":
      visual = <OutroScene />;
      break;
  }

  return (
    <AbsoluteFill
      style={{
        background: BG,
        opacity: fade,
        fontFamily: FONT_EN,
      }}
    >
      {langTag("EN", FONT_EN, "#60A5FA", 60)}
      {langTag("हिन्दी", FONT_HI, "#FB923C", 200)}
      {langTag("বাংলা", FONT_BN, "#A78BFA", 400)}
      {beatBadge}

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 280,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: 100,
        }}
      >
        {visual}
      </div>

      {/* Bottom caption strip — three languages */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 280,
          padding: "30px 80px",
          backgroundColor: "rgba(0,0,0,0.5)",
          borderTop: "1px solid rgba(148,163,184,0.2)",
          display: "flex",
          alignItems: "center",
        }}
      >
        <TriCaption en={beat.en} hi={beat.hi} bn={beat.bn} hint={beat.hint} />
      </div>
    </AbsoluteFill>
  );
};

// ─── Composition entry ──────────────────────────────────────────────────────
export const DashboardTour: React.FC = () => {
  return (
    <AbsoluteFill>
      {BEATS.map((b, i) => (
        <Sequence key={b.id} from={ALL_STARTS[i]} durationInFrames={ALL_DURS[i]}>
          <BeatScene beatIdx={i} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
