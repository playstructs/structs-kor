/* The driver: one persona's browser, held open behind a tiny local HTTP API, so any agent that
 * can run `curl` and read an image can playtest — e.g. a Claude Code subagent on the user's own
 * subscription, with no API key.
 *
 *   npx tsx playtest/ai/drive.ts --profile admiral --port 7413 --target http://localhost:5196/ [--mock] [--signup] [--chain-actions] --out <run dir>
 *
 * It enlists or opens the demo as the profile would, writes <out>/ai/<id>.brief.md (who to play,
 * the feature slice, the commands), then answers on 127.0.0.1:<port>:
 *
 *   /observe                         screenshot path + numbered controls + visible text
 *   /click?ref=N   /press?key=K      act; each replies with the new observation
 *   /type?ref=N&text=…   /go?path=/energy   /wait?blocks=N
 *   /feature?id=…&status=passed|failed|blocked&evidence=…
 *   /note?severity=blocker|major|minor|praise&title=…&detail=…
 *   /finish?fun=…&clarity=…&difficulty=…&would_return=true|false&summary=…&top_issues=a|b&best_moment=…
 *
 * /finish (or the step cap) writes <out>/ai/<id>.json in the same shape as a Claude API run and
 * closes the browser. playtest/ai/collect.ts merges those into ai.json for the report. */
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Harness, FORBIDDEN, GUEST, type Allow } from '../browser/harness';
import { accountBudget } from '../browser/journeys';
import { profile } from '../profiles';
import { feature } from '../features';
import { blank, start, snapshot, system, type Coverage, type Note, type Review } from './agent';
import { args, reportDir, writeJson } from '../lib/util';

const a = args();
const p = profile(a.profile);
const port = Number(a.port);
const steps = Number(a.steps ?? 100);
const out = reportDir(a);
const allow: Allow = { ...GUEST, mock: a.mock === 'true', signup: a.signup === 'true', chain: a['chain-actions'] === 'true' };
accountBudget.left = 1; // this process holds one profile, so at most one account
const res = { ...blank(p, 'scripted'), agent: 'subagent' as const, model: process.env.PLAYTEST_MODEL ?? 'claude-sonnet-5-5 (subagent)' };
const dir = resolve(out, 'ai', p.id);
mkdirSync(dir, { recursive: true });

const h = await Harness.open(p, a.target, `${out}/ai`, { allow });
try { await start(h, p); } catch (e) { res.error = `start: ${(e as Error).message}`; }
res.account = h.account;

let turn = 0;
async function observe() {
  await h.tours();
  const snap = await snapshot(h).catch(() => ({ url: h.page.url(), controls: '(page not readable)', text: '' }));
  const file = resolve(dir, `turn-${String(++turn).padStart(3, '0')}.jpg`);
  await h.page.screenshot({ path: file, type: 'jpeg', quality: 60 }).catch(() => {});
  const vp = h.page.viewportSize() ?? { width: 0, height: 0 };
  res.observations.push({ textChars: snap.controls.length + snap.text.length, imageBytes: 0, width: vp.width, height: vp.height });
  const at = new URL(h.page.url()).pathname.replace(/\/$/, '') || '/';
  for (const f of (await import('../features')).FEATURES) if ((f.path.replace(/\/$/, '') || '/') === at) h.mark(f.id, 'touched', 'screen visited');
  const errs = h.findings.filter((x) => x.kind === 'pageerror' || x.kind === 'js.error').slice(-3).map((x) => `PAGE ERROR: ${x.message}`);
  return `step ${res.steps}/${steps} · page ${snap.url} · ${h.account ? `signed in as ${h.account.callsign} ${h.account.playerId}` : 'guest/demo'}\nscreenshot: ${file}\n${errs.join('\n')}${errs.length ? '\n' : ''}controls:\n${snap.controls}\n\nvisible text (trimmed):\n${snap.text}`;
}

function finish(review: Review | null) {
  res.review = review;
  res.coverage = Object.fromEntries(h.coverage) as Record<string, Coverage>;
  res.account = h.account;
  for (const f of h.findings.filter((x) => x.severity === 'blocker')) res.notes.push({ severity: 'blocker', title: `probe: ${f.kind}`, detail: f.message, step: res.steps, url: '' });
  writeJson(resolve(out, 'ai', `${p.id}.json`), res);
  setTimeout(async () => { await h.close(); process.exit(0); }, 200);
}

writeFileSync(resolve(out, 'ai', `${p.id}.brief.md`), `${system(p, steps, h.account, allow)}

## How to play (commands)

You drive the browser with curl against http://127.0.0.1:${port}. Every action replies with the new observation: the page, a screenshot path (open it with your Read tool to see the screen), the numbered controls and the visible text.

    curl -sG http://127.0.0.1:${port}/observe
    curl -sG http://127.0.0.1:${port}/click --data-urlencode ref=12
    curl -sG http://127.0.0.1:${port}/press --data-urlencode key=e
    curl -sG http://127.0.0.1:${port}/type --data-urlencode ref=3 --data-urlencode text=hello
    curl -sG http://127.0.0.1:${port}/go --data-urlencode path=/energy
    curl -sG http://127.0.0.1:${port}/wait --data-urlencode blocks=20
    curl -sG http://127.0.0.1:${port}/feature --data-urlencode id=pow-panel --data-urlencode status=passed --data-urlencode evidence="..."
    curl -sG http://127.0.0.1:${port}/note --data-urlencode severity=major --data-urlencode title="..." --data-urlencode detail="..."
    curl -sG http://127.0.0.1:${port}/finish --data-urlencode fun=7 --data-urlencode clarity=6 --data-urlencode difficulty=5 --data-urlencode would_return=true --data-urlencode summary="..." --data-urlencode "top_issues=first|second" --data-urlencode best_moment="..."

Look at the screenshot whenever the text is not enough to judge what a player sees.
`);

const server = createServer(async (req, rsp) => {
  const u = new URL(req.url ?? '/', 'http://x');
  const q = (k: string) => u.searchParams.get(k) ?? '';
  let body = '';
  try {
    const acting = ['/click', '/press', '/type', '/go', '/wait'].includes(u.pathname);
    if (acting && res.steps >= steps) { body = 'out of actions: report remaining features, then /finish'; }
    else switch (u.pathname) {
      case '/observe': body = await observe(); break;
      case '/click': {
        const el = h.page.locator(`[data-pt-ref="${Number(q('ref'))}"]`);
        const href = await el.getAttribute('href').catch(() => null);
        if (!(await el.count())) body = `no control [${q('ref')}] on screen\n`;
        else if (href && (FORBIDDEN.test(href) && !(h.account && href.includes('/profile')) || (/^https?:/.test(href) && !href.startsWith(h.target.origin)))) body = 'that leads off the site or to a guarded screen; blocked\n';
        else { if (p.input === 'touch') await el.tap({ timeout: 3000 }).catch(() => el.click({ timeout: 3000, force: true })); else await el.click({ timeout: 3000 }).catch(() => el.click({ timeout: 3000, force: true })); await h.settle(300); }
        res.actions.push(`click ${q('ref')}`); res.steps++; body += await observe(); break;
      }
      case '/press': await h.key(q('key')); res.actions.push(`press ${q('key')}`); res.steps++; body = await observe(); break;
      case '/type': {
        const el = h.page.locator(`[data-pt-ref="${Number(q('ref'))}"]`);
        if (await el.evaluate((x) => (x as HTMLInputElement).type === 'password' || !!x.closest('[data-act="doImport"], [data-act="reveal"], [data-act="doUnlock"]')).catch(() => false)) body = 'refused: never type into password or recovery-phrase fields\n';
        else { await el.fill(q('text')); await el.press('Enter'); await h.settle(300); }
        res.actions.push(`type ${q('ref')}`); res.steps++; body += await observe(); break;
      }
      case '/go': {
        const path = q('path');
        if (FORBIDDEN.test(path) && !(h.account && path.startsWith('/profile'))) body = 'that screen is guarded in this run\n';
        else await h.go(path);
        res.actions.push(`go ${path}`); res.steps++; body += await observe(); break;
      }
      case '/wait': { const n = Math.max(1, Math.min(60, Number(q('blocks')) || 1)); await h.play(n); res.actions.push(`wait ${n}`); res.steps++; body = await observe(); break; }
      case '/feature': { const f = feature(q('id')); if (!f) { body = 'unknown feature id'; break; } h.mark(f.id, q('status') as Coverage['status'], q('evidence').slice(0, 400)); body = `recorded ${f.id}: ${q('status')}`; break; }
      case '/note': { const shot = await h.screenshot(`note-${res.notes.length + 1}`); res.notes.push({ severity: q('severity') as Note['severity'], title: q('title'), detail: q('detail'), step: res.steps, url: h.page.url(), screenshot: `ai/${p.id}/${shot}` }); body = 'noted'; break; }
      case '/finish': {
        finish({ fun: Number(q('fun')), clarity: Number(q('clarity')), difficulty: Number(q('difficulty')), would_return: q('would_return') === 'true', summary: q('summary'), top_issues: q('top_issues').split('|').filter(Boolean), best_moment: q('best_moment') });
        body = `thanks; results written to ${resolve(out, 'ai', `${p.id}.json`)}`; break;
      }
      default: body = 'commands: /observe /click /press /type /go /wait /feature /note /finish';
    }
    const here = new URL(h.page.url());
    if (here.origin !== h.target.origin || (FORBIDDEN.test(here.pathname) && !(h.account && here.pathname.startsWith('/profile')))) { await h.go('/console'); body += '\n(left the allowed screens; brought back to the bridge)'; }
  } catch (e) { body = `error: ${(e as Error).message.split('\n')[0]}`; }
  rsp.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  rsp.end(body);
});
server.listen(port, '127.0.0.1', () => console.log(`drive · ${p.id} on http://127.0.0.1:${port} · ${h.account ? `${h.account.created ? 'enlisted' : 'signed in as'} ${h.account.callsign} (${h.account.playerId})` : 'guest/demo'}${res.error ? ` · ${res.error}` : ''} · brief ${resolve(out, 'ai', `${p.id}.brief.md`)}`));
// A session nobody finishes still leaves its results (2 h cap).
setTimeout(() => finish(null), 2 * 60 * 60 * 1000);
