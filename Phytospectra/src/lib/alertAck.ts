const ACK_IDS_KEY = "phytospectra_alerts_ack_ids";
/** @deprecated migrated to ID set — kept for one-time migration */
const ACK_AT_KEY = "phytospectra_alerts_ack_at";

function readAckIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeAckIds(ids: Set<string>): void {
  try {
    localStorage.setItem(ACK_IDS_KEY, JSON.stringify([...ids]));
    localStorage.removeItem(ACK_AT_KEY);
  } catch {
    /* ignore */
  }
}

/** One-time: convert old timestamp ack into explicit alert IDs. */
export function migrateTimestampAck(
  alerts: { id: string; created_at: string }[],
): void {
  const ackAt = localStorage.getItem(ACK_AT_KEY);
  if (!ackAt || readAckIds().size > 0) return;

  const ackMs = new Date(ackAt).getTime();
  const ids = alerts
    .filter((a) => new Date(a.created_at).getTime() <= ackMs)
    .map((a) => a.id);

  if (ids.length > 0) {
    const set = readAckIds();
    ids.forEach((id) => set.add(id));
    writeAckIds(set);
  } else {
    localStorage.removeItem(ACK_AT_KEY);
  }
}

/** Mark specific alerts as seen (call from the Stress Alerts page). */
export function acknowledgeAlertIds(alerts: { id: string }[]): void {
  if (alerts.length === 0) return;
  const ids = readAckIds();
  alerts.forEach((a) => ids.add(a.id));
  writeAckIds(ids);
}

export function countUnacknowledged(
  alerts: { id: string; created_at: string }[],
): number {
  migrateTimestampAck(alerts);
  const acked = readAckIds();
  if (acked.size === 0) return alerts.length;
  return alerts.filter((a) => !acked.has(a.id)).length;
}

/** Clear ack state — useful after testing. */
export function resetAlertAcknowledgements(): void {
  try {
    localStorage.removeItem(ACK_IDS_KEY);
    localStorage.removeItem(ACK_AT_KEY);
  } catch {
    /* ignore */
  }
}
