import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const projectRefPattern = /^[a-z0-9]{20}$/;
export const tenantSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Argumento inesperado: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

export function requireProjectConfirmation(args) {
  const projectRef = args["project-ref"];
  if (typeof projectRef !== "string" || !projectRefPattern.test(projectRef)) {
    throw new Error("Informe --project-ref com os 20 caracteres do projeto Supabase.");
  }
  if (args["confirm-project"] !== projectRef) {
    throw new Error("Repita o project ref em --confirm-project antes de alterar o banco.");
  }
  return projectRef;
}

export function requireTenantSlug(args) {
  const tenantSlug = args["tenant-slug"];
  if (typeof tenantSlug !== "string" || !tenantSlugPattern.test(tenantSlug)) {
    throw new Error("Informe --tenant-slug usando letras minúsculas, números e hífens.");
  }
  return tenantSlug;
}

export function runSupabase(args) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["supabase", ...args], {
    cwd: resolve(process.cwd()),
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Supabase CLI falhou: ${args.join(" ")}`);
}

export function runSqlTemplate(relativePath, replacements) {
  let sql = readFileSync(resolve(relativePath), "utf8");
  for (const [placeholder, value] of Object.entries(replacements)) {
    sql = sql.replaceAll(placeholder, value);
  }
  if (/__[A-Z0-9_]+__/.test(sql)) {
    throw new Error(`Placeholder não substituído em ${relativePath}.`);
  }

  const directory = mkdtempSync(join(tmpdir(), "vendaplus-sql-"));
  const sqlPath = join(directory, "command.sql");
  try {
    writeFileSync(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
    runSupabase(["db", "query", "--linked", "--file", sqlPath]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
