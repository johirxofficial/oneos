export default function Wallpaper({ variant }: { variant?: string }) {
  const cls =
    variant === "nebula"
      ? "wallpaper-nebula"
      : variant === "graphite"
        ? "wallpaper-graphite"
        : "wallpaper-aurora";

  return (
    <div className={`absolute inset-0 ${cls}`}>
      <div className="grid-overlay absolute inset-0 opacity-50" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,transparent,rgba(3,5,9,0.55)_80%)]" />
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-[color:var(--oneos-accent)]/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-oneos-accent2/10 blur-[120px]" />
    </div>
  );
}
