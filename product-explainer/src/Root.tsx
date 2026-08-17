import "./index.css";
import { Composition } from "remotion";
import { AbaYaExplainer } from "./AbaYaExplainer";
import { ReliabilityStory, TOTAL_FRAMES } from "./ReliabilityStory";
import { DashboardTour } from "./dashboardTour/DashboardTour";
import { TOTAL_FRAMES as TOUR_FRAMES, FPS as TOUR_FPS } from "./dashboardTour/narration";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Reliability explainer — true 4K (3840×2160).
          Render 1080p:  npx remotion render ReliabilityStory out/reliability-1080p.mp4 --scale=0.5
          Render 4K:     npx remotion render ReliabilityStory out/reliability-4k.mp4   --scale=1 */}
      <Composition
        id="ReliabilityStory"
        component={ReliabilityStory}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={3840}
        height={2160}
      />

      <Composition
        id="AbaYaExplainer"
        component={AbaYaExplainer}
        durationInFrames={750}
        fps={30}
        width={1920}
        height={1080}
      />

      {/* Dashboard tour — full dashboard walkthrough, 3 languages (EN/HI/BN).
          Render 1080p:  npx remotion render DashboardTour out/dashboard-tour-1080p.mp4
          Total ~ 3-4 min, 30 fps, 1920x1080. */}
      <Composition
        id="DashboardTour"
        component={DashboardTour}
        durationInFrames={TOUR_FRAMES}
        fps={TOUR_FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
