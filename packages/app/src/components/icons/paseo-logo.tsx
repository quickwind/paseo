import Svg, { Circle, Path } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";
import {
  WUKONG_LOGO_EYES,
  WUKONG_LOGO_STROKE_PATHS,
  WUKONG_LOGO_STROKE_WIDTH,
  WUKONG_LOGO_VIEWBOX,
} from "./wukong-logo-geometry";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

// Internal edition: draws the Wukong mark. The component keeps its upstream name so
// call sites stay untouched across upstream merges.
export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  const { theme } = useUnistyles();
  const stroke = color ?? theme.colors.foreground;

  return (
    <Svg width={size} height={size} viewBox={WUKONG_LOGO_VIEWBOX} fill="none">
      {WUKONG_LOGO_STROKE_PATHS.map((d) => (
        <Path
          key={d}
          d={d}
          stroke={stroke}
          strokeWidth={WUKONG_LOGO_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {WUKONG_LOGO_EYES.map((eye) => (
        <Circle key={`${eye.cx}-${eye.cy}`} cx={eye.cx} cy={eye.cy} r={eye.r} fill={stroke} />
      ))}
    </Svg>
  );
}
