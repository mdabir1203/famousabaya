import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { ACTOR_LABEL, Actor, LIFECYCLE_STEPS } from "../data/lifecycleSteps";
import { SHOTS_S06_SESSION_LIFECYCLE } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { Caption } from "../components/Caption";
import { Connector } from "../components/Connector";
import { FlowNode } from "../components/FlowNode";
import { RackFocus } from "../components/RackFocus";
import { SectionTitle } from "../components/SectionTitle";
import { StepCounter } from "../components/StepCounter";
import { FPS, PALETTE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find(
  (s) => s.id === "S06_SessionLifecycle",
)!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const ACTORS: Record<Actor, { x: number; y: number; tone: "primary" | "good" | "warn" }> = {
  K: { x: cx - 700, y: cy + 0, tone: "good" },
  S: { x: cx - 200, y: cy + 0, tone: "primary" },
  W: { x: cx + 350, y: cy - 260, tone: "warn" },
  D: { x: cx + 700, y: cy - 260, tone: "primary" },
  L: { x: cx + 350, y: cy + 280, tone: "good" },
};

type Beat = {
  k: number;
  startSec: number;
  endSec: number;
};

const BEATS: Beat[] = [
  { k: 1, startSec: 3.0, endSec: 6.0 },
  { k: 2, startSec: 6.0, endSec: 9.0 },
  { k: 3, startSec: 9.0, endSec: 12.0 },
  { k: 4, startSec: 12.0, endSec: 15.0 },
  { k: 5, startSec: 15.0, endSec: 17.5 },
  { k: 6, startSec: 17.5, endSec: 20.5 },
  { k: 7, startSec: 20.5, endSec: 24.5 },
  { k: 8, startSec: 24.5, endSec: 28.0 },
  { k: 9, startSec: 28.0, endSec: 32.5 },
  { k: 10, startSec: 32.5, endSec: 36.5 },
  { k: 11, startSec: 36.5, endSec: 40.5 },
];

const startFrame = (sec: number): number => Math.round(sec * FPS);

const RECAP_BANNER_START = startFrame(45);

export const S06_SessionLifecycle: React.FC = () => {
  const frame = useCurrentFrame();
  const total = LIFECYCLE_STEPS.length;
  const recapPhase = frame > RECAP_BANNER_START;

  return (
    <SceneFrame shots={SHOTS_S06_SESSION_LIFECYCLE} totalDuration={DURATION}>
      <BackdropGrid />

      <div style={{ position: "absolute", left: cx - 900, top: cy - 760, width: 1800 }}>
        <SectionTitle
          kicker="6. Session Lifecycle"
          title="Eleven atomic steps from scan to ledger"
          subtitle="Kiosk -> Factory Server -> Cloudflare Worker -> D1, with the LAN Dashboard receiving every state_update in real time."
          startAt={0}
        />
      </div>

      {/* Actors */}
      {(Object.keys(ACTORS) as Actor[]).map((id) => {
        const a = ACTORS[id];
        return (
          <RackFocus key={id} id={`actor-${id}`}>
            <FlowNode
              x={a.x}
              y={a.y}
              width={320}
              height={150}
              label={ACTOR_LABEL[id]}
              sublabel={
                id === "S"
                  ? "in-memory state"
                  : id === "W"
                    ? "edge ingest"
                    : id === "D"
                      ? "durable"
                      : id === "L"
                        ? "Socket.IO + poll"
                        : "PWA"
              }
              tone={a.tone}
              startAt={6}
              active
            />
          </RackFocus>
        );
      })}

      {/* Connectors: linger from step start through end of scene (build up recap trace) */}
      {LIFECYCLE_STEPS.map((step, i) => {
        const beat = BEATS[i]!;
        const stepStart = startFrame(beat.startSec);
        const lingerDuration = DURATION - stepStart;
        const fromActor = ACTORS[step.from];
        const toActor = ACTORS[step.to];
        const isLoopback = step.from === step.to;
        const stepDuration = startFrame(beat.endSec) - stepStart;
        const routeLaneByStep: Record<number, number> = {
          1: -42,
          2: 42,
          3: -78,
          5: 78,
          6: -34,
          7: -36,
          9: -114,
          10: 34,
          11: 36,
        };
        const laneOffset = routeLaneByStep[step.k] ?? 0;
        const mostlyHorizontal = Math.abs(fromActor.y - toActor.y) < 80;
        const fromX =
          fromActor.x + (toActor.x > fromActor.x ? 160 : -160);
        const toX = toActor.x + (toActor.x > fromActor.x ? -160 : 160);
        const fromY = mostlyHorizontal
          ? fromActor.y + laneOffset
          : fromActor.y + Math.sign(toActor.y - fromActor.y) * 28;
        const toY = mostlyHorizontal
          ? toActor.y + laneOffset
          : toActor.y - Math.sign(toActor.y - fromActor.y) * 28;

        if (isLoopback) {
          return (
            <Sequence
              key={`conn-${i}`}
              from={stepStart}
              durationInFrames={lingerDuration}
              layout="none"
            >
              <div
                style={{
                  position: "absolute",
                  left: fromActor.x - 90,
                  top: fromActor.y - 110,
                  fontFamily: TYPE.mono,
                  fontSize: TYPE.scale.small,
                  color: PALETTE.accent,
                  border: `1px solid ${PALETTE.accent}`,
                  borderRadius: 999,
                  padding: "4px 14px",
                  background: PALETTE.bg1,
                }}
              >
                self  -  in-memory
              </div>
            </Sequence>
          );
        }

        return (
          <Sequence
            key={`conn-${i}`}
            from={stepStart}
            durationInFrames={lingerDuration}
            layout="none"
          >
            <Connector
              fromX={fromX}
              fromY={fromY}
              toX={toX}
              toY={toY}
              startAt={0}
              drawDuration={Math.max(stepDuration - 12, 12)}
              color={
                step.to === "L"
                  ? PALETTE.good
                  : step.to === "D"
                    ? PALETTE.accentWarm
                    : PALETTE.accent
              }
              strokeWidth={4}
              curve={
                step.from === "S" && step.to === "W"
                  ? step.k === 11
                    ? -0.38
                    : -0.22
                  : laneOffset < 0
                    ? -0.12
                    : 0.12
              }
              endTrim={34}
              labelDx={step.to === "W" ? 44 : 0}
              labelDy={step.to === "W" ? -24 : 0}
              showEndpointDot
            />
          </Sequence>
        );
      })}

      {/* Active beat: caption + step counter (only visible during the beat) */}
      {LIFECYCLE_STEPS.map((step, i) => {
        const beat = BEATS[i]!;
        const stepStart = startFrame(beat.startSec);
        const stepEnd = startFrame(beat.endSec);
        const captionWidth = 720;
        return (
          <Sequence
            key={`beat-${i}`}
            from={stepStart}
            durationInFrames={stepEnd - stepStart}
            layout="none"
          >
            <div
              style={{
                position: "absolute",
                left: cx - captionWidth / 2,
                top: cy + 540,
                width: captionWidth,
              }}
            >
              <Caption
                startAt={4}
                durationFrames={16}
                size={TYPE.scale.h3}
                color={PALETTE.fg}
              >
                <span
                  style={{
                    fontFamily: TYPE.mono,
                    background: PALETTE.bg1,
                    border: `1px solid ${PALETTE.panelBorder}`,
                    padding: "12px 22px",
                    borderRadius: 14,
                    display: "inline-block",
                  }}
                >
                  {step.text}
                </span>
              </Caption>
            </div>
            <StepCounter
              index={beat.k}
              total={total}
              startAt={0}
              x={cx - 920}
              y={cy + 700}
            />
          </Sequence>
        );
      })}

      {recapPhase ? (
        <div
          style={{
            position: "absolute",
            left: cx - 900,
            top: cy + 600,
            width: 1800,
            textAlign: "center",
            fontFamily: TYPE.family,
            fontSize: TYPE.scale.h3,
            fontWeight: 700,
            color: PALETTE.fg,
          }}
        >
          One trace.  Eleven hops.  Two systems.  Zero CEO friction.
        </div>
      ) : null}
    </SceneFrame>
  );
};
