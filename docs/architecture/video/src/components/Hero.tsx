import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

/** 0–6 seconds (frames 0–180). Big editorial intro. */
export const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // enter 0 → fade out at 5.5s
  const enter = interpolate(frame, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exit = interpolate(frame, [150, 180], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const opacity = Math.min(enter, exit);

  // line-by-line reveals
  const line1 = interpolate(frame, [10, 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const line2 = interpolate(frame, [28, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const line3 = interpolate(frame, [52, 84], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const lede = interpolate(frame, [80, 130], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: "0 8vw 14vh",
        opacity,
        pointerEvents: "none",
        fontFamily: "Inter, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          color: "#7a6cd1",
          fontFamily: "Geist Mono, ui-monospace, monospace",
          fontSize: 18,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          gap: 12,
          opacity: line1,
        }}
      >
        <div style={{ width: 40, height: 1, background: "#7a6cd1" }} />
        AbaYa-Track · a factory in three dimensions
      </div>

      <h1
        style={{
          fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
          fontWeight: 400,
          fontSize: 168,
          lineHeight: 0.98,
          letterSpacing: "-0.028em",
          color: "#f4f6f9",
          margin: 0,
          maxWidth: 1600,
        }}
      >
        <div style={{ opacity: line1, transform: `translateY(${(1 - line1) * 30}px)` }}>
          Three boxes.
        </div>
        <div style={{ opacity: line2, transform: `translateY(${(1 - line2) * 30}px)` }}>
          <span style={{ color: "#b39bff", fontStyle: "italic" }}>One source of truth.</span>
        </div>
        <div style={{ opacity: line3, transform: `translateY(${(1 - line3) * 30}px)`, color: "#6e7884" }}>
          And a CEO who never sees a gap.
        </div>
      </h1>

      <p
        style={{
          color: "#a9b3bf",
          fontSize: 28,
          lineHeight: 1.55,
          maxWidth: 1200,
          margin: "40px 0 0",
          fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
          opacity: lede,
          transform: `translateY(${(1 - lede) * 14}px)`,
        }}
      >
        A factory laptop in Dubai writes Start/Finish events to memory, durably saves them to disk, retries pushing them to a Cloudflare Worker, and reconciles any lost ones. The result is a live line you can read from any browser in the world, even if the WAN died.
      </p>
    </div>
  );
};
