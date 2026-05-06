"use client";


export default function Avatar({
  initials,
  color,
  size = 28,
}: {
  initials: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-[var(--bg)] flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color }}
    >
      {initials}
    </div>
  );
}