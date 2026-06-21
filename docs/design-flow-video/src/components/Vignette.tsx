import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

type VignetteProps = {
  intensity?: number;
  breathe?: number;
};

export const Vignette: React.FC<VignetteProps> = ({
  intensity = 0.55,
  breathe = 0.05,
}) => {
  const frame = useCurrentFrame();
  const period = 240;
  const oscillation = Math.sin((frame / period) * Math.PI * 2) * breathe;
  const i = Math.max(0, Math.min(1, intensity + oscillation));

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${i}) 100%)`,
      }}
    />
  );
};
