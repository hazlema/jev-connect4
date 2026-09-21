// bun run c4:match <stratA> <stratB> <games> [--concurrency N]

import { appendFileSync, mkdirSync } from "node:fs";
import { makeAsk } from "./jev";
import {
  accuracy, runMatch, type GameResult, type TacticKind, type Tally,
} from "./match";
import { STRATEGIES } from "./server";

const USAGE = "usage: bun run c4:match <stratA> <stratB> <games> [--concurrency N]";

export function parseCliArgs(
  argv: string[]
): { a: string; b: string; games: number; concurrency: number } | { error: string } {
  const positional: string[] = [];
  let concurrency = 8;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency") {
      concurrency = Number(argv[++i]);
    } else {
      positional.push(argv[i]);
    }
  }
  const [a, b, gamesRaw] = positional;
  if (!a || !b || gamesRaw === undefined) return { error: USAGE };
  for (const name of [a, b]) {
    if (!STRATEGIES[name]) {
      return { error: `unknown strategy: ${name} (have: ${Object.keys(STRATEGIES).join(", ")})` };
    }
  }
  const games = Number(gamesRaw);
  if (!Number.isInteger(games) || games < 1) {
    return { error: `games must be a positive integer, got: ${gamesRaw}` };
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return { error: "--concurrency must be a positive integer" };
  }
  return { a, b, games, concurrency };
}

export function formatLive(r: GameResult, done: number, total: number): string {
  const head = `game ${done}/${total}`;
  if (r.winner === "draw") return `${head} · draw after ${r.moves.length} moves`;
  if (r.winner === "error") return `${head} · ERROR after ${r.moves.length} moves: ${r.error}`;
  const winner = r.winner === "yellow" ? r.yellow : r.red;
  const loser = r.winner === "yellow" ? r.red : r.yellow;
  return `${head} · ${winner} (${r.winner}) beats ${loser} in ${r.moves.length} moves`;
}

export function formatTally(tally: Tally, acc: ReturnType<typeof accuracy>): string {
  const lines: string[] = [];
  const accLine = (name: string, a: ReturnType<typeof accuracy>[string]) => {
    const pct = (k: TacticKind) =>
      a[k].total === 0 ? "—" : `${((100 * a[k].agree) / a[k].total).toFixed(1)}% (${a[k].agree}/${a[k].total})`;
    const radarBits =
      a.open3.total > 0 || a.cap.total > 0
        ? ` · open3 ${pct("open3")} · cap ${pct("cap")}`
        : "";
    return `${"".padEnd(12)} accuracy · win ${pct("win")} · block ${pct("block")} · hand ${pct("hand")}${radarBits}`;
  };
  for (const [name, s] of Object.entries(tally.byStrategy)) {
    const seatGames = s.firstGames + s.secondGames;
    const winPct = seatGames > 0 ? ((100 * s.wins) / seatGames).toFixed(1) : "0.0";
    const msPerMove = s.moves > 0 ? (s.latencyMs / s.moves).toFixed(0) : "—";
    lines.push(
      `${name.padEnd(12)} ${s.wins}W ${s.losses}L ${s.draws}D (${winPct}%) · ` +
      `first: ${s.winsFirst}W/${s.firstGames} · second: ${s.winsSecond}W/${s.secondGames} · ${msPerMove} ms/move`
    );
    const a = acc[name];
    if (a) {
      lines.push(accLine(name, a));
    }
  }
  for (const name of Object.keys(acc)) {
    if (tally.byStrategy[name]) continue;
    lines.push(`${name.padEnd(12)} (errored games only)`);
    lines.push(accLine(name, acc[name]));
  }
  lines.push(
    `${tally.games} games · ${tally.draws} draws · ${tally.errored} errored · ` +
    `avg ${tally.avgMoves.toFixed(1)} moves`
  );
  return lines.join("\n");
}

if (import.meta.main) {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error("TYPESAFE_API_KEY is not set — put it in jav/.env");
    process.exit(1);
  }
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }
  const { a, b, games, concurrency } = parsed;
  const dir = new URL("./transcripts/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}match-${a}-vs-${b}-${Date.now()}.jsonl`;
  const ask = makeAsk();

  console.log(`${a} vs ${b} · ${games} games · concurrency ${concurrency}`);
  const started = performance.now();
  const { results, tally } = await runMatch(
    () => STRATEGIES[a], () => STRATEGIES[b], games, ask,
    {
      concurrency,
      onGameEnd(r, done, total) {
        console.log(formatLive(r, done, total));
        try {
          for (const m of r.moves) appendFileSync(file, JSON.stringify({ kind: "match-move", ...m }) + "\n");
          appendFileSync(file, JSON.stringify({
            kind: "game-result", game: r.game, yellow: r.yellow, red: r.red,
            winner: r.winner, moves: r.moves.length, error: r.error,
          }) + "\n");
        } catch (e) {
          console.error(`transcript write failed for game ${r.game}: ${(e as Error).message}`);
        }
      },
    }
  );
  const acc = accuracy(results);
  try {
    appendFileSync(file, JSON.stringify({ kind: "summary", a, b, tally, accuracy: acc }) + "\n");
  } catch (e) {
    console.error(`transcript write failed for summary: ${(e as Error).message}`);
  }
  const secs = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`\n${formatTally(tally, acc)}`);
  console.log(`${secs}s wall clock · transcript: ${file}`);
}
