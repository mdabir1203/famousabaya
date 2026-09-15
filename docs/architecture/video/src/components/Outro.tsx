import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { TOTAL_DURATION_IN_FRAMES, FPS } from "../chapters";

/** Last 2 seconds of the video — 88s → 90s (frames 2640 → 2700). */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const outroStart = (TOTAL_DURATION_IN_FRAMES / FPS - 2) * FPS; // frame 2640
  const localFrame = frame - outroStart;

  const enter = interpolate(localFrame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "0 8vw",
        opacity: enter,
        pointerEvents: "none",
        fontFamily: "Inter, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          color: "#5eead4",
          fontFamily: "Geist Mono, ui-monospace, monospace",
          fontSize: 18,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ width: 40, height: 1, background: "#5eead4" }} />
        End of demo
      </div>

      <h2
        style={{
          fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
          fontWeight: 400,
          fontSize: 120,
          lineHeight: 1.04,
          letterSpacing: "-0.024em",
          color: "#f4f6f9",
          margin: 0,
          maxWidth: 1500,
        }}
      >
        Read the{" "}
        <span style={{ color: "#5eead4", fontStyle: "italic" }}>line-cited prose</span>{" "}
        that pairs with every diagram.
      </h2>

      <p
        style={{
          color: "#a9b3bf",
          fontSize: 26,
          lineHeight: 1.55,
          maxWidth: 1100,
          margin: "40px 0 0",
          fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
        }}
      >
        The diagrams show you where the bytes go. The flow map shows you why, with file paths, line numbers, and the security model behind every endpoint.
      </p>
    </div>
  );
};
