# 030 — R2: two-line note clamp with a detail popup (work-phase wp3)

## Problem, measured

The `.sub` line renders `<code>{adapter}</code> · {note}`. The `opencode-free` note is
~900 characters, Muse Code ~1157, Cursor ~663. At the modal width that is 15-20 lines
inside a `max-height: 360px` scroller, so one row fills the whole list and the catalog
stops being browsable. That is the screenshot the user attached.

## Change

**Clamp (CSS).** `.provider-catalog-rows .list-row .sub` gets `display: -webkit-box`,
`-webkit-line-clamp: 2`, `-webkit-box-orient: vertical`, `overflow: hidden`. The text
block already carries `min-width: 0`, so this needs no layout change. Account rows keep
their existing single-line ellipsis; the clamp is scoped to preset rows.

**Reveal control.** A nested `<button type="button">` rendered only when the note
exceeds the clamp threshold. It calls `stopPropagation()` so the enclosing `.list-row`
button never fires `onSelectPreset`. Overflow is decided from note length, not from a
layout read: `scrollHeight > clientHeight` would need a ref per row plus a resize
observer and would make the decision untestable without a DOM. The threshold lives in
`provider-presets.ts` as a named constant with its own unit test.

**Popup.** A sibling overlay with the same shape as `OAuthTosWarningModal`: a
`role="dialog" aria-modal="true"` card rendered next to the add-provider overlay rather
than inside it, holding the provider label, the adapter chip, the full note, and a close
button. The argument for a popup over grok's inline disclosure is in `015`.

**Escape ordering.** `AddProviderModal`'s handler is
`if (e.key === "Escape" && !oauthTosPending) onClose()`. The note popup joins that
guard, so Escape closes the note first and the add-provider modal second.

## Verification (remote CI only)

- pure: the overflow predicate is true for the opencode-free note and false for
  `Local - key usually blank`.
- the reveal control's click does not reach `onSelectPreset`.
- the popup body carries the full note, not the clamped text.
