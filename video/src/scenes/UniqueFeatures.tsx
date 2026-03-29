import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  spring,
  useVideoConfig,
} from "remotion";

const ACCENT = "#4e9de0";

const uniqueFeatures = [
  {
    title: "Broken Link Detection",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path
          d="M20 28l-4 4a5.66 5.66 0 01-8-8l4-4"
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M28 20l4-4a5.66 5.66 0 018 8l-4 4"
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="14"
          y1="34"
          x2="34"
          y2="14"
          stroke="#e05050"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="4 4"
        />
      </svg>
    ),
  },
  {
    title: "Link Autocomplete",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect
          x="8"
          y="14"
          width="32"
          height="8"
          rx="4"
          stroke={ACCENT}
          strokeWidth="3"
        />
        <rect
          x="8"
          y="26"
          width="24"
          height="6"
          rx="3"
          fill="rgba(78, 157, 224, 0.2)"
          stroke={ACCENT}
          strokeWidth="2"
        />
        <rect
          x="8"
          y="34"
          width="20"
          height="6"
          rx="3"
          fill="rgba(78, 157, 224, 0.1)"
          stroke="rgba(78, 157, 224, 0.4)"
          strokeWidth="2"
        />
      </svg>
    ),
  },
  {
    title: "Backlink Panel",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect
          x="6"
          y="6"
          width="16"
          height="20"
          rx="3"
          stroke={ACCENT}
          strokeWidth="2.5"
        />
        <rect
          x="26"
          y="10"
          width="16"
          height="12"
          rx="3"
          stroke={ACCENT}
          strokeWidth="2.5"
        />
        <rect
          x="26"
          y="28"
          width="16"
          height="12"
          rx="3"
          stroke={ACCENT}
          strokeWidth="2.5"
        />
        <path
          d="M22 16h4M22 20l4 14"
          stroke={ACCENT}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "In-editor Find/Replace",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle
          cx="20"
          cy="20"
          r="10"
          stroke={ACCENT}
          strokeWidth="3"
        />
        <line
          x1="28"
          y1="28"
          x2="38"
          y2="38"
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M16 20h8M20 16v8"
          stroke={ACCENT}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export const UniqueFeatures: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Total: 150 frames (5 seconds)

  // Header animation
  const headerSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 60 },
  });
  const headerOpacity = interpolate(headerSpring, [0, 1], [0, 1]);
  const headerY = interpolate(headerSpring, [0, 1], [-30, 0]);

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
      {/* Subtle gradient accent */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            "radial-gradient(ellipse at 50% 120%, rgba(78, 157, 224, 0.06) 0%, transparent 60%)",
        }}
      />

      {/* Header */}
      <div
        style={{
          opacity: headerOpacity,
          transform: `translateY(${headerY}px)`,
          fontSize: 52,
          fontWeight: 700,
          color: "#ffffff",
          marginBottom: 64,
          textAlign: "center",
          letterSpacing: "-1px",
        }}
      >
        Features{" "}
        <span style={{ color: ACCENT }}>no one else</span>{" "}
        has
      </div>

      {/* Feature grid */}
      <div
        style={{
          display: "flex",
          gap: 40,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 1400,
        }}
      >
        {uniqueFeatures.map((feature, index) => {
          const delay = 15 + index * 12;
          const cardSpring = spring({
            frame: frame - delay,
            fps,
            config: { damping: 12, stiffness: 70 },
          });
          const cardOpacity = interpolate(cardSpring, [0, 1], [0, 1]);
          const cardY = interpolate(cardSpring, [0, 1], [40, 0]);
          const cardScale = interpolate(cardSpring, [0, 1], [0.95, 1]);

          return (
            <div
              key={feature.title}
              style={{
                opacity: cardOpacity,
                transform: `translateY(${cardY}px) scale(${cardScale})`,
                width: 280,
                padding: 32,
                backgroundColor: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(78, 157, 224, 0.15)",
                borderRadius: 16,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                gap: 20,
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 16,
                  backgroundColor: "rgba(78, 157, 224, 0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {feature.icon}
              </div>

              {/* Title */}
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: "#ffffff",
                }}
              >
                {feature.title}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
