export default function AppLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <div className="h-8 w-52 rounded-lg bg-muted" />
        <div className="h-4 w-80 max-w-full rounded bg-muted" />
      </div>
      <div className="h-24 rounded-xl border border-border/80 bg-muted/40" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 rounded-xl border border-border/80 bg-muted/40"
          />
        ))}
      </div>
      <div className="h-80 rounded-xl border border-border/80 bg-muted/40" />
    </div>
  );
}
