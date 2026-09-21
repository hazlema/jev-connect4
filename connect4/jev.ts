// Thin wrapper: one Jev call in, one fully-logged JevRound out.

import { callSystemOne } from "../src/jev-client";
import type { AskFn } from "./strategies/types";

export function makeAsk(fetchImpl?: typeof fetch): AskFn {
  return async (label, state, questions) => {
    const { answers, latencyMs } = await callSystemOne(state, questions, fetchImpl ?? fetch);
    return { label, state, questions, answers, latencyMs };
  };
}
