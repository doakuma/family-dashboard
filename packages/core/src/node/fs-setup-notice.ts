// SetupNoticeStore의 파일 구현(Node 전용). 연결 코드(fs-connect-code.ts)와 같은 상태 폴더(HSH_STATE_DIR) 아래 notice/ 를 쓴다. 위키 레포 안에 두지 않는다(결정 0008).
//
// 폴더: <dir>/notice/<id>.json (알림) · <id>.claim-<n>.json (n번째 처리 권한) · <id>.claim-<n>.released (n번째 권한 반납) · <id>.done (게시 끝)
// 쓰기: 임시 파일에 다 쓴 뒤 link(2)로 최종 이름을 만든다(0007과 같은 이유: 반쯤 쓴 파일이 안 보이고, 이미 있으면 EEXIST라 배타 생성).
//       claim은 번호를 올려 가며 배타 생성한다: 두 프로세스가 동시에 이어받으려 해도 같은 번호를 만드는 쪽은 하나뿐이다.
import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { asFamilyId } from "../types";
import { SETUP_NOTICE_LEASE_MS, SETUP_NOTICE_TTL_MS, type SetupNotice, type SetupNoticeInput, type SetupNoticeStore } from "../setup-notice";

const ID_RE = /^[0-9a-f]{32}$/;
const noticeSchema = z.object({ id: z.string().regex(ID_RE), familyId: z.string().transform((v, ctx) => { try { return asFamilyId(v); } catch { ctx.addIssue({ code: "custom", message: "가족 id 형식" }); return z.NEVER; } }), completedAt: z.string(), version: z.string().max(100) });
const claimSchema = z.object({ claimedAt: z.string() });

export interface FsSetupNoticeStoreOptions {
  /** 상태 폴더(HSH_STATE_DIR). 안에 notice/ 가 만들어진다 */
  dir: string;
  now?: () => Date;
  warn?: (message: string) => void;
}

/** 찌꺼기(알림이 사라진 뒤 남은 claim·done 파일, 죽은 임시 파일)를 이 시간 뒤에 지운다 */
const LEFTOVER_MS = 60 * 60_000;

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;
const isNotFound = (e: unknown) => code(e) === "ENOENT";
const isExists = (e: unknown) => code(e) === "EEXIST";
const isBusy = (e: unknown) => ["EPERM", "EBUSY"].includes(code(e) ?? "");

export class FsSetupNoticeStore implements SetupNoticeStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;
  private seq = 0;

  constructor(opts: FsSetupNoticeStoreOptions) {
    this.dir = join(opts.dir, "notice");
    this.now = opts.now ?? (() => new Date());
    this.warn = opts.warn ?? ((m) => console.warn(`[notice] ${m}`));
  }

  private path = (name: string) => join(this.dir, name);

  /** 임시 파일에 쓰고 link로 최종 이름을 만든다. 이미 있으면 false */
  private async createExclusive(name: string, data: string): Promise<boolean> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = this.path(`.tmp-${process.pid}-${Date.now()}-${this.seq++}-${randomBytes(4).toString("hex")}`);
    await writeFile(tmp, data, { flag: "wx", mode: 0o600 });
    try {
      try {
        await link(tmp, this.path(name));
      } catch (e) {
        if (!isBusy(e)) throw e;
        await new Promise((r) => setTimeout(r, 50)); // Windows: 백신·인덱서가 잠시 잡을 수 있다
        await link(tmp, this.path(name));
      }
      return true;
    } catch (e) {
      if (isExists(e)) return false;
      throw e;
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  private async readText(name: string): Promise<string | undefined> {
    try {
      return await readFile(this.path(name), "utf8");
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  }

  private async readJson<T>(name: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const text = await this.readText(name);
    if (text === undefined) return undefined;
    try {
      const r = schema.safeParse(JSON.parse(text));
      return r.success ? r.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async exists(name: string): Promise<boolean> {
    return (await stat(this.path(name)).catch(() => undefined)) !== undefined;
  }

  private async names(): Promise<string[]> {
    try {
      return await readdir(this.dir);
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }

  async put(input: SetupNoticeInput): Promise<SetupNotice> {
    const notice: SetupNotice = { id: randomBytes(16).toString("hex"), ...input };
    if (!(await this.createExclusive(`${notice.id}.json`, JSON.stringify(notice)))) throw new Error("알림 id가 겹쳤어요");
    return notice;
  }

  async list(): Promise<SetupNotice[]> {
    const out: SetupNotice[] = [];
    for (const n of await this.names()) {
      const m = /^([0-9a-f]{32})\.json$/.exec(n);
      if (!m?.[1] || (await this.exists(`${m[1]}.done`))) continue;
      const notice = await this.readJson(n, noticeSchema);
      if (notice && notice.id === m[1]) out.push(notice);
    }
    return out.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  /** 이 알림의 claim 번호들(오름차순) */
  private async claimNumbers(id: string): Promise<number[]> {
    const re = new RegExp(`^${id}\\.claim-(\\d+)\\.json$`);
    return (await this.names()).flatMap((n) => { const m = re.exec(n); return m?.[1] ? [Number(m[1])] : []; }).sort((a, b) => a - b);
  }

  async claim(id: string): Promise<boolean> {
    if (!ID_RE.test(id)) return false;
    // 지워졌거나 이미 게시한 알림은 처리하지 않는다(목록을 읽은 뒤 다른 봇이 끝냈을 수 있다)
    if (!(await this.exists(`${id}.json`)) || (await this.exists(`${id}.done`))) return false;
    const nums = await this.claimNumbers(id);
    const last = nums.at(-1) ?? 0;
    if (last > 0) {
      // 가장 최근 claim이 반납됐거나 임대 시간이 지났을 때만 이어받는다
      const released = await this.exists(`${id}.claim-${last}.released`);
      const claim = await this.readJson(`${id}.claim-${last}.json`, claimSchema);
      const stale = !claim || Date.parse(claim.claimedAt) + SETUP_NOTICE_LEASE_MS <= this.now().getTime();
      if (!released && !stale) return false;
    }
    // 번호를 하나 올려 배타 생성: 동시에 이어받으려는 다른 프로세스는 EEXIST로 진다
    if (!(await this.createExclusive(`${id}.claim-${last + 1}.json`, JSON.stringify({ claimedAt: this.now().toISOString() })))) return false;
    // 그 사이 다른 봇이 끝냈으면 이번 claim은 없던 일
    if (await this.exists(`${id}.done`)) return false;
    return true;
  }

  async release(id: string): Promise<void> {
    if (!ID_RE.test(id)) return;
    const last = (await this.claimNumbers(id)).at(-1);
    if (last === undefined) return;
    await this.createExclusive(`${id}.claim-${last}.released`, "").catch((e: unknown) => this.warn(`claim 반납 실패: ${e instanceof Error ? e.message : String(e)}`));
  }

  async complete(id: string): Promise<void> {
    if (!ID_RE.test(id)) return;
    // done 표식이 먼저(이후 어떤 claim도 실패). 알림 파일은 그 다음에 지우고, 지우다 실패해도 done 때문에 list에 안 나온다
    await this.createExclusive(`${id}.done`, "");
    await unlink(this.path(`${id}.json`)).catch((e: unknown) => { if (!isNotFound(e)) throw e; });
  }

  async expire(): Promise<string[]> {
    const now = this.now().getTime();
    const expired: string[] = [];
    const names = await this.names();
    const ids = new Set(names.flatMap((n) => { const m = /^([0-9a-f]{32})\./.exec(n); return m?.[1] ? [m[1]] : []; }));
    for (const id of ids) {
      try {
        const notice = await this.readJson(`${id}.json`, noticeSchema);
        const done = await this.exists(`${id}.done`);
        if (notice && !done) {
          // 시각이 깨진 알림도 오래된 것으로 본다
          const at = Date.parse(notice.completedAt);
          if (Number.isFinite(at) && now - at < SETUP_NOTICE_TTL_MS) continue;
          await this.removeAll(id);
          expired.push(id);
          continue;
        }
        // 알림이 없거나(게시 끝) 깨진 항목: 찌꺼기. 하루 가까이 둘 필요는 없고 한 시간 뒤에 지운다
        const newest = await this.newestMtime(id, names);
        if (now - newest > LEFTOVER_MS) await this.removeAll(id);
      } catch (e) {
        this.warn(`알림 ${id} 정리를 건너뛰었어요: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const n of names) {
      if (!n.startsWith(".tmp-")) continue;
      const st = await stat(this.path(n)).catch(() => undefined);
      if (st && now - st.mtimeMs > LEFTOVER_MS) await unlink(this.path(n)).catch(() => {});
    }
    return expired;
  }

  private async newestMtime(id: string, names: string[]): Promise<number> {
    let newest = 0;
    for (const n of names.filter((n) => n.startsWith(`${id}.`))) {
      const st = await stat(this.path(n)).catch(() => undefined);
      if (st) newest = Math.max(newest, st.mtimeMs);
    }
    return newest;
  }

  private async removeAll(id: string): Promise<void> {
    for (const n of (await this.names()).filter((n) => n.startsWith(`${id}.`))) await unlink(this.path(n)).catch((e: unknown) => { if (!isNotFound(e)) throw e; });
  }
}
