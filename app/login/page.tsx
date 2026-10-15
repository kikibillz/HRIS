import { redirect } from "next/navigation";
import { currentUser, setupAvailable } from "@/lib/auth";
import Login from "./sign-in";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return <Login setup={setupAvailable()} />;
}
