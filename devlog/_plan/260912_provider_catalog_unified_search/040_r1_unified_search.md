# 040 — R1: unified search across every tab (work-phase wp4)

The design is option A from `015`: while the query is non-empty, search mode replaces
browse mode and the selected tab is frozen instead of moved.

## Layout

The search input moves **above** the tab strip and stays mounted in both modes. It no
longer resets on tab click.

```
[ search input                     ]   <- always first
[ Accounts | Free | Local | Paid   ]   <- tablist when browsing, jump chips when searching
[ rows ...                          ]
```

## Browse mode (query empty)

Exactly today's behaviour plus the Local tab. The strip is a real tablist:
`role="tablist"`, `role="tab"`, `aria-selected`, and `aria-controls` pointing at the
rows container, which gains the `id` it does not have today.

## Search mode (query non-empty)

- The rows container renders **every** match, grouped, in the fixed order Accounts →
  Free → Local → Paid, each group preceded by a heading carrying the tier name and its
  count.
- The strip drops `role="tablist"`. Each control becomes a plain button with a count,
  `aria-controls` on its group heading, no `aria-selected`, and `disabled` at zero.
  Clicking a non-zero chip scrolls its heading into view and moves focus there
  (`tabIndex={-1}` then `focus()`); it does not change `tier`.
- One `aria-live="polite" aria-atomic="true"` node announces the result count and the
  tiers involved. It is not retargeted on chip click.
- Accounts login rows are searchable and render as account rows under the Accounts
  group. When a login row and a preset share an id, the login row wins and the preset
  is dropped so `openai` cannot appear twice.
- The Accounts hint line and the `modal.notListed` footer are browse copy and hide.
- Zero matches: `modal.noMatch` in the list, every chip disabled, the live region says
  the same thing.

Clearing the query restores the frozen tab, scrolls the container to top, and brings
the hint and footer back. Scroll offset is deliberately not restored: the list was
replaced, so restoring an offset would land somewhere meaningless.

## Matching

Haystack stays label + id. Widening to adapter or base URL would dump half the catalog
on `openai` (the adapter of Ollama, vLLM, LM Studio, Groq, Cerebras, PackyCode) and
every local row on `localhost`. Two explicit widenings instead:

1. equality-only adapter match, so `cursor` finds Cursor but `openai` does not match
   `openai-chat`;
2. local-runtime aliases (`ollama`, `vllm`, `lmstudio`, `lm studio`, `localhost`)
   resolved through `isLocalProvider`, not through substring matching.

Ranking inside a group: exact id or label, then label prefix, then the existing sponsor
pin, then usage rank, then label. Never re-ranked across groups — a paid sponsor above
free NVIDIA on `nim` reads as an ad slot.

## Keyboard

The input keeps focus while typing. ArrowDown from the input moves to the first result
row, not to a chip. Escape clears a non-empty query before the dialog closes, and after
the note popup if one is open (`030`).

## Verification (remote CI only)

Pure functions first: grouping, ordering, the login-row/preset dedupe, the ranking
comparator, and the alias rules all live in `provider-presets.ts` and are unit-tested
without React. The component test covers: a query with zero hits in the active tab
leaves `tier` untouched; tab click with a non-empty query does not clear the query; an
in-flight Accounts login keeps its `LoginHint` and paste field across a chip click.
