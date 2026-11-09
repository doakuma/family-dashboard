"use client";
import { useEffect, useState } from "react";
import { PICKABLE_COLORS, COLOR_LABELS, colorLabel, type MemberRole } from "@hsh/core";
import { Button } from "@/components/ui/form/Button";
import { ChoiceGroup, SwatchGroup, TextField } from "@/components/ui/form/Field";
import { MEMBER_COLORS, colorOf } from "@/lib/palette";
import type { SettingsViewData } from "@/lib/settings/client";
import { suggestColor } from "@/lib/setup/colors";
import s from "../setup/setup.module.css";
import x from "./settings.module.css";
import { SectionStatus } from "./SectionStatus";
import { useSettingsAction } from "./useSettingsAction";

const COLOR_OPTIONS = PICKABLE_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c], css: MEMBER_COLORS[c] }));
const ROLE_OPTIONS = [
  { value: "guardian" as const, label: "보호자" },
  { value: "child" as const, label: "아이" },
];
const ROLE_TEXT: Record<MemberRole, string> = { guardian: "보호자", child: "아이" };
const NAME_MAX = 40;
/** 추가 버튼은 폼이 닫힌 뒤에 다시 그려지므로 다음 프레임에 포커스를 돌려준다 */
const focusAddButton = () => requestAnimationFrame(() => document.getElementById("settings-add-btn")?.focus());

interface Props {
  view: SettingsViewData;
  onView: (v: SettingsViewData) => void;
}

/** 구성원 구역: 목록 + 색 바꾸기 + 구성원 추가. 삭제·이름·역할 변경은 하지 않는다(스펙에 없음). */
export function MembersSection({ view, onView }: Props) {
  const act = useSettingsAction(onView);
  const [editing, setEditing] = useState<string | undefined>();
  const [pick, setPick] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("child");
  const [color, setColor] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [colorError, setColorError] = useState<string | undefined>();
  const full = view.members.length >= view.maxMembers;

  // 폼이 열리면 첫 입력으로 포커스
  useEffect(() => {
    if (adding) document.getElementById("settings-add-name")?.focus();
  }, [adding]);
  useEffect(() => {
    if (editing) document.getElementById(`settings-color-${editing}`)?.focus();
  }, [editing]);

  const openAdd = () => {
    setName("");
    setRole("child");
    setColor(suggestColor(view.members.map((m) => m.color)));
    setNameError(undefined);
    setColorError(undefined);
    act.clear();
    setAdding(true);
  };

  const submitAdd = async () => {
    const n = name.trim();
    const err = n === "" ? "이름을 넣어 주세요" : n.length > NAME_MAX ? `이름은 ${NAME_MAX}자까지 쓸 수 있어요` : undefined;
    setNameError(err);
    if (err) {
      document.getElementById("settings-add-name")?.focus();
      return;
    }
    const r = await act.run({ kind: "member.add", name: n, role, color }, () => `${n} 님을 추가했어요. 슬랙 연결은 아래 '슬랙 연결'에서 할 수 있어요.`);
    if (!r) return;
    if (r.ok) {
      setAdding(false);
      focusAddButton();
      return;
    }
    // 서버가 필드별로 돌려준 사유를 입력칸에 붙인다
    setNameError(r.issues.find((i) => i.path.endsWith("name"))?.message);
    setColorError(r.issues.find((i) => i.path.endsWith("color"))?.message);
  };

  const submitColor = async (id: string, memberName: string) => {
    if (pick === "") return;
    const r = await act.run({ kind: "member.color", id, color: pick }, () => `${memberName} 님의 색을 ${colorLabel(pick)}(으)로 바꿨어요.`);
    if (r?.ok) {
      setEditing(undefined);
      // 눌렀던 버튼이 사라지므로 같은 구성원의 '색 바꾸기' 버튼으로 포커스를 돌려준다
      requestAnimationFrame(() => document.getElementById(`settings-color-btn-${id}`)?.focus());
    }
  };

  return (
    <section className={s.card} aria-labelledby="settings-members-title">
      <h2 id="settings-members-title" className={s.sectionTitle}>
        구성원
      </h2>
      <ul className={s.list} aria-label="구성원 목록">
        {view.members.map((m) => (
          <li key={m.id} className={`${s.item} ${x.itemWrap}`}>
            <span className={s.dot} style={{ background: colorOf(m.color) }} aria-hidden="true" />
            <span className={s.itemMain}>
              <span>{m.name}</span>
              <span className={s.itemSub}>
                {ROLE_TEXT[m.role]} · 색 {colorLabel(m.color)}
              </span>
            </span>
            <Button
              id={`settings-color-btn-${m.id}`}
              variant="quiet"
              aria-label={`${m.name} 색 바꾸기`}
              aria-expanded={editing === m.id}
              className={x.push}
              onClick={() => {
                act.clear();
                setPick(m.color);
                setEditing(editing === m.id ? undefined : m.id);
              }}
            >
              색 바꾸기
            </Button>
            {editing === m.id && (
              <form
                className={x.editor}
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!act.busy) void submitColor(m.id, m.name);
                }}
              >
                <SwatchGroup id={`settings-color-${m.id}`} legend={`${m.name} 님의 색`} value={pick} options={COLOR_OPTIONS} onChange={setPick} hint="일정 옆의 점 색이에요. 다른 사람과 같아도 괜찮아요" />
                <div className={x.actions}>
                  <Button type="submit" aria-label={`${m.name} 색 저장`} aria-disabled={act.busy || pick === "" || pick === m.color} onClick={(e) => (act.busy || pick === "" || pick === m.color) && e.preventDefault()}>
                    {act.busy ? "저장하는 중…" : "저장"}
                  </Button>
                  <Button variant="secondary" onClick={() => { setEditing(undefined); document.getElementById(`settings-color-btn-${m.id}`)?.focus(); }}>
                    닫기
                  </Button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>

      {!adding && (
        <Button id="settings-add-btn" variant="secondary" aria-disabled={full} onClick={() => !full && openAdd()}>
          구성원 추가 ({view.members.length}/{view.maxMembers})
        </Button>
      )}
      {full && !adding && <p className={s.itemSub}>구성원은 {view.maxMembers}명까지예요.</p>}

      {adding && (
        <form
          noValidate
          aria-label="구성원 추가"
          className={x.stack}
          onSubmit={(e) => {
            e.preventDefault();
            if (!act.busy) void submitAdd();
          }}
        >
          <TextField id="settings-add-name" label="이름" value={name} onChange={setName} error={nameError} maxLength={60} enterKeyHint="done" />
          <ChoiceGroup id="settings-add-role" legend="역할" value={role} options={ROLE_OPTIONS} onChange={setRole} hint={role === "guardian" ? "슬랙에서 일정·할 일을 쓸 수 있어요" : "슬랙에서 물어보기만 할 수 있어요"} />
          <SwatchGroup id="settings-add-color" legend="색" value={color} options={COLOR_OPTIONS} onChange={setColor} error={colorError} hint="일정 옆의 점 색이에요" />
          <div className={x.actions}>
            <Button type="submit" aria-disabled={act.busy} onClick={(e) => act.busy && e.preventDefault()}>
              {act.busy ? "추가하는 중…" : "추가"}
            </Button>
            <Button variant="secondary" onClick={() => { setAdding(false); focusAddButton(); }}>
              취소
            </Button>
          </div>
        </form>
      )}
      <SectionStatus message={act.message} />
    </section>
  );
}
