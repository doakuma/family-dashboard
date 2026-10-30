import type { WeatherIcon as Icon } from "@hsh/core";

const LABEL: Record<Icon, string> = {
  sunny: "맑음",
  partly: "구름 조금",
  cloudy: "흐림",
  rain: "비",
  shower: "소나기",
  snow: "눈",
};

// 색은 스킨 토큰(--icon-*)에서 온다
const SUN = "var(--icon-sun)";
const CLOUD = "var(--icon-cloud)";
const DROP = "var(--icon-drop)";

function Sun({ cx = 16, cy = 16, r = 6 }) {
  return (
    <g stroke={SUN} strokeWidth="2.4" strokeLinecap="round">
      <circle cx={cx} cy={cy} r={r} fill={SUN} stroke="none" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <line
            key={i}
            x1={cx + Math.cos(a) * (r + 3)}
            y1={cy + Math.sin(a) * (r + 3)}
            x2={cx + Math.cos(a) * (r + 6)}
            y2={cy + Math.sin(a) * (r + 6)}
          />
        );
      })}
    </g>
  );
}

const Cloud = ({ y = 0 }) => (
  <path
    d={`M9 ${26 + y}h15a5.5 5.5 0 0 0 .6-11A7.5 7.5 0 0 0 10 ${15.5 + y}a5.3 5.3 0 0 0-1 ${10.5}z`}
    fill={CLOUD}
  />
);

/** 직접 그린 날씨 아이콘 (외부 아이콘 세트 없이) */
export function WeatherIcon({ icon }: { icon: Icon }) {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" role="img" aria-label={LABEL[icon]}>
      {icon === "sunny" && <Sun />}
      {icon === "partly" && (
        <>
          <Sun cx={12} cy={12} r={5} />
          <Cloud y={2} />
        </>
      )}
      {icon === "cloudy" && <Cloud />}
      {(icon === "rain" || icon === "shower") && (
        <>
          <Cloud y={-4} />
          <g stroke={DROP} strokeWidth="2.4" strokeLinecap="round">
            <line x1="12" y1="25" x2="10.5" y2="29" />
            <line x1="18" y1="25" x2="16.5" y2="29" />
            {icon === "rain" && <line x1="24" y1="25" x2="22.5" y2="29" />}
          </g>
        </>
      )}
      {icon === "snow" && (
        <>
          <Cloud y={-4} />
          <g fill={CLOUD}>
            <circle cx="11" cy="27" r="1.8" />
            <circle cx="17" cy="28.5" r="1.8" />
            <circle cx="23" cy="27" r="1.8" />
          </g>
        </>
      )}
    </svg>
  );
}
