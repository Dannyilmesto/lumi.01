import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Assistente AI | Lumi",
};

export default async function AssistantPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <main className="lumi-chat-route" aria-labelledby="lumi-chat-page-title">
      <h1 id="lumi-chat-page-title" className="sr-only">
        Conversazione con Lumi AI
      </h1>
    </main>
  );
}
