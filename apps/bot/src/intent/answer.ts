// 슬랙 핸들러(#9)가 붙이기 쉬운 순수 함수. 의도 추출 -> (질문이면) 위키 사실로 답 조립. 쓰기 없음.
import { todayIn, type LlmAdapter } from "@hsh/core";
import { extractIntent, type ExtractInput, type Intent } from "./extract";
import { NO_ANSWER, composeAnswer, type WikiFacts } from "./question";

export interface AnswerResult {
  intent: Intent;
  /** 보낼 답. question이면 위키 기반 답, LLM 실패·형식 오류·무관한 말(unknown)이면 모르겠다는 안내, 쓰기 의도면 undefined(호출한 쪽이 확인 버튼 흐름으로) */
  text?: string;
}

export type AnswerInput = ExtractInput & Pick<WikiFacts, "anniversaries">;

export async function answerQuestion(input: AnswerInput, llm: LlmAdapter): Promise<AnswerResult> {
  const intent = await extractIntent(input, llm);
  if (intent.type === "question") return { intent, text: composeAnswer(intent.query, input, todayIn(input.now ?? new Date())) };
  if (intent.type === "unknown") return { intent, text: NO_ANSWER };
  return { intent };
}
