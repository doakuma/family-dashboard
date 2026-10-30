"use client";
import { REGION_GROUPS, findRegion } from "@hsh/core";
import { SelectField, TextField } from "@/components/ui/form/Field";
import { LinkButton } from "@/components/ui/form/Button";
import { Disclosure } from "@/components/ui/form/Disclosure";
import { fieldId } from "@/lib/setup/validate";
import { SkinPreviewSlot } from "../SkinPreviewSlot";
import s from "../setup.module.css";
import type { StepProps } from "./types";

/** 1단계: 우리 집 - 가족 이름, 지역(기상청 코드로 변환), 시간대 */
export function HomeStep({ draft, errors, onChange }: StepProps) {
  const set = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch });
  const setManual = (patch: Partial<typeof draft.manual>) => onChange({ ...draft, manual: { ...draft.manual, ...patch } });
  const region = findRegion(draft.regionKey);
  const manual = draft.regionMode === "manual";

  return (
    <>
      <TextField
        id={fieldId("familyName")}
        label="가족 이름"
        value={draft.familyName}
        onChange={(familyName) => set({ familyName })}
        error={errors.familyName}
        hint="대시보드 제목에 보여요. 예: 햇살네"
        autoComplete="off"
        maxLength={60}
        enterKeyHint="next"
      />

      {!manual && (
        <>
          <SelectField
            id={fieldId("region")}
            label="사는 지역"
            value={draft.regionKey}
            onChange={(regionKey) => set({ regionKey })}
            error={errors.region}
            hint="날씨를 가져오는 데 써요. 시·군·구 단위로 골라 주세요."
          >
            <option value="">지역을 골라 주세요</option>
            {REGION_GROUPS.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.regions.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label.replace(`${g.name} `, "")}
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectField>
          {region?.taApprox && <p className={s.note}>이 지역의 기온 예보는 가까운 도시 기준으로 가져와요.</p>}
          <LinkButton onClick={() => set({ regionMode: "manual" })}>목록에 없어요 · 직접 입력</LinkButton>
        </>
      )}

      {manual && (
        <fieldset className={s.card}>
          <legend>지역 직접 입력</legend>
          <p className={s.lead}>기상청 동네예보 격자(nx, ny)와 중기예보 지역 코드를 알고 있을 때만 쓰세요.</p>
          <TextField id={fieldId("manual.label")} label="지역 이름" value={draft.manual.label} onChange={(label) => setManual({ label })} error={errors["manual.label"]} hint="예: 부산광역시 해운대구" maxLength={100} />
          <div className={s.row2}>
            <TextField id={fieldId("manual.nx")} label="nx (격자 X)" value={draft.manual.nx} onChange={(nx) => setManual({ nx })} error={errors["manual.nx"]} inputMode="numeric" maxLength={3} />
            <TextField id={fieldId("manual.ny")} label="ny (격자 Y)" value={draft.manual.ny} onChange={(ny) => setManual({ ny })} error={errors["manual.ny"]} inputMode="numeric" maxLength={3} />
          </div>
          <TextField id={fieldId("manual.landId")} label="중기예보 육상 지역 코드" value={draft.manual.landId} onChange={(landId) => setManual({ landId })} error={errors["manual.landId"]} hint="예: 11B00000 (서울·인천·경기)" autoCapitalize="characters" maxLength={8} />
          <TextField id={fieldId("manual.taId")} label="중기예보 기온 지점 코드" value={draft.manual.taId} onChange={(taId) => setManual({ taId })} error={errors["manual.taId"]} hint="예: 11B10101 (서울)" autoCapitalize="characters" maxLength={8} />
          <LinkButton onClick={() => set({ regionMode: "list" })}>목록에서 고르기</LinkButton>
        </fieldset>
      )}

      <Disclosure className={s.details} forceOpen={Boolean(errors.timezone)} summary={`시간대: ${draft.timezone || "Asia/Seoul"} (바꾸려면 누르세요)`}>
        <TextField id={fieldId("timezone")} label="시간대" value={draft.timezone} onChange={(timezone) => set({ timezone })} error={errors.timezone} hint="한국에서 쓰면 그대로 두세요. (Asia/Seoul)" />
      </Disclosure>

      <SkinPreviewSlot />
    </>
  );
}
