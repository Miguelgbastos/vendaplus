import { z } from "zod";
import { GWE_EVENT_TYPE, GWE_SCHEMA, GWE_SCHEMA_VERSION, GWE_STAGES } from "./types.ts";

const nullableDateTime = z
  .string()
  .datetime({ offset: true })
  .nullable();

const milestone = z.enum(["1"]).nullable();

export const gweV1Schema = z
  .object({
    schema: z.literal(GWE_SCHEMA),
    schema_version: z.literal(GWE_SCHEMA_VERSION),
    event: z
      .object({
        id: z.string().min(1).max(128),
        type: z.literal(GWE_EVENT_TYPE),
        occurred_at: z.string().datetime({ offset: true }),
        sequence: z.number().int().nonnegative().optional(),
      })
      .strict(),
    lead: z
      .object({
        external_id: z.string().min(1).max(255),
        name: z.string().max(500).nullable(),
        email: z.string().email().max(320).nullable(),
        phone: z.string().max(50).nullable(),
        owner: z.object({ external_id: z.string().nullable() }).strict(),
        pipeline: z
          .object({
            external_id: z.string().nullable(),
            name: z.string().max(500).nullable(),
          })
          .strict(),
        stage: z
          .object({
            external_id: z.string().nullable(),
            name: z.string().max(500).nullable(),
          })
          .strict(),
        value: z
          .object({
            amount: z.number().finite().nonnegative().nullable(),
            currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
          })
          .strict(),
        created_at: nullableDateTime,
        updated_at: nullableDateTime,
      })
      .strict(),
    lifecycle: z
      .object({
        current_stage: z.enum(GWE_STAGES).nullable(),
        source_entered_at: nullableDateTime,
        history_complete: z.boolean(),
        milestones: z
          .object({
            mql: milestone,
            sal: milestone,
            sql: milestone,
            oportunidade: milestone,
            negociacao: milestone,
            venda: milestone,
            perda: milestone,
          })
          .strict(),
      })
      .strict(),
    attribution: z
      .object({
        utm_source: z.string().nullable(),
        utm_medium: z.string().nullable(),
        utm_campaign: z.string().nullable(),
        utm_content: z.string().nullable(),
        utm_term: z.string().nullable(),
      })
      .strict(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
