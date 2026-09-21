// One batched request: per legal column, three tactical Nouls; plus one
// positional Choice. Code owns the priority policy (combineTactics).

import type { ChoiceQuestion, NoulQuestion, Question } from "../../src/jev-client";
import { legalColumns, opponent, type Board, type Player } from "../engine";
import {
  boardState, colKey, combineTactics, RULES, WIN_CONDITION,
  type Strategy,
} from "./types";

export function positionalQuestion(me: Player, legal: number[]): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      `Connect Four (full rules in \`rules\`; position in ` +
      `\`grid_rows_top_to_bottom\` / \`columns_bottom_to_top\`, see \`grid_legend\`). ` +
      `Assume ${me} has no immediate win and faces no immediate loss. Which column ` +
      `gives ${me} the best long-term position? Favor central columns, moves that ` +
      `create two overlapping ways to make 4-in-a-line, and moves that build ` +
      `threats stacked above each other.`,
    criteria: Object.fromEntries(
      legal.map((c) => [colKey(c), `Drop the ${me} piece into column ${c}.`])
    ),
  };
}

function tacticQuestions(me: Player, c: number): Record<string, NoulQuestion> {
  const opp = opponent(me);
  const shared =
    `Connect Four: a dropped piece falls to the lowest empty cell of its column. ` +
    `${WIN_CONDITION}. Full rules in \`rules\`; position in ` +
    `\`grid_rows_top_to_bottom\` / \`columns_bottom_to_top\` (see \`grid_legend\`).`;
  return {
    [`win_${c}`]: {
      type: "noul",
      instructions:
        `${shared} If ${me} drops a piece into column ${c} right now, does ${me} ` +
        `then have 4 ${me} pieces in an adjacent straight line?`,
      criteria: {
        true: `After the drop, some straight line of 4 adjacent cells holds 4 ${me} pieces — ${me} wins immediately.`,
        false: `No straight line of 4 adjacent ${me} pieces exists after the drop.`,
      },
    },
    [`block_${c}`]: {
      type: "noul",
      instructions:
        `${shared} If ${opp} (the opponent, NOT ${me}) dropped a piece into column ` +
        `${c} right now, would ${opp} then have 4 ${opp} pieces in an adjacent ` +
        `straight line? (If yes, ${me} playing column ${c} first blocks that win.)`,
      criteria: {
        true: `A ${opp} piece landing in column ${c} completes 4 adjacent ${opp} pieces in a straight line.`,
        false: `A ${opp} piece landing in column ${c} does not complete 4 in a line for ${opp}.`,
      },
    },
    [`hand_${c}`]: {
      type: "noul",
      instructions:
        `${shared} Suppose ${me} drops a piece into column ${c} now. On the very ` +
        `next turn, is there ANY column where ${opp} can drop one piece and ` +
        `immediately have 4 ${opp} pieces in an adjacent straight line? Pay ` +
        `special attention to the cell directly above ${me}'s new piece, which ` +
        `${me}'s move makes reachable.`,
      criteria: {
        true: `After ${me}'s drop in column ${c}, at least one ${opp} drop immediately completes 4 in a line for ${opp}.`,
        false: `After ${me}'s drop in column ${c}, no single ${opp} drop completes 4 in a line.`,
      },
    },
  };
}

export const decomposed: Strategy = {
  name: "decomposed",
  async pickMove(board: Board, me: Player, ask) {
    const legal = legalColumns(board);
    const questions: Record<string, Question> = { pos: positionalQuestion(me, legal) };
    for (const c of legal) Object.assign(questions, tacticQuestions(me, c));

    const round = await ask("move-eval", { rules: RULES, ...boardState(board) }, questions);

    const noulAt = (id: string) => round.answers[id]?.noul ?? 0;
    const { column, decision } = combineTactics(legal, noulAt, round.answers.pos);
    return { column, rounds: [round], decision: `decomposed ${decision}` };
  },
};
