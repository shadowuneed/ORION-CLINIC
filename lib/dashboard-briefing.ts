import { z } from 'zod';

// Only aggregate integers cross the provider boundary. Never accept patient text or IDs.
export const dashboardBriefingCountsSchema = z.object({
  openEncounters: z.number().int().min(0).max(100),
  reviewEncounters: z.number().int().min(0).max(100),
  urgentOrders: z.number().int().min(0).max(100),
  overdueCareTasks: z.number().int().min(0).max(100),
  manualVoiceTasks: z.number().int().min(0).max(100),
  queueExceptions: z.number().int().min(0).max(100),
}).strict();

export type DashboardBriefingCounts = z.infer<typeof dashboardBriefingCountsSchema>;

export const dashboardBriefingResponseSchema = z.object({
  summary: z.string().trim().min(1).max(450),
  priorities: z.array(z.string().trim().min(1).max(180)).max(3),
}).strict();
