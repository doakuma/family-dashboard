// 세팅 완료 알림(#20): 대시보드(세팅 성공)가 넣고, 봇이 꺼내 #가족 채널에 환영 메시지를 올린다.
// 둘은 다른 프로세스고 대시보드에는 슬랙 클라이언트가 없어서 프로세스 간 상자(outbox)가 필요하다 -> 포트 SetupNoticeStore (결정 0008).
// 이 파일은 브라우저에서도 쓰는 부분만(타입·포트·상수). 파일 구현은 core/node의 FsSetupNoticeStore.
import type { FamilyId } from "./types";

/** 이 시간이 지난 알림은 게시하지 않고 지운다(봇이 오래 꺼져 있다가 켜져도 옛 환영 메시지를 올리지 않게) */
export const SETUP_NOTICE_TTL_MS = 24 * 60 * 60_000;
/** claim한 봇이 이 시간 안에 끝내지 못하면(죽음) 다른 봇이 이어받을 수 있다 */
export const SETUP_NOTICE_LEASE_MS = 5 * 60_000;

export interface SetupNotice {
  id: string;
  familyId: FamilyId;
  /** 세팅이 끝난 시각 (ISO). 24시간 만료의 기준 */
  completedAt: string;
  /** 세팅 커밋 version(sha). 로그·진단용 */
  version: string;
}

export interface SetupNoticeInput {
  familyId: FamilyId;
  completedAt: string;
  version: string;
}

export interface SetupNoticeStore {
  /** 알림 한 건을 넣는다(반쯤 쓴 파일이 보이지 않게 원자적으로) */
  put(input: SetupNoticeInput): Promise<SetupNotice>;
  /** 아직 게시되지 않은 알림(오래된 순). 깨진 항목은 건너뛴다 */
  list(): Promise<SetupNotice[]>;
  /** 처리 권한을 얻는다. 같은 알림에 한 번에 한 곳만 true(다른 프로세스 포함). 이미 끝났거나 지워졌으면 false */
  claim(id: string): Promise<boolean>;
  /** 게시에 실패해 처리 권한을 돌려준다(다시 claim할 수 있다) */
  release(id: string): Promise<void>;
  /** 게시를 마쳤다. 다시는 claim되지 않고 list에서도 사라진다 */
  complete(id: string): Promise<void>;
  /** 만료된 알림과 끝난 알림의 찌꺼기를 지운다. 지운 만료 알림 id를 돌려준다 */
  expire(): Promise<string[]>;
}
