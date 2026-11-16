
export type StoredCampaign = {
  id: string;
  name: string;
  channel: string;
  startDate: string;
  endDate: string;
  budget: number;
  objective: string;
};

export class CampaignValidationError extends Error {}

export function validateCampaign(input: Omit<StoredCampaign, "id">): Omit<StoredCampaign, "id"> {
  const clean = {
    name: input.name.trim(),
    channel: input.channel.trim(),
    objective: input.objective.trim(),
    startDate: input.startDate.trim(),
    endDate: input.endDate.trim(),
    budget: Math.round(input.budget),
  };
  const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  if (!clean.name || clean.name.length > 120) throw new CampaignValidationError("name");
  if (!clean.channel || clean.channel.length > 60) throw new CampaignValidationError("channel");
  if (!clean.objective || clean.objective.length > 160) throw new CampaignValidationError("objective");
  if (!isDay(clean.startDate) || !isDay(clean.endDate) || clean.endDate < clean.startDate) throw new CampaignValidationError("dates");
  if (!Number.isFinite(clean.budget) || clean.budget < 0 || clean.budget > 10_000_000_000) throw new CampaignValidationError("budget");
  return clean;
}
