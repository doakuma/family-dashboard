import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Event } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { DDAY_SOON_DAYS, LIMITS, STALE_AFTER_MS, isNight, isPast, isSoon, isStale, limit, orderAgenda } from "./view";

describe("isNight", () => {
  it("23:00부터 05:59까지가 야간", () => {
    expect(isNight("22:59")).toBe(false);
    expect(isNight("23:00")).toBe(true);
    expect(isNight("23:59")).toBe(true);
    expect(isNight("00:00")).toBe(true);
    expect(isNight("05:59")).toBe(true);
    expect(isNight("06:00")).toBe(false);
    expect(isNight("12:00")).toBe(false);
  });
});

describe("isSoon (D-day 강조 경계)", () => {
  it("기준은 30일, 30일은 강조·31일은 아님, 오늘(0)은 강조", () => {
    expect(DDAY_SOON_DAYS).toBe(30);
    expect(isSoon(0)).toBe(true);
    expect(isSoon(29)).toBe(true);
    expect(isSoon(30)).toBe(true);
    expect(isSoon(31)).toBe(false);
  });
});

describe("isStale", () => {
  const updatedAt = "2026-11-03T01:00:00Z";
  const at = (ms: number) => new Date(Date.parse(updatedAt) + ms);

  it("3분 이내는 정상, 정확히 3분도 정상, 넘으면 경고", () => {
    expect(isStale({ offline: false, now: at(0), updatedAt })).toBe(false);
    expect(isStale({ offline: false, now: at(STALE_AFTER_MS), updatedAt })).toBe(false);
    expect(isStale({ offline: false, now: at(STALE_AFTER_MS + 1), updatedAt })).toBe(true);
  });

  it("폴링이 실패한 상태면 시간과 상관없이 경고", () => {
    expect(isStale({ offline: true, now: at(0), updatedAt })).toBe(true);
  });
});

describe("위젯 개수 제한", () => {
  const nums = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("상한 이하면 그대로, 넘으면 나머지는 more로", () => {
    expect(limit(nums(3), 6)).toEqual({ shown: [0, 1, 2], more: 0 });
    expect(limit(nums(6), LIMITS.checklist)).toMatchObject({ more: 0 });
    const r = limit(nums(8), LIMITS.checklist);
    expect(r.shown).toHaveLength(6);
    expect(r.more).toBe(2);
  });

  it("스펙 값: 체크리스트 6, 다가오는 날 5, 달력 칸 2 (오늘 일정은 상한 없이 자동 순환)", () => {
    expect(LIMITS).toEqual({ checklist: 6, dday: 5, calendarCell: 2 });
  });
});

describe("오늘 일정 순서", () => {
  const ev = (id: string, start: string | undefined, o: Partial<Event> = {}): Event => ({
    id: `evt-${id}`,
    date: "2026-11-03",
    start,
    allDay: !start,
    title: id,
    members: ["mom"],
    done: false,
    ...o,
  });

  it("남은 일정이 먼저 시간순, 지난 일정은 그 아래", () => {
    const events = [ev("a", "08:00", { end: "09:00" }), ev("c", "18:00"), ev("b", "14:00"), ev("d", "10:00"), ev("x", "09:00", { date: "2026-11-04" })];
    const { upcoming, past } = orderAgenda(events, "2026-11-03", "12:00");
    expect(upcoming.map((e) => e.title)).toEqual(["b", "c"]);
    expect(past.map((e) => e.title)).toEqual(["a", "d"]);
  });

  it("종일 일정은 하루 내내 남은 일정(맨 앞), 완료한 일정은 지난 일정", () => {
    const events = [ev("t", "13:00"), ev("day", undefined), ev("done", "15:00", { done: true })];
    const { upcoming, past } = orderAgenda(events, "2026-11-03", "12:00");
    expect(upcoming.map((e) => e.title)).toEqual(["day", "t"]);
    expect(past.map((e) => e.title)).toEqual(["done"]);
  });

  it("지난 일정: 끝 시각(없으면 시작)이 지금보다 앞이어야 지난 것", () => {
    expect(isPast({ done: false, allDay: false, start: "11:00", end: "12:00" }, "12:00")).toBe(false);
    expect(isPast({ done: false, allDay: false, start: "11:00", end: "12:00" }, "12:01")).toBe(true);
    expect(isPast({ done: false, allDay: false, start: "12:00" }, "12:00")).toBe(false);
  });

  it("상한이 없다: 8건도 전부 나온다", () => {
    const events = Array.from({ length: 8 }, (_, i) => ev(`e${i}`, `${String(9 + i).padStart(2, "0")}:00`));
    const { upcoming, past } = orderAgenda(events, "2026-11-03", "00:00");
    expect(upcoming).toHaveLength(8);
    expect(past).toHaveLength(0);
  });
});

// ---- 명암비: 글자에 쓰는 색은 4.5:1 이상 (실제 CSS에서 글자색 토큰을 모아 검사, 투명도도 반영) ----
const appDir = join(import.meta.dirname, "..");
const globalsCss = readFileSync(join(appDir, "app/globals.css"), "utf8");
const cssFiles = ["components", "components/widgets", "components/ui", "components/ui/form", "components/setup"].flatMap((d) =>
  readdirSync(join(appDir, d))
    .filter((n) => n.endsWith(".css"))
    .map((n) => ({ name: n, path: join(d, n), text: readFileSync(join(appDir, d, n), "utf8") })),
);

function tokens(block: string) {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const day = tokens(/:root\s*{([^}]*)}/.exec(globalsCss)?.[1] ?? "");
const dim = { ...day, ...tokens(/\[data-tone="dim"\]\s*{([^}]*)}/.exec(globalsCss)?.[1] ?? "") };
const tones = [["낮", day], ["어두운 톤", dim]] as const;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function lum(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
/** 투명도 alpha로 bg 위에 올린 fg의 실제 색 */
function over(fg: string, bg: string, alpha: number) {
  const [f, b] = [rgb(fg), rgb(bg)];
  return `#${f.map((v, i) => Math.round(v * alpha + (b[i] ?? 0) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

/** CSS 규칙 [{file, selector, body}] */
const rules = cssFiles.flatMap((f) => [...f.text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ file: f.name, selector: (m[1] ?? "").trim().replace(/\s+/g, " "), body: m[2] ?? "" })));
const textColor = /(^|[\s;])color:\s*([^;]+);/g;

describe("명암비", () => {
  const used = new Set<string>();
  const hardcoded: string[] = [];
  for (const r of rules) {
    for (const m of r.body.matchAll(textColor)) {
      const v = (m[2] ?? "").trim();
      const t = /^var\(--([a-z-]+)\)$/.exec(v);
      if (t) used.add(t[1] ?? "");
      else hardcoded.push(`${r.file} ${r.selector}: color: ${v}`);
    }
  }

  it("글자색은 토큰만 쓴다 (하드코딩 색 금지)", () => {
    expect(hardcoded).toEqual([]);
  });

  it("글자로 쓰이는 토큰을 실제로 찾았다 (검사 대상이 빠지지 않게)", () => {
    for (const t of ["ink", "muted", "warn", "text-sunday", "text-saturday", "text-precip", "sheet"]) expect([...used], t).toContain(t);
    expect(used.has("faint"), "--faint는 장식 전용").toBe(false);
  });

  // 글자색으로 쓰이는 토큰을 순회한다(스킨이 늘면 tones에 스킨별 토큰 집합만 더하면 된다). sheet는 ink 바탕 위 글자라 따로 검사.
  const textTokens = [...used].filter((u) => u !== "sheet");
  for (const [name, t] of tones) {
    for (const fg of textTokens) {
      for (const bg of ["paper", "sheet"] as const) {
        it(`${name}: ${fg} on ${bg} >= 4.5`, () => {
          expect(ratio(t[fg] ?? "", t[bg] ?? "")).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${name}: 오늘 날짜 숫자(--sheet 글자 on --ink 바탕) >= 4.5`, () => {
      expect(ratio(t.sheet ?? "", t.ink ?? "")).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("장식용 --faint는 글자색으로 쓰지 않는다", () => {
    expect(rules.filter((r) => /(^|[\s;])color:\s*var\(--faint\)/.test(r.body))).toEqual([]);
  });
});

// opacity가 글자 위에 걸리면 실제 명암비가 떨어진다. 투명도 규칙은 모두 여기에 등록하고 계산한다(새 규칙을 추가하면 이 표를 채워야 통과).
const OPACITY_CASES: { file: string; selector: string; tone: "day" | "dim"; fg: string[]; bg: string[]; exempt?: string }[] = [
  { file: "NightView.module.css", selector: ".night", tone: "dim", fg: ["ink", "muted", "warn"], bg: ["paper"] }, // 야간 화면에 실제로 쓰이는 글자색
  {
    file: "MonthCalendar.module.css",
    selector: ".cell[data-past]:not([data-other]) .event",
    tone: "day",
    fg: ["ink"],
    bg: ["sheet"],
    exempt: "오너 결정 2026-10-30: 지난 일정은 의도적으로 흐림",
  },
  {
    file: "TodayAgenda.module.css",
    selector: ".item[data-past]",
    tone: "day",
    fg: ["muted"],
    bg: ["paper"],
    exempt: "오너 결정 2026-10-30: 지난 일정은 의도적으로 흐림",
  },
  {
    file: "MonthCalendar.module.css",
    selector: ".cell[data-other] .num, .cell[data-other] .event",
    tone: "day",
    fg: ["ink"],
    bg: ["sheet"],
    exempt: "다른 달 칸은 일부러 가장 흐리게(참고용 날짜). 오너 확인 대상",
  },
];

describe("투명도(opacity)를 반영한 명암비", () => {
  const found = rules.flatMap((r) => {
    const m = /(?:^|[\s;])opacity:\s*([\d.]+)\s*;/.exec(r.body);
    return m && Number(m[1]) < 1 ? [{ ...r, opacity: Number(m[1]) }] : [];
  });

  it("글자 위에 걸린 투명도 규칙이 모두 등록되어 있다", () => {
    const registered = new Set(OPACITY_CASES.map((c) => `${c.file}|${c.selector}`));
    const unknown = found.filter((f) => !registered.has(`${f.file}|${f.selector}`)).map((f) => `${f.file} ${f.selector}: opacity ${f.opacity}`);
    expect(unknown).toEqual([]);
  });

  for (const c of OPACITY_CASES) {
    const rule = found.find((f) => f.file === c.file && f.selector === c.selector);
    it(`${c.file} ${c.selector}`, () => {
      expect(rule, "표에 있는 규칙이 CSS에서 사라졌어요").toBeDefined();
      const t = c.tone === "dim" ? dim : day;
      for (const fg of c.fg) {
        for (const bg of c.bg) {
          const effective = ratio(over(t[fg] ?? "", t[bg] ?? "", rule?.opacity ?? 1), t[bg] ?? "");
          if (c.exempt) expect(effective).toBeGreaterThan(1); // 등록만 하고 면제(사유는 표에)
          else expect(effective, `${fg} on ${bg} @${rule?.opacity}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
