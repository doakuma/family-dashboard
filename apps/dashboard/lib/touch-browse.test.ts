import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 달력 보기 터치의 구조 기준을 소스에서 확인한다(결정 0006). 실제 동작은 e2e/touch.e2e.mjs.
const appDir = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(appDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자 하나의 선언 본문 */
function block(css: string, selector: string): string {
  const m = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(css);
  return m?.[1] ?? "";
}

describe("터치 영역 최소 48px", () => {
  const cal = read("components/widgets/MonthCalendar.module.css");
  const sheet = read("components/widgets/DaySheet.module.css");
  it("‹ › 버튼", () => {
    expect(block(cal, ".navBtn")).toMatch(/min-width:\s*48px/);
    expect(block(cal, ".navBtn")).toMatch(/min-height:\s*48px/);
  });
  it("시트 안 항목·닫기·목록으로 (.close, .back, .item은 한 규칙을 공유)", () => {
    expect(sheet).toMatch(/\.close,\s*\.back,\s*\.item\s*\{[^}]*min-height:\s*48px/);
  });
});

describe("키오스크 제스처 차단 (태블릿 표식이 있을 때만)", () => {
  const css = read("app/globals.css");
  it("핀치 줌·당겨서 새로고침·뒤로 가기·글자 선택·길게 누르기 메뉴를 CSS로 막는다", () => {
    expect(css).toMatch(/html:has\(\[data-surface="tablet"\]\)[\s\S]*?touch-action:\s*pan-y/);
    expect(css).toMatch(/overscroll-behavior:\s*none/);
    expect(css).toMatch(/user-select:\s*none/);
    expect(css).toMatch(/-webkit-touch-callout:\s*none/);
  });
  it("휴대폰 화면(/setup)에는 걸리지 않는다: 모든 차단 규칙이 tablet 표식 선택자 안에 있다", () => {
    const tail = css.slice(css.indexOf('html:has([data-surface="tablet"])'));
    expect(tail).not.toMatch(/^\s*(body|html|\*)\s*\{/m);
  });
  it("오늘 일정 영역은 pan-y를 유지한다", () => {
    expect(read("components/ui/AutoScroll.module.css")).toMatch(/touch-action:\s*pan-y/);
  });
  it("태블릿 첫 화면(page)만 확대를 막고, 레이아웃(휴대폰 포함)은 확대를 막지 않는다", () => {
    expect(readFileSync(join(appDir, "app/page.tsx"), "utf8")).toMatch(/maximumScale:\s*1,\s*userScalable:\s*false/);
    expect(readFileSync(join(appDir, "app/layout.tsx"), "utf8")).not.toMatch(/userScalable|maximumScale/);
  });
});

describe("터치 반응이 없는 위젯", () => {
  it("체크리스트·날씨·다가오는 날·오늘 일정 목록에는 클릭 핸들러가 없다 (오늘 일정은 자동 넘김 버튼 하나만 예외)", () => {
    for (const f of ["Checklist", "WeatherStrip", "DdayList"]) {
      const src = readFileSync(join(appDir, `components/widgets/${f}.tsx`), "utf8");
      expect(src, f).not.toMatch(/onClick|<button|role="button"|tabIndex/);
    }
    const agenda = readFileSync(join(appDir, "components/widgets/TodayAgenda.tsx"), "utf8");
    expect(agenda.match(/<button/g)).toHaveLength(1);
  });
});
