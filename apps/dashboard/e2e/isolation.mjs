// e2e가 띄우는 server.ts 자식 프로세스에 합치는 격리 env.
// server.ts는 레포 루트 .env를 읽는다. HSH_ENV_FILE=none이면 읽지 않아서, 실제 KMA_SERVICE_KEY·HSH_FAMILY_ID·HSH_STATE_DIR 같은 값이 들어오지 않는다.
// (부모 셸에 이미 설정된 환경 변수는 그대로 상속된다.)
export const ISOLATED_ENV = { HSH_ENV_FILE: "none" };
