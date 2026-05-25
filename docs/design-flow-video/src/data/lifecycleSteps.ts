export type Actor = "K" | "S" | "W" | "D" | "L";

export const ACTOR_LABEL: Record<Actor, string> = {
  K: "Kiosk",
  S: "Factory Server",
  W: "Cloudflare Worker",
  D: "D1",
  L: "LAN Dashboard",
};

export type LifecycleStep = {
  k: number;
  from: Actor;
  to: Actor;
  text: string;
  durationFrames?: number;
};

export const LIFECYCLE_STEPS: readonly LifecycleStep[] = [
  { k: 1, from: "K", to: "S", text: "req_lookup(ac_no)" },
  { k: 2, from: "S", to: "K", text: "employee + is_active" },
  { k: 3, from: "K", to: "S", text: "req_startWork(emp_id, abaya_id, process)" },
  { k: 4, from: "S", to: "S", text: "Update ACTIVE_SESSIONS (in-memory)" },
  { k: 5, from: "S", to: "K", text: "ok + log_id" },
  { k: 6, from: "S", to: "L", text: "state_update via Socket.IO" },
  { k: 7, from: "S", to: "W", text: "POST /api/event (session_start)" },
  { k: 8, from: "W", to: "D", text: "Upsert active_sessions" },
  { k: 9, from: "K", to: "S", text: "req_finishWork(emp_id, invoice_*)" },
  { k: 10, from: "S", to: "L", text: "state_update (active -> completed)" },
  { k: 11, from: "S", to: "W", text: "POST /api/event (session_finish)" },
] as const;
