import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLeadFilters,
  buildDimensionOptions,
  buildOwnerOptions,
  daysBetweenInclusive,
  defaultDateRange,
  MAX_RANGE_DAYS,
  NULL_FILTER_VALUE,
  parseDashboardFilters,
  serializeDashboardFilters,
  ymdInSaoPaulo,
  type FilterableLead,
} from "./dashboard-filters.ts";

describe("dashboard-filters", () => {
  const now = new Date("2026-07-31T15:00:00-03:00");

  it("ymdInSaoPaulo usa o dia civil de São Paulo, não o UTC do ISO", () => {
    // 2026-08-07 01:30 UTC == 2026-08-06 22:30 in America/Sao_Paulo (UTC-3).
    assert.equal(ymdInSaoPaulo("2026-08-07T01:30:00.000Z"), "2026-08-06");
    assert.equal(ymdInSaoPaulo("2026-08-06T03:00:00.000Z"), "2026-08-06");
    assert.notEqual(
      ymdInSaoPaulo("2026-08-07T01:30:00.000Z"),
      "2026-08-07T01:30:00.000Z".slice(0, 10),
    );
  });

  it("aplica default dos últimos 30 dias quando from/to ausentes", () => {
    const { filters, clamped } = parseDashboardFilters({}, now);
    assert.equal(filters.from, "2026-07-02");
    assert.equal(filters.to, "2026-07-31");
    assert.equal(clamped, false);
    assert.equal(daysBetweenInclusive(filters.from, filters.to), 30);
  });

  it("faz clamp em 90 dias e marca clamped", () => {
    const { filters, clamped } = parseDashboardFilters(
      { from: "2026-01-01", to: "2026-07-31" },
      now,
    );
    assert.equal(clamped, true);
    assert.equal(filters.to, "2026-07-31");
    assert.equal(filters.from, "2026-05-03");
    assert.equal(daysBetweenInclusive(filters.from, filters.to), MAX_RANGE_DAYS);
  });

  it("ignora stage inválido e trata como Todos", () => {
    const { filters } = parseDashboardFilters(
      { from: "2026-07-01", to: "2026-07-31", stage: "foo" },
      now,
    );
    assert.equal(filters.stage, undefined);
  });

  it("serializa omitindo Todos e sempre inclui from/to", () => {
    const params = serializeDashboardFilters({
      from: "2026-07-01",
      to: "2026-07-31",
      campaign: "spring_sale",
    });
    assert.equal(params.get("from"), "2026-07-01");
    assert.equal(params.get("to"), "2026-07-31");
    assert.equal(params.get("campaign"), "spring_sale");
    assert.equal(params.get("source"), null);
    assert.equal(params.get("stage"), null);
  });

  it("parse round-trip preserva params ativos", () => {
    const params = serializeDashboardFilters({
      from: "2026-07-01",
      to: "2026-07-20",
      campaign: NULL_FILTER_VALUE,
      source: "meta",
      medium: "cpc",
      owner: "42",
      stage: "sql",
    });
    const { filters } = parseDashboardFilters(params, now);
    assert.deepEqual(filters, {
      from: "2026-07-01",
      to: "2026-07-20",
      campaign: NULL_FILTER_VALUE,
      source: "meta",
      medium: "cpc",
      owner: "42",
      stage: "sql",
    });
  });

  it("aplica AND e __none__ para UTM/owner ausentes", () => {
    const leads: FilterableLead[] = [
      {
        qualification: "mql",
        utm_source: "meta",
        utm_medium: "cpc",
        utm_campaign: "spring",
        responsible_user_id: "10",
        custom_fields: { mql: "1" },
        first_seen_at: "2026-07-15T12:00:00-03:00",
      },
      {
        qualification: "sql",
        utm_source: null,
        utm_medium: "  ",
        utm_campaign: "",
        responsible_user_id: null,
        custom_fields: { mql: "1", sal: "1", sql: "1" },
        first_seen_at: "2026-07-16T12:00:00-03:00",
      },
      {
        qualification: "mql",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "spring",
        responsible_user_id: "10",
        custom_fields: null,
        first_seen_at: "2026-06-01T12:00:00-03:00",
      },
    ];

    const filtered = applyLeadFilters(leads, {
      from: "2026-07-01",
      to: "2026-07-31",
      campaign: NULL_FILTER_VALUE,
      source: NULL_FILTER_VALUE,
      medium: NULL_FILTER_VALUE,
      owner: NULL_FILTER_VALUE,
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.qualification, "sql");
  });

  it("filtra etapa por milestone alcançado", () => {
    const leads: FilterableLead[] = [
      {
        qualification: "oportunidade",
        utm_source: "meta",
        utm_medium: "cpc",
        utm_campaign: "a",
        responsible_user_id: "1",
        custom_fields: { mql: "1", sal: "1", sql: "1", oportunidade: "1" },
        first_seen_at: "2026-07-10T12:00:00-03:00",
      },
      {
        qualification: "mql",
        utm_source: "meta",
        utm_medium: "cpc",
        utm_campaign: "a",
        responsible_user_id: "1",
        custom_fields: { mql: "1" },
        first_seen_at: "2026-07-10T12:00:00-03:00",
      },
    ];

    const filtered = applyLeadFilters(leads, {
      ...defaultDateRange(now),
      from: "2026-07-01",
      to: "2026-07-31",
      stage: "sql",
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.qualification, "oportunidade");
  });

  it("monta opções com Sem … no topo", () => {
    const options = buildDimensionOptions(
      ["beta", null, "alpha", ""],
      "Sem campanha",
    );
    assert.equal(options[0]?.value, NULL_FILTER_VALUE);
    assert.equal(options[0]?.label, "Sem campanha");
    assert.deepEqual(
      options.slice(1).map((o) => o.value),
      ["alpha", "beta"],
    );
  });

  it("exibe o nome do responsável sem alterar o ID usado no filtro", () => {
    const options = buildOwnerOptions(["12853863", "12227483"], {
      "12227483": "Ana Souza",
    });

    assert.deepEqual(options, [
      { value: "12853863", label: "#12853863" },
      { value: "12227483", label: "Ana Souza" },
    ]);
  });
});
