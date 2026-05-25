import React from "react";
import { useCurrentFrame } from "remotion";
import { SHOTS_S08_SECURITY } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { RackFocus } from "../components/RackFocus";
import { SectionTitle } from "../components/SectionTitle";
import { PALETTE, SPACE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find(
  (s) => s.id === "S08_SecurityReliability",
)!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const CONTROLS = [
  "X-Ingest-Secret on ingest APIs",
  "CEO_TOKEN on Worker endpoints",
  "Cloudflare Access on tunnel hosts (optional)",
  "Tailscale mesh (WireGuard)",
];

const GAPS = [
  "Factory socket / read APIs unauthenticated by default",
  "CORS '*' on local runtime",
  "CEO_TOKEN in query string (log/referrer leak)",
  "No secret rotation, no audit trail",
];

const RELIABLE = [
  "Local ops do not block on cloud",
  "Dashboard prefers Socket.IO, polls /api/state on disconnect",
  "Catalog reload independent of Cloudflare",
  "Cloud ingest async with bounded timeout",
];

const RISKS = [
  "In-memory state lost on process kill (mitigated by snapshot)",
  "Multi-writer catalog race (last-writer-wins)",
  "Single Node process, no horizontal scale",
];

const Column: React.FC<{
  id: string;
  title: string;
  items: readonly string[];
  x: number;
  y: number;
  tone: string;
  revealAt: number;
}> = ({ id, title, items, x, y, tone, revealAt }) => {
  const frame = useCurrentFrame();
  return (
    <RackFocus id={id}>
      <div
        style={{
          position: "absolute",
          left: x - 480,
          top: y,
          width: 960,
          padding: 32,
          background: PALETTE.panel,
          border: `1px solid ${tone}55`,
          borderRadius: SPACE.radius,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          opacity: frame > revealAt ? 1 : 0,
        }}
      >
        <div
          style={{
            fontFamily: TYPE.mono,
            fontSize: TYPE.scale.small,
            color: tone,
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 20,
          }}
        >
          {title}
        </div>
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              fontFamily: TYPE.family,
              fontSize: TYPE.scale.body,
              color: PALETTE.fg,
              marginBottom: 12,
              opacity: frame > revealAt + 8 + i * 5 ? 1 : 0,
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
            }}
          >
            <span style={{ color: tone, marginTop: 4 }}>{">"}</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </RackFocus>
  );
};

export const S08_SecurityReliability: React.FC = () => {
  const frame = useCurrentFrame();

  const showReliability = frame > 18 * 30;

  return (
    <SceneFrame shots={SHOTS_S08_SECURITY} totalDuration={DURATION}>
      <BackdropGrid />

      <div style={{ position: "absolute", left: cx - 900, top: cy - 760, width: 1800 }}>
        <SectionTitle
          kicker="8 / 9. Security and Reliability"
          title="Honest controls, honest gaps"
          subtitle="What is enforced today, where the trust boundary leaks, and which failures are bounded."
          startAt={0}
        />
      </div>

      {!showReliability ? (
        <>
          <Column
            id="sec-controls"
            title="Controls"
            items={CONTROLS}
            x={cx - 540}
            y={cy - 100}
            tone={PALETTE.good}
            revealAt={20}
          />
          <Column
            id="sec-gaps"
            title="Known Gaps"
            items={GAPS}
            x={cx + 540}
            y={cy - 100}
            tone={PALETTE.danger}
            revealAt={120}
          />
        </>
      ) : (
        <>
          <Column
            id="sec-controls"
            title="Reliability  -  good"
            items={RELIABLE}
            x={cx - 540}
            y={cy - 100}
            tone={PALETTE.good}
            revealAt={18 * 30 + 4}
          />
          <Column
            id="sec-gaps"
            title="Reliability  -  risks"
            items={RISKS}
            x={cx + 540}
            y={cy - 100}
            tone={PALETTE.warn}
            revealAt={18 * 30 + 14}
          />
        </>
      )}
    </SceneFrame>
  );
};
