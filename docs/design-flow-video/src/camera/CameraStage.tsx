import React from "react";
import { AbsoluteFill } from "remotion";
import { HEIGHT, PALETTE, STAGE, WIDTH } from "../theme";
import { CameraContext, useCamera } from "./useCamera";
import { ShotList } from "./types";

type CameraStageProps = {
  shots: ShotList;
  background?: string;
  children: React.ReactNode;
};

export const CameraStage: React.FC<CameraStageProps> = ({
  shots,
  background = PALETTE.bg0,
  children,
}) => {
  const cam = useCamera(shots);

  const transform =
    `translate(${-cam.x}px, ${-cam.y}px) ` +
    `scale(${cam.scale}) ` +
    `rotate(${cam.rotateZ}deg)`;

  const stageStyle: React.CSSProperties = {
    position: "absolute",
    width: STAGE.width,
    height: STAGE.height,
    left: (WIDTH - STAGE.width) / 2,
    top: (HEIGHT - STAGE.height) / 2,
    transform,
    transformOrigin: "center center",
    filter: cam.blur > 0.05 ? `blur(${cam.blur}px)` : undefined,
    willChange: "transform, filter",
  };

  return (
    <CameraContext.Provider value={cam}>
      <AbsoluteFill
        style={{ backgroundColor: background, overflow: "hidden" }}
      >
        <div style={stageStyle}>{children}</div>
      </AbsoluteFill>
    </CameraContext.Provider>
  );
};
