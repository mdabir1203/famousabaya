import React from "react";
import { useCurrentFrame } from "remotion";
import { FACTORY_HTTP, FACTORY_SOCKET, WORKER_ROUTES, Route } from "../data/apiRoutes";
import { SHOTS_S05_API_SURFACE } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { ParallaxLayer } from "../components/ParallaxLayer";
import { SectionTitle } from "../components/SectionTitle";
import { PALETTE, SPACE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find((s) => s.id === "S05_ApiSurface")!.durationFrames;

const cx = STAGE.centerX;
const cy = STAGE.centerY;

const RouteRow: React.FC<{ route: Route; revealAt: number }> = ({
  route,
  revealAt,
}) => {
  const frame = useCurrentFrame();
  const visible = frame > revealAt;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 360px 1fr",
        alignItems: "center",
        gap: 16,
        padding: "12px 18px",
        borderBottom: `1px solid ${PALETTE.panelBorder}`,
        opacity: visible ? 1 : 0,
        transform: `translateX(${visible ? 0 : -10}px)`,
      }}
    >
      <span
        style={{
          fontFamily: TYPE.mono,
          fontSize: TYPE.scale.small,
          color: PALETTE.accent,
          letterSpacing: 1.5,
        }}
      >
        {route.method}
      </span>
      <span
        style={{
          fontFamily: TYPE.mono,
          fontSize: TYPE.scale.body,
          color: PALETTE.fg,
        }}
      >
        {route.path}
      </span>
      <span
        style={{
          fontFamily: TYPE.family,
          fontSize: TYPE.scale.small,
          color: PALETTE.fgDim,
        }}
      >
        {route.purpose}
      </span>
    </div>
  );
};

const Table: React.FC<{
  title: string;
  routes: readonly Route[];
  startReveal: number;
  perRow?: number;
  width?: number;
  x: number;
  y: number;
}> = ({ title, routes, startReveal, perRow = 8, width = 1400, x, y }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: x - width / 2,
        top: y,
        width,
        background: PALETTE.panel,
        border: `1px solid ${PALETTE.panelBorder}`,
        borderRadius: SPACE.radius,
        padding: 28,
        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          fontFamily: TYPE.mono,
          fontSize: TYPE.scale.small,
          color: PALETTE.accent,
          letterSpacing: 3,
          textTransform: "uppercase",
          marginBottom: 20,
        }}
      >
        {title}
      </div>
      {routes.map((r, i) => (
        <RouteRow key={r.path + i} route={r} revealAt={startReveal + i * perRow} />
      ))}
    </div>
  );
};

export const S05_ApiSurface: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame shots={SHOTS_S05_API_SURFACE} totalDuration={DURATION}>
      <BackdropGrid />
      <ParallaxLayer depth={0.6}>
        <div style={{ position: "absolute", left: cx - 900, top: cy - 1100, width: 1800 }}>
          <SectionTitle
            kicker="5. API Surface"
            title="Three contracts"
            subtitle="Factory HTTP, factory Socket.IO, and the Cloudflare Worker. Locked shapes; refactor guardrails forbid breaking them."
            startAt={0}
          />
        </div>
      </ParallaxLayer>

      <ParallaxLayer depth={1.0}>
        <Table
          title="Factory HTTP (server.js)"
          routes={FACTORY_HTTP}
          startReveal={20}
          x={cx}
          y={cy - 720}
          width={1500}
        />
        <Table
          title="Cloudflare Worker"
          routes={WORKER_ROUTES}
          startReveal={420}
          x={cx}
          y={cy + 200}
          width={1500}
        />
      </ParallaxLayer>

      <ParallaxLayer depth={1.4}>
        <div
          style={{
            position: "absolute",
            left: cx - 750,
            top: cy - 100,
            width: 1500,
            padding: 28,
            background: PALETTE.bg2,
            border: `1px solid ${PALETTE.accent}55`,
            borderRadius: SPACE.radius,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 28,
            opacity: frame > 240 ? 1 : 0,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: TYPE.mono,
                fontSize: TYPE.scale.small,
                color: PALETTE.accent,
                letterSpacing: 3,
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              Socket.IO  -  server emits
            </div>
            {FACTORY_SOCKET.serverEmits.map((e, i) => (
              <div
                key={e}
                style={{
                  fontFamily: TYPE.mono,
                  fontSize: TYPE.scale.body,
                  color: PALETTE.fg,
                  marginBottom: 8,
                  opacity: frame > 260 + i * 6 ? 1 : 0,
                }}
              >
                {">"} {e}
              </div>
            ))}
          </div>
          <div>
            <div
              style={{
                fontFamily: TYPE.mono,
                fontSize: TYPE.scale.small,
                color: PALETTE.good,
                letterSpacing: 3,
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              Socket.IO  -  client requests
            </div>
            {FACTORY_SOCKET.clientRequests.map((e, i) => (
              <div
                key={e}
                style={{
                  fontFamily: TYPE.mono,
                  fontSize: TYPE.scale.body,
                  color: PALETTE.fg,
                  marginBottom: 8,
                  opacity: frame > 280 + i * 6 ? 1 : 0,
                }}
              >
                {"<"} {e}
              </div>
            ))}
          </div>
        </div>
      </ParallaxLayer>
    </SceneFrame>
  );
};
