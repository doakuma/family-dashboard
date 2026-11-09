// POST /api/settings의 본체: 본문 모양(zod) -> 읽기/발급/조회 -> repo.applySettings -> HTTP 응답으로 번역. (출처·세션·본문 크기는 lib/setup/guard.ts의 guardSettingsJson + route.ts)
// 위키 쓰기는 항상 WikiRepository.applySettings 하나. 슬랙 ID는 서버 안(연결 기록 -> 위키)에서만 돌고 응답에는 연결됨 여부만 나간다.
import { ConnectStoreError, SettingsError, findRegion, isConnectCode, regionToConfigFields, type ConnectCodeState, type ConnectCodeStore, type FamilyId, type SettingsChange, type SettingsIssue, type WikiRepository, type WikiState } from "@hsh/core";
import { z } from "zod";
import { toSettingsView, type SettingsView } from "./view";

export type SettingsBody =
  | {
      ok: true;
      /** 저장됐는가(변경 종류에 따라 없을 수 있음: 코드 받기·상태 조회) */
      saved?: true;
      synced?: boolean;
      syncError?: string;
      /** 변경 뒤 화면 상태. 저장은 됐는데 다시 읽지 못했으면 없다(화면은 이전 상태를 두고 새로고침을 안내) */
      view?: SettingsView;
      /** slack.code: 발급한 코드 */
      code?: string;
      expiresAt?: string;
      /** slack.status: 코드별 상태 */
      states?: Record<string, ConnectCodeState>;
    }
  | { ok: false; code: ErrorCode; message: string; issues?: SettingsIssue[] };

export type ErrorCode = "bad_request" | "invalid" | "not_found" | "conflict" | "needs_setup" | "not_connected" | "too_many" | "read_only" | "failed";

export interface SettingsResult {
  status: 200 | 409 | 422 | 429 | 500 | 503;
  body: SettingsBody;
}

export interface SettingsApiDeps {
  repo: Pick<WikiRepository, "applySettings">;
  read: () => Promise<Pick<WikiState, "config" | "members">>;
  /** 슬랙 연결 코드 저장소. 상태 폴더 설정이 잘못되면 undefined(코드 관련 종류만 503) */
  connect?: Pick<ConnectCodeStore, "issue" | "states" | "claimed" | "revoke">;
  familyId: FamilyId;
  /** 변경 기록 작성자 */
  author?: string;
  log?: (message: string) => void;
}

const memberId = z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/);
const code = z.string().refine(isConnectCode);

/** 종류마다 본문이 다르다. 여분 필드는 거부(strict) - 특히 slackId·slack_id를 받지 않는다 */
const bodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("member.add"), name: z.string(), role: z.enum(["guardian", "child"]), color: z.string() }),
  z.strictObject({ kind: z.literal("member.color"), id: memberId, color: z.string() }),
  z.strictObject({ kind: z.literal("region"), regionKey: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("slack.code"), id: memberId }),
  z.strictObject({ kind: z.literal("slack.status"), codes: z.array(code).min(1).max(12) }),
  z.strictObject({ kind: z.literal("slack.save"), id: memberId, code }),
  z.strictObject({ kind: z.literal("slack.unlink"), id: memberId }),
]);

const MSG = {
  bad: "요청 형식이 올바르지 않아요",
  failed: "처리하지 못했어요. 잠시 뒤에 다시 해 주세요",
  writeFailed: "위키에 저장하지 못했어요. 서버 로그를 확인해 주세요",
  readOnly: "위키에 쓸 수 없는 설정이에요. 서버의 WIKI_REPO_PATH를 확인해 주세요",
  stateDir: "연결 코드를 저장할 폴더 설정이 올바르지 않아요. 서버의 HSH_STATE_DIR을 확인해 주세요",
  many: "연결 코드를 너무 많이 받았어요. 잠시 뒤에 다시 해 주세요",
  notConnected: "아직 슬랙 연결이 끝나지 않았어요. 슬랙에서 봇에게 코드를 보낸 뒤 다시 눌러 주세요",
} as const;

const optionalView = (v: SettingsView | undefined) => (v ? { view: v } : {});

const fail = (status: SettingsResult["status"], code: ErrorCode, message: string, issues?: SettingsIssue[]): SettingsResult => ({ status, body: { ok: false, code, message, ...(issues?.length ? { issues } : {}) } });

const STATUS = { invalid: 422, not_found: 422, conflict: 409, needs_setup: 409, read_only: 503 } as const;

export async function runSettings(raw: unknown, deps: SettingsApiDeps): Promise<SettingsResult> {
  const p = bodySchema.safeParse(raw);
  if (!p.success) return fail(422, "bad_request", MSG.bad);
  const b = p.data;
  const log = deps.log ?? ((m) => console.error(`[settings] ${m}`));
  const view = async (): Promise<SettingsView | undefined> => {
    try {
      return toSettingsView(await deps.read());
    } catch (e) {
      log(`저장 뒤 위키 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  };

  const write = async (change: SettingsChange): Promise<SettingsResult> => {
    try {
      const r = await deps.repo.applySettings(deps.familyId, change, { author: deps.author ?? "settings" });
      log(`변경 저장 kind=${change.kind} version=${r.version} synced=${r.synced}`);
      return { status: 200, body: { ok: true, saved: true, synced: r.synced, ...(r.syncError ? { syncError: r.syncError } : {}), ...optionalView(await view()) } };
    } catch (e) {
      if (e instanceof SettingsError) return fail(STATUS[e.code], e.code, e.message, e.issues);
      log(`위키 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`);
      return fail(500, "failed", MSG.writeFailed);
    }
  };

  try {
    switch (b.kind) {
      case "member.add":
        return await write({ kind: "member.add", payload: { name: b.name, role: b.role, color: b.color } });
      case "member.color":
        return await write({ kind: "member.color", payload: { id: b.id, color: b.color } });
      case "region": {
        const region = findRegion(b.regionKey);
        if (!region) return fail(422, "invalid", "알 수 없는 지역이에요", [{ path: "regionKey", message: "지역 목록에 없어요" }]);
        const f = regionToConfigFields(region);
        return await write({ kind: "config.region", payload: { region: f.region, kmaNx: f.kmaNx, kmaNy: f.kmaNy, kmaMidLandRegId: f.kmaMidLandRegId, kmaMidTaRegId: f.kmaMidTaRegId } });
      }
      case "slack.unlink":
        return await write({ kind: "member.slack", payload: { id: b.id, slackId: null } });
      case "slack.code": {
        if (!deps.connect) return fail(503, "read_only", MSG.stateDir);
        // 이름·역할은 클라이언트가 아니라 위키에서 읽는다(코드 안내에 보일 이름)
        const m = (await deps.read()).members.find((x) => x.id === b.id);
        if (!m || m.id === "family") return fail(422, "not_found", "구성원을 찾을 수 없어요");
        try {
          const rec = await deps.connect.issue({ memberKey: m.id, name: m.name, role: m.role, scope: "settings" });
          return { status: 200, body: { ok: true, code: rec.code, expiresAt: rec.expiresAt } };
        } catch (e) {
          if (e instanceof ConnectStoreError) return fail(429, "too_many", MSG.many);
          throw e;
        }
      }
      case "slack.status": {
        if (!deps.connect) return fail(503, "read_only", MSG.stateDir);
        return { status: 200, body: { ok: true, states: await deps.connect.states(b.codes) } };
      }
      case "slack.save": {
        if (!deps.connect) return fail(503, "read_only", MSG.stateDir);
        // 슬랙 ID는 클라이언트가 보내지 않는다: 이 구성원 몫으로 발급된 settings 코드의 연결 기록에서 서버가 꺼낸다
        const got = await deps.connect.claimed(b.code);
        if (!got || got.record.scope !== "settings" || got.record.memberKey !== b.id) return fail(409, "not_connected", MSG.notConnected);
        const r = await write({ kind: "member.slack", payload: { id: b.id, slackId: got.slackId } });
        // 반영했으면 코드는 더 쓸 수 없게 지운다(실패해도 반영은 성공: 코드는 만료로 사라진다)
        if (r.status === 200) await deps.connect.revoke(b.code).catch((e: unknown) => log(`연결 코드 정리 실패: ${e instanceof Error ? e.message : String(e)}`));
        return r;
      }
      default: {
        const never: never = b;
        log(`처리하지 않은 종류: ${JSON.stringify(never)}`);
        return fail(422, "bad_request", MSG.bad);
      }
    }
  } catch (e) {
    log(`설정 처리 실패 kind=${b.kind}: ${e instanceof Error ? e.message : String(e)}`);
    return fail(500, "failed", MSG.failed);
  }
}

