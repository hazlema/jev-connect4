import { test, expect } from "bun:test";
import {
  ROWS, COLS, emptyBoard, opponent, legalColumns, landingRow, drop, winner, status,
  linesThrough, groundTruth,
  type Board, type Player,
} from "./engine";

// Play columns alternately starting with `first`.
function play(cols: number[], first: Player = "yellow"): Board {
  let b = emptyBoard();
  let p: Player = first;
  for (const c of cols) {
    b = drop(b, c, p).board;
    p = opponent(p);
  }
  return b;
}

test("empty board: all columns legal, no winner, ongoing", () => {
  const b = emptyBoard();
  expect(b.length).toBe(ROWS);
  expect(b[0].length).toBe(COLS);
  expect(legalColumns(b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(winner(b)).toBeNull();
  expect(status(b)).toEqual({ state: "ongoing" });
});

test("gravity: pieces stack from the bottom", () => {
  let b = emptyBoard();
  const d1 = drop(b, 3, "yellow");
  expect(d1.row).toBe(0);
  const d2 = drop(d1.board, 3, "red");
  expect(d2.row).toBe(1);
  expect(d2.board[0][3]).toBe("yellow");
  expect(d2.board[1][3]).toBe("red");
  expect(b[0][3]).toBeNull(); // drop is pure
});

test("full column: landingRow -1, not legal, drop throws", () => {
  let b = emptyBoard();
  for (let i = 0; i < ROWS; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board;
  expect(landingRow(b, 0)).toBe(-1);
  expect(legalColumns(b)).not.toContain(0);
  expect(() => drop(b, 0, "yellow")).toThrow(/full/);
  expect(() => drop(b, 7, "yellow")).toThrow(/range/);
  expect(() => drop(b, -1, "yellow")).toThrow(/range/);
});

test("horizontal win", () => {
  // yellow: 0,1,2,3 bottom row; red: 0,1,2 second row
  const b = play([0, 0, 1, 1, 2, 2, 3]);
  expect(winner(b)).toBe("yellow");
  expect(status(b)).toEqual({ state: "won", winner: "yellow" });
});

test("vertical win", () => {
  const b = play([2, 5, 2, 5, 2, 5, 2]);
  expect(winner(b)).toBe("yellow");
});

test("diagonal up-right win", () => {
  // classic staircase: yellow at (0,0),(1,1),(2,2),(3,3)
  const b = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  expect(winner(b)).toBe("yellow");
});

test("diagonal up-left win", () => {
  const b = play([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
  expect(winner(b)).toBe("yellow");
});

test("no false positive across the board edge", () => {
  // yellow at cols 5,6 bottom row and cols 0,1 of row 1 must NOT wrap into a win
  let b = emptyBoard();
  b = drop(b, 5, "yellow").board;
  b = drop(b, 6, "yellow").board;
  b = drop(b, 0, "red").board;
  b = drop(b, 1, "red").board;
  b = drop(b, 0, "yellow").board;
  b = drop(b, 1, "yellow").board;
  expect(winner(b)).toBeNull();
});

test("draw: full board without four in a line", () => {
  // Even columns YYRRYY, odd columns RRYYRR (bottom to top). Rows alternate
  // color every column (no horizontal 4), columns run in pairs (no vertical
  // 4), and along any diagonal the color changes at least once every 2 steps
  // (no diagonal 4). Not move-order-reachable, but fine for detection tests.
  let b = emptyBoard();
  const even: Player[] = ["yellow", "yellow", "red", "red", "yellow", "yellow"];
  const odd: Player[] = ["red", "red", "yellow", "yellow", "red", "red"];
  for (let c = 0; c < COLS; c++) {
    for (const p of c % 2 === 0 ? even : odd) b = drop(b, c, p).board;
  }
  expect(winner(b)).toBeNull();
  expect(legalColumns(b)).toEqual([]);
  expect(status(b)).toEqual({ state: "draw" });
});

test("linesThrough corner (0,0) has exactly 3 lines", () => {
  // horizontal right, vertical up, diagonal up-right; up-left is out of bounds
  const lines = linesThrough(0, 0);
  expect(lines.length).toBe(3);
  for (const line of lines) {
    expect(line.length).toBe(4);
    expect(line).toContainEqual([0, 0]);
  }
});

test("linesThrough center cell (2,3) has 4+ lines in all directions", () => {
  const lines = linesThrough(2, 3);
  expect(lines.length).toBe(4 + 3 + 3 + 3); // h:4, v:3, dr:3, dl:3
  for (const line of lines) expect(line).toContainEqual([2, 3]);
});

test("groundTruth flags winsNow", () => {
  const b = play([2, 5, 2, 5, 2, 5]); // yellow has 3 stacked in col 2
  const t = groundTruth(b, "yellow");
  expect(t.find((x) => x.column === 2)).toMatchObject({ winsNow: true });
  expect(t.find((x) => x.column === 0)).toMatchObject({ winsNow: false });
});

test("groundTruth flags blocksWin for the opponent's completing column", () => {
  const b = play([2, 5, 2, 5, 2, 5]); // red has 3 stacked in col 5
  const t = groundTruth(b, "yellow");
  expect(t.find((x) => x.column === 5)).toMatchObject({ blocksWin: true });
  expect(t.find((x) => x.column === 1)).toMatchObject({ blocksWin: false });
});

test("groundTruth flags handsWin when dropping gives opponent the cell above", () => {
  // Bottom-row supports are mixed colors so yellow's own drop does NOT win.
  // Red holds (1,1),(1,2),(1,3): red completes 4 at (1,0) or (1,4), each
  // reachable only once someone fills the row-0 cell below it.
  let b = emptyBoard();
  b = drop(b, 1, "yellow").board;
  b = drop(b, 2, "red").board;
  b = drop(b, 3, "yellow").board;
  b = drop(b, 1, "red").board;
  b = drop(b, 2, "red").board;
  b = drop(b, 3, "red").board;
  const t = groundTruth(b, "yellow");
  // col 0: yellow drop lands row 0; opp dropping col 0 next (row 1 above) wins -> handsWinAbove true
  expect(t.find((x) => x.column === 0)).toMatchObject({ winsNow: false, handsWin: true, handsWinAbove: true });
  // col 4: same reasoning
  expect(t.find((x) => x.column === 4)).toMatchObject({ winsNow: false, handsWin: true, handsWinAbove: true });
  expect(t.find((x) => x.column === 6)).toMatchObject({ handsWin: false, handsWinAbove: false });
});

test("handsWinAbove only flags wins in the same column's cell above", () => {
  // Build a board where red has 3 stacked in col 5 (wins by dropping col 5),
  // but col 5 is not above yellow's drop in col 2.
  // yellow at (0,6),(1,6),(2,6) — irrelevant stacking in col 6
  // red   at (0,5),(1,5),(2,5) — needs one more in col 5 to win
  let b = emptyBoard();
  for (let i = 0; i < 3; i++) {
    b = drop(b, 6, "yellow").board;
    b = drop(b, 5, "red").board;
  }
  const t = groundTruth(b, "yellow");
  // col 2 for yellow: winsNow false (no yellow line), handsWin true (red wins col 5),
  // handsWinAbove false (opp dropping col 2 on top of yellow's col 2 drop is not a red win)
  expect(t.find((x) => x.column === 2)).toMatchObject({ winsNow: false, handsWin: true, handsWinAbove: false });
  // col 5 must be blocked (red completes 4 there)
  expect(t.find((x) => x.column === 5)).toMatchObject({ blocksWin: true });
});

test("groundTruth only reports legal columns", () => {
  let b = emptyBoard();
  for (let i = 0; i < ROWS; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board;
  const t = groundTruth(b, "yellow");
  expect(t.map((x) => x.column)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("groundTruth flags makesThree when a drop builds three-with-one-empty", () => {
  let b = emptyBoard();
  b = drop(b, 2, "yellow").board;
  b = drop(b, 2, "yellow").board; // yellow pair stacked in col 2
  const t = groundTruth(b, "yellow");
  expect(t.find((x) => x.column === 2)).toMatchObject({ makesThree: true }); // vertical 3, top cell empty
  expect(t.find((x) => x.column === 6)).toMatchObject({ makesThree: false });
});

test("groundTruth flags capsTwo against an adjacent open two", () => {
  let b = emptyBoard();
  b = drop(b, 2, "red").board;
  b = drop(b, 3, "red").board; // red open two on the bottom row: . . R R . . .
  const t = groundTruth(b, "yellow");
  expect(t.find((x) => x.column === 1)).toMatchObject({ capsTwo: true });
  expect(t.find((x) => x.column === 4)).toMatchObject({ capsTwo: true });
  expect(t.find((x) => x.column === 6)).toMatchObject({ capsTwo: false });
});

test("capsTwo requires the capping cell to TOUCH the pair (no gap caps)", () => {
  let b = emptyBoard();
  b = drop(b, 3, "red").board;
  b = drop(b, 4, "red").board; // red pair on row 0: cols 3,4
  const t = groundTruth(b, "yellow");
  expect(t.find((x) => x.column === 2)).toMatchObject({ capsTwo: true });  // touches at left
  expect(t.find((x) => x.column === 5)).toMatchObject({ capsTwo: true });  // touches at right
  expect(t.find((x) => x.column === 1)).toMatchObject({ capsTwo: false }); // gap at 2 — useless
  expect(t.find((x) => x.column === 6)).toMatchObject({ capsTwo: false }); // gap at 5 — useless
});
