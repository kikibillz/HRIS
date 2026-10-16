import { db } from "./db";
import type { User } from "./auth";
import { onboardingDay } from "./onboarding-date";
export { onboardingDay } from "./onboarding-date";
export function onboardingProgress(
  user: User,
  id?: number,
  today = onboardingDay(),
) {
  if (!["admin", "manager"].includes(user.access)) return [];
  return db
    .prepare(
      `SELECT a.id,a.title,a.due AS start_date,e.id AS employee_id,e.name,
    COUNT(t.id) AS total,SUM(CASE WHEN t.status='Done' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN t.status='Open' AND t.due<>'' AND t.due<? THEN 1 ELSE 0 END) AS overdue,
    MIN(CASE WHEN t.status='Open' AND t.due<>'' THEN t.due END) AS next_due
    FROM hr_records a JOIN employees e ON e.id=a.employee_id JOIN company_employees ce ON ce.employee_id=e.id AND ce.company_id=a.company_id
    LEFT JOIN hr_records t ON t.reference_id=a.id AND t.kind='tasks' AND t.company_id=a.company_id AND t.employee_id=a.employee_id
    WHERE a.company_id=? AND a.kind='onboarding_assignment' AND e.status='Active' AND (? IS NULL OR a.id=?)
    ${user.access === "manager" ? "AND EXISTS (SELECT 1 FROM reporting_lines r WHERE r.employee_id=e.id AND r.manager_id=?)" : ""}
    GROUP BY a.id ORDER BY a.id DESC LIMIT 100`,
    )
    .all(
      today,
      user.company_id,
      id ?? null,
      id ?? null,
      ...(user.access === "manager" ? [user.id] : []),
    ) as {
    id: number;
    title: string;
    start_date: string;
    employee_id: number;
    name: string;
    total: number;
    completed: number;
    overdue: number;
    next_due: string | null;
  }[];
}
