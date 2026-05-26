import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import React from "react";

const Title: React.FC<{ text: string; delay?: number }> = ({ text, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame: frame - delay, fps, config: { damping: 100 } });
  const translateY = interpolate(opacity, [0, 1], [50, 0]);

  return (
    <h1
      style={{
        fontFamily: "Inter, sans-serif",
        fontSize: "80px",
        textAlign: "center",
        color: "#333",
        opacity,
        transform: `translateY(${translateY}px)`,
        margin: "20px 0",
      }}
    >
      {text}
    </h1>
  );
};

const EmojiDisplay: React.FC<{ emojis: string; delay?: number }> = ({ emojis, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame: frame - delay, fps, config: { tension: 120, friction: 14 } });

  return (
    <div
      style={{
        fontSize: "150px",
        textAlign: "center",
        transform: `scale(${scale})`,
        margin: "40px 0",
      }}
    >
      {emojis}
    </div>
  );
};

const Scene: React.FC<{
  bgColor: string;
  title1: string;
  title2: string;
  emojis: string;
}> = ({ bgColor, title1, title2, emojis }) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: bgColor,
        justifyContent: "center",
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        padding: "100px",
      }}
    >
      <EmojiDisplay emojis={emojis} delay={10} />
      <Title text={title1} delay={30} />
      <Title text={title2} delay={70} />
    </AbsoluteFill>
  );
};

export const AbaYaExplainer: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={150}>
        <Scene
          bgColor="#FFF5F5"
          title1="Making beautiful Abayas takes time."
          title2="But tracking them? A nightmare."
          emojis="📄 😩 ⏳"
        />
      </Sequence>
      
      <Sequence from={150} durationInFrames={150}>
        <Scene
          bgColor="#EBF8FF"
          title1="Enter AbaYa Track."
          title2="The simplest way to track your factory floor."
          emojis="✨ 📱 ✨"
        />
      </Sequence>

      <Sequence from={300} durationInFrames={150}>
        <Scene
          bgColor="#F0FFF4"
          title1="Scan the item. Scan the employee."
          title2="Start working. It's that simple."
          emojis="👗 📷 🪪 ✅"
        />
      </Sequence>

      <Sequence from={450} durationInFrames={150}>
        <Scene
          bgColor="#FFFAF0"
          title1="Instantly synced to the cloud."
          title2="The CEO sees real-time progress from Dubai."
          emojis="☁️ 📡 🏢 ☕"
        />
      </Sequence>

      <Sequence from={600} durationInFrames={150}>
        <AbsoluteFill
          style={{
            backgroundColor: "#1A202C",
            justifyContent: "center",
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            padding: "100px",
            color: "white",
          }}
        >
          <div style={{ fontSize: "150px", margin: "40px 0" }}>🌍 🚀</div>
          <h1 style={{ fontFamily: "Inter, sans-serif", fontSize: "100px", margin: "20px 0" }}>
            AbaYa Track
          </h1>
          <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "60px", fontWeight: "normal", color: "#A0AEC0" }}>
            Scale your production globally.
          </h2>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
