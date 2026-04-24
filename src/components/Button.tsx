import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "dark" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center font-semibold rounded-btn transition " +
  "disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-red focus-visible:ring-offset-2";

const variants: Record<Variant, string> = {
  primary:
    "bg-cg-red text-white hover:bg-cg-red-600 disabled:bg-cg-red-200 disabled:text-white",
  dark: "bg-cg-black text-white hover:bg-cg-n-800 disabled:bg-cg-n-400",
  secondary:
    "bg-white text-cg-n-900 border border-cg-n-200 hover:bg-cg-n-50 disabled:text-cg-n-400",
  ghost: "text-cg-n-700 hover:text-cg-n-900 disabled:text-cg-n-400",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3 py-1.5",
  md: "text-sm px-4 py-2",
  lg: "text-base px-5 py-2.5",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
});
