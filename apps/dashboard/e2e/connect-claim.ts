// e2e 도우미: 봇이 하는 일(슬랙 DM으로 받은 코드를 사용 처리)을 FsConnectCodeStore로 흉내 낸다.
//   tsx apps/dashboard/e2e/connect-claim.ts <상태 폴더> <코드> <슬랙 ID>   -> 결과 JSON을 한 줄로 출력
import { FsConnectCodeStore } from "@hsh/core/node";

const [dir, code, slackId] = process.argv.slice(2);
if (!dir || !code || !slackId) throw new Error("사용법: connect-claim.ts <dir> <code> <slackId>");
const r = await new FsConnectCodeStore({ dir }).claim(code, slackId);
console.log(JSON.stringify(r.ok ? { ok: true } : r));
