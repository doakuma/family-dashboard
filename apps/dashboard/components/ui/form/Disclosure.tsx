"use client";
import { useState, type ReactNode } from "react";

/**
 * 접었다 펴는 영역(고급 입력용). 안의 필드에 오류가 생기면 펼쳐 주고, 오류가 사라져도 닫지 않는다
 * (고치는 중에 입력칸이 사라지면 안 되므로).
 */
export function Disclosure({ summary, forceOpen, className, children }: { summary: ReactNode; forceOpen?: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (forceOpen && !open) setOpen(true);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
