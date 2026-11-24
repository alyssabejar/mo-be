const pesoFmt = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Centavos as pesos, e.g. 125050 → "₱1,250.50". */
export function peso(centavos: number | undefined | null): string {
  if (centavos == null) return "—";
  return pesoFmt.format(centavos / 100);
}

/** Fill {{placeholders}} in a template. */
export function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
}
