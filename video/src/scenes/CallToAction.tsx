import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  spring,
  useVideoConfig,
} from "remotion";

const ACCENT = "#4e9de0";

export const CallToAction: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Total: 90 frames (3 seconds)

  // Main CTA spring
  const ctaSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 60 },
  });
  const ctaOpacity = interpolate(ctaSpring, [0, 1], [0, 1]);
  const ctaScale = interpolate(ctaSpring, [0, 1], [0.9, 1]);

  // Extension name and URL fade in
  const detailsSpring = spring({
    frame: frame - 20,
    fps,
    config: { damping: 14, stiffness: 60 },
  });
  const detailsOpacity = interpolate(detailsSpring, [0, 1], [0, 1]);
  const detailsY = interpolate(detailsSpring, [0, 1], [20, 0]);

  // Button pulse
  const pulseIntensity = interpolate(
    Math.sin((frame - 30) * 0.08),
    [-1, 1],
    [0.15, 0.35]
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `radial-gradient(ellipse at center, rgba(78, 157, 224, 0.1) 0%, transparent 60%)`,
        }}
      />

      {/* CTA text */}
      <div
        style={{
          opacity: ctaOpacity,
          transform: `scale(${ctaScale})`,
          textAlign: "center",
        }}
      >
        {/* Button-like CTA */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            padding: "24px 56px",
            backgroundColor: ACCENT,
            borderRadius: 16,
            boxShadow: `0 0 ${pulseIntensity * 80}px rgba(78, 157, 224, ${pulseIntensity})`,
            marginBottom: 48,
          }}
        >
          {/* VS Code icon */}
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path
              d="M27 3L12 15.75 5.25 10.5 3 11.7V24.3l2.25 1.2L12 20.25 27 33l6-3V6l-6-3zM5.25 22.5v-9L9 18l-3.75 4.5zM12 18l15-11.25v22.5L12 18z"
              fill="white"
            />
          </svg>
          <span
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: "#ffffff",
            }}
          >
            Install from VS Code Marketplace
          </span>
        </div>
      </div>

      {/* Details */}
      <div
        style={{
          opacity: detailsOpacity,
          transform: `translateY(${detailsY}px)`,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: "#ffffff",
          }}
        >
          mikedown-editor
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 400,
            color: "#888",
          }}
        >
          github.com/mikejoseph23/mikedown
        </div>
      </div>
    </AbsoluteFill>
  );
};
