// Pure Connect Four rules. board[row][col], row 0 = bottom.

export const ROWS = 6;
export const COLS = 7;

export type Player = "yellow" | "red";
export type Cell = Player | null;
export type Board = Cell[][];

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

export function opponent(p: Player): Player {
  return p === "yellow" ? "red" : "yellow";
}

export function legalColumns(board: Board): number[] {
  const cols: number[] = [];
  for (let c = 0; c < COLS; c++) if (board[ROWS - 1][c] === null) cols.push(c);
  return cols;
}

export function landingRow(board: Board, col: number): number {
  for (let r = 0; r < ROWS; r++) if (board[r][col] === null) return r;
  return -1;
}

export function drop(board: Board, col: number, p: Player): { board: Board; row: number } {
  if (col < 0 || col >= COLS) throw new Error(`column ${col} out of range`);
  const row = landingRow(board, col);
  if (row === -1) throw new Error(`column ${col} is full`);
  const next = board.map((r) => r.slice());
  next[row][col] = p;
  return { board: next, row };
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],  // horizontal
  [1, 0],  // vertical
  [1, 1],  // diagonal up-right
  [1, -1], // diagonal up-left
] as const;

export function winner(board: Board): Player | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) continue;
      for (const [dr, dc] of DIRS) {
        let n = 1;
        while (n < 4) {
          const rr = r + dr * n;
          const cc = c + dc * n;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr][cc] !== p) break;
          n++;
        }
        if (n === 4) return p;
      }
    }
  }
  return null;
}

export type Status =
  | { state: "won"; winner: Player }
  | { state: "draw" }
  | { state: "ongoing" };

export function status(board: Board): Status {
  const w = winner(board);
  if (w) return { state: "won", winner: w };
  if (legalColumns(board).length === 0) return { state: "draw" };
  return { state: "ongoing" };
}

// All in-bounds 4-cell windows containing (row, col), per direction.
export function linesThrough(row: number, col: number): [number, number][][] {
  const lines: [number, number][][] = [];
  for (const [dr, dc] of DIRS) {
    for (let offset = -3; offset <= 0; offset++) {
      const cells: [number, number][] = [];
      for (let i = 0; i < 4; i++) {
        const r = row + (offset + i) * dr;
        const c = col + (offset + i) * dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
        cells.push([r, c]);
      }
      if (cells.length === 4) lines.push(cells);
    }
  }
  return lines;
}

export interface ColumnTruth {
  column: number;
  winsNow: boolean;
  blocksWin: boolean;
  handsWin: boolean;
  handsWinAbove: boolean;
  makesThree: boolean; // after my drop, some line through it holds 3 mine + 1 empty
  capsTwo: boolean;    // my drop occupies a line holding exactly 2 adjacent opp pieces + 2 empties
}

// Ground truth for the tactical judgments strategies ask Jev about.
// Never sent to Jev — used to grade its answers in the inspector.
export function groundTruth(board: Board, me: Player): ColumnTruth[] {
  const opp = opponent(me);
  return legalColumns(board).map((column) => {
    const mine = drop(board, column, me).board;
    const theirs = drop(board, column, opp).board;
    const winsNow = winner(mine) === me;
    const blocksWin = winner(theirs) === opp;
    const handsWin =
      !winsNow &&
      legalColumns(mine).some((c2) => winner(drop(mine, c2, opp).board) === opp);
    const handsWinAbove =
      !winsNow &&
      legalColumns(mine).includes(column) &&
      winner(drop(mine, column, opp).board) === opp;

    const row = landingRow(board, column);
    const windows = linesThrough(row, column);
    const makesThree = windows.some((cells) => {
      let m = 0;
      let e = 0;
      for (const [r, c] of cells) {
        const v = mine[r][c];
        if (v === me) m++;
        else if (v === null) e++;
      }
      return m === 3 && e === 1;
    });
    const capsTwo = windows.some((cells) => {
      const vals = cells.map(([r, c]) => board[r][c]);
      if (vals.filter((v) => v === opp).length !== 2) return false;
      if (vals.filter((v) => v === null).length !== 2) return false;
      const i = vals.indexOf(opp);
      if (vals[i + 1] !== opp) return false; // the pair must sit adjacent
      // The cap must TOUCH the pair — a gap cap leaves the open-three cell
      // free (found live: capping [me][_][O][O] lost to [_][O][O] -> three).
      const j = cells.findIndex(([r, c]) => r === row && c === column);
      return j === i - 1 || j === i + 2;
    });

    return { column, winsNow, blocksWin, handsWin, handsWinAbove, makesThree, capsTwo };
  });
}
