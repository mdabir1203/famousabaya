import React from "react";
import { useCurrentFrame } from "remotion";
import { CATALOG_NOTE, CATALOG_WRITERS } from "../data/catalogWriters";
import { SHOTS_S07_CATALOG_FLOW } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { Connector } from "../components/Connector";
import { FlowNode } from "../components/FlowNode";
import { RackFocus } from "../components/RackFocus";
import { SectionTitle } from "../components/SectionTitle";
import { PALETTE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find((s) => s.id === "S07_CatalogFlow")!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const WRITER_POSITIONS: Record<string, { x: number; y: number }> = {
  watcher: { x: cx - 540, y: cy - 260 },
  localXlsx: { x: cx + 540, y: cy - 260 },
  admin: { x: cx - 540, y: cy + 260 },
  worker: { x: cx + 540, y: cy + 260 },
};

const D1 = { x: cx, y: cy };

export const S07_CatalogFlow: React.FC = () => {
  const frame = useCurrentFrame();

  const showWarning = frame > 30 * 28;

  return (
    <SceneFrame shots={SHOTS_S07_CATALOG_FLOW} totalDuration={DURATION}>
      <BackdropGrid />

      <div style={{ position: "absolute", left: cx - 900, top: cy - 760, width: 1800 }}>
        <SectionTitle
          kicker="7. Catalog Flow"
          title="Four writers, one ledger"
          subtitle="Excel exports, local XLSX reload, admin PUTs, and the Worker itself can all touch the catalog. Last-writer-wins by timing."
          startAt={0}
        />
      </div>

      {CATALOG_WRITERS.map((w, i) => {
        const pos = WRITER_POSITIONS[w.id]!;
        const revealAt = 18 + i * 10;
        return (
          <RackFocus key={w.id} id={`writer-${w.id}`}>
            <FlowNode
              x={pos.x}
              y={pos.y}
              width={420}
              height={150}
              label={w.label}
              sublabel={w.via}
              tone="warm"
              startAt={revealAt}
              active
            />
          </RackFocus>
        );
      })}

      <RackFocus id="node-d1">
        <FlowNode
          x={D1.x}
          y={D1.y}
          width={360}
          height={170}
          label="D1: abaya_catalog"
          sublabel="catalog_meta + version"
          tone="primary"
          startAt={60}
          active
        />
      </RackFocus>

      {/* fan-in arrows */}
      {CATALOG_WRITERS.map((w, i) => {
        const pos = WRITER_POSITIONS[w.id]!;
        return (
          <Connector
            key={`in-${w.id}`}
            fromX={pos.x + (pos.x < D1.x ? 160 : -160)}
            fromY={pos.y + (pos.y < D1.y ? 60 : -60)}
            toX={D1.x + (pos.x < D1.x ? -140 : 140)}
            toY={D1.y + (pos.y < D1.y ? -60 : 60)}
            startAt={90 + i * 20}
            drawDuration={20}
            color={PALETTE.accentWarm}
            strokeWidth={3}
            curve={pos.y < D1.y ? -0.18 : 0.18}
            startTrim={24}
            endTrim={44}
            showEndpointDot
          />
        );
      })}

      {/* fan-out from D1 to clients (server -> kiosk + dash) */}
      <FlowNode
        x={cx + 1100}
        y={cy + 0}
        width={420}
        height={150}
        label="Factory Server"
        sublabel="GET poll  -  catalog_update"
        tone="primary"
        startAt={300}
        active
      />
      <FlowNode
        x={cx + 1500}
        y={cy - 220}
        width={320}
        height={130}
        label="Kiosk UI"
        sublabel="catalog_update"
        tone="good"
        startAt={360}
        active
      />
      <FlowNode
        x={cx + 1500}
        y={cy + 220}
        width={320}
        height={130}
        label="LAN Dashboard"
        sublabel="catalog_update"
        tone="good"
        startAt={390}
        active
      />

      <Connector
        fromX={D1.x + 180}
        fromY={D1.y}
        toX={cx + 900}
        toY={cy}
        startAt={330}
        drawDuration={20}
        color={PALETTE.accent}
        label="GET (poll)"
        labelDy={-34}
        labelWidth={260}
        startTrim={30}
        endTrim={44}
      />
      <Connector
        fromX={cx + 1300}
        fromY={cy - 30}
        toX={cx + 1500}
        toY={cy - 180}
        startAt={420}
        drawDuration={16}
        color={PALETTE.good}
        curve={-0.16}
        startTrim={26}
        endTrim={38}
      />
      <Connector
        fromX={cx + 1300}
        fromY={cy + 30}
        toX={cx + 1500}
        toY={cy + 180}
        startAt={450}
        drawDuration={16}
        color={PALETTE.good}
        curve={0.16}
        startTrim={26}
        endTrim={38}
      />

      {showWarning ? (
        <div
          style={{
            position: "absolute",
            left: cx - 600,
            top: cy + 700,
            width: 1200,
            textAlign: "center",
            padding: "20px 28px",
            background: "rgba(255, 108, 138, 0.1)",
            border: `1px solid ${PALETTE.danger}88`,
            borderRadius: 16,
            fontFamily: TYPE.family,
            fontSize: TYPE.scale.h3,
            color: PALETTE.danger,
            letterSpacing: 0.5,
          }}
        >
          {CATALOG_NOTE}
        </div>
      ) : null}
    </SceneFrame>
  );
};
