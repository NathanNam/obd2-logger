import { useMemo } from "react";

type Props = {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
};

export function Sparkline({ values, width = 96, height = 28, color = "#5cc4ff" }: Props) {
  const path = useMemo(() => buildPath(values, width, height), [values, width, height]);
  if (values.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="rgba(255,255,255,0.06)"
        />
      </svg>
    );
  }
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

function buildPath(values: number[], w: number, h: number): string {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "";
  if (max === min) {
    const y = h / 2;
    return `M0 ${y} L${w} ${y}`;
  }
  const n = values.length;
  const xs = (i: number) => (i / (n - 1)) * w;
  const ys = (v: number) => h - ((v - min) / (max - min)) * (h - 2) - 1;
  let d = "";
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    d += (d ? " L" : "M") + xs(i).toFixed(1) + " " + ys(v).toFixed(1);
  }
  return d;
}
