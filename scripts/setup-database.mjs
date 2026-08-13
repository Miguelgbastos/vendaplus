#!/usr/bin/env node

import {
  parseArgs,
  requireProjectConfirmation,
  requireTenantSlug,
  runSqlTemplate,
  runSupabase,
} from "./supabase-cli.mjs";

const usage = `
Uso:
  npm run setup:database -- --project-ref REF --confirm-project REF

Com dados demonstrativos (somente empresa sem integrações ativas):
  npm run setup:database -- --project-ref REF --confirm-project REF \\
    --with-demo --tenant-slug empresa-demonstracao \\
    --confirm-demo VENDA_PLUS_DEMO
`;

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage.trim());
    process.exit(0);
  }

  const projectRef = requireProjectConfirmation(args);
  console.log(`\nVenda+ → projeto Supabase confirmado: ${projectRef}`);
  runSupabase(["link", "--project-ref", projectRef]);

  console.log("\n1/5 Prévia das migrations pendentes");
  runSupabase(["db", "push", "--linked", "--dry-run", "--skip-vault"]);

  console.log("\n2/5 Aplicação incremental das migrations");
  runSupabase(["db", "push", "--linked", "--skip-vault"]);

  console.log("\n3/5 Reconciliação do histórico local/remoto");
  runSupabase(["migration", "list", "--linked"]);

  console.log("\n4/5 Validação estrutural e lint do banco");
  runSupabase(["db", "query", "--linked", "--file", "supabase/validate.sql"]);
  runSupabase([
    "db", "lint", "--linked", "--schema", "public", "--level", "warning", "--fail-on", "error",
  ]);

  console.log("\n5/5 Dados demonstrativos");
  if (args["with-demo"]) {
    if (args["confirm-demo"] !== "VENDA_PLUS_DEMO") {
      throw new Error("Para inserir dados fictícios, use --confirm-demo VENDA_PLUS_DEMO.");
    }
    const tenantSlug = requireTenantSlug(args);
    runSqlTemplate("supabase/seeds/demo.sql", { __DEMO_TENANT_SLUG__: tenantSlug });
    console.log(`Dados demonstrativos aplicados à empresa '${tenantSlug}'.`);
  } else {
    console.log("Ignorados. Use --with-demo somente em uma empresa dedicada à demonstração.");
  }

  console.log("\nBanco do Venda+ aplicado e validado com sucesso.");
} catch (error) {
  console.error(`\nFalha: ${error instanceof Error ? error.message : String(error)}`);
  console.error(usage.trim());
  process.exit(1);
}
