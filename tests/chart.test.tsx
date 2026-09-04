import { act, render, screen } from "@testing-library/react";
import { Bar, BarChart } from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegendContent,
  ChartTooltipContent,
} from "@/components/ui/chart";

const CONFIG: ChartConfig = {
  assessments: { label: "Assessments", color: "var(--chart-1)" },
  findings: {
    label: "Findings",
    theme: { light: "oklch(0.5 0.1 200)", dark: "oklch(0.8 0.1 200)" },
  },
};

const DATA = [
  { label: "Jan", assessments: 12, findings: 31 },
  { label: "Feb", assessments: 18, findings: 27 },
];

/** The Recharts surface carries the chart size the container resolved; the DOM is the contract. */
function chartSurface(): SVGSVGElement {
  const svg = document.querySelector("svg.recharts-surface");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("no Recharts surface rendered");
  }
  return svg;
}

function renderBarChart(props: Partial<React.ComponentProps<typeof ChartContainer>> = {}) {
  return render(
    <ChartContainer config={CONFIG} {...props}>
      <BarChart data={DATA}>
        <Bar dataKey="assessments" fill="var(--color-assessments)" />
      </BarChart>
    </ChartContainer>,
  );
}

describe("ChartContainer (spec 0003, AC-9)", () => {
  it("renders the chart at the initial dimension when no resize has been observed", () => {
    // jsdom has no ResizeObserver, so Recharts keeps the initial size it was given.
    renderBarChart({ initialDimension: { width: 480, height: 240 } });

    expect(chartSurface()).toHaveAttribute("width", "480");
    expect(chartSurface()).toHaveAttribute("height", "240");
  });

  it("falls back to a 320 by 200 initial dimension", () => {
    renderBarChart();

    expect(chartSurface()).toHaveAttribute("width", "320");
    expect(chartSurface()).toHaveAttribute("height", "200");
  });

  it("scopes the series colors to the chart id for the light and the dark theme", () => {
    const { container } = renderBarChart({ id: "kpi" });

    const chart = container.querySelector("[data-slot=chart]");
    expect(chart).toHaveAttribute("data-chart", "chart-kpi");
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain("[data-chart=chart-kpi] {");
    expect(css).toContain("--color-assessments: var(--chart-1);");
    expect(css).toContain("--color-findings: oklch(0.5 0.1 200);");
    expect(css).toContain(".dark [data-chart=chart-kpi] {");
    expect(css).toContain("--color-findings: oklch(0.8 0.1 200);");
  });

  it("emits no style block when the config carries no colors", () => {
    const { container } = render(
      <ChartContainer config={{ assessments: { label: "Assessments" } }}>
        <BarChart data={DATA}>
          <Bar dataKey="assessments" />
        </BarChart>
      </ChartContainer>,
    );

    expect(container.querySelector("style")).toBeNull();
  });
});

describe("ChartContainer resize throttling (spec 0003, AC-9)", () => {
  // The observer callbacks Recharts registered; a test fires them like the browser would.
  const observed: ResizeObserverCallback[] = [];

  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      observed.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  function tick(width: number, height = 300) {
    const callback = observed[0];
    if (!callback) {
      throw new Error("Recharts registered no ResizeObserver");
    }
    const entry = { contentRect: { width, height } } as ResizeObserverEntry;
    act(() => callback([entry], {} as ResizeObserver));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    observed.length = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    // Recharts measures the container once on mount; give it a real size so the chart exists.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 600,
      height: 300,
      top: 0,
      left: 0,
      right: 600,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("collapses resize ticks inside the default 100ms window into one trailing update at the final size", () => {
    renderBarChart();
    expect(chartSurface()).toHaveAttribute("width", "600");

    // Five frames of a 200ms sidebar animation: the chart must not repaint on each one.
    for (const width of [560, 520, 480, 440, 420]) {
      tick(width);
      act(() => vi.advanceTimersByTime(16));
      expect(chartSurface()).toHaveAttribute("width", "600");
    }

    act(() => vi.advanceTimersByTime(100));
    expect(chartSurface()).toHaveAttribute("width", "420");
  });

  it("honors a custom resizeThrottleMs window", () => {
    renderBarChart({ resizeThrottleMs: 250 });

    tick(400);
    act(() => vi.advanceTimersByTime(100));
    expect(chartSurface()).toHaveAttribute("width", "600");

    act(() => vi.advanceTimersByTime(150));
    expect(chartSurface()).toHaveAttribute("width", "400");
  });

  it("re-renders on every resize tick when resizeThrottleMs is 0", () => {
    renderBarChart({ resizeThrottleMs: 0 });

    tick(560);
    expect(chartSurface()).toHaveAttribute("width", "560");
    tick(420);
    expect(chartSurface()).toHaveAttribute("width", "420");
  });
});

describe("ChartTooltipContent and ChartLegendContent (spec 0003, AC-9)", () => {
  // Shaped like the entry Recharts hands the tooltip for one bar of one series.
  const payload: NonNullable<React.ComponentProps<typeof ChartTooltipContent>["payload"]> = [
    {
      name: "assessments",
      dataKey: "assessments",
      value: 12,
      color: "var(--chart-1)",
      payload: DATA[0],
      graphicalItemId: "bar-assessments",
    },
  ];

  function renderInChart(ui: React.ReactElement) {
    return render(<ChartContainer config={CONFIG}>{ui}</ChartContainer>);
  }

  it("tooltip shows the axis label, the series label from the config and the value", () => {
    renderInChart(<ChartTooltipContent active payload={payload} label="Jan" />);

    expect(screen.getByText("Jan")).toBeInTheDocument();
    expect(screen.getByText("Assessments")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("tooltip renders nothing while inactive", () => {
    renderInChart(<ChartTooltipContent active={false} payload={payload} label="Jan" />);

    expect(screen.queryByText("Assessments")).not.toBeInTheDocument();
  });

  it("legend lists each series by its config label and skips hidden entries", () => {
    renderInChart(
      <ChartLegendContent
        payload={[
          { value: "assessments", dataKey: "assessments", color: "var(--chart-1)", type: "rect" },
          { value: "findings", dataKey: "findings", color: "var(--chart-3)", type: "none" },
        ]}
      />,
    );

    expect(screen.getByText("Assessments")).toBeInTheDocument();
    expect(screen.queryByText("Findings")).not.toBeInTheDocument();
  });

  it("tooltip content refuses to render outside a ChartContainer", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<ChartTooltipContent active payload={payload} />)).toThrow(
      "useChart must be used within a <ChartContainer />",
    );
  });
});
