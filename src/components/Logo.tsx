type Props = {
  size?: number;
  className?: string;
};

export function Logo({ size = 40, className }: Props) {
  return (
    <svg
      viewBox="0 0 400 400"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Color Graphics"
    >
      <circle
        cx="200"
        cy="200"
        r="160"
        fill="none"
        stroke="#E01B2B"
        strokeWidth="24"
      />
      <text
        x="200"
        y="235"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="900"
        fontSize="160"
        letterSpacing="-4"
        fill="#FFFFFF"
      >
        CG
      </text>
    </svg>
  );
}
