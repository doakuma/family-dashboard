import type { Task, TaskList } from "@hsh/core";
import { colorOf } from "@/lib/palette";
import { LIMITS, limit } from "@/lib/view";
import type { MemberMap } from "./MemberDot";
import s from "./Checklist.module.css";

const COLUMNS: { list: TaskList; title: string }[] = [
  { list: "shopping", title: "장보기" },
  { list: "todo", title: "할 일" },
];

/** 장보기·할 일 2열, 미완료만. 보기 전용이라 체크박스 대신 구성원 색 점을 쓴다. */
export function Checklist({ tasks, members }: { tasks: Task[]; members: MemberMap }) {
  return (
    <section className={s.checklist} aria-label="장보기와 할 일">
      {COLUMNS.map(({ list, title }) => {
        const open = tasks.filter((t) => t.list === list && !t.done);
        const { shown, more } = limit(open, LIMITS.checklist);
        return (
          <div key={list} className={s.column}>
            <h2 className={s.title}>
              {title} <span className={s.count}>{open.length}</span>
            </h2>
            {open.length === 0 ? (
              <p className={s.empty}>{list === "shopping" ? "살 것 없음" : "할 일 없음"}</p>
            ) : (
              <ul className={s.items}>
                {shown.map((t) => {
                  const m = t.member ? members.get(t.member) : undefined;
                  return (
                    <li key={t.id} className={s.item}>
                      <span
                        className={s.dot}
                        data-none={!m || undefined}
                        style={m ? { background: colorOf(m.color) } : undefined}
                        aria-hidden
                      />
                      <span className={s.text}>{t.title}</span>
                      {m && <span className="sr-only">({m.name})</span>}
                    </li>
                  );
                })}
                {more > 0 && <li className={s.more}>외 {more}개</li>}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
