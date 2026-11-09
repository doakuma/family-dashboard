"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/form/Button";
import type { SettingsViewData } from "@/lib/settings/client";
import s from "../setup/setup.module.css";
import x from "./settings.module.css";
import { MembersSection } from "./MembersSection";
import { RegionSection } from "./RegionSection";
import { SlackSection } from "./SlackSection";

export interface SettingsScreenProps {
  initial: SettingsViewData;
  /** 서버가 위키에 쓸 수 있는 설정인지 */
  writable: boolean;
}

/** 설정 화면(휴대폰·PC). 구역마다 독립 저장: 한 번에 한 가지씩, 저장 버튼을 눌러야 반영된다. 태블릿 화면에는 이런 UI가 없다. */
export function SettingsScreen({ initial, writable }: SettingsScreenProps) {
  const [view, setView] = useState(initial);
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <div className={s.page} data-surface="phone">
      <header className={s.top}>
        <p className={s.brand}>HomeSweetHome · 가족 설정</p>
      </header>
      <main className={x.stack}>
        <div>
          <h1 ref={heading} className={s.title} tabIndex={-1}>
            설정
          </h1>
          <p className={s.lead}>{view.familyName ? `${view.familyName}의 ` : ""}구성원, 슬랙 연결, 지역을 바꿀 수 있어요. 구역마다 따로 저장돼요.</p>
        </div>
        {!writable && (
          <p role="alert" className={s.summary} data-invalid="true">
            이 서버는 위키에 쓸 수 없는 설정이에요(WIKI_REPO_PATH). 저장은 되지 않아요.
          </p>
        )}
        <MembersSection view={view} onView={setView} />
        <SlackSection view={view} onView={setView} />
        <RegionSection view={view} onView={setView} />
        <form method="post" action="/api/auth/logout">
          <Button type="submit" variant="quiet">
            나가기
          </Button>
        </form>
      </main>
    </div>
  );
}
