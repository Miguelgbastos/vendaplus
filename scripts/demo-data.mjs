#!/usr/bin/env node

import {
  parseArgs,
  requireProjectConfirmation,
  requireTenantSlug,
  runSqlTemplate,
  runSupabase,
} from "./supabase-cli.mjs";

const action = process.argv[2];
const usage = `
Uso:
  npm run demo:seed -- --project-ref REF --confirm-project REF \\
    --tenant-slug empresa-demonstracao --confirm-demo VENDA_PLUS_DEMO

  npm run demo:clear -- --project-ref REF --confirm-project REF \\
    --tenant-slug empresa-demonstracao --confirm-demo VENDA_PLUS_DEMO
`;

try {
  if (!["seed", "clear"].includes(action)) throw new Error("Ação inválida.");
  const args = parseArgs(process.argv.slice(3));
  if (args.help) {
    console.log(usage.trim());
    process.exit(0);
  }

  const projectRef = requireProjectConfirmation(args);
  const tenantSlug = requireTenantSlug(args);
  if (args["confirm-demo"] !== "VENDA_PLUS_DEMO") {
    throw new Error("Confirme com --confirm-demo VENDA_PLUS_DEMO.");
  }

  console.log(`Venda+ → projeto ${projectRef}; empresa '${tenantSlug}'; ação '${action}'.`);
  runSupabase(["link", "--project-ref", projectRef]);
  runSqlTemplate(
    action === "seed" ? "supabase/seeds/demo.sql" : "supabase/seeds/clear-demo.sql",
    { __DEMO_TENANT_SLUG__: tenantSlug },
  );
  console.log(action === "seed" ? "Dados demonstrativos aplicados." : "Dados demonstrativos removidos.");
} catch (error) {
  console.error(`\nFalha: ${error instanceof Error ? error.message : String(error)}`);
  console.error(usage.trim());
  process.exit(1);
}
