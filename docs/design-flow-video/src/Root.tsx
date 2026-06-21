import React from "react";
import { Composition } from "remotion";
import { AbaYaDesignFlow } from "./AbaYaDesignFlow";
import { TOTAL_DURATION } from "./data/scenes";
import { FPS, HEIGHT, WIDTH } from "./theme";

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="AbaYaDesignFlow"
        component={AbaYaDesignFlow}
        durationInFrames={TOTAL_DURATION}
        fps={FPS}
        width={3840}
        height={2160}
      />
    </>
  );
};
