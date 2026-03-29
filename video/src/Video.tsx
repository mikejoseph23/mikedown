import { AbsoluteFill, Sequence } from "remotion";
import { TitleCard } from "./scenes/TitleCard";
import { TheProblem } from "./scenes/TheProblem";
import { FeatureHighlights } from "./scenes/FeatureHighlights";
import { UniqueFeatures } from "./scenes/UniqueFeatures";
import { CallToAction } from "./scenes/CallToAction";

// 30 seconds at 30fps = 900 frames
// Scene 1: 0-5s   (frames 0-149)    — Title card
// Scene 2: 5-12s  (frames 150-359)  — The Problem
// Scene 3: 12-22s (frames 360-659)  — Feature highlights
// Scene 4: 22-27s (frames 660-809)  — Unique features
// Scene 5: 27-30s (frames 810-899)  — CTA

export const MikeDownPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <Sequence from={0} durationInFrames={150}>
        <TitleCard />
      </Sequence>

      <Sequence from={150} durationInFrames={210}>
        <TheProblem />
      </Sequence>

      <Sequence from={360} durationInFrames={300}>
        <FeatureHighlights />
      </Sequence>

      <Sequence from={660} durationInFrames={150}>
        <UniqueFeatures />
      </Sequence>

      <Sequence from={810} durationInFrames={90}>
        <CallToAction />
      </Sequence>
    </AbsoluteFill>
  );
};
