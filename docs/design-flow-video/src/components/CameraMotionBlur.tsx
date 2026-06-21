import React from "react";
import { CameraMotionBlur as RemotionCameraMotionBlur } from "@remotion/motion-blur";
import { useCameraContext } from "../camera/useCamera";

type Props = {
  shutterAngle?: number;
  samples?: number;
  children: React.ReactNode;
};

export const CameraMotionBlur: React.FC<Props> = ({
  shutterAngle = 180,
  samples = 8,
  children,
}) => {
  const cam = useCameraContext();
  const enabled = cam.motionBlur && process.env.MOTION_BLUR !== "0";

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <RemotionCameraMotionBlur shutterAngle={shutterAngle} samples={samples}>
      {children}
    </RemotionCameraMotionBlur>
  );
};
