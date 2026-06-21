import React from "react";
import { AbsoluteFill } from "remotion";
import { CameraStage } from "../camera/CameraStage";
import type { ShotList } from "../camera/types";
import { CameraMotionBlur } from "../components/CameraMotionBlur";
import { FilmGrain } from "../components/FilmGrain";
import { Letterbox } from "../components/Letterbox";
import { Vignette } from "../components/Vignette";

type SceneFrameProps = {
  shots: ShotList;
  totalDuration: number;
  letterbox?: boolean;
  letterboxHeight?: number;
  vignetteIntensity?: number;
  grainOpacity?: number;
  background?: string;
  children: React.ReactNode;
};

export const SceneFrame: React.FC<SceneFrameProps> = ({
  shots,
  totalDuration,
  letterbox = true,
  letterboxHeight = 80,
  vignetteIntensity = 0.55,
  grainOpacity = 0.05,
  background,
  children,
}) => {
  return (
    <AbsoluteFill>
      <CameraStage shots={shots} background={background}>
        <CameraMotionBlur>{children}</CameraMotionBlur>
      </CameraStage>
      <Vignette intensity={vignetteIntensity} />
      <FilmGrain opacity={grainOpacity} />
      {letterbox ? (
        <Letterbox totalDuration={totalDuration} heightPx={letterboxHeight} />
      ) : null}
    </AbsoluteFill>
  );
};
