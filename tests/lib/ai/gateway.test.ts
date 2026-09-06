// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AI_MODEL, structuredOutput } from "@/lib/ai/gateway";

/**
 * The one AI call (spec 0007, AC-5): the gateway is created with the key, the model is Claude
 * Sonnet 5 through the gateway, the call is `generateText` with `Output.object` on the given
 * schema at temperature 0 with the SDK's retries, and a failure propagates to the caller.
 * The `ai` package is the boundary.
 */
const sdk = vi.hoisted(() => ({
  createGateway: vi.fn(),
  generateText: vi.fn(),
  object: vi.fn((options: unknown) => ({ kind: "object", options })),
  model: { id: "model" },
}));

vi.mock("ai", () => ({
  createGateway: sdk.createGateway,
  generateText: sdk.generateText,
  Output: { object: sdk.object },
}));

const schema = z.object({ answer: z.string() });

beforeEach(() => {
  sdk.createGateway.mockReturnValue((id: string) => ({ ...sdk.model, id }));
  sdk.generateText.mockResolvedValue({ output: { answer: "yes" } });
});

describe("structuredOutput (AC-5)", () => {
  it("names the model the spec pins", () => {
    expect(AI_MODEL).toBe("anthropic/claude-sonnet-5");
  });

  it("calls generateText on the gateway model with the schema output, temperature 0 and two retries", async () => {
    await expect(
      structuredOutput({ apiKey: "vck_test", schema, system: "sys", prompt: "ask" }),
    ).resolves.toEqual({ answer: "yes" });
    expect(sdk.createGateway).toHaveBeenCalledWith({ apiKey: "vck_test" });
    expect(sdk.object).toHaveBeenCalledWith({ schema });
    expect(sdk.generateText).toHaveBeenCalledWith({
      model: { id: AI_MODEL },
      output: { kind: "object", options: { schema } },
      system: "sys",
      prompt: "ask",
      temperature: 0,
      maxRetries: 2,
    });
  });

  it("passes an explicit retry count through", async () => {
    await structuredOutput({ apiKey: "k", schema, system: "s", prompt: "p", maxRetries: 0 });
    expect(sdk.generateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it("lets a failed call throw so the caller decides what it means", async () => {
    sdk.generateText.mockRejectedValue(new Error("no output matched the schema"));
    await expect(
      structuredOutput({ apiKey: "k", schema, system: "s", prompt: "p" }),
    ).rejects.toThrow("no output matched the schema");
  });
});
