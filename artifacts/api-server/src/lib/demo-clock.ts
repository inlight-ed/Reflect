/**
 * The demo dataset was authored around one snapshot (18 Aug 2026, 09:42 Almaty).
 * Instead of showing that frozen date forever, every demo date is shifted by whole
 * days so the snapshot always lands on "today" (or yesterday, before 09:42).
 *
 * Set DEMO_SNAPSHOT_DATE=2026-08-18 to pin the original dates (used by e2e tests).
 */
const AUTHORED_SNAPSHOT = Date.parse("2026-08-18T09:42:00+05:00");
const DAY = 86_400_000;

function offsetDays(now = Date.now()): number {
  const pinned = process.env["DEMO_SNAPSHOT_DATE"];
  if (pinned) {
    const pinnedAt = Date.parse(`${pinned}T09:42:00+05:00`);
    if (!Number.isNaN(pinnedAt)) return Math.round((pinnedAt - AUTHORED_SNAPSHOT) / DAY);
  }
  const days = Math.floor((now - AUTHORED_SNAPSHOT) / DAY);
  return days;
}

/** Shift an authored ISO timestamp so it keeps the same distance to the snapshot. */
export function demoTimestamp(authored: string): string {
  return new Date(Date.parse(authored) + offsetDays() * DAY).toISOString();
}

/** Shift an authored YYYY-MM-DD date. */
export function demoDay(authored: string): string {
  return new Date(Date.parse(`${authored}T12:00:00Z`) + offsetDays() * DAY).toISOString().slice(0, 10);
}

/** Time of the demo snapshot: today 09:42 Almaty, or yesterday if it is earlier than that. */
export function demoRefreshedAt(): string {
  return demoTimestamp("2026-08-18T09:42:00+05:00");
}

/** Today's date in Almaty as YYYY-MM-DD, after the demo shift. */
export function demoToday(): string {
  return demoDay("2026-08-18");
}
