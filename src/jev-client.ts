export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>; // option name -> description
}

export type Question = NoulQuestion | ChoiceQuestion;

// noul answers carry `noul`; choice answers carry `choice`/`probabilities`.
export interface NoulAnswer {
  type: string;
  noul: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface SystemOneResult {
  answers: Record<string, NoulAnswer>;
  latencyMs: number;
}

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const RETRY_DELAY_MS = 2000;

// A stalled connection with no timeout hangs callers forever (seen live in
// connect4: one stalled fetch froze the game with no error). Abort instead;
// the retry loop below turns one stall into a retry, two into a thrown error.
const DEFAULT_TIMEOUT_MS = 30_000;

export async function callSystemOne(
  state: unknown,
  questions: Record<string, Question>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<SystemOneResult> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set — put it in jav/.env");
  const body = JSON.stringify({ state, model: "jev-latest", questions });
  let lastErr: Error | null = null;
  const start = performance.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 401 || res.status === 403) {
        throw new FatalAuthError(`HTTP ${res.status}: check TYPESAFE_API_KEY`);
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        if (res.status === 429 || res.status === 529) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        }
        continue;
      }
      const json = (await res.json()) as { answers: Record<string, NoulAnswer> };
      return { answers: json.answers, latencyMs: performance.now() - start };
    } catch (e) {
      if (e instanceof FatalAuthError) throw e;
      lastErr =
        e instanceof DOMException && e.name === "TimeoutError"
          ? new Error(`Jev request timed out after ${timeoutMs}ms`)
          : (e as Error);
    }
  }
  throw lastErr ?? new Error("systemOne call failed");
}

export class FatalAuthError extends Error {}
