import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { Chapter } from "../chapters";

/**
 * Editorial overlay for a single chapter.
 * Animates in with a staggered reveal — the Lottie-style
 * sequence of eyebrow → headline → feynman line → explain text → notes.
 */
export const ChapterOverlay: React.FC<{ chapter: Chapter; totalDurationInFrames: number }> = ({
  chapter,
  totalDurationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const localFrame = frame - chapter.startFrame;
  const chapterLength = chapter.endFrame - chapter.startFrame;

  // 0–1 progress through the chapter, eased
  const t = interpolate(localFrame, [0, chapterLength], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.2, 0.8, 0.2, 1),
  });

  // staggered reveals — each element enters with its own delay
  const enter = (delayInFrames: number, durInFrames = 18) => {
    return interpolate(localFrame, [delayInFrames, delayInFrames + durInFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  };

  // exit — last 12 frames fade out
  const exit = interpolate(
    localFrame,
    [chapterLength - 24, chapterLength],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) }
  );

  const ord = enter(0);
  const headline = enter(6);
  const feynman = enter(14);
  const explain = enter(24);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "8vh 6vw",
        display: "flex",
        alignItems: "flex-start",
        opacity: t,
        pointerEvents: "none",
        fontFamily: "Inter, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 820,
          opacity: exit,
          transform: `translateY(${(1 - t) * 16}px)`,
        }}
      >
        {/* ord */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 22,
            opacity: ord,
            transform: `translateY(${(1 - ord) * 14}px)`,
          }}
        >
          <div style={{ width: 28, height: 1, background: "#b39bff" }} />
          <div
            style={{
              color: "#7a6cd1",
              fontFamily: "Geist Mono, ui-monospace, monospace",
              fontSize: 13,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
            }}
          >
            {chapter.ord} · {chapter.kind}
          </div>
        </div>

        {/* headline */}
        <h2
          style={{
            fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
            fontWeight: 400,
            fontSize: 76,
            lineHeight: 1.02,
            letterSpacing: "-0.022em",
            color: "#f3f5f8",
            margin: 0,
            maxWidth: 820,
            opacity: headline,
            transform: `translateY(${(1 - headline) * 22}px)`,
          }}
        >
          {renderHeadline(chapter.headline)}
        </h2>

        {/* feynman line */}
        <p
          style={{
            fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
            fontSize: 26,
            lineHeight: 1.4,
            color: "#e7eaef",
            fontStyle: "italic",
            borderLeft: "3px solid #b39bff",
            paddingLeft: 22,
            margin: "26px 0 0",
            maxWidth: 720,
            opacity: feynman,
            transform: `translateY(${(1 - feynman) * 14}px)`,
          }}
        >
          {chapter.feynman}
        </p>

        {/* explain — only the first 2 lines, large enough to read on a 1080p frame */}
        <p
          style={{
            color: "#a9b3bf",
            fontSize: 19,
            lineHeight: 1.5,
            maxWidth: 720,
            margin: "22px 0 0",
            fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
            opacity: explain,
            transform: `translateY(${(1 - explain) * 14}px)`,
          }}
        >
          {shortExplain(chapter.explain)}
        </p>
      </div>
    </div>
  );
};

/** Highlight the italic accent in the headline with the purple color. */
function renderHeadline(h: string) {
  // split on the "em accent" — last noun phrase in italics
  // convention: "X. Y. Noun phrase." — italicize the last segment
  const match = h.match(/^(.+?)\.\s+([^.]+?)\.\s+([^.]+?)\.$/);
  if (!match) return h;
  return (
    <>
      {match[1]}. {match[2]}.{" "}
      <span style={{ color: "#b39bff", fontStyle: "italic" }}>{match[3]}.</span>
    </>
  );
}

/** First 1-2 sentences of the explanation for the on-screen caption. */
function shortExplain(text: string): string {
  const sentences = text.split(/(?<=\.)\s+/);
  return sentences.slice(0, 2).join(" ");
}
