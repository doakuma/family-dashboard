// CalendarMappingStore의 파일 구현(Node 전용): <상태 폴더>/calendar-sync/<familyId>.json. 위키 레포 밖(결정 0012).
// 쓰기는 임시 파일 + rename이라 반쯤 쓴 파일이 보이지 않는다. 쓰는 쪽은 봇 하나(프로세스 안은 CalendarReconciler가 한 번에 한 바퀴).
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { calendarMappingSchema, type CalendarMapping, type CalendarMappingRead, type CalendarMappingStore } from "../calendar";
import type { FamilyId } from "../types";

export interface FsCalendarMappingStoreOptions {
  /** 상태 폴더(HSH_STATE_DIR) */
  dir: string;
  familyId: FamilyId;
  now?: () => Date;
}

const isNotFound = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

export class FsCalendarMappingStore implements CalendarMappingStore {
  private readonly folder: string;
  private readonly file: string;

  constructor(private readonly o: FsCalendarMappingStoreOptions) {
    this.folder = join(o.dir, "calendar-sync");
    this.file = join(this.folder, `${o.familyId}.json`);
  }

  async read(): Promise<CalendarMappingRead> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if (isNotFound(e)) return {};
      throw e;
    }
    try {
      const parsed = calendarMappingSchema.safeParse(JSON.parse(text));
      if (parsed.success) return { mapping: parsed.data };
    } catch {
      // 아래에서 깨진 것으로 처리
    }
    // 깨진 파일은 옆으로 치워 두고(원인 조사용) 새로 시작한다
    const stamp = (this.o.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
    await rename(this.file, `${this.file}.broken-${stamp}`).catch(() => undefined);
    return { broken: true };
  }

  async write(mapping: CalendarMapping): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, this.file);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
  }
}
