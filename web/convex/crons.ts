import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.cron("daily job discovery", "0 13 * * *", (internal as any).autoDiscovery.queueDueRuns, {});
export default crons;
