// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { KPI_KEYS, KPI_LIST } from "@/features/research/catalogue";
import {
  createFixtureProvider,
  FIXTURE_FACTS,
  FIXTURE_RUN_PREFIX,
  FIXTURE_SOURCES,
  FIXTURE_STEP_MS,
  FIXTURE_VALUES,
  fixtureEmptyResult,
  fixtureResult,
  fixtureValue,
  fixtureWantsEmpty,
  fixtureWantsFailure,
  fixtureYears,
} from "@/lib/research/fixture";
import { buildOutputSchema, FACT_FIELDS, YEAR_SLOTS } from "@/lib/research/output-schema";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/research/provider";

/**
 * The fixture provider (spec 0007, AC-12): pinned constants, done on the first poll after one
 * pause per step, a full result for any name, an empty one for a name containing `empty`, a
 * retryable failure for a name containing `fail`, case insensitive. The pause is injected.
 */
const input = { name: "Muster AG", legalName: null, website: null, country: "CH" };

describe("the fixture constants (AC-12)", () => {
  it("reports the three years before the current one, newest first", () => {
    expect(fixtureYears(new Date("2026-06-01T00:00:00Z"))).toEqual([2025, 2024, 2023]);
    expect(fixtureYears(new Date("2027-01-01T00:00:00Z"))).toEqual([2026, 2025, 2024]);
  });

  it("steps each value back per year and rounds to two decimals", () => {
    expect(fixtureValue("ltifr", 0)).toBe(2.4);
    expect(fixtureValue("ltifr", 1)).toBe(2.7);
    expect(fixtureValue("ltifr", 2)).toBe(3);
    expect(fixtureValue("near_miss_rate", 2)).toBe(12);
    expect(fixtureValue("fatalities", 2)).toBe(0);
    expect(fixtureValue("iso_45001_certified", 2)).toBe(1);
  });

  it("recognises the empty and fail names case insensitively", () => {
    expect(fixtureWantsEmpty("Empty AG")).toBe(true);
    expect(fixtureWantsEmpty("Nothing AG")).toBe(false);
    expect(fixtureWantsFailure("FAILSAFE GmbH")).toBe(true);
    expect(fixtureWantsFailure("Muster AG")).toBe(false);
  });
});

describe("fixtureResult and fixtureEmptyResult", () => {
  it("fills every field of the output schema: eight KPIs for three years, the seven facts and the years", () => {
    const result = fixtureResult([2025, 2024, 2023]);
    const schemaFields = Object.keys(buildOutputSchema().properties);
    expect(Object.keys(result.fields).sort()).toEqual([...schemaFields].sort());
    expect(result.fields.reporting_years).toBe("2025, 2024, 2023");
    expect(result.fields.ltifr_latest).toBe("2.4 (per 1 000 000 hours worked), 2025");
    expect(result.fields.iso_45001_certified_two_years_prior).toBe("yes (yes or no), 2023");
    expect(result.fields.uid).toBe(FIXTURE_FACTS.uid);
    expect(result.text).toBe(FIXTURE_FACTS.summary);
    expect(result.processor).toBe("fixture");
  });

  it("cites one of the five sources per field, high confidence for the latest year and medium before", () => {
    const result = fixtureResult([2025, 2024, 2023]);
    expect(result.basis).toHaveLength(KPI_KEYS.length * YEAR_SLOTS.length + FACT_FIELDS.length);
    const urls = new Set(result.basis.flatMap((entry) => entry.citations.map((c) => c.url)));
    expect([...urls].sort()).toEqual(FIXTURE_SOURCES.map((source) => source.url).sort());
    const latest = result.basis.find((entry) => entry.field === "ltifr_latest");
    const previous = result.basis.find((entry) => entry.field === "ltifr_previous");
    expect(latest?.confidence).toBe("high");
    expect(previous?.confidence).toBe("medium");
    expect(latest?.citations[0]?.excerpts[0]).toBe("ltifr 2025: 2.4 per 1 000 000 hours worked.");
  });

  it("reports only the years it was given", () => {
    const result = fixtureResult([2025]);
    expect(result.fields.ltifr_latest).toBeDefined();
    expect(result.fields.ltifr_previous).toBeUndefined();
    expect(result.basis.filter((entry) => entry.field.startsWith("ltifr_"))).toHaveLength(1);
  });

  it("marks every field not found in the empty result, with no sources", () => {
    const result = fixtureEmptyResult();
    expect(new Set(Object.values(result.fields))).toEqual(new Set(["not found"]));
    expect(Object.keys(result.fields)).toHaveLength(1 + KPI_LIST.length * 3 + FACT_FIELDS.length);
    expect(result.basis).toEqual([]);
    expect(result.text).toBeNull();
  });
});

describe("createFixtureProvider (AC-12)", () => {
  it("pauses one step per call, encodes the name into the run id and is done on the first poll", async () => {
    const sleep = vi.fn(async () => {});
    const provider = createFixtureProvider(sleep);
    const { providerRunId } = await provider.createRun(input, buildOutputSchema());
    expect(providerRunId.startsWith(FIXTURE_RUN_PREFIX)).toBe(true);
    expect(sleep).toHaveBeenCalledWith(FIXTURE_STEP_MS);
    await expect(provider.getRun(providerRunId)).resolves.toEqual({ status: "done" });
    expect(sleep).toHaveBeenCalledTimes(2);
    const result = await provider.getResult(providerRunId);
    expect(result.fields.ltifr_latest).toContain(String(FIXTURE_VALUES.ltifr));
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("answers the empty result for a name containing empty", async () => {
    const provider = createFixtureProvider(async () => {});
    const { providerRunId } = await provider.createRun(
      { ...input, name: "Leere Empty GmbH" },
      buildOutputSchema(),
    );
    await expect(provider.getResult(providerRunId)).resolves.toEqual(fixtureEmptyResult());
  });

  it("throws the retryable class with a 503 for a name containing fail", async () => {
    const provider = createFixtureProvider(async () => {});
    const failure = provider.createRun({ ...input, name: "Fail AG" }, buildOutputSchema());
    await expect(failure).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(failure).rejects.toMatchObject({ status: 503 });
  });

  it("rejects a run id it did not issue with a 404", async () => {
    const provider = createFixtureProvider(async () => {});
    const failure = provider.getRun("trun_from_parallel");
    await expect(failure).rejects.toBeInstanceOf(ProviderRejectedError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });

  it("uses a real two second pause by default", () => {
    expect(FIXTURE_STEP_MS).toBe(2_000);
  });
});
