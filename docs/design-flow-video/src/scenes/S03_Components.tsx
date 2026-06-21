import React from "react";
import { SHOTS_S03_COMPONENTS } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { FlowNode } from "../components/FlowNode";
import { RackFocus } from "../components/RackFocus";
import { SectionTitle } from "../components/SectionTitle";
import { STAGE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find((s) => s.id === "S03_Components")!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const COMPONENTS = [
  {
    id: "comp-server",
    x: cx - 560,
    y: cy - 200,
    label: "server.js",
    sublabel: "Express + Socket.IO + REST",
    revealAt: 18,
    tone: "primary" as const,
  },
  {
    id: "comp-worker",
    x: cx + 560,
    y: cy - 200,
    label: "cloudflare/src/index.js",
    sublabel: "CEO + ingest + D1 + R2",
    revealAt: 36,
    tone: "primary" as const,
  },
  {
    id: "comp-watcher",
    x: cx - 560,
    y: cy + 200,
    label: "tools/catalog-watcher",
    sublabel: "watch-catalog.js (xlsx)",
    revealAt: 54,
    tone: "warm" as const,
  },
  {
    id: "comp-public",
    x: cx + 560,
    y: cy + 200,
    label: "public/",
    sublabel: "kiosk.html + dashboard.html + setup.html",
    revealAt: 72,
    tone: "good" as const,
  },
];

export const S03_Components: React.FC = () => {
  return (
    <SceneFrame shots={SHOTS_S03_COMPONENTS} totalDuration={DURATION}>
      <BackdropGrid />
      <div
        style={{
          position: "absolute",
          left: cx - 900,
          top: cy - 760,
          width: 1800,
        }}
      >
        <SectionTitle
          kicker="3. Component Inventory"
          title="Four runtimes, one factory"
          subtitle="One Node process for the floor, one Worker at the edge, one watcher for catalog ingest, one set of static SPAs for the browser."
          startAt={0}
        />
      </div>

      {COMPONENTS.map((c) => (
        <RackFocus key={c.id} id={c.id}>
          <FlowNode
            x={c.x}
            y={c.y}
            width={680}
            height={220}
            label={c.label}
            sublabel={c.sublabel}
            tone={c.tone}
            startAt={c.revealAt}
            active
          />
        </RackFocus>
      ))}
    </SceneFrame>
  );
};
