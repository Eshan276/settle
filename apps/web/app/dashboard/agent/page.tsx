import { redirect } from "next/navigation";

// AI autopay now lives inside Bills.
export default function AgentRedirect() {
  redirect("/dashboard/bills");
}
