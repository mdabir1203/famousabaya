import React from "react";
import { useCameraContext } from "../camera/useCamera";

type RackFocusProps = {
  id: string;
  maxBlurPx?: number;
  children: React.ReactNode;
};

export const RackFocus: React.FC<RackFocusProps> = ({
  id,
  maxBlurPx = 6,
  children,
}) => {
  const cam = useCameraContext();
  const isFocused = cam.focusOn === id || cam.focusOn === null;
  const blur = isFocused ? 0 : maxBlurPx;

  return (
    <div
      style={{
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
};
