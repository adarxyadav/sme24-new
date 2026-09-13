// @vitest-environment node
import { APIConnectionError, APIError } from "parallel-web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOutputSchema } from "@/lib/research/output-schema";
import {
  buildParallelInput,
  buildParallelPeerInput,
  classifyParallelError,
  createParallelProvider,
  mapBasis,
  PARALLEL_PROCESSOR,
  parsePeerContent,
} from "@/lib/research/parallel";
import { buildPeerOutputSchema } from "@/lib/research/peer-schema";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/research/provider";

/**
 * The Parallel adapter (spec 0007, AC-4, AC-10, AC-13): one task run on the `core` processor
 * with the flat schema, the statuses mapped to the three the task knows, the json output read
 * into string fields with its basis, a 429, 5xx or network error as the retryable class and any
 * other 4xx as the abort class. The SDK client is the boundary; its error classes are real.
 */
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  result: vi.fn(),
  options: null as unknown,
}));

vi.mock("parallel-web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("parallel-web")>();
  return {
    ...actual,
    default: class FakeParallel {
      taskRun = { create: sdk.create, retrieve: sdk.retrieve, result: sdk.result };
      constructor(options: unknown) {
        sdk.options = options;
      }
    },
  };
});

const input = {
  name: "Muster AG",
  legalName: "Muster Holding AG",
  website: "https://muster.ch",
  country: "CH",
};

function apiError(status: number) {
  return new APIError(status, { message: "x" }, `answered ${status}`, new Headers());
}

beforeEach(() => {
  sdk.create.mockResolvedValue({ run_id: "trun_1" });
  sdk.retrieve.mockResolvedValue({ status: "completed" });
});

describe("buildParallelInput (AC-13)", () => {
  it("carries the objective and the four public company fields, blanks for the optional ones", () => {
    expect(buildParallelInput(input)).toEqual({
      objective: expect.stringContaining("occupational health and safety"),
      company_name: "Muster AG",
      legal_name: "Muster Holding AG",
      website: "https://muster.ch",
      country: "CH",
    });
    expect(buildParallelInput({ ...input, legalName: null, website: null })).toMatchObject({
      legal_name: "",
      website: "",
    });
  });
});

describe("mapBasis", () => {
  it("keeps a known confidence, the citations with blank titles and excerpts filled in", () => {
    expect(
      mapBasis({
        field: "ltifr_latest",
        reasoning: "stated",
        confidence: "high",
        citations: [{ url: "https://a.example/r", title: null, excerpts: null }],
      }),
    ).toEqual({
      field: "ltifr_latest",
      reasoning: "stated",
      confidence: "high",
      citations: [{ url: "https://a.example/r", title: "", excerpts: [] }],
    });
  });

  it("drops an unknown confidence and copes with no citations", () => {
    expect(mapBasis({ field: "uid", reasoning: "r", confidence: "very high" })).toEqual({
      field: "uid",
      reasoning: "r",
      confidence: null,
      citations: [],
    });
  });
});

describe("classifyParallelError (AC-10)", () => {
  it("treats a network error, a 429 and every 5xx as unavailable, with the status", () => {
    const network = classifyParallelError(new APIConnectionError({ message: "socket hang up" }));
    expect(network).toBeInstanceOf(ProviderUnavailableError);
    expect(network.status).toBeNull();
    for (const status of [429, 500, 502, 503]) {
      const error = classifyParallelError(apiError(status));
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect(error.status).toBe(status);
    }
  });

  it("treats every other 4xx as rejected", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const error = classifyParallelError(apiError(status));
      expect(error).toBeInstanceOf(ProviderRejectedError);
      expect(error.status).toBe(status);
    }
  });

  it("treats anything else as unavailable so the run is retried rather than failed", () => {
    expect(classifyParallelError(new Error("weird"))).toBeInstanceOf(ProviderUnavailableError);
    expect(classifyParallelError("string")).toBeInstanceOf(ProviderUnavailableError);
  });
});

describe("createParallelProvider (AC-4)", () => {
  it("creates the client with the key and no SDK retries, and one run on core with the json schema", async () => {
    const provider = createParallelProvider("pk_test");
    const schema = buildOutputSchema("CH");
    await expect(provider.createRun(input, schema)).resolves.toEqual({ providerRunId: "trun_1" });
    expect(sdk.options).toEqual({ apiKey: "pk_test", maxRetries: 0 });
    expect(PARALLEL_PROCESSOR).toBe("core");
    expect(sdk.create).toHaveBeenCalledWith({
      input: buildParallelInput(input),
      processor: "core",
      task_spec: { output_schema: { type: "json", json_schema: schema } },
    });
  });

  it.each([
    ["queued", "running"],
    ["action_required", "running"],
    ["running", "running"],
    ["cancelling", "running"],
    ["completed", "done"],
    ["failed", "failed"],
    ["cancelled", "failed"],
    ["something_new", "running"],
  ])("maps the provider status %s to %s", async (theirs, ours) => {
    sdk.retrieve.mockResolvedValue({ status: theirs });
    const provider = createParallelProvider("pk_test");
    await expect(provider.getRun("trun_1")).resolves.toEqual({ status: ours });
    expect(sdk.retrieve).toHaveBeenCalledWith("trun_1");
  });

  it("reads a json result into string fields, the mapped basis, the summary text and the core processor", async () => {
    sdk.result.mockResolvedValue({
      output: {
        type: "json",
        content: {
          reporting_years: "2025, 2024",
          ltifr_latest: "2.4, 2025",
          employees: 420,
          canton: null,
          summary: "Reports exist.",
        },
        basis: [
          {
            field: "ltifr_latest",
            reasoning: "r",
            confidence: "medium",
            citations: [{ url: "https://a.example", title: "A", excerpts: ["LTIFR 2.4"] }],
          },
        ],
      },
    });
    const provider = createParallelProvider("pk_test");
    const result = await provider.getResult("trun_1");
    expect(sdk.result).toHaveBeenCalledWith("trun_1", { timeout: 30 });
    expect(result).toEqual({
      fields: {
        reporting_years: "2025, 2024",
        ltifr_latest: "2.4, 2025",
        employees: "420",
        canton: "",
        summary: "Reports exist.",
      },
      basis: [
        {
          field: "ltifr_latest",
          reasoning: "r",
          confidence: "medium",
          citations: [{ url: "https://a.example", title: "A", excerpts: ["LTIFR 2.4"] }],
        },
      ],
      text: "Reports exist.",
      processor: "core",
    });
  });

  it("gives null text when the summary is empty", async () => {
    sdk.result.mockResolvedValue({ output: { type: "json", content: { summary: "" }, basis: [] } });
    const provider = createParallelProvider("pk_test");
    await expect(provider.getResult("trun_1")).resolves.toMatchObject({ text: null });
  });

  it("rejects a text output for the json schema without retrying", async () => {
    sdk.result.mockResolvedValue({ output: { type: "text", content: "prose", basis: [] } });
    const provider = createParallelProvider("pk_test");
    await expect(provider.getResult("trun_1")).rejects.toBeInstanceOf(ProviderRejectedError);
  });

  it("translates SDK errors on every call into the provider classes", async () => {
    sdk.create.mockRejectedValue(apiError(503));
    sdk.retrieve.mockRejectedValue(apiError(401));
    sdk.result.mockRejectedValue(new APIConnectionError({ message: "reset" }));
    const provider = createParallelProvider("pk_test");
    await expect(provider.createRun(input, buildOutputSchema("CH"))).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    await expect(provider.getRun("trun_1")).rejects.toBeInstanceOf(ProviderRejectedError);
    await expect(provider.getResult("trun_1")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

/**
 * The peer run (spec 0022, AC-6): the same processor and the same create call with the peer
 * schema, the answer read through Zod so one malformed peer costs that peer and not the run.
 */
const peerInput = {
  companyName: "Muster AG",
  section: "C",
  sectionName: "Manufacturing",
  country: "CH",
  regionCountries: ["CH", "DE", "AT", "LI"],
  targetPeers: 8,
  minimumPeers: 3,
};

const peer = (over: Record<string, unknown> = {}) => ({
  name: "Peer AG",
  website: "https://www.example.com/peer",
  country: "CH",
  headcount: 500,
  headcountYear: 2025,
  ltifr: {
    value: 3.1,
    unit: "per_million_hours",
    periodYear: 2025,
    sourceUrl: "https://www.example.com/peer/report",
    sourceTitle: "Sustainability report",
    basis: "employees",
  },
  trifr: null,
  ...over,
});

describe("the peer run (spec 0022, AC-6)", () => {
  it("sends the objective, the ladder and the peer schema on the core processor", async () => {
    sdk.create.mockResolvedValue({ run_id: "trun_peers" });
    const provider = createParallelProvider("pk_test");
    await expect(provider.createPeerRun(peerInput, buildPeerOutputSchema())).resolves.toEqual({
      providerRunId: "trun_peers",
    });
    const call = sdk.create.mock.calls[0]?.[0];
    expect(call.processor).toBe(PARALLEL_PROCESSOR);
    expect(call.task_spec.output_schema.json_schema).toEqual(buildPeerOutputSchema());
    expect(call.input.region_countries).toBe("CH, DE, AT, LI");
    expect(call.input.industry_section).toBe("C (Manufacturing)");
    expect(call.input.objective).toContain("NACE section C");
  });

  it("builds the peer task input from the search input", () => {
    expect(buildParallelPeerInput(peerInput)).toMatchObject({
      company_name: "Muster AG",
      country: "CH",
      target_peers: "8",
      minimum_peers: "3",
    });
  });

  it("reads the peers out of the json output", async () => {
    sdk.result.mockResolvedValue({
      output: { type: "json", content: { peers: [peer()] }, basis: [] },
    });
    const provider = createParallelProvider("pk_test");
    const result = await provider.getPeerResult("trun_peers");
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]?.ltifr?.unit).toBe("per_million_hours");
  });

  it("drops one malformed peer rather than failing the run", () => {
    const parsed = parsePeerContent({
      peers: [peer(), peer({ country: "Switzerland" }), peer({ name: "Second AG" })],
    });
    expect(parsed.peers.map((entry) => entry.name)).toEqual(["Peer AG", "Second AG"]);
  });

  it("keeps at most eight peers even when the provider returns more", () => {
    const parsed = parsePeerContent({ peers: Array.from({ length: 12 }, () => peer()) });
    expect(parsed.peers).toHaveLength(8);
  });

  it("rejects a content without a peers array", () => {
    expect(() => parsePeerContent({ companies: [] })).toThrow(ProviderRejectedError);
    expect(() => parsePeerContent(null)).toThrow(ProviderRejectedError);
  });

  it("rejects a text output for the peer schema", async () => {
    sdk.result.mockResolvedValue({ output: { type: "text", content: "prose", basis: [] } });
    const provider = createParallelProvider("pk_test");
    await expect(provider.getPeerResult("trun_peers")).rejects.toBeInstanceOf(
      ProviderRejectedError,
    );
  });
});
