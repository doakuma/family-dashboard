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
