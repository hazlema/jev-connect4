// Selection-side decomposition, after sliday/jev-chess-algo (jevchess.com):
// the engine pre-computes every tactical fact and bakes plain-language
// verdicts INTO the Choice option descriptions; Jev answers ONE question as
// a strategist picking among annotated moves. Policy lives in language, not
// code — the counterpoint to radar's perceive-with-Nouls / decide-in-code.

import type { ChoiceQuestion } from "../../src/jev-client";
import {
  groundTruth, legalColumns, opponent, ROWS,
  type Board, type Player,
} from "../engine";
import { colKey, pickFromChoice, type Strategy } from "./types";

const SYM: Record<string, string> = { yellow: "Y", red: "R" };

function stacks(board: Board): Record<string, string> {
  const out: Record<string, string> = {};
  for (let c = 0; c < 7; c++) {
    let s = "";
    for (let r = 0; r < ROWS; r++) {
      const v = board[r][c];
      if (v) s += SYM[v];
    }
    out[colKey(c)] = s;
  }
  return out;
}

export const annotated: Strategy = {
  name: "annotated",
  async pickMove(board: Board, me: Player, ask) {
    const legal = legalColumns(board);
    const opp = opponent(me);
    const truth = groundTruth(board, me);
    const heights = stacks(board);

    const criteria: Record<string, string> = {};
    for (const t of truth) {
      const facts: string[] = [];
      if (t.winsNow) facts.push(`completes four in a row — ${me} WINS IMMEDIATELY`);
      if (t.blocksWin) facts.push(`occupies the square ${opp} needs — blocks ${opp}'s immediate win`);
      if (!t.winsNow && t.handsWin) facts.push(`WARNING: after this move ${opp} can drop and win at once — a serious blunder`);
      if (!t.winsNow && t.makesThree) facts.push(`builds three in a line for ${me} (one move from four)`);
      if (t.capsTwo) facts.push(`lands touching ${opp}'s developing pair, killing that line`);
      if (facts.length === 0) facts.push("quiet move: no immediate tactical consequence");
      criteria[colKey(t.column)] =
        `Drop into column ${t.column} (stack ${heights[colKey(t.column)].length}/6). ` +
        facts.join("; ") + ".";
    }

    const question: ChoiceQuestion = {
      type: "choice",
      instructions:
        `You are ${me} in Connect Four (7 columns, 6 rows; four in a straight ` +
        `line wins). Choose the best column. Every option's description states ` +
        `EXACT consequences verified by the game engine — facts, not guesses. ` +
        `\`stacks\` shows each column's pieces bottom-to-top (Y = yellow, ` +
        `R = red). Prefer winning immediately; otherwise block; never pick a ` +
        `"serious blunder" unless every option is one; otherwise favor central ` +
        `columns, building your threats and killing ${opp}'s.`,
      criteria,
    };

    const round = await ask(
      "annotated-choice",
      {
        you: me,
        stacks: heights,
        note: "Option descriptions are exact facts computed by the game engine.",
      },
      { move: question }
    );

    const { column, p } = pickFromChoice(round.answers.move, legal);
    return {
      column,
      rounds: [round],
      decision: `annotated: col ${column} @ ${p.toFixed(2)}`,
    };
  },
};
