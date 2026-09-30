"use client";

import { useEffect, useState } from "react";
import { AppNavigation } from "@/components/organisms/app-navigation";
import { api, type HealthReport } from "@/lib/api/client";

type Status = "loading" | "up" | "down";

const SERVICES = ["app", "postgres", "redis"] as const;

function Dot({ ok }: { ok: boolean }) {
  return <span style={{ color: ok ? "var(--color-ok)" : "var(--color-error)" }}>{ok ? "ok" : "down"}</span>;
}

export default function StatusView() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const check = () => {
      api
        .health()
        .then((r) => {
          setReport(r);
          setStatus(r.app && r.postgres && r.redis ? "up" : "down");
        })
        .catch(() => setStatus("down"));
    };
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app-shell">
      <AppNavigation />
      <main className="dashboard-main">
      <h1 className="text-2xl font-semibold">Pyrite</h1>
      <p style={{ color: "var(--color-muted)" }}>
        Estado del sistema: {status === "loading" ? "consultando" : status === "up" ? "operativo" : "con fallas"}
      </p>
      <ul className="flex gap-6">
        {SERVICES.map((s) => (
          <li key={s}>
            {s}: {report ? <Dot ok={report[s]} /> : status === "down" ? <Dot ok={false} /> : "..."}
          </li>
        ))}
      </ul>
      </main>
    </div>
  );
}
