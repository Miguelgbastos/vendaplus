export function DashboardChartsFallback() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Carregando gráficos"
    >
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
