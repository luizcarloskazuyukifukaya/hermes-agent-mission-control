"use client";

import { useEffect, useState } from "react";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Still up";
}

export default function Dashboard() {
  const [time, setTime] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      <div className="hq-rise pt-4 pb-10">
        <div className="eyebrow mb-2.5">{greeting()}</div>
        <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">{process.env.NEXT_PUBLIC_OWNER_NAME || "Founder"}</h1>
        <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-3">
          {time.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          {"  ·  "}
          {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </p>
      </div>
    </div>
  );
}
