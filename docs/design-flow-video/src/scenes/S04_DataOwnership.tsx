import React from "react";
import { useCurrentFrame } from "remotion";
import { SHOTS_S04_DATA_OWNERSHIP } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { Connector } from "../components/Connector";
import { FlowNode } from "../components/FlowNode";
import { RackFocus } from "../components/RackFocus";
import { SectionTitle } from "../components/SectionTitle";
import { PALETTE, SPACE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find((s) => s.id === "S04_DataOwnership")!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const COLUMNS = [
  {
    id: "data-local",
    title: "Local (in-memory)",
    x: cx - 700,
    items: [
      "ACTIVE_SESSIONS",
      "Completed log buffer",
      "EMP_PERF",
      "Catalog cache",
    ],
    revealAt: 30,
    tone: "warm" as const,
  },
  {
    id: "data-snapshot",
    title: "Offline JSON snapshot",
    x: cx,
    items: [
      "OFFLINE_REPORT_DIR",
      "persistOfflineDashboardReport()",
      "restoreOfflineDashboardFromDisk()",
      "RESTORE_ACTIVE_SESSION_MAX_AGE_MS = 48h",
    ],
    revealAt: 240,
    tone: "primary" as const,
  },
  {
    id: "data-cloud",
    title: "Cloud (D1 + R2, durable)",
    x: cx + 700,
    items: [
      "sessions",
      "active_sessions",
      "daily_stats",
      "abaya_catalog + catalog_meta",
      "Daily R2 export",
    ],
    revealAt: 600,
    tone: "good" as const,
  },
];

export const S04_DataOwnership: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame shots={SHOTS_S04_DATA_OWNERSHIP} totalDuration={DURATION}>
      <BackdropGrid />
      <div style={{ position: "absolute", left: cx - 900, top: cy - 760, width: 1800 }}>
        <SectionTitle
          kicker="4. Data Ownership"
          title="Three durability tiers"
          subtitle="In-memory state on the floor, periodic JSON snapshot on disk, durable D1 + R2 in the cloud. The middle tier saves you on a power cut."
          startAt={0}
        />
      </div>

      {COLUMNS.map((col) => (
        <RackFocus key={col.id} id={col.id}>
          <FlowNode
            x={col.x}
            y={cy - 100}
            width={620}
            height={120}
            label={col.title}
            tone={col.tone}
            startAt={col.revealAt}
            active
          />
          <div
            style={{
              position: "absolute",
              left: col.x - 310,
              top: cy + 0,
              width: 620,
              padding: 28,
              background: PALETTE.panel,
              border: `1px solid ${PALETTE.panelBorder}`,
              borderRadius: SPACE.radius,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              opacity: frame > col.revealAt + 12 ? 1 : 0,
            }}
          >
            {col.items.map((item, i) => (
              <div
                key={i}
                style={{
                  fontFamily: TYPE.mono,
                  fontSize: TYPE.scale.body,
                  color: PALETTE.fg,
                  letterSpacing: 0.3,
                  opacity: frame > col.revealAt + 18 + i * 6 ? 1 : 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <span style={{ color: PALETTE.accent, width: 18 }}>{">"}</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </RackFocus>
      ))}

      <Connector
        fromX={cx - 380}
        fromY={cy - 80}
        toX={cx - 320}
        toY={cy - 80}
        startAt={300}
        drawDuration={18}
        color={PALETTE.accent}
        label="snapshot"
      />
      <Connector
        fromX={cx + 320}
        fromY={cy - 80}
        toX={cx + 380}
        toY={cy - 80}
        startAt={660}
        drawDuration={18}
        color={PALETTE.good}
        label="POST /api/event"
      />
    </SceneFrame>
  );
};
