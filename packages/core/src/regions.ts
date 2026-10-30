// 지역 -> 기상청 코드 변환표 (정적 데이터, /setup 1단계에서 쓴다).
// 범위와 출처는 docs/regions.md. 이 표는 구현자가 정리한 초안이라 기상청 원본 표와 대조하기 전까지 '검증 전'이다.
//
//  nx, ny           동네예보 격자 좌표 (시·군·구 대표 격자, 동 단위로는 인접 격자와 다를 수 있다)
//  midLandRegId     중기예보 육상 예보구역 (시·도 단위: 서울·인천·경기는 11B00000)
//  midTaRegId       중기예보 기온 예보 지점 (도시 단위). 표에 없는 시·군은 인접한 대표 도시 코드를 쓴다(taApprox: true)
export interface Region {
  /** 안정적인 선택 키 (화면 상태·테스트용). 바꾸지 않는다 */
  key: string;
  /** 위키 config.md의 region 값으로 저장되는 표시 이름 */
  label: string;
  nx: number;
  ny: number;
  midLandRegId: string;
  midTaRegId: string;
  /** 기온 지점이 이 지역 자체가 아니라 인접 도시의 코드임 */
  taApprox?: true;
}

export interface RegionGroup {
  name: string;
  regions: Region[];
}

const SEOUL = { land: "11B00000", ta: "11B10101" };
const GYEONGGI_LAND = "11B00000";

const seoul = (key: string, gu: string, nx: number, ny: number): Region => ({
  key: `seoul-${key}`,
  label: `서울특별시 ${gu}`,
  nx,
  ny,
  midLandRegId: SEOUL.land,
  midTaRegId: SEOUL.ta,
});

const incheon = (key: string, name: string, nx: number, ny: number): Region => ({
  key: `incheon-${key}`,
  label: `인천광역시 ${name}`,
  nx,
  ny,
  midLandRegId: GYEONGGI_LAND,
  midTaRegId: "11B20201",
});

const gg = (key: string, city: string, nx: number, ny: number, ta: string, approx = false): Region => ({
  key: `gyeonggi-${key}`,
  label: `경기도 ${city}`,
  nx,
  ny,
  midLandRegId: GYEONGGI_LAND,
  midTaRegId: ta,
  ...(approx ? { taApprox: true as const } : {}),
});

export const REGION_GROUPS: RegionGroup[] = [
  {
    name: "서울특별시",
    regions: [
      seoul("jongno", "종로구", 60, 127),
      seoul("jung", "중구", 60, 127),
      seoul("yongsan", "용산구", 60, 126),
      seoul("seongdong", "성동구", 61, 127),
      seoul("gwangjin", "광진구", 62, 126),
      seoul("dongdaemun", "동대문구", 61, 127),
      seoul("jungnang", "중랑구", 62, 128),
      seoul("seongbuk", "성북구", 61, 127),
      seoul("gangbuk", "강북구", 61, 128),
      seoul("dobong", "도봉구", 61, 129),
      seoul("nowon", "노원구", 61, 129),
      seoul("eunpyeong", "은평구", 59, 127),
      seoul("seodaemun", "서대문구", 59, 127),
      seoul("mapo", "마포구", 59, 127),
      seoul("yangcheon", "양천구", 58, 126),
      seoul("gangseo", "강서구", 58, 126),
      seoul("guro", "구로구", 58, 125),
      seoul("geumcheon", "금천구", 59, 124),
      seoul("yeongdeungpo", "영등포구", 58, 126),
      seoul("dongjak", "동작구", 59, 125),
      seoul("gwanak", "관악구", 59, 125),
      seoul("seocho", "서초구", 61, 125),
      seoul("gangnam", "강남구", 61, 126),
      seoul("songpa", "송파구", 62, 126),
      seoul("gangdong", "강동구", 62, 126),
    ],
  },
  {
    name: "인천광역시",
    regions: [
      incheon("jung", "중구", 51, 125),
      incheon("michuhol", "미추홀구", 55, 124),
      incheon("yeonsu", "연수구", 55, 123),
      incheon("namdong", "남동구", 56, 124),
      incheon("bupyeong", "부평구", 55, 126),
      incheon("gyeyang", "계양구", 56, 126),
      incheon("seo", "서구", 55, 126),
      incheon("ganghwa", "강화군", 51, 130),
    ],
  },
  {
    name: "경기도",
    regions: [
      gg("suwon", "수원시", 60, 121, "11B20601"),
      gg("seongnam", "성남시", 63, 124, "11B20605"),
      gg("seongnam-bundang", "성남시 분당구", 62, 123, "11B20605"),
      gg("goyang", "고양시", 57, 128, "11B20302"),
      gg("yongin", "용인시", 64, 119, "11B20612"),
      gg("bucheon", "부천시", 56, 125, "11B20204"),
      gg("ansan", "안산시", 58, 121, "11B20203"),
      gg("anyang", "안양시", 59, 123, "11B20602"),
      gg("namyangju", "남양주시", 64, 128, "11B20301", true),
      gg("hwaseong", "화성시", 57, 119, "11B20604"),
      gg("pyeongtaek", "평택시", 62, 114, "11B20606"),
      gg("uijeongbu", "의정부시", 61, 130, "11B20301"),
      gg("siheung", "시흥시", 57, 123, "11B20202"),
      gg("gimpo", "김포시", 55, 128, "11B20102"),
      gg("gwangju", "광주시", 65, 123, "11B20605", true),
      gg("gwangmyeong", "광명시", 58, 125, "11B10103"),
      gg("gunpo", "군포시", 59, 122, "11B20602", true),
      gg("hanam", "하남시", 64, 126, "11B10101", true),
      gg("osan", "오산시", 62, 118, "11B20603"),
      gg("icheon", "이천시", 68, 121, "11B20701"),
      gg("anseong", "안성시", 65, 115, "11B20611"),
      gg("uiwang", "의왕시", 60, 122, "11B20601", true),
      gg("yangju", "양주시", 61, 131, "11B20304"),
      gg("paju", "파주시", 56, 131, "11B20305"),
      gg("guri", "구리시", 62, 127, "11B10101", true),
      gg("gwacheon", "과천시", 60, 124, "11B10102"),
      gg("pocheon", "포천시", 64, 134, "11B20403"),
      gg("dongducheon", "동두천시", 61, 134, "11B20401"),
      gg("yeoju", "여주시", 71, 121, "11B20701", true),
      gg("yangpyeong", "양평군", 69, 125, "11B20701", true),
      gg("gapyeong", "가평군", 69, 133, "11B20404"),
      gg("yeoncheon", "연천군", 61, 138, "11B20402"),
    ],
  },
];

export const ALL_REGIONS: Region[] = REGION_GROUPS.flatMap((g) => g.regions);

export function findRegion(key: string | undefined): Region | undefined {
  return key ? ALL_REGIONS.find((r) => r.key === key) : undefined;
}

/** 직접 입력(고급) 값의 범위: 동네예보 격자는 nx 1~149, ny 1~253. 중기 예보구역 코드는 `11B00000`, 기온 지점은 `11B10101` 꼴(숫자 2 + 영문 1 + 숫자 5). */
export const KMA_NX_RANGE = [1, 149] as const;
export const KMA_NY_RANGE = [1, 253] as const;
export const KMA_REG_ID_RE = /^\d{2}[A-Z]\d{5}$/;

/** 선택한 지역 -> config.md에 들어갈 지역 필드 */
export function regionToConfigFields(r: Region) {
  return { region: r.label, kmaNx: r.nx, kmaNy: r.ny, kmaMidLandRegId: r.midLandRegId, kmaMidTaRegId: r.midTaRegId };
}
