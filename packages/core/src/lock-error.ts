/** 다른 프로세스(대시보드·봇)가 쓰는 중이라 제때 쓰기 잠금을 얻지 못했다. 메시지는 화면·슬랙 카드에 그대로 나가므로 경로 같은 내부 정보를 넣지 않는다(자세한 것은 로그에만). */
export class WikiLockError extends Error {
  constructor(message = "다른 곳에서 저장 중이에요. 잠시 뒤 다시 해 주세요") {
    super(message);
    this.name = "WikiLockError";
  }
}
