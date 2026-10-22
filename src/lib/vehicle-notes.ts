export const MAX_VEHICLE_NOTES_LENGTH = 32_767;
export const MAX_REENTRY_NOTES_LENGTH = 5_000;

export function appendReentryNotes(
  previousNotes: string | null | undefined,
  newNotes: string | undefined,
  nextCycle: number,
  inboundAt: string,
): string | null | undefined {
  const notes = newNotes?.trim();
  if (!notes) return previousNotes;

  const section = `【第 ${nextCycle} 轮入库 · ${inboundAt}】\n${notes}`;
  return previousNotes ? `${previousNotes}\n\n${section}` : section;
}
