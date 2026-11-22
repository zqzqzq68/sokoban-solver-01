// Sokoban solver: room-by-room push-optimal search.
// Entry: node /bot/main.ts (Node 22, erasable TypeScript).
// Reads /input/<id>/level.txt for every instance, writes
// /output/<id>/solution.txt (moves in u/d/l/r, one letter a step).
//
// Why rooms: the generator lays a hallway across the board and hangs
// 1-4 rooms off it, each in its own 6x6 slot with a single door, 3-4
// boxes and as many goals. A box pushed through a door into the hallway
// can never come back, so every box stays in its room and the level's
// push-optimal count is the sum of its rooms' optima. Each room is
// therefore solved on its own, push-optimally, by breadth-first search
// over pushes; the rooms are then strung together with plain walks.
import * as fs from "node:fs";
import * as path from "node:path";

const INPUT_DIR = "/input";
const OUTPUT_DIR = "/output";

const DIRS = [
  { dx: 0, dy: -1, ch: "u" },
  { dx: 0, dy: 1, ch: "d" },
  { dx: -1, dy: 0, ch: "l" },
  { dx: 1, dy: 0, ch: "r" },
];

type Grid = {
  w: number;
  h: number;
  wall: boolean[];
  goals: Set<number>;
  boxes: number[];
  player: number;
};

function parseLevel(text: string): Grid {
  const lines = text.split("\n").filter((l) => l.length > 0);
  const h = lines.length;
  const w = Math.max(...lines.map((l) => l.length));
  const wall: boolean[] = new Array(w * h).fill(false);
  const goals = new Set<number>();
  const boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = lines[y][x] || "#";
      const idx = y * w + x;
      if (c === "#") wall[idx] = true;
      if (c === "." || c === "*" || c === "+") goals.add(idx);
      if (c === "$" || c === "*") boxes.push(idx);
      if (c === "@" || c === "+") player = idx;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

// Flood fill from `from` over floor cells that are not blocked.
// Returns parent pointers (for path reconstruction) and a seen mask.
function flood(g: Grid, blocked: Set<number>, from: number): { parent: Int32Array; seen: Uint8Array } {
  const parent = new Int32Array(g.w * g.h).fill(-1);
  const seen = new Uint8Array(g.w * g.h);
  const q: number[] = [from];
  seen[from] = 1;
  parent[from] = from;
  let head = 0;
  while (head < q.length) {
    const c = q[head++];
    const cx = c % g.w;
    const cy = (c / g.w) | 0;
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;
      const n = ny * g.w + nx;
      if (seen[n] || g.wall[n] || blocked.has(n)) continue;
      seen[n] = 1;
      parent[n] = c;
      q.push(n);
    }
  }
  return { parent, seen };
}

// Move letters for the shortest walk from `from` to `to`, following the
// parent pointers of a flood fill rooted at `from`. Empty when from==to.
function pathString(g: Grid, parent: Int32Array, from: number, to: number): string {
  const steps: string[] = [];
  let c = to;
  while (c !== from) {
    const p = parent[c];
    const dx = (c % g.w) - (p % g.w);
    const dy = ((c / g.w) | 0) - ((p / g.w) | 0);
    let ch = "?";
    for (const d of DIRS) if (d.dx === dx && d.dy === dy) ch = d.ch;
    steps.push(ch);
    c = p;
  }
  steps.reverse();
  return steps.join("");
}

// Direction letter for a single step from cell a to adjacent cell b.
function stepLetter(g: Grid, a: number, b: number): string {
  const dx = (b % g.w) - (a % g.w);
  const dy = ((b / g.w) | 0) - ((a / g.w) | 0);
  for (const d of DIRS) if (d.dx === dx && d.dy === dy) return d.ch;
  return "?";
}

type Room = {
  cells: Set<number>;
  boxes: number[];
  goals: Set<number>;
  entries: number[];
};

// Split a level into rooms: drop the hallway row (the player's row) and
// take the connected components of the remaining floor. Each component
// holding boxes is one room; its entry cells are the cells adjacent to
// the hallway row (in practice exactly one per room).
function findRooms(g: Grid): Room[] {
  const hallRow = (g.player / g.w) | 0;
  const seen = new Uint8Array(g.w * g.h);
  const rooms: Room[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const idx = y * g.w + x;
      if (y === hallRow || g.wall[idx] || seen[idx]) continue;
      const comp: number[] = [];
      const stack = [idx];
      seen[idx] = 1;
      while (stack.length) {
        const c = stack.pop() as number;
        comp.push(c);
        const cx = c % g.w;
        const cy = (c / g.w) | 0;
        for (const d of DIRS) {
          const nx = cx + d.dx;
          const ny = cy + d.dy;
          if (ny === hallRow) continue;
          if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;
          const n = ny * g.w + nx;
          if (g.wall[n] || seen[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      const cells = new Set(comp);
      const boxes = g.boxes.filter((b) => cells.has(b));
      if (boxes.length === 0) continue;
      const goals = new Set([...g.goals].filter((v) => cells.has(v)));
      const entries = comp.filter((c) => {
        const cx = c % g.w;
        const cy = (c / g.w) | 0;
        for (const d of DIRS) {
          const nx = cx + d.dx;
          const ny = cy + d.dy;
          if (ny === hallRow && nx >= 0 && nx < g.w && !g.wall[ny * g.w + nx]) return true;
        }
        return false;
      });
      rooms.push({ cells, boxes, goals, entries });
    }
  }
  rooms.sort((a, b) => a.entries[0] - b.entries[0]);
  return rooms;
}

function stateKey(boxes: number[], player: number): string {
  return boxes.join(",") + "|" + player;
}

// Solve one room push-optimally. The player starts in the hallway at
// startPlayer. `otherBoxes` are the boxes of the other rooms, fixed for
// this search (they only ever block walks). Returns the move letters for
// the whole segment (hallway walk in, entry, room solution, walk out),
// the room's boxes where the solution leaves them (on goals), and the
// hallway cell the player ends on. Null when the room cannot be solved.
function solveRoom(
  g: Grid,
  room: Room,
  otherBoxes: Set<number>,
  startPlayer: number
): { moves: string; finalBoxes: number[]; endPlayer: number } | null {
  const entry = room.entries[0];
  // The hallway cell beside the door: the neighbour of the entry that is
  // floor but not part of this room.
  let hall = -1;
  for (const d of DIRS) {
    const nx = (entry % g.w) + d.dx;
    const ny = ((entry / g.w) | 0) + d.dy;
    if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;
    const n = ny * g.w + nx;
    if (!g.wall[n] && !room.cells.has(n)) { hall = n; break; }
  }
  if (hall < 0) return null;

  // Enter the room. Walk the hallway to the door, then either step in
  // (empty door) or push the box sitting in the doorway inside.
  const initBlocked = new Set<number>([...room.boxes, ...otherBoxes]);
  const fl0 = flood(g, initBlocked, startPlayer);
  if (!fl0.seen[hall]) return null;
  const walkToHall = pathString(g, fl0.parent, startPlayer, hall);
  let initBoxes: number[];
  let initPlayer: number;
  let entryMoves: string;
  const doorBox = room.boxes.indexOf(entry);
  if (doorBox < 0) {
    initBoxes = [...room.boxes];
    initPlayer = entry;
    entryMoves = walkToHall + stepLetter(g, hall, entry);
  } else {
    const dx = (entry % g.w) - (hall % g.w);
    const dy = ((entry / g.w) | 0) - ((hall / g.w) | 0);
    const beyond = entry + dy * g.w + dx;
    if (!room.cells.has(beyond) || g.wall[beyond] || initBlocked.has(beyond)) return null;
    initBoxes = [...room.boxes];
    initBoxes[doorBox] = beyond;
    initBoxes.sort((a, b) => a - b);
    initPlayer = entry;
    entryMoves = walkToHall + stepLetter(g, hall, entry);
  }

  // Breadth-first search over pushes. Each edge is one push; the walk
  // the player needs to reach the pushing spot is folded into the edge.
  const visited = new Map<string, { parent: string | null; moves: string }>();
  const startKey = stateKey(initBoxes, initPlayer);
  visited.set(startKey, { parent: null, moves: entryMoves });
  const queue: { boxes: number[]; player: number }[] = [{ boxes: initBoxes, player: initPlayer }];
  let head = 0;
  let goalKey: string | null = null;
  let goalBoxes: number[] | null = null;
  let goalPlayer = -1;
  while (head < queue.length) {
    const cur = queue[head++];
    const curKey = stateKey(cur.boxes, cur.player);
    const blocked = new Set<number>([...cur.boxes, ...otherBoxes]);
    const fl = flood(g, blocked, cur.player);
    // Solved when every box sits on a goal and the player can still walk
    // out through the (empty) door.
    if (cur.boxes.every((b) => room.goals.has(b)) && fl.seen[entry]) {
      goalKey = curKey;
      goalBoxes = cur.boxes;
      goalPlayer = cur.player;
      break;
    }
    for (const b of cur.boxes) {
      const bx = b % g.w;
      const by = (b / g.w) | 0;
      for (const d of DIRS) {
        const tx = bx + d.dx;
        const ty = by + d.dy;
        if (tx < 0 || tx >= g.w || ty < 0 || ty >= g.h) continue;
        const t = ty * g.w + tx;
        if (!room.cells.has(t) || g.wall[t] || blocked.has(t)) continue;
        const sx = bx - d.dx;
        const sy = by - d.dy;
        if (sx < 0 || sx >= g.w || sy < 0 || sy >= g.h) continue;
        const s = sy * g.w + sx;
        if (g.wall[s] || !fl.seen[s]) continue;
        const nb = cur.boxes.map((x) => (x === b ? t : x));
        nb.sort((a, b2) => a - b2);
        const nKey = stateKey(nb, b);
        if (visited.has(nKey)) continue;
        visited.set(nKey, { parent: curKey, moves: pathString(g, fl.parent, cur.player, s) + d.ch });
        queue.push({ boxes: nb, player: b });
      }
    }
  }
  if (goalKey === null || goalBoxes === null) return null;

  // Rebuild the move letters from the goal back to the entry.
  const parts: string[] = [];
  let k: string | null = goalKey;
  while (k !== null) {
    const rec = visited.get(k) as { parent: string | null; moves: string };
    parts.push(rec.moves);
    k = rec.parent;
  }
  parts.reverse();
  let moves = parts.join("");

  // Walk out: from where the last push left the player, back to the door
  // and out into the hallway. Legal walks only; the push count is final.
  const exitBlocked = new Set<number>([...goalBoxes, ...otherBoxes]);
  const fl2 = flood(g, exitBlocked, goalPlayer);
  if (!fl2.seen[entry]) return null;
  moves += pathString(g, fl2.parent, goalPlayer, entry) + stepLetter(g, entry, hall);
  return { moves, finalBoxes: goalBoxes, endPlayer: hall };
}

// Solve one level: decompose into rooms, solve each in turn, and string
// the segments together. The player carries over from room to room.
function solveLevel(g: Grid): string | null {
  const rooms = findRooms(g);
  if (rooms.length === 0) return "";
  let allBoxes = [...g.boxes];
  let curPlayer = g.player;
  let allMoves = "";
  for (const room of rooms) {
    const other = new Set<number>(allBoxes.filter((b) => !room.cells.has(b)));
    const res = solveRoom(g, room, other, curPlayer);
    if (res === null) return null;
    allMoves += res.moves;
    // This room's boxes are now where the solution left them (on goals);
    // the other rooms' boxes are untouched.
    const rest = allBoxes.filter((b) => !room.cells.has(b));
    allBoxes = [...rest, ...res.finalBoxes].sort((a, b) => a - b);
    curPlayer = res.endPlayer;
  }
  return allMoves;
}

function main(): void {
  const ids = fs
    .readdirSync(INPUT_DIR)
    .filter((name) => fs.statSync(path.join(INPUT_DIR, name)).isDirectory())
    .sort();
  for (const id of ids) {
    const levelPath = path.join(INPUT_DIR, id, "level.txt");
    if (!fs.existsSync(levelPath)) continue;
    const text = fs.readFileSync(levelPath, "utf8");
    const g = parseLevel(text);
    const moves = solveLevel(g);
    const outDir = path.join(OUTPUT_DIR, id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "solution.txt"), moves === null ? "" : moves, "utf8");
  }
}

main();
