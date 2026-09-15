import { useCurrentFrame, AbsoluteFill, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { chapterAtFrame, chapters, WIDTH, HEIGHT, TOTAL_DURATION_IN_FRAMES } from "./chapters";
import { ThreeScene } from "./components/ThreeScene";
import { ChapterOverlay } from "./components/ChapterOverlay";
import { Hero } from "./components/Hero";
import { Outro } from "./components/Outro";
import { Narration } from "./components/Narration";
import { Soundtrack } from "./components/Soundtrack";

/**
 * Main video composition.
 *
 * 0–6s   : Hero (intro overlay)
 * 6–88s  : 7 chapter overlays, each with its own 3D camera waypoint
 * 88–90s : Outro (CTA overlay)
 *
 * Behind all of it: the Three.js scene rendered every frame.
 */
export const Main: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const currentChapter = chapterAtFrame(frame);
  const isIntro = frame < chapters[0].startFrame;
  const isOutro = frame >= TOTAL_DURATION_IN_FRAMES - 60; // last 2s

  return (
    <AbsoluteFill style={{ background: "#08090c" }}>
      {/* 3D scene — the persistent factory floor */}
      <ThreeCanvas
        width={width}
        height={height}
        camera={{ fov: 45, near: 0.1, far: 200, position: [0, 2, 18] }}
        style={{ position: "absolute", inset: 0 }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight color="#b39bff" intensity={1.2} position={[8, 12, 6]} />
        <directionalLight color="#5eead4" intensity={0.8} position={[-8, 4, -6]} />
        <directionalLight color="#f5b95b" intensity={0.4} position={[0, -2, 8]} />
        <ThreeScene />
      </ThreeCanvas>

      {/* grain + vignette overlays */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(8,9,12,0.5) 90%)",
          pointerEvents: "none",
        }}
      />

      {/* editorial overlays */}
      {isIntro && <Hero />}
      {currentChapter && <ChapterOverlay chapter={currentChapter} totalDurationInFrames={TOTAL_DURATION_IN_FRAMES} />}
      {isOutro && <Outro />}

      {/* audio */}
      <Narration />
      <Soundtrack />

      {/* chapter index chip — bottom left, persistent */}
      <ChapterIndex frame={frame} />
    </AbsoluteFill>
  );
};

const ChapterIndex: React.FC<{ frame: number }> = ({ frame }) => {
  const idx = chapters.findIndex((c) => frame >= c.startFrame && frame < c.endFrame);
  const current = idx >= 0 ? chapters[idx] : null;
  if (!current) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 48,
        left: 48,
        display: "flex",
        gap: 16,
        alignItems: "center",
        color: "#7a6cd1",
        fontFamily: "Geist Mono, ui-monospace, monospace",
        fontSize: 14,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
      }}
    >
      <div style={{ width: 22, height: 1, background: "#b39bff" }} />
      {current.ord} / 07 — {current.kind}
    </div>
  );
};
