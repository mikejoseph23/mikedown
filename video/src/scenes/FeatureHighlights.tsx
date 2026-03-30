import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  spring,
  useVideoConfig,
} from "remotion";

const ACCENT = "#4e9de0";

const features = [
  { title: "Smart Paste", desc: "URLs auto-link, images embed, tables convert", screenshot: "dark-mode-editor.jpg" },
  { title: "Link Intelligence", desc: "Autocomplete, validation, and broken link detection", screenshot: "context-menu.jpg" },
  { title: "Document Outline", desc: "Navigate heading hierarchy with click-to-jump", screenshot: "dropdown-menu.jpg" },
  { title: "Font Themes", desc: "Curated serif + sans pairings with live preview", screenshot: "light-mode-editor.jpg" },
  { title: "Backlink Explorer", desc: "See every file that references the current document", screenshot: "split-view-mark-down.jpg" },
  { title: "Source Mode", desc: "Drop into raw markdown when you need full control", screenshot: "source-mode.jpg" },
];

// Each feature gets 50 frames = ~1.67 seconds
const FRAMES_PER_FEATURE = 50;

interface FeatureCardProps {
  title: string;
  desc: string;
  screenshot: string;
  localFrame: number;
  fps: number;
  index: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({
  title,
  desc,
  screenshot,
  localFrame,
  fps,
  index,
}) => {
  // Slide in from the right
  const enterSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 80 },
  });
  const enterX = interpolate(enterSpring, [0, 1], [400, 0]);
  const enterOpacity = interpolate(enterSpring, [0, 1], [0, 1]);

  // Slide out to the left
  const exitFrame = localFrame - (FRAMES_PER_FEATURE - 12);
  const exitProgress = interpolate(exitFrame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitX = interpolate(exitProgress, [0, 1], [0, -400]);
  const exitOpacity = interpolate(exitProgress, [0, 1], [1, 0]);

  const x = enterX + exitX;
  const opacity = enterOpacity * exitOpacity;

  // Accent bar width animation
  const barWidth = interpolate(enterSpring, [0, 1], [0, 6]);

  // Number indicator
  const numberStr = String(index + 1).padStart(2, "0");

  // Screenshot slide-in (slightly delayed)
  const imgSpring = spring({
    frame: localFrame - 5,
    fps,
    config: { damping: 14, stiffness: 60 },
  });
  const imgScale = interpolate(imgSpring, [0, 1], [0.85, 1]);
  const imgOpacity = interpolate(imgSpring, [0, 1], [0, 1]);

  return (
    <div
      style={{
        position: "absolute",
        transform: `translateX(${x}px)`,
        opacity,
        display: "flex",
        alignItems: "center",
        gap: 48,
        width: "100%",
      }}
    >
      {/* Left: text */}
      <div style={{ flex: "0 0 500px" }}>
        {/* Accent bar */}
        <div
          style={{
            width: barWidth,
            height: 4,
            backgroundColor: ACCENT,
            borderRadius: 2,
            marginBottom: 16,
          }}
        />

        {/* Feature number */}
        <div
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: ACCENT,
            marginBottom: 8,
            letterSpacing: 3,
            fontFamily: "monospace",
          }}
        >
          {numberStr}
        </div>

        {/* Feature title */}
        <div
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: "#ffffff",
            marginBottom: 12,
            letterSpacing: "-1px",
          }}
        >
          {title}
        </div>

        {/* Feature description */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 400,
            color: "#999",
          }}
        >
          {desc}
        </div>
      </div>

      {/* Right: screenshot */}
      <div
        style={{
          flex: 1,
          opacity: imgOpacity * exitOpacity,
          transform: `scale(${imgScale})`,
        }}
      >
        <Img
          src={staticFile(screenshot)}
          style={{
            width: "100%",
            borderRadius: 12,
            boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
          }}
        />
      </div>
    </div>
  );
};

export const FeatureHighlights: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Section header
  const headerOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0a0a",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Background decorative grid */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `
            linear-gradient(rgba(78, 157, 224, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(78, 157, 224, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Section label */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 140,
          opacity: headerOpacity,
          fontSize: 18,
          fontWeight: 600,
          color: ACCENT,
          textTransform: "uppercase",
          letterSpacing: 4,
        }}
      >
        Core Features
      </div>

      {/* Feature cards container */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 140,
          right: 140,
          bottom: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        {features.map((feature, index) => {
          const featureStart = index * FRAMES_PER_FEATURE;
          const localFrame = frame - featureStart;

          // Only render if this feature should be visible
          if (localFrame < -10 || localFrame > FRAMES_PER_FEATURE + 10) {
            return null;
          }

          return (
            <FeatureCard
              key={feature.title}
              title={feature.title}
              desc={feature.desc}
              screenshot={feature.screenshot}
              localFrame={Math.max(0, localFrame)}
              fps={fps}
              index={index}
            />
          );
        })}
      </div>

      {/* Progress dots */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 16,
        }}
      >
        {features.map((_, index) => {
          const featureStart = index * FRAMES_PER_FEATURE;
          const isActive =
            frame >= featureStart &&
            frame < featureStart + FRAMES_PER_FEATURE;
          const isPast = frame >= featureStart + FRAMES_PER_FEATURE;

          return (
            <div
              key={index}
              style={{
                width: isActive ? 32 : 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: isActive
                  ? ACCENT
                  : isPast
                    ? "rgba(78, 157, 224, 0.4)"
                    : "#333",
                transition: "all 0.3s",
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
