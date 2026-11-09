import { REGION_GROUPS } from "@hsh/core";

/** 지역 선택 상자의 <option>들(시·도별 묶음). 마법사 1단계와 /settings가 같이 쓴다. */
export function RegionOptions({ placeholder = "지역을 골라 주세요" }: { placeholder?: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {REGION_GROUPS.map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.regions.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label.replace(`${g.name} `, "")}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
