"use client";
import { useState } from "react";
import { Button } from "@/components/ui/form/Button";
import { SelectField } from "@/components/ui/form/Field";
import { findRegion } from "@hsh/core";
import type { SettingsViewData } from "@/lib/settings/client";
import { RegionOptions } from "../setup/RegionOptions";
import s from "../setup/setup.module.css";
import { SectionStatus } from "./SectionStatus";
import { useSettingsAction } from "./useSettingsAction";

interface Props {
  view: SettingsViewData;
  onView: (v: SettingsViewData) => void;
}

/** 지역 구역: 마법사 1단계와 같은 지역 선택(지역표). 기상청 코드는 서버가 지역표에서 채운다. */
export function RegionSection({ view, onView }: Props) {
  const act = useSettingsAction(onView);
  const [key, setKey] = useState(view.regionKey ?? "");
  const [error, setError] = useState<string | undefined>();
  const chosen = findRegion(key);
  const unchanged = key === (view.regionKey ?? "");

  const submit = async () => {
    if (act.busy) return;
    if (!chosen) {
      setError("지역을 골라 주세요");
      document.getElementById("settings-region")?.focus();
      return;
    }
    if (unchanged) return;
    setError(undefined);
    const r = await act.run({ kind: "region", regionKey: chosen.key }, () => `지역을 ${chosen.label}(으)로 바꿨어요. 날씨는 곧 새 지역 기준으로 바뀌어요.`);
    if (r && !r.ok) setError(r.issues[0]?.message);
  };

  return (
    <section className={s.card} aria-labelledby="settings-region-title">
      <h2 id="settings-region-title" className={s.sectionTitle}>
        지역
      </h2>
      <form
        noValidate
       
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SelectField
          id="settings-region"
          label="사는 지역"
          value={key}
          onChange={(v) => {
            setKey(v);
            setError(undefined);
          }}
          error={error}
          hint={view.region && !view.regionKey ? `지금: ${view.region} (목록에 없는 지역이에요)` : "날씨를 가져오는 데 써요. 시·군·구 단위로 골라 주세요."}
        >
          <RegionOptions />
        </SelectField>
        {chosen?.taApprox && <p className={s.note}>이 지역의 기온 예보는 가까운 도시 기준으로 가져와요.</p>}
        <Button type="submit" aria-disabled={act.busy || unchanged || !chosen} onClick={(e) => (act.busy || unchanged || !chosen) && e.preventDefault()}>
          {act.busy ? "저장하는 중…" : "지역 저장"}
        </Button>
      </form>
      <SectionStatus message={act.message} />
    </section>
  );
}
