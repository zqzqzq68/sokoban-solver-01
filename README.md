# Sokoban solver

Push-optimal Sokoban solver for the make.fun bounty
`sokoban-solver-01-run-20261121`.

## Idea

The generator lays a hallway across the board and hangs 1-4 rooms off
it, each in its own 6x6 slot with a single door, 3-4 boxes and as many
goals. A box pushed through a door into the hallway can never come
back, so every box stays in its room and the level's push-optimal
count is the sum of its rooms' optima. Each room is therefore solved
on its own, push-optimally, by breadth-first search over pushes (the
walk the player needs to reach each pushing spot is folded into the
edge), and the rooms are strung together with plain walks.

## Run

`node main.ts` reads `/input/<id>/level.txt` for every instance and
writes `/output/<id>/solution.txt` (moves in `u`/`d`/`l`/`r`).

Deterministic: the search is breadth-first with a fixed neighbour
order and no clock or randomness, so two runs write identical bytes.

## License

MIT — see `LICENSE`.
