import { db } from "./db";
import { allowances, workdays } from "./leave-policy";
export { allowances, validDate, workdays } from "./leave-policy";
export function balances(employeeId: number, year: number) {
  const rows = db
    .prepare(
      "SELECT type,start,end,status FROM leaves WHERE employee_id=? AND status IN ('Pending','Approved') AND substr(start,1,4)=?",
    )
    .all(employeeId, String(year)) as {
    type: string;
    start: string;
    end: string;
    status: string;
  }[];
  return Object.entries(allowances).map(([type, total]) => {
    const matching = rows.filter((r) => r.type === type);
    const used = matching
      .filter((r) => r.status === "Approved")
      .reduce((n, r) => n + workdays(r.start, r.end), 0);
    const reserved = matching
      .filter((r) => r.status === "Pending")
      .reduce((n, r) => n + workdays(r.start, r.end), 0);
    return {
      type,
      total,
      used,
      reserved,
      available: total - used - reserved,
      year,
    };
  });
}
