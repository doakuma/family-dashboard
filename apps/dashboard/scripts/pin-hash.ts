// 관리자 PIN -> .env에 넣을 한 줄. PIN은 화면에 보이지 않게 stdin으로 받고, 파일에는 아무것도 쓰지 않는다.
//   pnpm pin:hash            (대화형: 두 번 입력)
//   echo 4821 | pnpm pin:hash (파이프: 첫 줄을 PIN으로)
// 출력(stdout): ADMIN_PIN_HASH=scrypt:...   -> 서버의 .env에 직접 붙여 넣는다.
import { hashPin, isValidPinFormat } from "../lib/auth/pin.ts";

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(buf));
        if (ch === "\u0003") return done(() => reject(new Error("취소했어요")));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += String(chunk);
  return data.split(/\r?\n/)[0] ?? "";
}

async function main() {
  let pin: string;
  if (process.stdin.isTTY) {
    pin = await readHidden("관리자 PIN (숫자 4~6자리): ");
    if (!isValidPinFormat(pin)) throw new Error("PIN은 숫자 4~6자리여야 해요");
    if ((await readHidden("한 번 더: ")) !== pin) throw new Error("두 번 입력한 PIN이 달라요");
  } else {
    pin = await readPiped();
    if (!isValidPinFormat(pin)) throw new Error("PIN은 숫자 4~6자리여야 해요");
  }
  process.stdout.write(`ADMIN_PIN_HASH=${hashPin(pin)}\n`);
  process.stderr.write("위 한 줄을 서버의 .env에 넣고 서버를 다시 시작하세요. (PIN 자체는 어디에도 저장되지 않아요)\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
