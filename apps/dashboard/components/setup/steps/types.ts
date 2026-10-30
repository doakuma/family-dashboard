import type { Draft } from "@/lib/setup/draft";
import type { Errors } from "@/lib/setup/validate";

export interface StepProps {
  draft: Draft;
  /** 필드 키 -> 한국어 오류 (lib/setup/validate의 필드 키 규칙) */
  errors: Errors;
  onChange: (next: Draft) => void;
}
