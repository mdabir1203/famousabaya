/**
 * AbaYa Track — "It Just Keeps Running" reliability explainer.
 *
 * Audience: a non-technical abaya-factory owner / CEO.
 * Style: Feynman — plain words, everyday analogies, zero jargon.
 * Designed at 4K (3840×2160). Render at 1080p with `--scale=0.5`, or full 4K with `--scale=1`.
 *
 * Each beat answers one worry a business owner actually has:
 *   1. The fear            2. A tireless assistant    3. Never goes down
 *   4. Forgets nothing     5. Works on phone signal   6. Nothing slips through
 *   7. Watch from Dubai    8. Peace of mind
 */

import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import React from "react";

const FONT =
  '"Segoe UI", "Inter", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

// ─── A pulsing "heartbeat" dot — the visual metaphor for "always on" ──────────
const Heartbeat: React.FC<{ label?: string; color?: string }> = ({
  label = "RUNNING",
  color = "#22C55E",
}) => {
  const frame = useCurrentFrame();
  const beat = 1 + 0.35 * Math.abs(Math.sin(frame / 7));
  const glow = 30 + 40 * Math.abs(Math.sin(frame / 7));
  return (
    <div
      style={{
        position: "absolute",
        bottom: 120,
        display: "flex",
        alignItems: "center",
        gap: 32,
        opacity: 0.9,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          backgroundColor: color,
          transform: `scale(${beat})`,
          boxShadow: `0 0 ${glow}px ${color}`,
        }}
      />
      <span
        style={{
          fontFamily: FONT,
          fontSize: 52,
          fontWeight: 700,
          letterSpacing: 8,
          color,
        }}
      >
        {label}
      </span>
    </div>
  );
};

// ─── One narrative beat ───────────────────────────────────────────────────────
const Scene: React.FC<{
  durationInFrames: number;
  bg: string;
  emoji: string;
  headline: string;
  subline: string;
  textColor?: string;
  subColor?: string;
  heartbeat?: { label: string; color: string } | null;
}> = ({
  durationInFrames,
  bg,
  emoji,
  headline,
  subline,
  textColor = "#0F172A",
  subColor = "#475569",
  heartbeat = { label: "RUNNING", color: "#22C55E" },
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Crossfade in/out so beats melt into each other.
  const fade = interpolate(
    frame,
    [0, 18, durationInFrames - 18, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const emojiScale = spring({ frame, fps, config: { stiffness: 110, damping: 16 } });
  const headRise = interpolate(
    spring({ frame: frame - 8, fps, config: { damping: 100 } }),
    [0, 1],
    [60, 0],
  );
  const subRise = interpolate(
    spring({ frame: frame - 20, fps, config: { damping: 100 } }),
    [0, 1],
    [40, 0],
  );

  return (
    <AbsoluteFill
      style={{
        background: bg,
        justifyContent: "center",
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        padding: 220,
        opacity: fade,
      }}
    >
      <div style={{ fontSize: 300, marginBottom: 60, transform: `scale(${emojiScale})` }}>
        {emoji}
      </div>
      <h1
        style={{
          fontFamily: FONT,
          fontSize: 150,
          fontWeight: 800,
          lineHeight: 1.05,
          textAlign: "center",
          color: textColor,
          margin: 0,
          whiteSpace: "pre-line",
          transform: `translateY(${headRise}px)`,
        }}
      >
        {headline}
      </h1>
      <p
        style={{
          fontFamily: FONT,
          fontSize: 80,
          fontWeight: 500,
          textAlign: "center",
          color: subColor,
          marginTop: 50,
          maxWidth: 2800,
          transform: `translateY(${subRise}px)`,
        }}
      >
        {subline}
      </p>
      {heartbeat && <Heartbeat label={heartbeat.label} color={heartbeat.color} />}
    </AbsoluteFill>
  );
};

// ─── Scene timing (30 fps) ──────────────────────────────────────────────────────
export const SCENES = [
  { d: 130 }, // 1 the fear
  { d: 120 }, // 2 tireless assistant
  { d: 130 }, // 3 never goes down
  { d: 120 }, // 4 forgets nothing
  { d: 120 }, // 5 phone signal
  { d: 130 }, // 6 nothing slips
  { d: 120 }, // 7 watch from Dubai
  { d: 150 }, // 8 peace of mind
];
export const TOTAL_FRAMES = SCENES.reduce((s, x) => s + x.d, 0); // 1020 ≈ 34 s

const starts = SCENES.reduce<number[]>((acc, s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + SCENES[i - 1].d);
  return acc;
}, []);

export const ReliabilityStory: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0F172A" }}>
      {/* 1 — The fear every factory owner knows */}
      <Sequence from={starts[0]} durationInFrames={SCENES[0].d}>
        <Scene
          durationInFrames={SCENES[0].d}
          bg="linear-gradient(135deg,#FEF2F2,#FFE4E6)"
          emoji="😰"
          headline="An order goes missing.\nThe screen freezes."
          subline="Every factory owner's quiet fear — and you don't even find out until it's too late."
          heartbeat={null}
        />
      </Sequence>

      {/* 2 — Meet your tireless assistant */}
      <Sequence from={starts[1]} durationInFrames={SCENES[1].d}>
        <Scene
          durationInFrames={SCENES[1].d}
          bg="linear-gradient(135deg,#EFF6FF,#DBEAFE)"
          emoji="🤝"
          headline="Meet a worker who never sleeps."
          subline="AbaYa Track watches your factory floor 24 hours a day. No breaks. No days off."
        />
      </Sequence>

      {/* 3 — Never goes down */}
      <Sequence from={starts[2]} durationInFrames={SCENES[2].d}>
        <Scene
          durationInFrames={SCENES[2].d}
          bg="linear-gradient(135deg,#ECFDF5,#D1FAE5)"
          emoji="🔌➡️✅"
          headline="Power blinks? It reopens itself."
          subline="Like a shop that unlocks its own doors after a power cut — back up in seconds, on its own."
        />
      </Sequence>

      {/* 4 — Forgets nothing */}
      <Sequence from={starts[3]} durationInFrames={SCENES[3].d}>
        <Scene
          durationInFrames={SCENES[3].d}
          bg="linear-gradient(135deg,#FFFBEB,#FEF3C7)"
          emoji="📝"
          headline="It writes everything down."
          subline="The instant an order is created, it's saved. A restart loses nothing — not a single abaya."
        />
      </Sequence>

      {/* 5 — Works on phone signal */}
      <Sequence from={starts[4]} durationInFrames={SCENES[4].d}>
        <Scene
          durationInFrames={SCENES[4].d}
          bg="linear-gradient(135deg,#F0F9FF,#E0F2FE)"
          emoji="📱📡"
          headline="Works on a phone signal."
          subline="Not just office WiFi. Your tablets stay connected on mobile data — anywhere in the building."
        />
      </Sequence>

      {/* 6 — Nothing slips through */}
      <Sequence from={starts[5]} durationInFrames={SCENES[5].d}>
        <Scene
          durationInFrames={SCENES[5].d}
          bg="linear-gradient(135deg,#FFF1F2,#FECDD3)"
          emoji="🟥⏰"
          headline="Running late? The board turns red."
          subline="The moment an order is at risk, it lights up. Nothing is ever quietly forgotten."
          heartbeat={{ label: "WATCHING", color: "#EF4444" }}
        />
      </Sequence>

      {/* 7 — Watch from Dubai */}
      <Sequence from={starts[6]} durationInFrames={SCENES[6].d}>
        <Scene
          durationInFrames={SCENES[6].d}
          bg="linear-gradient(135deg,#FAF5FF,#EDE9FE)"
          emoji="☕🌍"
          headline="Watch it from anywhere."
          subline="Sitting with your coffee in Dubai, you see every order's progress — live, as it happens."
        />
      </Sequence>

      {/* 8 — Peace of mind (payoff) */}
      <Sequence from={starts[7]} durationInFrames={SCENES[7].d}>
        <PayoffScene durationInFrames={SCENES[7].d} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ─── Closing payoff ─────────────────────────────────────────────────────────────
const PayoffScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const logoScale = spring({ frame, fps, config: { stiffness: 90, damping: 14 } });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg,#0F172A,#1E293B)",
        justifyContent: "center",
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        opacity: fade,
      }}
    >
      <div style={{ fontSize: 260, marginBottom: 40, transform: `scale(${logoScale})` }}>🛡️</div>
      <h1
        style={{
          fontFamily: FONT,
          fontSize: 200,
          fontWeight: 900,
          color: "#FFFFFF",
          margin: 0,
          letterSpacing: -2,
        }}
      >
        AbaYa Track
      </h1>
      <h2
        style={{
          fontFamily: FONT,
          fontSize: 96,
          fontWeight: 400,
          color: "#94A3B8",
          marginTop: 30,
        }}
      >
        It just keeps running.
      </h2>
      <Heartbeat label="PEACE OF MIND" color="#22C55E" />
    </AbsoluteFill>
  );
};
