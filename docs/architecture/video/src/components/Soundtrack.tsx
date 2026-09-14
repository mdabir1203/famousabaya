import { Audio, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { TOTAL_DURATION_IN_FRAMES } from "../chapters";

/**
 * Soft ambient background music — ducks under the voiceover.
 *
 * Uses a pre-rendered mp3 placed at public/soundtrack.mp3.
 * If you don't have one, this component renders silently.
 */
export const Soundtrack: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // fade in 0–3s, hold, fade out last 4s
  const fadeIn = interpolate(frame, [0, 90], [0, 0.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [TOTAL_DURATION_IN_FRAMES - 120, TOTAL_DURATION_IN_FRAMES], [0.4, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const volume = Math.max(0, Math.min(fadeIn, fadeOut));

  return <Audio src={staticFile("soundtrack.mp3")} volume={volume} />;
};
