import { Composition } from "remotion";
import { Main } from "./Main";
import { TOTAL_DURATION_IN_FRAMES, FPS, WIDTH, HEIGHT } from "./chapters";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AbaYaTrack"
        component={Main}
        durationInFrames={TOTAL_DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
