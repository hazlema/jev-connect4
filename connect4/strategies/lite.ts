// Token-optimization experiment: radar's exact policy and question IDs,
// but the shared framing lives ONCE in state (`reading`) and questions
// shrink to 1-2 sentences referencing it. Two representations under test:
//   radar-trim — word cells ("yellow", "(this move)")
//   radar-sym  — 4-char symbol lines (Y R . * ^), key in `reading`
// Same round label as spoonfed/radar so grading and ticks work unchanged.

import type { ChoiceQuestion, NoulQuestion, Question } from "../../src/jev-client";
import {
  drop, landingRow, legalColumns, linesThrough, opponent, ROWS,
  type Board, type Player,
} from "../engine";
import { decideFromAnswers, type Rung } from "./radar";
import { colKey, type Strategy } from "./types";

type CellStyle = "words" | "symbols";

const RUNGS: Rung[] = ["win", "block", "cap", "open3"];

const SYM: Record<string, string> = { yellow: "Y", red: "R" };

interface Marks {
  move: string;   // the landing cell of this candidate move
  above: string;  // the cell the opponent could take after this move
}
const MARKS: Record<CellStyle, Marks> = {
  words: { move: "(this move)", above: "(opponent's next piece)" },
  symbols: { move: "*", above: "^" },
};

function reading(style: CellStyle): string {
  const base =
    "Each entry in `candidates.colN.lines` is one straight line of 4 " +
    "adjacent Connect Four cells through the cell where a piece dropped " +
    "into column N would land, in board order. Four pieces of one color " +
    "filling a whole line wins. `lines_above` are the lines through the " +
    "cell directly above that landing cell, on the board AFTER the drop " +
    "(the opponent could take that upper cell next turn).";
  if (style === "words") {
    return (
      base +
      ' "(this move)" marks the landing cell; "(opponent\'s next piece)" marks the upper cell.'
    );
  }
  return (
    base +
    " Each line is a 4-character string: Y = yellow piece, R = red piece, " +
    ". = empty, * = the landing cell of this move, ^ = the upper cell the " +
    "opponent could take next turn."
  );
}

function renderLine(
  board: Board,
  cells: [number, number][],
  target: [number, number],
  mark: string,
  style: CellStyle
): string[] | string {
  const parts = cells.map(([r, c]) => {
    if (r === target[0] && c === target[1]) return mark;
    const v = board[r][c];
    if (style === "words") return v ?? "empty";
    return v === null ? "." : SYM[v];
  });
  return style === "symbols" ? parts.join("") : parts;
}

function candidate(board: Board, me: Player, c: number, style: CellStyle) {
  const row = landingRow(board, c);
  const marks = MARKS[style];
  const result: Record<string, unknown> = {
    lines: linesThrough(row, c).map((cells) =>
      renderLine(board, cells, [row, c], marks.move, style)
    ),
  };
  if (row + 1 < ROWS) {
    const after = drop(board, c, me).board;
    result.lines_above = linesThrough(row + 1, c).map((cells) =>
      renderLine(after, cells, [row + 1, c], marks.above, style)
    );
  }
  return result;
}

// Compact board summary for the positional question only.
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

function liteQuestions(
  me: Player,
  c: number,
  hasAbove: boolean,
  style: CellStyle
): Record<string, NoulQuestion> {
  const opp = opponent(me);
  const marks = MARKS[style];
  const MV = style === "symbols" ? "*" : `"${marks.move}"`;
  const AB = style === "symbols" ? "^" : `"${marks.above}"`;
  const ME = style === "symbols" ? `${me} (${SYM[me]})` : me;
  const OP = style === "symbols" ? `${opp} (${SYM[opp]})` : opp;
  const EMPTY = style === "symbols" ? "." : `"empty"`;
  const path = `\`candidates.${colKey(c)}.lines\``;
  const gapEx =
    style === "symbols"
      ? `*.${SYM[opp]}${SYM[opp]}`
      : `${MV}, empty, ${opp}, ${opp}`;
  const qs: Record<string, NoulQuestion> = {
    [`win_${c}`]: {
      type: "noul",
      instructions: `See \`reading\`. If the ${MV} cell in ${path} becomes a ${ME} piece, is at least one line then four ${ME} pieces?`,
      criteria: {
        true: `Some line is ${MV} plus three ${ME} cells.`,
        false: `Every line has an empty or ${OP} cell besides ${MV}.`,
      },
    },
    [`block_${c}`]: {
      type: "noul",
      instructions: `See \`reading\`. If the ${MV} cell in ${path} instead became a ${OP} piece, would at least one line be four ${OP} pieces? (Then ${ME} taking it first blocks that win.)`,
      criteria: {
        true: `Some line is ${MV} plus three ${OP} cells.`,
        false: `Every line has an empty or ${ME} cell besides ${MV}.`,
      },
    },
    [`open3_${c}`]: {
      type: "noul",
      instructions:
        `Each entry in ${path} is one straight line of 4 adjacent cells (in ` +
        `board order) through the cell where a piece dropped into column ${c} ` +
        `lands; ${MV} marks that landing cell. If the ${MV} cell becomes a ` +
        `${ME} piece, does at least one listed line then hold exactly THREE ` +
        `${ME} pieces plus one ${EMPTY} cell — a developing line one move away from four?`,
      criteria: {
        true: `Some listed line is ${MV} plus exactly two ${ME} cells and one ${EMPTY} cell — one more ${ME} piece there would complete four.`,
        false: `No listed line becomes three ${ME} with a single ${EMPTY} remainder.`,
      },
    },
    [`cap_${c}`]: {
      type: "noul",
      instructions: `See \`reading\`. Does some line in ${path} read ${MV} DIRECTLY NEXT TO two adjacent ${OP} cells, with the remaining cell empty? A gap between ${MV} and the ${OP} pair (like ${gapEx}) does NOT count.`,
      criteria: {
        true: `Some line has ${MV} touching an adjacent ${OP}-${OP} pair, fourth cell empty.`,
        false: `No such line; gap-separated patterns do not count.`,
      },
    },
  };
  if (hasAbove) {
    qs[`hand_${c}`] = {
      type: "noul",
      instructions: `See \`reading\`. In \`candidates.${colKey(c)}.lines_above\`, would a ${OP} piece at ${AB} complete four ${OP} pieces in a line?`,
      criteria: {
        true: `Some line there is ${AB} plus three ${OP} cells — this move hands ${OP} the win.`,
        false: `Every such line has an empty or ${ME} cell besides ${AB}.`,
      },
    };
  }
  return qs;
}

function posQuestion(me: Player, legal: number[]): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      `\`stacks\` lists each column's pieces bottom-to-top (Y = yellow, R = red, ` +
      `empty string = empty column) on a 7-wide, 6-tall Connect Four grid. You are ${me}. ` +
      `No immediate tactic applies; pick the best column for ${me} long-term: prefer ` +
      `central columns and moves that develop more than one way to make four in a row.`,
    criteria: Object.fromEntries(legal.map((c) => [colKey(c), `Drop into column ${c}.`])),
  };
}

export function makeLite(
  name: string,
  style: CellStyle,
  // Experiment hook: extra state (e.g. redundant board views) merged in.
  extraState?: (board: Board) => Record<string, unknown>
): Strategy {
  return {
    name,
    async pickMove(board: Board, me: Player, ask) {
      const legal = legalColumns(board);
      const candidates: Record<string, unknown> = {};
      const questions: Record<string, Question> = { pos: posQuestion(me, legal) };
      for (const c of legal) {
        candidates[colKey(c)] = candidate(board, me, c, style);
        const hasAbove = landingRow(board, c) + 1 < ROWS;
        Object.assign(questions, liteQuestions(me, c, hasAbove, style));
      }

      const round = await ask(
        "move-eval-spoonfed",
        {
          reading: reading(style),
          stacks: stacks(board),
          candidates,
          ...(extraState?.(board) ?? {}),
        },
        questions
      );

      const { column, decision } = decideFromAnswers(name, legal, round, RUNGS);
      return { column, rounds: [round], decision };
    },
  };
}

export const radarTrim = makeLite("radar-trim", "words");
export const radarSym = makeLite("radar-sym", "symbols");
