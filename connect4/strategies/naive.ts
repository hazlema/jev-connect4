// The control: raw board, one "pick the best move" Choice. Expected weak —
// this is deliberately what the beatable checkers demo did.

import type { ChoiceQuestion } from "../../src/jev-client";
import { legalColumns, type Board, type Player } from "../engine";
import {
  boardState, colKey, pickFromChoice, RULES,
  type Strategy,
} from "./types";

export const naive: Strategy = {
  name: "naive",
  async pickMove(board: Board, me: Player, ask) {
    const legal = legalColumns(board);
    const question: ChoiceQuestion = {
      type: "choice",
      instructions:
        `You are playing Connect Four as ${me}. The full rules are in \`rules\`; ` +
        `the current position is in \`grid_rows_top_to_bottom\` and ` +
        `\`columns_bottom_to_top\` (see \`grid_legend\`). Choose the single best ` +
        `column for ${me} to drop a piece into right now.`,
      criteria: Object.fromEntries(
        legal.map((c) => [colKey(c), `Drop the ${me} piece into column ${c}.`])
      ),
    };
    const round = await ask(
      "best-move",
      { rules: RULES, ...boardState(board) },
      { move: question }
    );
    const { column, p } = pickFromChoice(round.answers.move, legal);
    return {
      column,
      rounds: [round],
      decision: `naive: col ${column} @ ${p.toFixed(2)}`,
    };
  },
};
