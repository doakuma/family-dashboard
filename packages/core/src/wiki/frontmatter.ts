// 평평한(key: value 한 단계) 프론트매터만 다룬다. 위키 형식이 그렇게 정해져 있다.

export type Frontmatter = Record<string, string>;

const FM = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

export function parseFrontmatter(text: string): { data: Frontmatter; body: string } | null {
  const src = text.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  const m = FM.exec(src);
  if (!m) return null;
  const data: Frontmatter = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    data[key] = value;
  }
  return { data, body: src.slice(m[0].length) };
}

/** 한 줄에 못 담는 값(줄바꿈·제어문자)이나 읽을 때 달라지는 값(앞뒤 공백·따옴표 감쌈)은 거부한다. */
function assertSafe(key: string, value: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`프론트매터 키가 올바르지 않아요: ${key}`);
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) throw new Error(`프론트매터 값에 줄바꿈·제어문자를 쓸 수 없어요: ${key}`);
  if (value !== value.trim() || /^(["']).*\1$/.test(value)) throw new Error(`프론트매터 값 형식이 올바르지 않아요: ${key}`);
}

export function stringifyFrontmatter(data: Record<string, string | number | undefined>, body = ""): string {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => {
      assertSafe(k, String(v));
      return `${k}: ${v}`;
    });
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body}` : ""}`;
}

/**
 * 프론트매터의 키 몇 개만 바꾼 새 글을 돌려준다. 나머지 줄(모르는 키·주석·순서)과 본문, 앞의 주석(`<!-- -->`)·줄바꿈 방식(LF/CRLF)은 그대로 둔다.
 * 값이 undefined면 그 키의 줄을 지운다. 없는 키는 프론트매터 끝에 더한다. 프론트매터가 없으면 null.
 * 값은 stringifyFrontmatter와 같은 규칙으로 검사한다(줄바꿈·제어문자·앞뒤 공백·따옴표 감쌈은 오류).
 */
export function updateFrontmatterValues(text: string, updates: Record<string, string | number | undefined>): string | null {
  const m = /^(\s*<!--[\s\S]*?-->\s*)?---(\r?\n)([\s\S]*?)(\r?\n)---/.exec(text);
  if (!m) return null;
  const eol = m[2] ?? "\n";
  const lines = (m[3] ?? "").split(/\r?\n/);
  for (const [key, raw] of Object.entries(updates)) {
    const value = raw === undefined ? undefined : String(raw);
    if (value !== undefined) assertSafe(key, value);
    // parseFrontmatter는 같은 키가 여러 번이면 마지막 값을 쓰므로 마지막 줄을 고친다
    let at = -1;
    lines.forEach((l, idx) => {
      const t = l.trim();
      const i = t.indexOf(":");
      if (!t.startsWith("#") && i > 0 && t.slice(0, i).trim() === key) at = idx;
    });
    if (value === undefined || value === "") {
      if (at >= 0) lines.splice(at, 1);
    } else if (at >= 0) lines[at] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  }
  const head = `${m[1] ?? ""}---${eol}`;
  return `${head}${lines.join(eol)}${m[4] ?? "\n"}---${text.slice(m[0].length)}`;
}
