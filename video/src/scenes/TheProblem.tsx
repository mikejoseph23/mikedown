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

export const TheProblem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Total: 210 frames (7 seconds)

  // Phase 1 (frames 0-89): Show the split pane problem
  // Phase 2 (frames 90-149): Cross out the split, transition
  // Phase 3 (frames 150-209): "What if you could just... edit?"

  // --- Phase 1: Split pane ---
  const splitPaneOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const sourceSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const sourceX = interpolate(sourceSpring, [0, 1], [-200, 0]);

  const previewSpring = spring({
    frame: frame - 10,
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const previewX = interpolate(previewSpring, [0, 1], [200, 0]);

  // --- Phase 2: Strike-through and fade ---
  const strikeProgress = interpolate(frame, [90, 120], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const splitFadeOut = interpolate(frame, [120, 150], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Phase 3: The question ---
  const questionFade = interpolate(frame, [150, 170], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const questionScale = interpolate(frame, [150, 170], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "edit?" word highlight
  const editHighlight = interpolate(frame, [180, 200], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
      {/* Split pane illustration */}
      <div
        style={{
          opacity: splitPaneOpacity * splitFadeOut,
          display: "flex",
          alignItems: "center",
          gap: 40,
          position: "relative",
        }}
      >
        {/* Source pane */}
        <div
          style={{
            transform: `translateX(${sourceX}px)`,
            width: 500,
            height: 340,
            backgroundColor: "#161622",
            borderRadius: 12,
            border: "1px solid #2a2a3a",
            padding: 32,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#888",
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            Source
          </div>
          {/* Fake markdown source lines */}
          {["# Heading", "", "Some **bold** text", "", "- List item one", "- List item two"].map(
            (line, i) => (
              <div
                key={i}
                style={{
                  fontSize: 16,
                  color: "#666",
                  fontFamily: "monospace",
                  height: line ? "auto" : 8,
                }}
              >
                {line}
              </div>
            )
          )}
        </div>

        {/* Divider with pipe */}
        <div
          style={{
            fontSize: 64,
            color: "#333",
            fontWeight: 200,
          }}
        >
          |
        </div>

        {/* Preview pane */}
        <div
          style={{
            transform: `translateX(${previewX}px)`,
            width: 500,
            height: 340,
            backgroundColor: "#161622",
            borderRadius: 12,
            border: "1px solid #2a2a3a",
            padding: 32,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#888",
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            Preview
          </div>
          {/* Rendered preview */}
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ccc" }}>
            Heading
          </div>
          <div style={{ fontSize: 16, color: "#999", marginTop: 4 }}>
            Some <span style={{ fontWeight: 700 }}>bold</span> text
          </div>
          <div style={{ fontSize: 16, color: "#999", marginTop: 8, paddingLeft: 16 }}>
            {"\u2022"} List item one
          </div>
          <div style={{ fontSize: 16, color: "#999", paddingLeft: 16 }}>
            {"\u2022"} List item two
          </div>
        </div>

        {/* Strike-through line */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "5%",
            width: `${strikeProgress * 90}%`,
            height: 4,
            backgroundColor: "#e05050",
            transform: "translateY(-50%) rotate(-2deg)",
            borderRadius: 2,
          }}
        />
      </div>

      {/* The question */}
      <div
        style={{
          position: "absolute",
          opacity: questionFade,
          transform: `scale(${questionScale})`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 56,
            fontWeight: 300,
            color: "#ffffff",
            lineHeight: 1.4,
          }}
        >
          What if you could just...{" "}
          <span
            style={{
              fontWeight: 700,
              color: interpolate(editHighlight, [0, 1], [0, 1])
                ? ACCENT
                : "#fff",
              textShadow:
                editHighlight > 0.5
                  ? `0 0 30px rgba(78, 157, 224, ${editHighlight * 0.6})`
                  : "none",
            }}
          >
            edit?
          </span>
        </div>
      </div>

      {/* Hero screenshot reveal */}
      {frame >= 185 && (
        <div
          style={{
            position: "absolute",
            bottom: 40,
            left: "50%",
            transform: `translateX(-50%) scale(${interpolate(
              spring({ frame: frame - 185, fps, config: { damping: 14, stiffness: 60 } }),
              [0, 1],
              [0.8, 1]
            )})`,
            opacity: interpolate(frame, [185, 200], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            width: 900,
          }}
        >
          <Img
            src={staticFile("dark-mode-editor.jpg")}
            style={{
              width: "100%",
              borderRadius: 12,
              boxShadow: `0 8px 60px rgba(78, 157, 224, 0.3)`,
            }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
};
