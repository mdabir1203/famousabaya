import React from "react";
import { PALETTE, STAGE } from "../theme";

type BackdropGridProps = {
  spacing?: number;
  dotSize?: number;
  color?: string;
};

export const BackdropGrid: React.FC<BackdropGridProps> = ({
  spacing = 80,
  dotSize = 2,
  color = "rgba(108, 194, 255, 0.07)",
}) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `
          radial-gradient(ellipse at 50% 30%, ${PALETTE.bg2} 0%, ${PALETTE.bg0} 70%),
          radial-gradient(${color} ${dotSize}px, transparent ${dotSize}px)
        `,
        backgroundSize: `100% 100%, ${spacing}px ${spacing}px`,
        width: STAGE.width,
        height: STAGE.height,
      }}
    />
  );
};
