export interface InternalFinanceScenario {
  id: string;
  label: string;
  monthlyBurnUsd: number;
  runwayMonths: number;
  note: string;
  status: "base" | "watch" | "extension";
}

export interface InternalBurnCategory {
  id: string;
  label: string;
  amountUsd: number;
  trend: "up" | "flat" | "down";
}

export interface InternalFinanceSnapshot {
  cashOnHandUsd: number;
  monthlyBurnUsd: number;
  committedRevenueUsd: number;
  runwayMonths: number;
  activeScenarioId: string;
  categories: InternalBurnCategory[];
  scenarios: InternalFinanceScenario[];
  watchItems: string[];
  reviewQueue: string[];
  updatedAt: string;
}

type InternalFinanceAction =
  | { action: "scenario"; scenarioId: string }
  | { action: "review" };

interface InternalFinanceState extends InternalFinanceSnapshot {
  nextId: number;
}

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function calculateRunway(cashOnHandUsd: number, monthlyBurnUsd: number) {
  return Number((cashOnHandUsd / monthlyBurnUsd).toFixed(1));
}

function initialState(): InternalFinanceState {
  const cashOnHandUsd = 1280000;
  const monthlyBurnUsd = 142000;
  const committedRevenueUsd = 386000;
  const updatedAt = nowIso();

  return {
    nextId: 100,
    cashOnHandUsd,
    monthlyBurnUsd,
    committedRevenueUsd,
    runwayMonths: calculateRunway(cashOnHandUsd, monthlyBurnUsd),
    activeScenarioId: "base",
    categories: [
      { id: "eng", label: "Engineering", amountUsd: 62000, trend: "flat" },
      { id: "gtm", label: "GTM and pilots", amountUsd: 35000, trend: "up" },
      { id: "infra", label: "Secure runtime infra", amountUsd: 24000, trend: "up" },
      { id: "ops", label: "Ops and tools", amountUsd: 21000, trend: "down" },
    ],
    scenarios: [
      {
        id: "base",
        label: "Base plan",
        monthlyBurnUsd,
        runwayMonths: calculateRunway(cashOnHandUsd, monthlyBurnUsd),
        note: "Hold current spend while converting pilots into committed revenue.",
        status: "base",
      },
      {
        id: "lean",
        label: "Lean extension",
        monthlyBurnUsd: 118000,
        runwayMonths: calculateRunway(cashOnHandUsd, 118000),
        note: "Delay two discretionary GTM motions and narrow infra experiments.",
        status: "extension",
      },
      {
        id: "growth",
        label: "Growth push",
        monthlyBurnUsd: 176000,
        runwayMonths: calculateRunway(cashOnHandUsd, 176000),
        note: "Add enterprise pilot support and paid acquisition tests.",
        status: "watch",
      },
    ],
    watchItems: [
      "Infrastructure spend is acceptable, but it needs a monthly ceiling before hosted pilots expand.",
      "A single enterprise prepay would add roughly 2.7 months of runway at the base burn rate.",
      "Growth push should require explicit review because it pulls runway under eight months.",
    ],
    reviewQueue: [],
    updatedAt,
  };
}

declare global {
  var __zkmarkInternalFinance: InternalFinanceState | undefined;
}

function getState(): InternalFinanceState {
  if (!globalThis.__zkmarkInternalFinance) {
    globalThis.__zkmarkInternalFinance = initialState();
  }
  return globalThis.__zkmarkInternalFinance;
}

function nextId(prefix: string) {
  const state = getState();
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

export function getInternalFinanceSnapshot(): InternalFinanceSnapshot {
  const state = getState();
  return clone({
    cashOnHandUsd: state.cashOnHandUsd,
    monthlyBurnUsd: state.monthlyBurnUsd,
    committedRevenueUsd: state.committedRevenueUsd,
    runwayMonths: state.runwayMonths,
    activeScenarioId: state.activeScenarioId,
    categories: state.categories,
    scenarios: state.scenarios,
    watchItems: state.watchItems,
    reviewQueue: state.reviewQueue,
    updatedAt: state.updatedAt,
  });
}

export function dispatchInternalFinanceAction(input: InternalFinanceAction): InternalFinanceSnapshot {
  const state = getState();

  if (input.action === "scenario") {
    const scenario = state.scenarios.find((item) => item.id === input.scenarioId);
    if (!scenario) {
      return getInternalFinanceSnapshot();
    }

    state.activeScenarioId = scenario.id;
    state.monthlyBurnUsd = scenario.monthlyBurnUsd;
    state.runwayMonths = scenario.runwayMonths;
    state.updatedAt = nowIso();
    return getInternalFinanceSnapshot();
  }

  const scenario = state.scenarios.find((item) => item.id === state.activeScenarioId) || state.scenarios[0];
  const review = `${scenario.label}: ${scenario.runwayMonths} months runway at $${Math.round(scenario.monthlyBurnUsd / 1000)}k monthly burn`;
  state.reviewQueue.unshift(`${nextId("review")} · ${review}`);
  state.reviewQueue = state.reviewQueue.slice(0, 4);
  state.updatedAt = nowIso();
  return getInternalFinanceSnapshot();
}
