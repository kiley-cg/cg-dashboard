type Props = {
  size?: number;
  className?: string;
};

export function Logo({ size = 40, className }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo.svg"
      width={size}
      height={size}
      alt="Color Graphics"
      className={className}
    />
  );
}
