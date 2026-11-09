// 세팅 완료 환영 메시지(#20): 위키 상태 -> 슬랙 mrkdwn 글 하나. 슬랙·파일을 모르는 순수 함수.
import { FAMILY_ID, type WikiState } from "@hsh/core";
import { escapeMrkdwn } from "../slack/messenger";

/** 슬랙 사용자 id 모양(U·W로 시작). 위키 값이 이상해도 멘션 문법을 깨지 않게 거른다 */
const SLACK_ID_RE = /^[UW][A-Z0-9]{2,}$/;
const MAX_MENTIONS = 12;
/** 예시 안에 넣을 이름: 코드 표시(`)와 줄바꿈을 걷어 낸다 */
const plain = (s: string) => escapeMrkdwn(s.replace(/[`\r\n]+/g, " ").trim());

export const WELCOME_EXAMPLE_COUNT = 3;

export interface WelcomeInput {
  familyName: string;
  members: Pick<WikiState["members"][number], "id" | "name" | "role" | "slackId">[];
}

/** 이렇게 말해 보세요 예시 정확히 3개: 일정 넣기 · 장보기/할 일 추가 · 질문 */
export function welcomeExamples(members: WelcomeInput["members"]): [string, string, string] {
  const people = members.filter((m) => m.id !== FAMILY_ID);
  const child = people.find((m) => m.role === "child");
  const guardian = people.find((m) => m.role === "guardian");
  const eventName = child ?? guardian ?? people[0];
  const askName = guardian ?? people[0];
  return [
    `다음 주 화요일 3시 ${eventName ? `${plain(eventName.name)} ` : ""}치과`,
    "장보기에 우유랑 계란 추가해 줘",
    `이번 주말에 ${askName ? `${plain(askName.name)} ` : ""}일정 뭐 있어?`,
  ];
}

export function buildWelcomeMessage(input: WelcomeInput): string {
  const mentions = input.members
    .flatMap((m) => (m.id !== FAMILY_ID && m.slackId && SLACK_ID_RE.test(m.slackId) ? [`<@${m.slackId}>`] : []))
    .slice(0, MAX_MENTIONS);
  const [a, b, c] = welcomeExamples(input.members);
  return [
    `🏠 *${plain(input.familyName)}* 대시보드가 준비됐어요! 이제 이 채널에서 편하게 말씀해 주세요.`,
    ...(mentions.length ? [`${mentions.join(" ")} 함께 써요.`] : []),
    "",
    "*이렇게 말해 보세요*",
    `1. 일정 넣기: \`${a}\``,
    `2. 장보기·할 일 추가: \`${b}\``,
    `3. 궁금한 것 묻기: \`${c}\``,
    "",
    "제가 알아듣고 \"넣을까요?\" 하고 물으면 확인 버튼을 눌러 주세요. 확인하면 위키에 들어가요.",
  ].join("\n");
}
