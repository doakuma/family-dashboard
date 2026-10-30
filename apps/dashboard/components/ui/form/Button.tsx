import type { ButtonHTMLAttributes } from "react";
import s from "./form.module.css";

export function Button({ variant = "primary", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return <button type="button" {...rest} className={`${s.button} ${s[variant]}${className ? ` ${className}` : ""}`} />;
}

/** 밑줄 글자 버튼 (보조 동작: 직접 입력 열기 등) */
export function LinkButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={`${s.link}${className ? ` ${className}` : ""}`} />;
}
