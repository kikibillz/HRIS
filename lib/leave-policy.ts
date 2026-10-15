export const allowances: Record<string, number> = {
  "Annual leave": 20,
  "Sick leave": 10,
  "Personal leave": 5,
};
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function workdays(start: string, end: string) {
  let count = 0;
  for (
    let time = Date.parse(start + "T00:00:00Z");
    time <= Date.parse(end + "T00:00:00Z");
    time += 86400000
  ) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
