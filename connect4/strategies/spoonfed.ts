// Decomposed questions, but the state does the spatial work: every 4-cell
// window through each candidate landing cell is pre-computed and marked, so
// Jev never scans the grid. Tests whether representation was the checkers
// demo's real failure.

import type { NoulQuestion, Question } from "../../src/jev-client";
import {
  drop, landingRow, legalColumns, linesThrough, opponent, ROWS,
  type Board, type Player,
} from "../engine";
import { positionalQuestion } from "./decomposed";
import {
  boardState, colKey, combineTactics, RULES,
  type Strategy, type TacticPriority,
} from "./types";

export const MOVE_MARK = "(this move)";
export const OPP_MARK = "(opponent's next piece)";

export function markedLines(
  board: Board,
  lines: [number, number][][],
  target: [number, number],
  mark: string
): string[][] {
  return lines.map((cells) =>
    cells.map(([r, c]) =>
      r === target[0] && c === target[1] ? mark : board[r][c] ?? "empty"
    )
  );
}

export function candidate(board: Board, me: Player, c: number) {
  const row = landingRow(board, c);
  const lines = markedLines(board, linesThrough(row, c), [row, c], MOVE_MARK);
  const result: Record<string, unknown> = {
    landing_cell: `column ${c}, row ${row} counting from the bottom row (row 0)`,
    lines_through_landing_cell: lines,
  };
  if (row + 1 < ROWS) {
    const after = drop(board, c, me).board;
    result.lines_after_my_drop_through_cell_above = markedLines(
      after, linesThrough(row + 1, c), [row + 1, c], OPP_MARK
    );
  }
  return result;
}

export function tacticQuestions(me: Player, c: number, hasAbove: boolean): Record<string, NoulQuestion> {
  const opp = opponent(me);
  const path = `\`candidates.${colKey(c)}.lines_through_landing_cell\``;
  const preamble =
    `Connect Four. Each entry in ${path} is one straight line of 4 adjacent ` +
    `cells (in board order) that passes through the cell where a piece dropped ` +
    `into column ${c} lands; "${MOVE_MARK}" marks that landing cell. 4 matching ` +
    `pieces filling one whole line wins.`;
  const qs: Record<string, NoulQuestion> = {
    [`win_${c}`]: {
      type: "noul",
      instructions:
        `${preamble} If the "${MOVE_MARK}" cell becomes a ${me} piece, is at ` +
        `least one of these lines then made of 4 ${me} pieces?`,
      criteria: {
        true: `Some listed line consists of "${MOVE_MARK}" plus 3 cells that all read "${me}".`,
        false: `Every listed line has at least one cell that is "empty" or "${opp}".`,
      },
    },
    [`block_${c}`]: {
      type: "noul",
      instructions:
        `${preamble} If instead the "${MOVE_MARK}" cell became a ${opp} piece ` +
        `(the opponent playing this column), would at least one line be 4 ${opp} ` +
        `pieces? (If yes, ${me} taking this cell first blocks ${opp}'s win.)`,
      criteria: {
        true: `Some listed line consists of "${MOVE_MARK}" plus 3 cells that all read "${opp}".`,
        false: `Every listed line has at least one cell that is "empty" or "${me}".`,
      },
    },
  };
  if (hasAbove) {
    const abovePath = `\`candidates.${colKey(c)}.lines_after_my_drop_through_cell_above\``;
    qs[`hand_${c}`] = {
      type: "noul",
      instructions:
        `Connect Four. If ${me} drops into column ${c}, the cell directly above ` +
        `${me}'s new piece becomes reachable for ${opp} next turn. Each entry in ` +
        `${abovePath} is a straight line of 4 adjacent cells through that upper ` +
        `cell, on the board AFTER ${me}'s drop; "${OPP_MARK}" marks the upper ` +
        `cell. Would a ${opp} piece there complete 4 ${opp} pieces in a line?`,
      criteria: {
        true: `Some listed line consists of "${OPP_MARK}" plus 3 cells that all read "${opp}" — playing column ${c} hands ${opp} the win.`,
        false: `Every listed line has at least one cell that is "empty" or "${me}".`,
      },
    };
  }
  return qs;
}

// Both variants share the questions, state, and round label; only the
// code-side priority differs.
function makeSpoonfed(name: string, priority: TacticPriority): Strategy {
  return {
    name,
    async pickMove(board: Board, me: Player, ask) {
      const legal = legalColumns(board);
      const candidates: Record<string, unknown> = {};
      const questions: Record<string, Question> = { pos: positionalQuestion(me, legal) };
      for (const c of legal) {
        candidates[colKey(c)] = candidate(board, me, c);
        const hasAbove = landingRow(board, c) + 1 < ROWS;
        Object.assign(questions, tacticQuestions(me, c, hasAbove));
      }

      const round = await ask(
        "move-eval-spoonfed",
        { rules: RULES, ...boardState(board), candidates },
        questions
      );

      const noulAt = (id: string) => round.answers[id]?.noul ?? 0;
      const { column, decision } = combineTactics(legal, noulAt, round.answers.pos, priority);
      return { column, rounds: [round], decision: `${name} ${decision}` };
    },
  };
}

export const spoonfed = makeSpoonfed("spoonfed", "win-first");
// blocker moved to radar.ts: reacting at two requires the cap question,
// which lives in the threat-strategy batch.
