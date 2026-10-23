# Plan: Block editor experience for To Do MVC

## Context
The block (`to-do-mvc/to-do-mvc`) is fully dynamic: `src/render.php` outputs the markup, `src/view.js` (Interactivity API) holds todos in client state (`state.toDos`, items `{id, title, completed}`) and persists them only in the visitor's `localStorage`. `src/edit.js` is just a placeholder `<p>`, and block.json has no attributes. Goal: let authors build and edit the todo list in the editor, with rich text, Markdown conversion and clipboard support planned as later phases.

## Roadmap at a glance
| Phase | Scope |
|---|---|
| 1 | Unstyled editor UI, plain-text todos stored in a block attribute |
| 2 | Style parity with the front end |
| 3 | Front-end wiring (`render.php` seeds state from the attribute) |
| 4 | Rich text in todo items |
| 5 | Markdown <-> Todo conversion (pure functions + tests) |
| 6 | Copy to clipboard (plain / rich / Markdown) and paste |

Phases 1-3 are the committed near-term work. Phases 4-6 are scoped here so the Phase 1 data model does not need to change later.

## Storage decision (designed for rich text from day one)
Store the list as a **block attribute** (`todos`), serialized into the post content's block comment delimiter. `save` stays `null` and `render.php` stays the front-end renderer.

```json
"attributes": {
  "todos": { "type": "array", "default": [], "items": { "type": "object" } }
}
```

### Item shape
```js
{ id: number, title: string, completed: boolean, html?: string }
```
- `title` is **always plain text**. It is the source of truth for plain-text items and is always kept in sync (stripped from `html`) for rich items. It is what `view.js` uses today, what plain-text copy uses, and the fallback for search and a11y.
- `html` is **optional** and only present once an item has rich formatting. It is the serialized value from `RichText` (a restricted inline-HTML string). Items without it behave exactly like Phase 1 items.
- No migration is ever needed: Phase 1 data is valid forever, and rich text is purely additive. This also avoids the ambiguity of storing HTML in `title` (a plain title containing `<` or `&` would be misread as markup).

### Why still an attribute, not InnerBlocks
Earlier I called todos "simple" and chose the lightweight option. Rich text does not change that conclusion, and the attribute approach also fits `RichText` fine: `RichText` can be rendered once per row inside `todos.map(...)` with `value={ todo.html ?? escape(todo.title) }` and `onChange` writing back via `setAttributes`. InnerBlocks (one child block per todo, e.g. a custom `to-do-mvc/item` block) would only be worth it if items needed block-level features: nested todos, per-item block toolbars, drag-and-drop between blocks, or block-level transforms/paste. Trade-offs:

| | Attribute array + per-row `RichText` (chosen) | InnerBlocks child per todo |
|---|---|---|
| Frontend data | one JSON array, matches `view.js` state | needs a render pass per child, then collect into state |
| Complexity | low | child block registration, parent/ancestor rules, render context |
| Rich text | `RichText` per row, restricted `allowedFormats` | native |
| Copy/paste | we own it (Phase 6) | Gutenberg multi-block copy works, but Markdown/clipboard flows are still custom |
| Downside | RichText has no multiline-per-row paste splitting by default (we handle in Phase 6); HTML inside a JSON comment is escaped (`<`) and bulky | far more moving parts |

Decision: stay with the attribute. Revisit InnerBlocks only if nesting/subtasks become a requirement.

### Retrieval
- **Editor:** `attributes.todos` -> rows. Each row renders `RichText` (Phase 4) or a plain `<input>` (Phase 1).
- **Front end:** `render.php` reads `$attributes['todos']`, **sanitizes** every item (cast `id` to int, `completed` to bool, `title` via `sanitize_text_field`, `html` via `wp_kses` with an inline allowlist: `strong, em, a[href|rel|target], code, s/del, br`), and passes the result to `wp_interactivity_state('to-dos', ['toDos' => ...])`.
- **`view.js`:** keeps using `title` for text bindings. For items with `html` it needs an HTML-capable render path (see Phase 4). The `.edit` input stays plain text.
- Id handling: use `max(existing ids) + 1` in the editor (avoid `length + 1`, which collides after deletes; the same bug exists in `view.js:onKeyDown` and is worth fixing separately).

---

## Phase 1: unstyled editor UI (plain text)
Files: `src/block.json`, `src/edit.js`, then `npm run build` (build/ is committed).

1. **block.json**: add the `todos` attribute above. Keep `render`, `viewScriptModule`; no `save`.
2. **edit.js**: using `useBlockProps()` and `setAttributes`, render plain, unstyled elements:
   - "new todo" `<input>` (add on Enter, trim, ignore empty)
   - `<ul>` of todos, each row: checkbox (toggle `completed`), text `<input>` (edit `title`), "Delete" `<button>`
   - "Mark all complete" checkbox and "Clear completed" button
   - an "N items left" line
   - No filters in the editor for now; show every todo.
   - `useState` only for the new-todo draft; all list changes go through `setAttributes({ todos: [...] })` immutably.
3. Do not touch `style.scss` / `editor.scss` styling yet (the dotted red border in `editor.scss` stays as a boundary). `style.scss` is scoped to classes like `.todoapp`, so unclassed markup is unaffected.
4. Keep class names off the editor markup in this phase.
5. Put list mutations in a small pure module (`src/todos.js`: `addTodo`, `updateTodo`, `removeTodo`, `toggleAll`, `clearCompleted`, `nextId`) so Phases 4-6 reuse them and they are unit-testable.

## Phase 2: styling parity
Reuse the front-end class names (`todoapp`, `header`, `new-todo`, `main`, `toggle-all`, `todo-list`, `view`, `toggle`, `destroy`, `edit`, `footer`, `todo-count`, `filters`, `clear-completed`) in `edit.js` so `style.scss` applies; add editor-only overrides in `editor.scss`; optionally filters via local state.

## Phase 3: front-end wiring and permissions
`render.php` seeds `state.toDos` from the sanitized attribute. **Decision:** the attribute is the single source of truth, and only the logged-in author of the post containing the list may edit it.

- **Who can edit:** `render.php` computes `$can_edit = is_user_logged_in() && (int) get_post_field( 'post_author', get_the_ID() ) === get_current_user_id()` (optionally `&& current_user_can( 'edit_post', $post_id )`) and passes it as `state.canEdit`. All other viewers get a **read-only** list: nothing they do changes the list. Copy (Phase 6) stays available to everyone.
- **Warning for non-permitted users:** the controls stay visible (so the list still looks like the TodoMVC app), but any attempt to change the list by someone who is not the author shows a clear warning instead of silently doing nothing.
  - *Trigger:* in `view.js`, every mutating action (`onKeyDown` add, `toggleCompleted`, `toggleAll`/`markAllComplete`, `deleteTodo`, `clearCompletedTodos`, `editTodo`/`saveEditsForTodo`/`editBlur`) first calls a shared guard, `helpers.requireEdit()`. If `!state.canEdit` it calls `event.preventDefault()`, reverts any optimistic DOM change (e.g. the checkbox the browser just toggled), sets `state.warning`, and returns without touching `state.toDos`. The new-todo input and `.edit` inputs are `readonly` for non-authors so typing does not even start, but clicking/focusing them still raises the warning.
  - *Message, which depends on the viewer:*
    - logged out: "Log in as the author of this page to edit this to-do list." (with a login link built by `wp_login_url( get_permalink() )`, passed from `render.php`);
    - logged in but not the author: "You don't have permission to edit this to-do list. Only its author can change it.";
    - copy is unaffected and never triggers a warning.
  - *Display:* a `role="alert"` (`aria-live="assertive"`) element rendered by `render.php` near the top of the block, bound with `data-wp-bind--hidden="!state.warning"` and `data-wp-text="state.warning"`. It auto-dismisses after a few seconds (timer wrapped in `withScope`) and has a close button. Reused by the save-error path below.
  - *Server enforcement:* the REST save route returns `403` with a `rest_forbidden`-style message for the same cases (not logged in, not the author, bad nonce). The client shows that message in the same warning element and rolls back to the last server-confirmed `todos`. This also covers a user whose session expired or whose `canEdit` was tampered with in the browser.
  - *Editor:* not needed there. Block editor access is already governed by core capabilities.
  - *Styling:* a minimal warning style is added in Phase 3; visual polish belongs with the style work.
  - *Tests:* manual matrix of (logged out / logged in non-author / author) x (add / toggle / edit / delete / clear / mark-all), confirming the warning appears for the first two roles, `state.toDos` is unchanged, and a forced REST call from the console as a non-author returns 403.
- **Enforce on the server, not just in the UI:** hiding controls is not security. Any write path must check the capability server-side (see persistence below).
- **Persistence for front-end edits by the author:** `localStorage` can no longer be the source of truth (it would shadow the author's saved list and is per-browser). Replace `loadTodos`/`saveTodos` with a save to the server: a small REST route (`register_rest_route`) that takes `post_id` + `todos`, checks `current_user_can( 'edit_post', $post_id )` and the post-author rule with a nonce, sanitizes with the same function `render.php` uses, then updates the block attribute by `parse_blocks` -> find `to-do-mvc/to-do-mvc` (`multiple: false` makes this unambiguous) -> set `attrs.todos` -> `serialize_blocks` -> `wp_update_post`. Debounce saves, show a saving/error state, and keep optimistic client state.
- **Fallback if the REST work is deferred:** author-side front-end edits are disabled and the author edits in the block editor only; visitors still see the read-only list. Decide at the start of this phase which of the two ships first.
- **Limitation (documented, see Future enhancements; the warning above is how the limitation is surfaced to users):** one editor per list, and visitors cannot keep a personal checklist state.

## Phase 4: rich text in todo items (future)
- **Editor:** replace the row's text `<input>` with `RichText` (`tagName="span"`, `multiline={ false }`, `allowedFormats={ [ 'core/bold', 'core/italic', 'core/link', 'core/code', 'core/strikethrough' ] }`, `withoutInteractiveFormatting` considered so links do not hijack row clicks). Enter in a row adds the next todo instead of a line break (`onSplit`/key handler); Backspace on an empty row deletes it.
- **Write path:** on change, store `html` only if it contains markup (`html !== escape(plainText)`), always set `title = stripTags(html)`. Plain items keep no `html`.
- **Front end:**
  - `render.php` sanitizes `html` (see Retrieval).
  - `view.js` currently uses `data-wp-text="context.item.title"`. Add an HTML path: the Interactivity API has no official innerHTML directive, so use a ref-based `data-wp-watch` callback that sets `ref.innerHTML` from `context.item.html` when present (the existing `updateCounterSection` already uses this ref pattern), falling back to text otherwise. Re-sanitize client-side only if the value could come from `localStorage` (treat that as untrusted).
  - **Full rich editing on the front end** (for the authorized author only, per Phase 3). The double-click `.edit` `<input>` is replaced by a rich editing surface that edits `html` and re-derives `title`. Options, to pick during Phase 4: a `contenteditable` element with a minimal toolbar / keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+K) written in `view.js`, or loading a small editor library as a script module only for authorized users (keeps the visitor payload small). Either way the output goes through the same allowlist sanitizer on the client and again on the server when saved. Because it is only loaded for authors, gate the editing code behind `state.canEdit` (dynamic import).
- **Tests:** round-trip `title`/`html` sync; sanitizer allowlist.

## Phase 5: Markdown <-> Todo conversion (future)
A dependency-free, unit-tested module `src/markdown.js` (jest via `wp-scripts test-unit-js`). Format is GitHub-flavored task lists:

```
- [ ] Buy milk
- [x] Write **plan** with a [link](https://example.com)
```

- **`todosToMarkdown( todos ) -> string`**
  - one line per item: `- [ ] ` / `- [x] ` + text.
  - plain items: `title` with Markdown-special characters escaped (`\ * _ [ ] ` ` etc.).
  - rich items: convert `html` -> inline Markdown (`strong`->`**`, `em`->`*`, `code`->backtick, `s/del`->`~~`, `a`->`[text](href)`, `br`->space). Anything outside the allowlist falls back to its text.
- **`markdownToTodos( text ) -> todo[]`**
  - recognizes `- [ ]`, `- [x]`/`[X]`, with `-`, `*` or `+` bullets, and numbered `1.` lists.
  - plain bullets (`- text`) and bare non-empty lines become uncompleted todos (useful for pasting any list).
  - nested/indented items are flattened (no subtasks in the data model).
  - headings, blank lines, fenced code and other block syntax are skipped.
  - inline Markdown -> `html` when rich text is enabled (same allowlist), always producing `title` as stripped plain text; before Phase 4 ships, inline Markdown is simply stripped to `title`.
  - assigns ids via `nextId` so imports append safely.
- **Tests:** table-driven cases for each direction plus round trip (`markdownToTodos(todosToMarkdown(x))` equals `x` for the supported subset), escaping, CRLF input, empty input.

## Phase 6: copy to clipboard and paste (future)
Depends on Phase 5 (Markdown) and, for the rich format, Phase 4.

- **Copy UI, in both places:**
  - *Editor:* a "Copy as..." dropdown in the block toolbar (`BlockControls` + `ToolbarDropdownMenu`) with three formats: **Plain text**, **Rich text** (hidden/disabled until Phase 4 exists), **Markdown**.
  - *Front end:* a "Copy" menu/button group rendered by `render.php` (visible to **all** viewers, including read-only ones) wired to a `view.js` action. It shares the same format builders as the editor, so put them in a module importable by both bundles (`src/clipboard.js`; `view.js` is a script module, so it must not depend on editor-only `@wordpress/*` packages, and notices should use a lightweight inline "Copied" status instead of `@wordpress/notices`).
- **Formats:**
  - Plain text: one line per item. Incomplete items are copied as **raw text** (just the `title`, no `[ ]` marker). How completed items are represented is **open question 4** and is not decided yet; until it is answered, completed items are copied the same as incomplete ones.
  - Rich text: an HTML `<ul>` of items (checkbox state as `&#9744;`/`&#9745;` prefix, since `<input>` is stripped by many targets), placed in `text/html` together with the plain version in `text/plain`, so pasting into Docs/email keeps formatting and into a code editor degrades gracefully.
  - Markdown: `todosToMarkdown` output in `text/plain`.
- **Mechanism:** `navigator.clipboard.write([ new ClipboardItem({ 'text/plain': ..., 'text/html': ... }) ])`, with fallback to `navigator.clipboard.writeText`, then to `@wordpress/compose` `useCopyToClipboard` / `execCommand('copy')`. Show a confirmation via `@wordpress/notices` (`createSuccessNotice`) and an error notice on failure. Clipboard APIs need a secure context and a user gesture, which the toolbar click provides.
- **Paste:** `onPaste` handlers on the new-todo input (and row inputs):
  - read `clipboardData`; prefer `text/plain` parsed with `markdownToTodos` when it has multiple lines or list/task syntax; single-line paste stays a normal text paste into the input.
  - `text/html` paste (Phase 4+) is cleaned with `@wordpress/dom` helpers / the block `pasteHandler` down to the inline allowlist, then converted to items.
  - multi-line paste appends one todo per line; offer replace vs append only if requested.
- **Interaction with Gutenberg's own copy/paste:** copying the whole block uses Gutenberg's serializer, which already carries the `todos` attribute, so no work is needed there.
- **Tests:** unit-test the format builders (pure functions) and paste parsing; manually verify clipboard behavior in Chrome, Firefox and Safari (ClipboardItem support differs).

## Verification
Phase 1:
- `npm run build`, activate plugin in the Studio site, insert the block in a post.
- Add, edit, toggle, delete, mark-all, clear-completed; confirm counts update.
- Save, reload editor: todos persist. Code editor view: block comment contains `"todos":[...]`.
- Front end still renders as before (attribute not yet consumed); no console errors or block validation warnings.

Later phases: `npm run test:unit` for `todos.js`, `markdown.js` and clipboard builders; manual round trip: author in editor -> copy as Markdown -> paste into a fresh block -> identical list; formatted item survives copy as rich text into a rich text target; front end shows sanitized formatting.

## Future enhancements
- **Multi-user / visitor editing (limitation to revisit).** For now only the logged-in author of the post can change the list (Phase 3); everyone else sees it read-only, and there is no per-visitor state. Potential enhancements:
  - per-visitor checklist state (checkbox toggles stored in `localStorage` or user meta, overlaid on the author's list without modifying it, with a "reset" control);
  - a block setting for who may edit (author only / any logged-in user / specific roles / anyone), enforced by the same server-side capability check;
  - collaborative or shared lists (per-user lists keyed by user id, or multiple editors with conflict handling, e.g. revision/`updated_at` checks on save);
  - a block setting to restore the original anonymous `localStorage` behavior for sites that want visitor-owned todo apps.
- Subtasks (nested todos), which would also be the trigger to reconsider InnerBlocks (see Storage decision).

## Decisions made
1. Copy is available in both the editor and the front end (Phase 6).
2. Front-end editing is full rich editing, for authorized users only (Phase 4).
3. Only the logged-in post author can edit the list for now; the attribute is the source of truth, not `localStorage` (Phase 3).

## Open questions
4. **How should completed items be represented in plain-text copy?** Incomplete items copy as raw text. Plain text cannot carry real strikethrough, so the candidates are:
   - (a) leave completed items as raw text too (no distinction);
   - (b) Unicode combining strikethrough (`t̶e̶x̶t̶`, U+0336 after each character): visible in most apps but hurts searchability, screen readers and accessibility;
   - (c) Markdown-style `~~text~~`: readable in plain text and renders as strikethrough in Markdown-aware targets;
   - (d) a `[x]` prefix (and `[ ]` for incomplete, which would change the "raw text" rule above).
   Rich text and Markdown copies are not affected: they use `<s>` / `~~text~~` (or a checked task-list marker) naturally. To be answered before Phase 6 starts.
5. Phase 3 persistence: ship the REST save endpoint first, or ship author-edits-in-editor-only first and add front-end saving after?
6. Phase 4 front-end rich editor: hand-rolled `contenteditable` vs a small library loaded only for authors.
