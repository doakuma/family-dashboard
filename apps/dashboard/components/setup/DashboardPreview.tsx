"use client";
import { SampleWeatherSource } from "@/lib/weather";
import type { ApiState, WeatherDay } from "@hsh/core";
import { useEffect, useRef, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import s from "./setup.module.css";

const STAGE_W = 1280;
const STAGE_H = 800;

/**
 * 기존 Dashboard 컴포넌트를 1280x800 태블릿 크기로 그린 뒤 폭에 맞춰 줄여 보여 주는 미리보기.
 * 입력값(state)만 받는 표시 컴포넌트다. 만질 수 없고(inert) 스크린리더에서는 숨긴다 - 같은 내용을 요약 목록이 읽어 준다.
 * 날씨는 예시 데이터(실제 날씨는 기상청 연동 뒤).
 */
export function DashboardPreview({ state }: { state: ApiState }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.28);
  const [weather, setWeather] = useState<WeatherDay[]>([]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / STAGE_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    void new SampleWeatherSource(() => new Date(state.updatedAt)).week().then((w) => alive && setWeather(w));
    return () => {
      alive = false;
    };
  }, [state.updatedAt]);

  return (
    <div ref={frame} className={s.previewFrame} style={{ height: STAGE_H * scale }} aria-hidden="true" inert data-testid="dashboard-preview">
      <div className={s.previewStage} style={{ transform: `scale(${scale})` }}>
        <Dashboard state={{ ...state, weather }} offline={false} mode="day" />
      </div>
    </div>
  );
}
