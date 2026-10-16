import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import Operations from "./operations";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await currentUser())) redirect("/login");
  return <Operations />;
}
