export type Person = {
  id: number;
  name: string;
  email: string;
  role: string;
  joined: string;
  status: string;
  account_access: string | null;
  department: string;
};
export type Context = {
  user: {
    id: number;
    employee_id: number;
    company_id: number;
    name: string;
    access: "admin" | "manager" | "employee";
  };
  company: { name: string; created: string };
  employees: Person[];
  peers: { id: number; name: string }[];
  managed: { employee_id: number }[];
  ai_configured: boolean;
};
export type Row = {
  id: number;
  title: string;
  body: string;
  status: string;
  employee_id: number | null;
  reviewer_id: number | null;
  reference_id: number | null;
  progress: number;
  due: string;
  created: string;
  data: Record<string, string | number>;
  review_hash?: string;
  acknowledgment?: {
    record_id: number;
    employee_id: number;
    actor_id: number;
    review_hash: string;
    created: string;
  } | null;
};
export async function api(path: string, body?: unknown, method = "POST") {
  const response = await fetch(
    "/api/" + path,
    body === undefined
      ? { cache: "no-store" }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Request failed.");
  return result;
}
export const amount = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    kobo / 100,
  );
export const dateTime = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) +
  " WAT";
