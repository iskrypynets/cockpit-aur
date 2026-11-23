import type { StreamEvent } from "./bindings";
import { t } from "./i18n/index";

export interface ProgressPlan {
  /** Bytes the transaction will download; 0 leaves the download band indeterminate. */
  downloadBytes: number;
  /** Packages the transaction installs or upgrades (removals excluded). */
  packages: number;
}

export type ProgressPhase = "preparing" | "downloading" | "transaction" | "hooks" | "aur";

export interface ProgressState {
  /** 0-100, non-decreasing; undefined until the first real count. */
  value: number | undefined;
  phase: ProgressPhase;
  phaseLabel: string;
  stepLabel: string | undefined;
  /** Package, file or hook currently being processed. */
  item: string;
  /** Pre-transaction hooks must not move the value, so hooks are placed by stage. */
  stage: "pre" | "transaction" | "post";
  fileBytes: Record<string, number>;
  /** libalpm counts removals and installs separately and runs removals first. */
  removeTotal: number;
  /** Discovered AUR packages across dependencies and explicit targets (DAG topological order). */
  aurPackages?: string[];
  /** Completed AUR packages. */
  aurCompleted?: string[];
  /** Total packages discovered from helper dependency headers or pacman counts. */
  aurTotal?: number;
  /** Flag indicating we have entered actual compilation/build phase. */
  aurBuildStarted?: boolean;
}

// Band edges only redistribute real work units; they are design choices, not measured weights.
const DOWNLOAD_END = 40;
const TRANSACTION_END = 95;
const HOOKS_CAP = 99;

function getTransactionLabel(op: string): string {
  switch (op) {
    case "add_start":
      return t("installingPackages");
    case "upgrade_start":
      return t("upgradingPackages");
    case "reinstall_start":
      return t("reinstallingPackages");
    case "downgrade_start":
      return t("downgradingPackages");
    case "remove_start":
      return t("removingPackages");
    default:
      return "";
  }
}

function getCheckLabel(op: string): string {
  switch (op) {
    case "conflicts_start":
      return t("checkConflicts");
    case "diskspace_start":
      return t("checkDiskspace");
    case "integrity_start":
      return t("checkIntegrity");
    case "load_start":
      return t("loadingPackageFiles");
    case "keyring_start":
      return t("checkKeyring");
    default:
      return "";
  }
}

export const initialProgress: ProgressState = {
  value: undefined,
  phase: "preparing",
  phaseLabel: t("preparing"),
  stepLabel: undefined,
  item: "",
  stage: "pre",
  fileBytes: {},
  removeTotal: 0,
};

function raise(prev: number | undefined, next: number): number {
  return prev === undefined ? next : Math.max(prev, next);
}

function isPackageFile(filename: string): boolean {
  return filename.includes(".pkg.tar") && !filename.endsWith(".sig");
}

function downloadEnd(plan: ProgressPlan): number {
  return plan.downloadBytes > 0 ? DOWNLOAD_END : 0;
}

export function reduceProgress(state: ProgressState, event: StreamEvent, plan: ProgressPlan): ProgressState {
  switch (event.type) {
    case "download": {
      const base = {
        ...state,
        phase: "downloading" as const,
        phaseLabel: t("downloadingPackages"),
        item: event.filename,
        stepLabel: undefined,
      };
      if (!isPackageFile(event.filename)) return base;
      const bytes = event.event === "completed" ? event.total : event.downloaded;
      if (bytes === undefined) return base;
      const fileBytes = { ...state.fileBytes, [event.filename]: bytes };
      if (plan.downloadBytes <= 0) return { ...base, fileBytes };
      const done = Object.values(fileBytes).reduce((a, b) => a + b, 0);
      const fraction = Math.min(1, done / plan.downloadBytes);
      return { ...base, fileBytes, value: raise(state.value, fraction * DOWNLOAD_END) };
    }
    case "progress": {
      const check = getCheckLabel(event.operation);
      if (check) {
        const count = event.total > 0 ? ` (${event.current} of ${event.total})` : "";
        return { ...state, stepLabel: `${check}${count}` };
      }
      const label = getTransactionLabel(event.operation);
      if (!label) return state;
      const total = event.total;
      if (total <= 0) return { ...state, phase: "transaction", phaseLabel: label, item: event.package };
      const current = Math.min(Math.max(event.current, 1), total);
      const units = current - 1 + Math.min(Math.max(event.percent, 0), 100) / 100;
      const removing = event.operation === "remove_start";
      const removeTotal = removing ? total : state.removeTotal;
      const fraction = removing
        ? units / (total + plan.packages)
        : (removeTotal + units) / (removeTotal + total);
      const start = downloadEnd(plan);
      return {
        ...state,
        removeTotal,
        phase: "transaction",
        phaseLabel: label,
        item: event.package,
        stepLabel: `${current} of ${total}`,
        value: raise(state.value, start + fraction * (TRANSACTION_END - start)),
      };
    }
    case "event": {
      if (event.event === "transaction_start") return { ...state, stage: "transaction" };
      if (event.event === "transaction_done") return { ...state, stage: "post" };
      if (event.event !== "hook_run_start" && event.event !== "hook_run_done") return state;
      const post = state.stage === "post";
      const { current, total } = event;
      const known = current !== undefined && total !== undefined && total > 0;
      const next: ProgressState = {
        ...state,
        phase: "hooks",
        phaseLabel: post ? t("postTransactionHooks") : t("preTransactionHooks"),
        item: event.package ?? "",
        stepLabel: known ? `Running hook ${current} of ${total}` : undefined,
      };
      if (!post) return next;
      if (!known) return { ...next, value: raise(state.value, TRANSACTION_END) };
      const finished = event.event === "hook_run_done" ? current : current - 1;
      const computed = TRANSACTION_END + (finished / total) * (100 - TRANSACTION_END);
      return { ...next, value: raise(state.value, Math.min(computed, HOOKS_CAP)) };
    }
    case "complete":
      return event.success ? { ...state, value: 100 } : state;
    default:
      return state;
  }
}

/** Integer percent for display; floor keeps it monotonic with the raw value. */
export function progressPercent(state: ProgressState): number | undefined {
  return state.value === undefined ? undefined : Math.floor(state.value);
}

/** Spoken form, e.g. "42 percent, Upgrading packages, 5 of 12". */
export function progressValueText(state: ProgressState): string {
  const percent = progressPercent(state);
  return [percent === undefined ? undefined : `${percent} percent`, state.phaseLabel, state.stepLabel]
    .filter(Boolean)
    .join(", ");
}

/** Parses AUR helper log output to track package-level progress and remaining items. */
export function reduceAurProgress(
  state: ProgressState,
  line: string,
  totalPackages: number,
  aurPackageList?: string[]
): ProgressState {
  const trimmed = line.trim();
  if (!trimmed) return state;

  let aurPackages = state.aurPackages?.length
    ? [...state.aurPackages]
    : aurPackageList?.length
    ? [...aurPackageList]
    : [];
  let aurCompleted = state.aurCompleted ? [...state.aurCompleted] : [];
  let aurTotal = state.aurTotal ?? Math.max(totalPackages, aurPackages.length);
  let aurBuildStarted = state.aurBuildStarted ?? false;
  let currentItem = state.item || (aurPackages.length > 0 ? aurPackages[0] : "");

  // 1. Discover additional dependencies from helper headers if graph was not pre-resolved
  const depsMatch = trimmed.match(/::\s*(\d+)\s+dependencies\s+will\s+also\s+be\s+installed/i);
  if (depsMatch) {
    const depsCount = parseInt(depsMatch[1], 10);
    aurTotal = Math.max(aurTotal, depsCount + (aurPackageList?.length ?? totalPackages));
  }

  const upgMatch = trimmed.match(/::\s*(\d+)\s+packages\s+to\s+upgrade\/install/i);
  if (upgMatch) {
    aurTotal = Math.max(aurTotal, parseInt(upgMatch[1], 10));
  }

  // 2. Discover package names from SRCINFO or helper lists if missing
  const srcInfoMatch = trimmed.match(/::\s*\((\d+)\/(\d+)\)\s+Parsing\s+SRCINFO:\s*([a-zA-Z0-9@._+-]+)/i);
  if (srcInfoMatch) {
    const pkg = srcInfoMatch[3];
    if (pkg && !aurPackages.includes(pkg)) aurPackages.unshift(pkg);
    aurTotal = Math.max(aurTotal, parseInt(srcInfoMatch[2], 10), aurPackages.length);
  }

  const helperPkgMatch = trimmed.match(/(?:^|\s)aur\/([a-zA-Z0-9@._+-]+)/i);
  if (helperPkgMatch) {
    const pkg = helperPkgMatch[1];
    if (pkg && !aurPackages.includes(pkg)) aurPackages.unshift(pkg);
    aurTotal = Math.max(aurTotal, aurPackages.length);
  }

  // 3. Detect transitions to download / preparation vs real build phase
  if (
    /==>\s*(?:Retrieving sources|Отримання джерел|Получение исходных)|::\s*(?:Searching AUR|Downloaded PKGBUILD|Parsing SRCINFO)/i.test(trimmed)
  ) {
    aurBuildStarted = false;
  } else if (
    /==>\s*(?:Checking (?:runtime|buildtime) dependencies|Starting (?:prepare|build|check|package)|Extracting sources|Entering fakeroot environment|Finished making|Перевірка залежностей|Початок складання|Начало сборки|Створення пакунка завершено)/i.test(trimmed) ||
    /^(?:->\s*)?Building\s+[a-zA-Z0-9@._+-]+/i.test(trimmed)
  ) {
    aurBuildStarted = true;
  }

  // 4. Detect makepkg / helper making package
  const makingMatch = trimmed.match(
    /(?:==>\s*(?:Making package|Створення пакунка|Создание пакета)|(?:->\s*)?Building)[:\s]+([a-zA-Z0-9@._+-]+)/i
  );
  if (makingMatch) {
    const pkg = makingMatch[1];
    if (!aurPackages.includes(pkg)) {
      aurPackages.push(pkg);
    }
    // If a package is being made again, remove from completed
    aurCompleted = aurCompleted.filter((p) => p !== pkg);

    // If build has started and we are moving to another package, mark previous completed
    if (aurBuildStarted && currentItem && currentItem !== pkg && !aurCompleted.includes(currentItem)) {
      aurCompleted.push(currentItem);
    }

    currentItem = pkg;

    if (state.aurBuildStarted === undefined) {
      aurBuildStarted = true;
    }
  }

  // 5. Detect finished package build
  const finishedMatch = trimmed.match(
    /==>\s*(?:Finished making|Створення пакунка завершено|Создание пакета завершено)[:\s]+([a-zA-Z0-9@._+-]+)/i
  );
  if (finishedMatch) {
    const pkg = finishedMatch[1];
    if (!aurCompleted.includes(pkg)) {
      aurCompleted.push(pkg);
    }
  }

  // 6. Detect pacman installation
  const countMatch = trimmed.match(
    /\((\d+)\/(\d+)\)\s+(?:upgrading|installing|reinstalling|оновлення|встановлення|перевстановлення|обновление|установка|переустановка)\s+([a-zA-Z0-9@._+-]+)/i
  );
  if (countMatch) {
    aurBuildStarted = true;
    aurTotal = Math.max(aurTotal, parseInt(countMatch[2], 10), aurPackages.length);
    const pkg = countMatch[3];
    if (pkg) {
      currentItem = pkg;
      if (!aurCompleted.includes(pkg)) aurCompleted.push(pkg);
    }
  } else {
    const pacmanSingle = trimmed.match(
      /^(?:upgrading|installing|reinstalling|оновлення|встановлення|обновление|установка)\s+([a-zA-Z0-9@._+-]+)(?:\.\.\.|$)/i
    );
    if (pacmanSingle && pacmanSingle[1]) {
      aurBuildStarted = true;
      currentItem = pacmanSingle[1];
    }
  }

  // Total packages bound to DAG
  const total = Math.max(aurTotal, aurPackages.length, aurPackageList?.length ?? 0, 1);

  // Active index calculated cleanly from DAG progress
  let activeIndex = 1;
  if (countMatch) {
    activeIndex = parseInt(countMatch[1], 10);
  } else if (aurCompleted.length > 0) {
    activeIndex = Math.min(total, aurCompleted.length + 1);
  } else if (currentItem && aurPackages.includes(currentItem)) {
    activeIndex = Math.max(1, aurPackages.indexOf(currentItem) + 1);
  }

  const remaining = Math.max(1, total - aurCompleted.length);

  let phaseLabel = "";
  let stepLabel = "";
  let percent = 0;

  if (!aurBuildStarted) {
    phaseLabel = t("preparingAurQueued", { total });
    stepLabel = currentItem
      ? t("preparingAurSources", { pkg: currentItem })
      : `${total} packages queued (${remaining} remaining)`;
    percent = Math.min(15, Math.round(5 + (aurPackages.length / total) * 10));
  } else {
    phaseLabel = t("upgradingAurPackages", { current: activeIndex, total });
    stepLabel = t("aurPackageProgress", { current: activeIndex, total, remaining });
    percent = Math.min(99, Math.round(((activeIndex - 0.5) / total) * 100));
  }

  return {
    ...state,
    phase: "aur",
    phaseLabel,
    stepLabel,
    item: currentItem,
    value: raise(state.value, percent),
    aurPackages,
    aurCompleted,
    aurTotal: total,
    aurBuildStarted,
  };
}

/** Folds multiple lines of AUR helper log output into a single updated ProgressState. */
export function foldAurProgress(
  base: ProgressState,
  logChunk: string,
  totalPackages: number,
  aurPackageList?: string[]
): ProgressState {
  let next = base;
  for (const line of logChunk.split("\n")) {
    if (line.trim()) {
      next = reduceAurProgress(next, line, totalPackages, aurPackageList);
    }
  }
  return next;
}
