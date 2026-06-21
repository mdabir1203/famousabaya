import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, PALETTE, STAGE } from "../theme";

type ConnectorProps = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startAt?: number;
  drawDuration?: number;
  color?: string;
  strokeWidth?: number;
  dashed?: boolean;
  label?: string;
  curve?: number;
  startTrim?: number;
  endTrim?: number;
  labelDx?: number;
  labelDy?: number;
  labelWidth?: number;
  showEndpointDot?: boolean;
};

export const Connector: React.FC<ConnectorProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  startAt = 0,
  drawDuration = 18,
  color = PALETTE.accent,
  strokeWidth = 3,
  dashed = false,
  label,
  curve = 0.25,
  startTrim = 16,
  endTrim = 28,
  labelDx = 0,
  labelDy = 0,
  labelWidth = 320,
  showEndpointDot = true,
}) => {
  const frame = useCurrentFrame();

  const dx = toX - fromX;
  const dy = toY - fromY;
  const rawLen = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / Math.max(rawLen, 1);
  const uy = dy / Math.max(rawLen, 1);
  const startX = fromX + ux * startTrim;
  const startY = fromY + uy * startTrim;
  const endX = toX - ux * endTrim;
  const endY = toY - uy * endTrim;
  const trimmedDx = endX - startX;
  const trimmedDy = endY - startY;
  const len = Math.sqrt(trimmedDx * trimmedDx + trimmedDy * trimmedDy);
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const nx = -dy / Math.max(len, 1);
  const ny = dx / Math.max(len, 1);
  const ctrlX = midX + nx * len * curve;
  const ctrlY = midY + ny * len * curve;
  const labelX = ctrlX + labelDx;
  const labelY = ctrlY + labelDy;

  const path = `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`;

  const draw = interpolate(
    frame,
    [startAt, startAt + drawDuration],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );
  const opacity = interpolate(
    frame,
    [startAt, startAt + 6],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );

  const labelOpacity = interpolate(
    frame,
    [startAt + drawDuration - 4, startAt + drawDuration + 8],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );

  const arrowId = `arrow-${color.replace(/[^a-z0-9]/gi, "")}-${strokeWidth}`;
  const visibleDraw = 1 - draw;

  return (
    <svg
      width={STAGE.width}
      height={STAGE.height}
      viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
    >
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="rgba(7, 10, 18, 0.92)"
        strokeWidth={strokeWidth + 8}
        strokeLinecap="round"
        strokeDasharray={dashed ? "10 8" : `${len}`}
        strokeDashoffset={dashed ? 0 : len * draw}
        opacity={opacity}
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dashed ? "10 8" : `${len}`}
        strokeDashoffset={dashed ? 0 : len * draw}
        opacity={opacity}
        markerEnd={`url(#${arrowId})`}
      />
      {showEndpointDot ? (
        <circle
          cx={endX}
          cy={endY}
          r={Math.max(4, strokeWidth + 2)}
          fill={color}
          opacity={opacity * visibleDraw}
          stroke="rgba(7, 10, 18, 0.92)"
          strokeWidth={3}
        />
      ) : null}
      {label ? (
        <g opacity={labelOpacity}>
          <rect
            x={labelX - labelWidth / 2}
            y={labelY - 22}
            width={labelWidth}
            height={44}
            rx={10}
            fill={PALETTE.bg1}
            stroke={PALETTE.panelBorder}
          />
          <text
            x={labelX}
            y={labelY + 7}
            textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={20}
            fill={PALETTE.fg}
          >
            {label}
          </text>
        </g>
      ) : null}
    </svg>
  );
};
