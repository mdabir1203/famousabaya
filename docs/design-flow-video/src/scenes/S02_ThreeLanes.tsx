import React from "react";
import { useCurrentFrame } from "remotion";
import { SHOTS_S02_THREE_LANES } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { Connector } from "../components/Connector";
import { FlowNode } from "../components/FlowNode";
import { RackFocus } from "../components/RackFocus";
import { SectionTitle } from "../components/SectionTitle";
import { PALETTE, SPACE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find((s) => s.id === "S02_ThreeLanes")!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const LANES = [
  {
    id: "lane-ceo",
    x: cx + 480,
    y: cy - 120,
    title: "CEO Phone",
    actor: "Browser",
    target: "dashboard.farewellabaya.com",
    friction: "Zero. No app install.",
    revealAt: 30,
    tone: "primary" as const,
  },
  {
    id: "lane-kiosk",
    x: cx - 480,
    y: cy - 120,
    title: "Kiosk Tablet",
    actor: "Browser (PWA)",
    target: "Factory server (Socket.IO)",
    friction: "Zero. Add to home screen once.",
    revealAt: 480,
    tone: "good" as const,
  },
  {
    id: "lane-admin",
    x: cx,
    y: cy + 380,
    title: "Admin / Office",
    actor: "Tailscale",
    target: "100.x.x.x:3000  /  https://factory-pc",
    friction: "One-time Tailscale install.",
    revealAt: 780,
    tone: "warm" as const,
  },
];

export const S02_ThreeLanes: React.FC = () => {
  const frame = useCurrentFrame();

  const showHeader = frame > 6;

  return (
    <SceneFrame shots={SHOTS_S02_THREE_LANES} totalDuration={DURATION}>
      <BackdropGrid />
      <div
        style={{
          position: "absolute",
          left: cx - 900,
          top: cy - 760,
          width: 1800,
          opacity: showHeader ? 1 : 0,
        }}
      >
        <SectionTitle
          kicker="2. Network Architecture"
          title="Three Lanes"
          subtitle="Each user group reaches AbaYa Track through a single optimal path. Different friction, different transport, one factory."
          startAt={0}
        />
      </div>

      {LANES.map((lane) => (
        <RackFocus key={lane.id} id={lane.id}>
          <FlowNode
            x={lane.x}
            y={lane.y - 90}
            width={520}
            height={220}
            label={lane.title}
            sublabel={lane.actor}
            tone={lane.tone}
            startAt={lane.revealAt}
            active
          />
          <div
            style={{
              position: "absolute",
              left: lane.x - 280,
              top: lane.y + 50,
              width: 560,
              fontFamily: TYPE.mono,
              fontSize: TYPE.scale.body,
              color: PALETTE.fg,
              textAlign: "center",
              letterSpacing: 0.5,
              padding: "16px 20px",
              background: PALETTE.bg1,
              border: `1px solid ${PALETTE.panelBorder}`,
              borderRadius: SPACE.radius,
              opacity: frame > lane.revealAt + 12 ? 1 : 0,
            }}
          >
            {lane.target}
          </div>
          <div
            style={{
              position: "absolute",
              left: lane.x - 280,
              top: lane.y + 150,
              width: 560,
              textAlign: "center",
              fontFamily: TYPE.family,
              fontSize: TYPE.scale.small,
              color: PALETTE.fgDim,
              opacity: frame > lane.revealAt + 24 ? 1 : 0,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            {lane.friction}
          </div>
        </RackFocus>
      ))}

      {/* connectors fan-in to a central "Factory" node, drawn after lanes appear */}
      <Connector
        fromX={cx + 480}
        fromY={cy - 60}
        toX={cx}
        toY={cy + 90}
        startAt={300}
        drawDuration={20}
        color={PALETTE.accent}
        curve={-0.14}
        startTrim={24}
        endTrim={46}
        label="CEO lane"
        labelDy={-34}
      />
      <Connector
        fromX={cx - 480}
        fromY={cy - 60}
        toX={cx}
        toY={cy + 90}
        startAt={720}
        drawDuration={20}
        color={PALETTE.good}
        curve={0.14}
        startTrim={24}
        endTrim={46}
        label="Kiosk lane"
        labelDy={-34}
      />
      <Connector
        fromX={cx}
        fromY={cy + 280}
        toX={cx}
        toY={cy + 130}
        startAt={1020}
        drawDuration={16}
        color={PALETTE.accentWarm}
        curve={0}
        startTrim={24}
        endTrim={46}
        label="Tailscale lane"
        labelDx={160}
        labelWidth={280}
      />

      <FlowNode
        x={cx}
        y={cy + 110}
        width={420}
        height={140}
        label="AbaYa Track"
        sublabel="server.js + cloudflare/src/index.js"
        tone="primary"
        startAt={frame > 12 ? 12 : 0}
        active
      />
    </SceneFrame>
  );
};
