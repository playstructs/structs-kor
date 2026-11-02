# The Korean overlay

Everything in this directory is applied to the `structs-webapp` submodule as
it is built. Nothing in the submodule is edited.

| Path | What it is |
|---|---|
| `strings/<upstream path>.json` | Korean for one upstream file: `{"exact source text": "replacement"}` |
| `patches.cjs` | Changes that are not text: the guild connection, translating struct-type data where it is read |
| `runtime/` | Loaded before webapp's entry: `__ko.t()` with `terms.json` (Korean for game data from the guild API) and `__ko.guild` (`guild.js`, which guild the page plays through) |
| `public/` | Static files served over webapp's: `ko/ko.css` (Hangul faces for webapp's fonts), Galmuri, and the Korean banner frames in `lottie/` |
| `art/banners.py` | Draws those banner frames from webapp's (needs Pillow); `banners.json` records which upstream frames they replace |
| `page.cjs` | Renders webapp's Twig page (`templates/`) to `index.html` |
| `loader.cjs`, `translate.cjs` | Apply `patches.cjs` then `strings/` to each source file webpack reads |
| `audit.cjs` | Reports stale entries and English still on screen |
| `GLOSSARY.md` | The words to use |

## Writing a strings file

`strings/js/view_models/signup/IncomingCall1ViewModel.js.json`:

```json
{
  "'Incoming Call'": "'수신 통화'",
  "<strong>Alert:</strong> Priority Call": "<strong>경보:</strong> 긴급 통화",
  "$keep": ["SN Corp"]
}
```

- A key is text copied exactly from the upstream file, and every occurrence
  in that file is replaced. Include enough around it (quotes, tags) that it
  can only match what a player reads, never an id, class, selector, event
  name, storage key or anything compared or sent to the guild or the chain.
- Keep `${…}` expressions, tags and attributes; reorder them as Korean needs.
- Text that is also used as a value in code (`STRUCT_TYPES` names, for one)
  stays English. Translate it where it is shown instead, calling the
  runtime: `"${structType.type}</div>": "${__ko.t(structType.type)}</div>"`,
  and add the word to `runtime/terms.json`. Not in `js/workers/` or what it
  imports: the task worker has no `__ko`.
- `$keep` lists English left as is on purpose (names, units), so the audit
  stops reporting it.

Check a file as you go:

```bash
node ko/audit.cjs js/view_models/signup/IncomingCall1ViewModel.js
```

## Game data

`runtime/terms.json` follows the struct-type text guilds serve (structs-pg's
`struct_type` migrations). When a guild sends wording it doesn't have, the
page shows the English and logs `[ko] no Korean for game data …` once.

## After updating structs-webapp

```bash
git -C structs-webapp pull
npm run audit:ko
```

`stale` lines are entries whose upstream text changed: fix the key (or the
translation), or for banner frames run `python3 ko/art/banners.py` again.
`untranslated` lines are new English. `npm test` fails while either remains.
The build shows the same stale text entries as warnings.
