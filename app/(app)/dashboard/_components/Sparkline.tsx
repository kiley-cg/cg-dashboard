// Stateless inline-SVG sparkline. No charting deps — our datasets are tiny
// (one point per day per CSR over 30 days = 30 points max).

interface Props {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

export function Sparkline({
  points,
  width = 120,
  height = 32,
  stroke = "currentColor",
  fill = "none",
}: Props) {
  if (points.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="text-cg-n-300"
        width={width}
        height={height}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="overflow-visible"
    >
      <polyline
        points={coords.join(" ")}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* dot on the latest point so the current value is obvious */}
      <circle
        cx={(points.length - 1) * stepX}
        cy={height - ((points[points.length - 1] - min) / range) * height}
        r={2}
        fill={stroke}
      />
    </svg>
  );
}
