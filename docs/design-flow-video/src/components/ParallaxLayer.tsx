import React from "react";
import { useCameraContext } from "../camera/useCamera";

type ParallaxLayerProps = {
  depth?: number;
  id?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

export const ParallaxLayer: React.FC<ParallaxLayerProps> = ({
  depth = 1,
  style,
  children,
}) => {
  const cam = useCameraContext();
  const factor = 1 - depth;
  const dx = cam.x * factor;
  const dy = cam.y * factor;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `translate(${dx}px, ${dy}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
