import React from "react";
import { SHOTS_S09_DEPLOYMENT } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { Connector } from "../components/Connector";
import { FlowNode } from "../components/FlowNode";
import { ParallaxLayer } from "../components/ParallaxLayer";
import { SectionTitle } from "../components/SectionTitle";
import { PALETTE, SPACE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find(
  (s) => s.id === "S09_DeploymentTopology",
)!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const SubgraphLabel: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
}> = ({ x, y, width, height, label, color }) => (
  <div
    style={{
      position: "absolute",
      left: x - width / 2,
      top: y - height / 2,
      width,
      height,
      border: `1.5px dashed ${color}55`,
      borderRadius: SPACE.radius,
      pointerEvents: "none",
    }}
  >
    <div
      style={{
        position: "absolute",
        top: -36,
        left: 24,
        padding: "4px 14px",
        background: PALETTE.bg0,
        fontFamily: TYPE.mono,
        fontSize: TYPE.scale.small,
        color,
        letterSpacing: 3,
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  </div>
);

export const S09_DeploymentTopology: React.FC = () => {
  return (
    <SceneFrame shots={SHOTS_S09_DEPLOYMENT} totalDuration={DURATION}>
      <BackdropGrid />

      <div style={{ position: "absolute", left: cx - 900, top: cy - 760, width: 1800 }}>
        <SectionTitle
          kicker="10. Deployment Topology"
          title="OnPrem and Cloud, talking over HTTPS"
          subtitle="One Windows host on the floor, one Office laptop on Tailscale, one Worker at the edge. The legacy tunnel is preserved as backup."
          startAt={0}
        />
      </div>

      <ParallaxLayer depth={0.6}>
        <SubgraphLabel
          x={cx - 600}
          y={cy + 100}
          width={1100}
          height={760}
          label="OnPrem  -  Factory / Office"
          color={PALETTE.accent}
        />
        <SubgraphLabel
          x={cx + 700}
          y={cy + 100}
          width={800}
          height={760}
          label="Internet  -  Cloud"
          color={PALETTE.good}
        />
      </ParallaxLayer>

      <ParallaxLayer depth={1.0}>
        <FlowNode
          x={cx - 950}
          y={cy - 100}
          width={320}
          height={130}
          label="Tablets (LAN)"
          tone="good"
          startAt={20}
          active
        />
        <FlowNode
          x={cx - 950}
          y={cy + 100}
          width={320}
          height={130}
          label="Supervisor PCs"
          tone="good"
          startAt={36}
          active
        />
        <FlowNode
          x={cx - 250}
          y={cy + 0}
          width={420}
          height={170}
          label="Windows Host"
          sublabel="Node + Tailscale"
          tone="primary"
          startAt={6}
          active
        />
        <FlowNode
          x={cx - 250}
          y={cy + 320}
          width={420}
          height={150}
          label="Office Laptop"
          sublabel="Tailscale + Watcher"
          tone="warm"
          startAt={48}
          active
        />
        <FlowNode
          x={cx + 700}
          y={cy + 0}
          width={420}
          height={170}
          label="Cloudflare Worker"
          sublabel="D1 + R2"
          tone="primary"
          startAt={20}
          active
        />
        <FlowNode
          x={cx + 700}
          y={cy + 320}
          width={420}
          height={150}
          label="Cloudflare Tunnel"
          sublabel="legacy backup"
          tone="warn"
          startAt={60}
          active
        />
      </ParallaxLayer>

      <ParallaxLayer depth={1.2}>
        <Connector
          fromX={cx - 790}
          fromY={cy - 100}
          toX={cx - 460}
          toY={cy - 30}
          startAt={70}
          color={PALETTE.good}
          label="LAN HTTP/WS"
        />
        <Connector
          fromX={cx - 790}
          fromY={cy + 100}
          toX={cx - 460}
          toY={cy + 30}
          startAt={90}
          color={PALETTE.good}
          label="LAN HTTP/WS"
        />
        <Connector
          fromX={cx - 250}
          fromY={cy + 240}
          toX={cx - 250}
          toY={cy + 80}
          startAt={120}
          color={PALETTE.accentWarm}
          label="Tailscale mesh"
          curve={-0.2}
        />
        <Connector
          fromX={cx - 40}
          fromY={cy + 0}
          toX={cx + 490}
          toY={cy + 0}
          startAt={150}
          color={PALETTE.accent}
          label="HTTPS push"
        />
        <Connector
          fromX={cx - 40}
          fromY={cy + 60}
          toX={cx + 490}
          toY={cy + 320}
          startAt={180}
          color={PALETTE.warn}
          dashed
          label="optional"
          curve={0.18}
        />
      </ParallaxLayer>
    </SceneFrame>
  );
};
