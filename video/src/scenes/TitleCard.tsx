import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  spring,
  useVideoConfig,
} from "remotion";

const ACCENT = "#4e9de0";

const MikeDownIcon: React.FC<{ size: number }> = ({ size }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Document shape */}
      <rect
        x="24"
        y="12"
        width="80"
        height="104"
        rx="8"
        fill="#1a1a2e"
        stroke={ACCENT}
        strokeWidth="3"
      />
      {/* Markdown M symbol */}
      <path
        d="M40 80V48l12 16 12-16v32"
        stroke={ACCENT}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Down arrow */}
      <path
        d="M80 52v24m0 0l-8-8m8 8l8-8"
        stroke={ACCENT}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Decorative lines */}
      <line x1="36" y1="92" x2="92" y2="92" stroke="#333" strokeWidth="2" />
      <line x1="36" y1="100" x2="72" y2="100" stroke="#333" strokeWidth="2" />
    </svg>
  );
};

export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Icon drops in from above
  const iconSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const iconY = interpolate(iconSpring, [0, 1], [-120, 0]);
  const iconOpacity = interpolate(iconSpring, [0, 1], [0, 1]);

  // Title fades in after icon
  const titleSpring = spring({
    frame: frame - 15,
    fps,
    config: { damping: 14, stiffness: 60 },
  });
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);
  const titleY = interpolate(titleSpring, [0, 1], [30, 0]);

  // Tagline fades in after title
  const taglineSpring = spring({
    frame: frame - 35,
    fps,
    config: { damping: 14, stiffness: 60 },
  });
  const taglineOpacity = interpolate(taglineSpring, [0, 1], [0, 1]);
  const taglineY = interpolate(taglineSpring, [0, 1], [20, 0]);

  // Subtle glow pulse on the icon
  const glowIntensity = interpolate(
    Math.sin(frame * 0.05),
    [-1, 1],
    [0.3, 0.6]
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
      {/* Subtle radial gradient background */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `radial-gradient(ellipse at center, rgba(78, 157, 224, 0.08) 0%, transparent 70%)`,
        }}
      />

      {/* Icon */}
      <div
        style={{
          transform: `translateY(${iconY}px)`,
          opacity: iconOpacity,
          filter: `drop-shadow(0 0 ${glowIntensity * 40}px rgba(78, 157, 224, ${glowIntensity}))`,
          marginBottom: 40,
        }}
      >
        <MikeDownIcon size={160} />
      </div>

      {/* Title */}
      <div
        style={{
          transform: `translateY(${titleY}px)`,
          opacity: titleOpacity,
          fontSize: 96,
          fontWeight: 700,
          color: "#ffffff",
          letterSpacing: "-2px",
          marginBottom: 16,
        }}
      >
        MikeDown Editor
      </div>

      {/* Tagline */}
      <div
        style={{
          transform: `translateY(${taglineY}px)`,
          opacity: taglineOpacity,
          fontSize: 36,
          fontWeight: 400,
          color: ACCENT,
          letterSpacing: "1px",
        }}
      >
        WYSIWYG Markdown for VS Code
      </div>
    </AbsoluteFill>
  );
};
