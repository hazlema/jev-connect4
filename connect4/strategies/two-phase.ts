// User's staging idea: request 1 is pure perception (where are the
// completable 3-in-a-lines?), code turns threats into a move; only with no
// threats does request 2 ask for a positional preference.

import type { ChoiceQuestion, NoulAnswer } from "../../src/jev-client";
import { legalColumns, opponent, type Board, type Player } from "../engine";
import { positionalQuestion } from "./decomposed";
import {
  boardState, colKey, parseCol, pickFromChoice, RULES, WIN_CONDITION,
  type JevRound, type Strategy,
} from "./types";

export const THREAT_THRESHOLD = 0.5;

function threatQuestion(p: Player, legal: number[]): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      `Connect Four position in \`grid_rows_top_to_bottom\` / ` +
      `\`columns_bottom_to_top\` (legend in \`grid_legend\`, full rules in ` +
      `\`rules\`). A dropped piece falls to the lowest empty cell of its column. ` +
      `Consider ONLY ${p}'s pieces. Is there a column where dropping ONE ${p} ` +
      `piece right now would complete 4 adjacent ${p} pieces in a straight line ` +
      `(${WIN_CONDITION})? Pick that column, or "none".`,
    criteria: {
      ...Object.fromEntries(
        legal.map((c) => [
          colKey(c),
          `A ${p} piece dropped into column ${c} completes 4 in a line for ${p}.`,
        ])
      ),
      none: `No single ${p} drop completes 4 in a line right now.`,
    },
  };
}

// A trusted threat: a colN choice over threshold. "none" means no threat.
function detectedColumn(ans: NoulAnswer | undefined, legal: number[]): { column: number; p: number } | null {
  if (!ans) return null;
  const column = parseCol(ans.choice ?? "");
  if (column === null || !legal.includes(column)) return null;
  const p = ans.probabilities?.[colKey(column)] ?? ans.confidence ?? 0;
  return p >= THREAT_THRESHOLD ? { column, p } : null;
}

export const twoPhase: Strategy = {
  name: "two-phase",
  async pickMove(board: Board, me: Player, ask) {
    const legal = legalColumns(board);
    const opp = opponent(me);
    const state = { rules: RULES, ...boardState(board) };

    const scan = await ask("threat-scan", state, {
      my_threat: threatQuestion(me, legal),
      opp_threat: threatQuestion(opp, legal),
    });
    const rounds: JevRound[] = [scan];

    const mine = detectedColumn(scan.answers.my_threat, legal);
    if (mine)
      return {
        column: mine.column,
        rounds,
        decision: `two-phase win: col ${mine.column} @ ${mine.p.toFixed(2)}`,
      };

    const theirs = detectedColumn(scan.answers.opp_threat, legal);
    if (theirs)
      return {
        column: theirs.column,
        rounds,
        decision: `two-phase block: col ${theirs.column} @ ${theirs.p.toFixed(2)}`,
      };

    const posRound = await ask("position", state, { pos: positionalQuestion(me, legal) });
    rounds.push(posRound);
    const pos = pickFromChoice(posRound.answers.pos, legal);
    return {
      column: pos.column,
      rounds,
      decision: `two-phase positional: col ${pos.column} @ ${pos.p.toFixed(2)}`,
    };
  },
};
