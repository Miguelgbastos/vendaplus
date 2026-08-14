import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildLossPopulation,
  buildOwnerConversion,
  buildStagnantPriorityTable,
  categorizePreviousStage,
  dedupeLastLossesByLead,
  isRecoveredLoss,
  limitLossMatrixReasons,
  normalizeCloseCycleStats,
  previousStageBars,
} from "./commercial-loss-intelligence.ts";

describe("categorizePreviousStage / Sem histórico", () => {
  it("só aceita sql, oportunidade e negociacao; resto vira Sem histórico", () => {
    assert.equal(categorizePreviousStage("sql"), "sql");
    assert.equal(categorizePreviousStage("oportunidade"), "oportunidade");
    assert.equal(categorizePreviousStage("negociacao"), "negociacao");
    assert.equal(categorizePreviousStage(null), "sem_historico");
    assert.equal(categorizePreviousStage(undefined), "sem_historico");
    assert.equal(categorizePreviousStage("mql"), "sem_historico");
    assert.equal(categorizePreviousStage("sal"), "sem_historico");
    assert.equal(categorizePreviousStage("venda"), "sem_historico");
  });
});

describe("dedupeLastLossesByLead", () => {
  it("mantém só a última perda por lead e classifica Sem histórico quando falta from", () => {
    const rows = dedupeLastLossesByLead([
      {
        leadId: "a",
        changedAt: "2026-08-01T10:00:00.000Z",
        fromQualification: "sql",
      },
      {
        leadId: "a",
        changedAt: "2026-08-10T10:00:00.000Z",
        fromQualification: "negociacao",
      },
      {
        leadId: "b",
        changedAt: "2026-08-05T10:00:00.000Z",
        fromQualification: null,
      },
    ]);

    assert.equal(rows.length, 2);
    const byLead = Object.fromEntries(rows.map((row) => [row.leadId, row]));
    assert.equal(byLead.a.fromQualification, "negociacao");
    assert.equal(byLead.a.previousStage, "negociacao");
    assert.equal(byLead.b.previousStage, "sem_historico");
  });
});

describe("buildLossPopulation (histórico autoritativo + fallback)", () => {
  const periodFrom = "2026-08-01T03:00:00.000Z";
  const periodTo = "2026-08-15T03:00:00.000Z";

  it("inclui perda seguida de recuperação/venda no mesmo período", () => {
    const population = buildLossPopulation({
      periodFrom,
      periodTo,
      historyEvents: [
        {
          leadId: "recovered",
          toQualification: "perda",
          fromQualification: "negociacao",
          changedAt: "2026-08-05T12:00:00.000Z",
        },
        {
          leadId: "recovered",
          toQualification: "sql",
          fromQualification: "perda",
          changedAt: "2026-08-08T12:00:00.000Z",
        },
        {
          leadId: "recovered",
          toQualification: "venda",
          fromQualification: "negociacao",
          changedAt: "2026-08-12T12:00:00.000Z",
        },
      ],
      leads: [
        {
          leadId: "recovered",
          qualification: "venda",
          closedAt: "2026-08-12T12:00:00.000Z",
        },
      ],
    });

    assert.equal(population.length, 1);
    assert.equal(population[0].leadId, "recovered");
    assert.equal(population[0].currentQualification, "venda");
    assert.equal(population[0].hasHistory, true);
    assert.equal(population[0].previousStage, "negociacao");
  });

  it("não exige qualification atual=perda e classifica fallback sem histórico", () => {
    const population = buildLossPopulation({
      periodFrom,
      periodTo,
      historyEvents: [],
      leads: [
        {
          leadId: "orphan",
          qualification: "perda",
          closedAt: "2026-08-10T12:00:00.000Z",
        },
        {
          leadId: "still-open",
          qualification: "sql",
          closedAt: null,
        },
      ],
    });

    assert.equal(population.length, 1);
    assert.equal(population[0].leadId, "orphan");
    assert.equal(population[0].hasHistory, false);
    assert.equal(population[0].previousStage, "sem_historico");
  });

  it("dedupe pela última perda no período e barras/matriz compartilham a mesma população", () => {
    const population = buildLossPopulation({
      periodFrom,
      periodTo,
      historyEvents: [
        {
          leadId: "a",
          toQualification: "perda",
          fromQualification: "sql",
          changedAt: "2026-08-02T12:00:00.000Z",
        },
        {
          leadId: "a",
          toQualification: "perda",
          fromQualification: "oportunidade",
          changedAt: "2026-08-11T12:00:00.000Z",
        },
        {
          leadId: "b",
          toQualification: "perda",
          fromQualification: "negociacao",
          changedAt: "2026-08-09T12:00:00.000Z",
        },
      ],
      leads: [
        { leadId: "a", qualification: "sql", closedAt: null },
        { leadId: "b", qualification: "perda", closedAt: "2026-08-09T12:00:00.000Z" },
      ],
    });

    assert.equal(population.length, 2);
    const byLead = Object.fromEntries(population.map((row) => [row.leadId, row]));
    assert.equal(byLead.a.previousStage, "oportunidade");
    assert.equal(byLead.b.previousStage, "negociacao");

    const bars = previousStageBars(
      population.map((row) => ({ previous_stage: row.previousStage, total: 1 })),
    );
    const matrix = limitLossMatrixReasons(
      population.map((row) => ({
        previous_stage: row.previousStage,
        reason: "Preço",
        total: 1,
      })),
    );
    const barTotal = bars.reduce((sum, row) => sum + row.value, 0);
    const matrixTotal = matrix.cells.reduce((sum, cell) => sum + cell.total, 0);
    assert.equal(barTotal, population.length);
    assert.equal(matrixTotal, population.length);
  });
});

describe("previousStageBars", () => {
  it("calcula volume e percentual incluindo Sem histórico", () => {
    const bars = previousStageBars([
      { previous_stage: "sql", total: 2 },
      { previous_stage: "oportunidade", total: 1 },
      { previous_stage: "sem_historico", total: 1 },
    ]);
    assert.equal(bars.find((b) => b.stage === "sql")?.value, 2);
    assert.equal(bars.find((b) => b.stage === "sql")?.percent, 50);
    assert.equal(bars.find((b) => b.stage === "sem_historico")?.value, 1);
    assert.equal(bars.find((b) => b.stage === "negociacao")?.value, 0);
  });
});

describe("limitLossMatrixReasons", () => {
  it("preserva Sem motivo/Sem histórico e limita motivos colapsando Outros", () => {
    const cells = [
      { previous_stage: "sql", reason: "Preço", total: 5 },
      { previous_stage: "sql", reason: "Timing", total: 4 },
      { previous_stage: "oportunidade", reason: "Concorrente", total: 3 },
      { previous_stage: "negociacao", reason: "Sem motivo", total: 2 },
      { previous_stage: "sem_historico", reason: "Raro", total: 1 },
      { previous_stage: "mql", reason: "Outro raro", total: 1 },
    ];
    const limited = limitLossMatrixReasons(cells, 2);
    assert.ok(limited.reasons.includes("Preço"));
    assert.ok(limited.reasons.includes("Timing"));
    assert.ok(limited.reasons.includes("Sem motivo"));
    assert.ok(limited.reasons.includes("Outros"));
    assert.equal(limited.matrix.sem_historico.Outros, 2);
    assert.equal(limited.matrix.negociacao["Sem motivo"], 2);
  });
});

describe("buildStagnantPriorityTable + labels", () => {
  it("usa nome Kommo com fallback #ID e ordena por 30+", () => {
    const rows = buildStagnantPriorityTable(
      [
        { owner_id: "10", stage: "sql", bucket: "3", total: 2 },
        { owner_id: "10", stage: "sql", bucket: "30+", total: 1 },
        { owner_id: "99", stage: "negociacao", bucket: "7", total: 5 },
        { owner_id: "", stage: "oportunidade", bucket: "15", total: 1 },
      ],
      { "10": "Ana Paula" },
    );

    assert.equal(rows[0].ownerName, "Ana Paula");
    assert.equal(rows[0].bucket30, 1);
    assert.equal(rows.find((r) => r.ownerId === "99")?.ownerName, "#99");
    assert.equal(rows.find((r) => r.ownerId === "")?.ownerName, "Sem responsável");
  });
});

describe("buildOwnerConversion", () => {
  it("resolve labels e calcula SQL→Venda", () => {
    const rows = buildOwnerConversion(
      [
        {
          name: "10",
          sql: 10,
          oportunidade: 5,
          negociacao: 2,
          venda: 1,
        },
        {
          name: "Sem responsável",
          sql: 0,
          oportunidade: 0,
          negociacao: 0,
          venda: 0,
        },
      ],
      { "10": "Ana" },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Ana");
    assert.equal(rows[0].sqlToVenda, 10);
  });
});

describe("normalizeCloseCycleStats + recuperação", () => {
  it("marca ausência quando não há amostra confiável", () => {
    const empty = normalizeCloseCycleStats({
      median_days_to_venda: null,
      venda_sample_size: 0,
      median_days_to_perda: 12,
      perda_sample_size: 0,
      recovered_to_venda: 0,
    });
    assert.equal(empty.medianDaysToVenda, null);
    assert.equal(empty.medianDaysToPerda, null);
    assert.equal(empty.hasReliableHistory, false);
  });

  it("detecta perda recuperada que chegou a venda depois", () => {
    assert.equal(
      isRecoveredLoss([
        { to: "perda", at: "2026-07-01T00:00:00.000Z" },
        { to: "sql", at: "2026-07-10T00:00:00.000Z" },
        { to: "venda", at: "2026-08-01T00:00:00.000Z" },
      ]),
      true,
    );
    assert.equal(
      isRecoveredLoss([
        { to: "venda", at: "2026-06-01T00:00:00.000Z" },
        { to: "perda", at: "2026-07-01T00:00:00.000Z" },
      ]),
      false,
    );
  });
});

describe("SQL contract: commercial_loss_intelligence migration", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260814165954_commercial_loss_intelligence.sql"),
    "utf8",
  );

  it("usa histórico como fonte autoritativa e popula barras/matriz via helper compartilhado", () => {
    assert.match(sql, /create or replace function public\.dashboard_loss_events_deduped/);
    assert.match(
      sql,
      /h\.to_qualification = 'perda'[\s\S]*h\.changed_at >= p_from[\s\S]*h\.changed_at < p_to/,
    );
    assert.match(sql, /distinct on \(h\.lead_id\)/);

    const previousUsesHelper =
      /dashboard_loss_previous_stage[\s\S]*dashboard_loss_events_deduped/.test(sql);
    const matrixUsesHelper =
      /dashboard_loss_stage_reason_matrix[\s\S]*dashboard_loss_events_deduped/.test(sql);
    assert.equal(previousUsesHelper, true);
    assert.equal(matrixUsesHelper, true);

    // Bars/matrix must not seed population from currently-lost + closed_at alone.
    const previousBody = sql.slice(
      sql.indexOf("create or replace function public.dashboard_loss_previous_stage"),
      sql.indexOf("create or replace function public.dashboard_loss_stage_reason_matrix"),
    );
    assert.doesNotMatch(previousBody, /l\.qualification = 'perda'/);
    assert.doesNotMatch(previousBody, /l\.closed_at >= p_from/);
  });

  it("mantém fallback seguro closed_at sem evento de histórico no período", () => {
    assert.match(sql, /closed_fallback/);
    assert.match(
      sql,
      /l\.qualification = 'perda'[\s\S]*l\.closed_at >= p_from[\s\S]*not exists \([\s\S]*to_qualification = 'perda'/,
    );
  });
});
