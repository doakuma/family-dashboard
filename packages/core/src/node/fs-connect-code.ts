// ConnectCodeStore의 파일 구현(Node 전용). 대시보드와 봇이 같은 폴더(HSH_STATE_DIR)를 보며 코드를 주고받는다. 위키 레포 안에 두지 않는다(결정 0007).
//
// 폴더: <dir>/connect/<코드>.json (발급 기록) · <코드>.claim.json (연결 기록: slackId)
// 쓰기: 임시 파일에 다 쓴 뒤 link(2)로 최종 이름을 만든다. rename과 같이 내용이 반쯤 쓰인 파일이 보이지 않고,
//       rename과 달리 이미 있으면 EEXIST로 실패해서 "배타 생성"이 된다(사용 처리·코드 중복 방지가 프로세스 사이에서도 한 번만 성공).
import { randomInt } from "node:crypto";
import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  CONNECT_CLAIM_TTL_MS,
  CONNECT_CODE_TTL_MS,
  CONNECT_MAX_ACTIVE,
  ConnectStoreError,
  generateConnectCode,
  isConnectCode,
  isExpired,
  type ClaimResult,
  type ClaimedCode,
  type ConnectCodeRecord,
  type ConnectCodeState,
  type ConnectCodeStore,
  type ConnectScope,
  type IssueInput,
} from "../connect-code";

const recordSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  memberKey: z.string().min(1).max(40),
  name: z.string().min(1).max(100),
  role: z.enum(["guardian", "child"]),
  scope: z.enum(["setup"]),
  issuedAt: z.string(),
  expiresAt: z.string(),
});
const claimSchema = z.object({ slackId: z.string().regex(/^[A-Za-z0-9]+$/), claimedAt: z.string() });
type Claim = z.infer<typeof claimSchema>;

export interface FsConnectCodeStoreOptions {
  /** 상태 폴더(HSH_STATE_DIR). 안에 connect/ 가 만들어진다 */
  dir: string;
  now?: () => Date;
  /** [0, max) 정수. 기본 crypto.randomInt */
  random?: (max: number) => number;
  /** 정리하다 지우지 못한 파일 같은 비치명적 문제를 남길 곳(기본 console.warn) */
  warn?: (message: string) => void;
}

/** 임시 파일이 이 시간보다 오래되면 죽은 프로세스가 남긴 것으로 보고 지운다 */
const STALE_TMP_MS = 60_000;

const isNotFound = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
const isBusy = (e: unknown) => ["EPERM", "EBUSY"].includes((e as NodeJS.ErrnoException | undefined)?.code ?? "");
const isExists = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code === "EEXIST";

export class FsConnectCodeStore implements ConnectCodeStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly random: (max: number) => number;
  private readonly warn: (message: string) => void;
  private seq = 0;

  constructor(opts: FsConnectCodeStoreOptions) {
    this.dir = join(opts.dir, "connect");
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? ((max) => randomInt(max));
    this.warn = opts.warn ?? ((m) => console.warn(`[connect] ${m}`));
  }

  private recordPath = (code: string) => join(this.dir, `${code}.json`);
  private claimPath = (code: string) => join(this.dir, `${code}.claim.json`);

  /** 임시 파일에 쓰고 link로 최종 이름을 만든다. 이미 있으면 false */
  private async createExclusive(path: string, data: unknown): Promise<boolean> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = join(this.dir, `.tmp-${process.pid}-${Date.now()}-${this.seq++}-${randomInt(1e9)}`);
    await writeFile(tmp, JSON.stringify(data), { flag: "wx", mode: 0o600 });
    try {
      // Windows(NTFS)에서는 백신·인덱서가 파일을 잠시 잡아 EPERM/EBUSY가 날 수 있어 한 번 다시 시도한다
      try {
        await link(tmp, path);
      } catch (e) {
        if (!isBusy(e)) throw e;
        await new Promise((r) => setTimeout(r, 50));
        await link(tmp, path);
      }
      return true;
    } catch (e) {
      if (isExists(e)) return false;
      throw e;
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  private async readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
    try {
      const r = schema.safeParse(JSON.parse(text));
      return r.success ? r.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async remove(code: string): Promise<void> {
    for (const p of [this.recordPath(code), this.claimPath(code)]) await unlink(p).catch((e: unknown) => { if (!isNotFound(e)) throw e; });
  }

  /** 폴더의 코드 목록(기록·연결 파일 이름에서) */
  private async codesOnDisk(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
    return [...new Set(names.flatMap((n) => { const m = /^(\d{6})(?:\.claim)?\.json$/.exec(n); return m?.[1] ? [m[1]] : []; }))];
  }

  private async load(code: string): Promise<{ record?: ConnectCodeRecord; claim?: Claim }> {
    const [record, claim] = await Promise.all([this.readJson(this.recordPath(code), recordSchema), this.readJson(this.claimPath(code), claimSchema)]);
    return { record, claim };
  }

  /** 연결 전 코드는 expiresAt, 연결된 코드는 claim 시각 + CLAIM_TTL 이 지나면 쓸 수 없다 */
  private alive(e: { record?: ConnectCodeRecord; claim?: Claim }): boolean {
    if (!e.record) return false;
    const now = this.now();
    if (e.claim) return !isExpired(new Date(Date.parse(e.claim.claimedAt) + CONNECT_CLAIM_TTL_MS).toISOString(), now);
    return !isExpired(e.record.expiresAt, now);
  }

  /** 만료·깨진·짝 없는 파일을 지우고, 살아 있는 항목을 돌려준다 */
  private async sweep(): Promise<{ code: string; record: ConnectCodeRecord; claim?: Claim }[]> {
    const live: { code: string; record: ConnectCodeRecord; claim?: Claim }[] = [];
    for (const code of await this.codesOnDisk()) {
      // 한 코드를 읽거나 지우지 못해도(Windows 파일 잠금, 깨진 항목 등) 로그만 남기고 건너뛴다: 발급·claim을 막지 않는다
      try {
        const e = await this.load(code);
        if (e.record && this.alive(e)) live.push({ code, record: e.record, claim: e.claim });
        else await this.remove(code);
      } catch (err) {
        this.warn(`연결 코드 ${code} 정리를 건너뛰었어요: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await this.sweepTmp();
    return live;
  }

  /** 죽은 프로세스가 남긴 오래된 임시 파일 정리 */
  private async sweepTmp(): Promise<void> {
    try {
      for (const n of await readdir(this.dir)) {
        if (!n.startsWith(".tmp-")) continue;
        const path = join(this.dir, n);
        const st = await stat(path).catch(() => undefined);
        if (st && Date.now() - st.mtimeMs > STALE_TMP_MS) await unlink(path).catch(() => {});
      }
    } catch (e) {
      if (!isNotFound(e)) this.warn(`임시 파일 정리 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async issue(input: IssueInput): Promise<ConnectCodeRecord> {
    const scope: ConnectScope = input.scope ?? "setup";
    const live = await this.sweep();
    // 같은 구성원의 이전 코드는 연결 기록까지 무효
    for (const e of live) if (e.record.scope === scope && e.record.memberKey === input.memberKey) await this.remove(e.code);
    const keep = live.filter((e) => !(e.record.scope === scope && e.record.memberKey === input.memberKey));
    if (keep.filter((e) => e.record.scope === scope).length >= CONNECT_MAX_ACTIVE) throw new ConnectStoreError("활성 연결 코드가 너무 많아요", "too_many");

    const taken = new Set(keep.map((e) => e.code));
    const now = this.now();
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateConnectCode(this.random, taken);
      if (!code) break;
      const record: ConnectCodeRecord = {
        code,
        memberKey: input.memberKey,
        name: input.name,
        role: input.role,
        scope,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS).toISOString(),
      };
      if (await this.createExclusive(this.recordPath(code), record)) return record;
      taken.add(code); // 다른 프로세스가 먼저 만들었다
    }
    throw new Error("연결 코드를 만들지 못했어요");
  }

  async claim(code: string, slackId: string): Promise<ClaimResult> {
    const invalid = { ok: false, reason: "invalid" } as const;
    if (!isConnectCode(code) || !/^[A-Za-z0-9]+$/.test(slackId)) return invalid;
    const e = await this.load(code);
    if (!e.record || !this.alive(e)) return invalid;
    if (e.claim) return e.claim.slackId === slackId ? { ok: false, reason: "already_yours", name: e.record.name } : invalid;

    // 같은 슬랙 계정이 같은 세팅에서 이미 다른 구성원으로 연결됐는가 (동시에 두 코드를 보내는 경우는 마법사 완료가 한 번 더 막는다)
    for (const other of await this.sweep()) {
      if (other.code === code || !other.claim || other.record.scope !== e.record.scope) continue;
      if (other.claim.slackId === slackId && other.record.memberKey !== e.record.memberKey) return { ok: false, reason: "slack_taken", name: other.record.name };
    }
    const claim: Claim = { slackId, claimedAt: this.now().toISOString() };
    // 배타 생성: 두 프로세스·두 번 DM이 겹쳐도 한 번만 성공한다
    if (!(await this.createExclusive(this.claimPath(code), claim))) return invalid;
    // 그 사이 재발급·revoke로 기록이 사라졌으면 연결은 없던 일(짝 없는 연결 기록은 지운다)
    const after = await this.readJson(this.recordPath(code), recordSchema);
    if (!after || after.issuedAt !== e.record.issuedAt) {
      await unlink(this.claimPath(code)).catch(() => {});
      return invalid;
    }
    return { ok: true, record: e.record };
  }

  async revoke(code: string, opts?: { unclaimedOnly?: boolean }): Promise<void> {
    if (!isConnectCode(code)) return;
    if (opts?.unclaimedOnly && (await this.readJson(this.claimPath(code), claimSchema))) return;
    await this.remove(code);
  }

  async states(codes: readonly string[]): Promise<Record<string, ConnectCodeState>> {
    const out: Record<string, ConnectCodeState> = {};
    for (const code of codes) {
      if (!isConnectCode(code)) {
        out[code] = "expired";
        continue;
      }
      const e = await this.load(code);
      out[code] = !this.alive(e) ? "expired" : e.claim ? "connected" : "pending";
    }
    return out;
  }

  async claimed(code: string): Promise<ClaimedCode | undefined> {
    if (!isConnectCode(code)) return undefined;
    const e = await this.load(code);
    return e.record && e.claim && this.alive(e) ? { record: e.record, slackId: e.claim.slackId } : undefined;
  }

  async clearScope(scope: ConnectScope): Promise<void> {
    for (const code of await this.codesOnDisk()) {
      const { record } = await this.load(code);
      // 기록이 없거나 깨진 파일도 같이 정리한다
      if (!record || record.scope === scope) await this.remove(code);
    }
  }
}
