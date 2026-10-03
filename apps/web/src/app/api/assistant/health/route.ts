import { auth } from "@/lib/auth";
import { getLLMProvider } from "@/lib/llm/llama-cpp-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "Accedi per continuare." }, { status: 401 });

  try {
    const health = await getLLMProvider().health(request.signal);
    return Response.json(health, { status: health.available ? 200 : 503 });
  } catch (error) {
    if (request.signal.aborted) throw error;
    console.error("Health check AI non riuscito.", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      {
        available: false,
        error:
          "Il motore AI locale non è disponibile. Verifica che llama.cpp sia avviato.",
      },
      { status: 503 },
    );
  }
}
