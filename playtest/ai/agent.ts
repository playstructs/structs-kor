/* The AI playtester: Claude plays the client as one persona, looking at a screenshot and a
 * numbered list of the controls on screen each turn, acting through a few tools, reporting each
 * feature it checks and writing notes and a review — a deep-dive session on demand.
 *
 * Deep dive (default): Claude Sonnet 5.5, a feature slice per persona (features.ts) plus free
 * exploration, a signed-in account when the run enlists against the mock Guild API.
 * Context editing clears old tool results (and their screenshots) server-side so a 120-step session
 * stays affordable; the history itself is append-only (every assistant turn goes back as returned). */
import Anthropic from '@anthropic-ai/sdk';
import { Harness, FORBIDDEN, canEnlist, type Allow, type Account } from '../browser/harness';
import { STEPS, accountBudget } from '../browser/journeys';
import { FEATURES, feature } from '../features';
import type { Profile } from '../profiles';

export const MODEL = process.env.PLAYTEST_MODEL ?? 'claude-sonnet-5-5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Note { severity: 'blocker' | 'major' | 'minor' | 'praise'; title: string; detail: string; step: number; url: string; screenshot?: string }
export interface Review { fun: number; clarity: number; difficulty: number; would_return: boolean; summary: string; top_issues: string[]; best_moment: string }
export interface TurnUsage { input: number; cacheRead: number; cacheWrite: number; output: number }
export interface Coverage { status: 'touched' | 'passed' | 'failed' | 'blocked' | 'guarded'; note: string; by: string }
export interface AiResult {
  persona: string; model: string; agent: 'claude' | 'scripted' | 'subagent'; steps: number;
  account: Account | null; coverage: Record<string, Coverage>; notes: Note[]; review: Review | null; actions: string[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }; turns: TurnUsage[];
  /** Size of what each observation sends (scripted runs measure this for the cost estimate). */
  observations: { textChars: number; imageBytes: number; width: number; height: number }[];
  error?: string;
}
export interface AgentOpts { steps: number; effort: Effort; allow: Allow; contextEditing: boolean }

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object' as const, properties, required, additionalProperties: false });
const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { name: 'click', description: 'Click (or tap) the control with this number from the list.', strict: true, input_schema: obj({ ref: { type: 'integer' } }) },
  { name: 'press', description: 'Press a keyboard key, e.g. "e", "1", "Escape", "Tab", "Enter", "?", "F10".', strict: true, input_schema: obj({ key: { type: 'string' } }) },
  { name: 'type', description: 'Type text into the input with this number, then press Enter.', strict: true, input_schema: obj({ ref: { type: 'integer' }, text: { type: 'string' } }) },
  { name: 'go', description: 'Open a screen by path, e.g. "/energy", "/sim", "/replicants". Faster than clicking through menus.', strict: true, input_schema: obj({ path: { type: 'string' } }) },
  { name: 'wait', description: 'Let game time pass: blocks of 4 seconds each (1–60). Use it to see production, raids and events play out.', strict: true, input_schema: obj({ blocks: { type: 'integer' } }) },
  {
    name: 'feature', description: 'Report the result for one feature from the checklist once you have tried it: passed (works as described), failed (broken, wrong or crashes: say how), blocked (could not reach it: say why).', strict: true,
    input_schema: obj({ id: { type: 'string', enum: FEATURES.map((f) => f.id) }, status: { type: 'string', enum: ['passed', 'failed', 'blocked'] }, evidence: { type: 'string' } }),
  },
  { name: 'note', description: 'Record a playtest observation as you go: a bug, confusion, friction, or something that works well.', strict: true, input_schema: obj({ severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'praise'] }, title: { type: 'string' }, detail: { type: 'string' } }) },
  {
    name: 'finish', description: 'End the session with your review as this persona. Call once, when you have covered your features or run out of steps.', strict: true,
    input_schema: obj({
      fun: { type: 'integer', description: '1–10' }, clarity: { type: 'integer', description: '1–10: how well the game explained itself' }, difficulty: { type: 'integer', description: '1–10' },
      would_return: { type: 'boolean' }, summary: { type: 'string' }, top_issues: { type: 'array', items: { type: 'string' } }, best_moment: { type: 'string' },
    }),
  },
];

export function system(p: Profile, steps: number, account: Account | null, allow: Allow = { mock: false }) {
  const mine = p.slice.map((id) => feature(id)!).map((f) => `- ${f.id} · ${f.name} (${f.path}${f.chain ? ', signs a chain transaction' : ''}${f.guarded ? ', guarded' : ''}): ${f.try}`).join('\n');
  const rest = FEATURES.filter((f) => !p.slice.includes(f.id)).map((f) => `${f.id} (${f.path})`).join(', ');
  return `You are a playtester for 구조체 STRUCTS, a Korean-language space strategy game played in the browser, doing a deep dive into its features.

${account ? `You are signed in as a newly enlisted commander, ${account.callsign ?? 'a new recruit'} (player ${account.playerId}). ${allow.mock ? 'This run uses a mock Guild API on a local dev server: no real chain.' : 'This is a real account on the Structs testnet; breaking things is fine, that is what testing is for.'}` : 'You are playing as a guest in the demo base, a pretend base that runs in the browser; nothing touches a real chain or account.'}

You play as this person, and judge the game through their eyes:
- Who: ${p.name}, ${p.archetype}. ${p.bio}
- Skill with strategy games: ${Math.round(p.skill * 10)}/10. Patience: gives up on a confusing screen after about ${p.patience} actions.
- Device: ${p.device}, ${p.input} input${p.zoom > 1 ? `, ${p.zoom * 100}% zoom` : ''}${p.motion === 'reduced' ? ', reduced motion' : ''}. ${p.input === 'keyboard' ? 'Use the keyboard (press) wherever you can; only click when nothing else works, and note it.' : ''}
- Goals: ${p.goals.join('; ')}.
- Voice: ${p.voice}
- The studio wants this session to answer: ${p.questions.join(' ')}

Your assigned features. Try each one properly and report it with the feature tool:
${mine}

When those are done, explore freely and report anything else you try from the rest of the checklist: ${rest}.

Rules:
- Each turn you get a screenshot and a numbered list of the controls on screen. Act with click, press, type, go or wait.
- Log with note whenever something confuses, frustrates, breaks or delights this person. Be concrete (what you did, what you expected, what happened), so a developer can reproduce it.
- Never try to reveal, copy, type or export a recovery phrase or password. The harness blocks those controls; if one is blocked, report the feature as blocked and move on.
- ${allow.chain ? 'Chain transactions are allowed in this run: confirmation dialogs for them are accepted, so try them for real. Wiping the wallet is always declined.' : 'Confirmation dialogs that would sign a chain transaction, change a contract or wipe the wallet are declined by the harness in this run. Report such features from what you could see up to the confirmation.'}
- You have about ${steps} actions. Call finish with your review before they run out.
- Write notes and the review in English, quoting Korean UI text where it matters.`;
}

/** Number the visible controls and return a compact text list (refs live in data-pt-ref). */
export async function snapshot(h: Harness) {
  return h.page.evaluate(() => {
    document.querySelectorAll('[data-pt-ref]').forEach((el) => el.removeAttribute('data-pt-ref'));
    const vis = (el: Element) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const els = [...document.querySelectorAll('button, a[href], [role="button"], input, select, textarea, .bd-cell[data-key], .gx-node')].filter(vis).slice(0, 80);
    const lines = els.map((el, i) => {
      el.setAttribute('data-pt-ref', String(i));
      const h = el as HTMLElement;
      const name = (h.getAttribute('aria-label') || h.innerText || h.getAttribute('title') || h.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const extra = [h.dataset.act && `act=${h.dataset.act}`, h.dataset.key && `tile=${h.dataset.key}`, (h as HTMLButtonElement).disabled && 'disabled', h.getAttribute('href')].filter(Boolean).join(' ');
      return `[${i}] ${el.tagName.toLowerCase()} "${name}" ${extra}`.trim();
    });
    const text = document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1500);
    return { url: location.pathname + location.search, controls: lines.join('\n'), text };
  });
}

/** Screenshot and control list for the model; also measured for the cost estimate. */
export async function observe(h: Harness, res: AiResult): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  await h.tours();
  const snap = await snapshot(h).catch(() => ({ url: h.page.url(), controls: '(page not readable)', text: '' }));
  const img = await h.page.screenshot({ type: 'jpeg', quality: 60, scale: 'css' }).catch(() => null);
  const s = await h.demoState();
  const text = `Page ${snap.url} · ${h.account ? `signed in as ${h.account.playerId}` : `demo height ${s?.height ?? '—'} · α ${typeof s?.alpha === 'number' ? s.alpha.toFixed(1) : '—'}`}\nControls:\n${snap.controls}\n\nVisible text (trimmed):\n${snap.text}`;
  const vp = h.page.viewportSize() ?? { width: 0, height: 0 };
  res.observations.push({ textChars: text.length, imageBytes: img?.length ?? 0, width: vp.width, height: vp.height });
  // Every feature on this screen counts as touched.
  const at = new URL(h.page.url()).pathname.replace(/\/$/, '') || '/';
  for (const f of FEATURES) if ((f.path.replace(/\/$/, '') || '/') === at) h.mark(f.id, 'touched', 'screen visited');
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (img) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.toString('base64') } });
  blocks.push({ type: 'text', text });
  return blocks;
}

export function blank(p: Profile, agent: AiResult['agent']): AiResult {
  return { persona: p.id, model: agent === 'claude' ? MODEL : 'scripted', agent, steps: 0, account: null, coverage: {}, notes: [], review: null, actions: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, turns: [], observations: [] };
}

/** Enlist (against the mock) when this persona plays an account; otherwise open the demo. */
export async function start(h: Harness, p: Profile) {
  await h.go('/');
  if (canEnlist(h.allow, p)) await STEPS.enlist(h);
  else await STEPS.demo(h).catch(() => '');
}

export async function playAi(client: Anthropic, p: Profile, target: string, out: string, o: AgentOpts): Promise<AiResult> {
  const res = blank(p, 'claude');
  const h = await Harness.open(p, target, `${out}/ai`, { allow: o.allow });
  let editing = o.contextEditing;
  try {
    await start(h, p);
    res.account = h.account;
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'Start your deep dive.' }, ...(await observe(h, res))] }];
    for (let step = 0; step < o.steps + 3 && !res.review; step++) {
      if (step >= o.steps) messages.push({ role: 'user', content: [{ type: 'text', text: 'You are out of actions. Report any features you tried and have not reported, then call finish.' }] });
      const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
        model: MODEL, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01', ...(editing ? ['context-management-2025-06-27' as const] : [])], fallbacks: 'default',
        thinking: { type: 'adaptive' }, output_config: { effort: o.effort },
        system: [{ type: 'text', text: system(p, o.steps, h.account, o.allow), cache_control: { type: 'ephemeral' } }],
        tools: TOOLS, tool_choice: { type: 'auto' },
        cache_control: { type: 'ephemeral' },
        ...(editing ? { context_management: { edits: [{ type: 'clear_tool_uses_20250919' as const, trigger: { type: 'input_tokens' as const, value: 100_000 }, keep: { type: 'tool_uses' as const, value: 8 }, clear_at_least: { type: 'input_tokens' as const, value: 30_000 } }] } } : {}),
        messages,
      };
      let r: Anthropic.Beta.BetaMessage;
      try { r = await client.beta.messages.create(params); } catch (e) {
        // If the model or account rejects context editing, carry on without it (costs more, still works).
        if (editing && e instanceof Anthropic.BadRequestError && /context.?management|clear_tool_uses/i.test(e.message)) { editing = false; step--; continue; }
        throw e;
      }
      const u = { input: r.usage.input_tokens, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0, output: r.usage.output_tokens };
      res.turns.push(u);
      res.usage.input += u.input; res.usage.output += u.output; res.usage.cacheRead += u.cacheRead; res.usage.cacheWrite += u.cacheWrite;
      messages.push({ role: 'assistant', content: r.content });
      if (r.stop_reason === 'refusal') { res.error = `refused: ${r.stop_details?.category ?? ''}`; break; }
      const uses = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (!uses.length) { messages.push({ role: 'user', content: [{ type: 'text', text: 'Use a tool: act on the game, report a feature, note something, or finish.' }] }); continue; }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      let acted = false;
      for (const u of uses) {
        const input = u.input as Record<string, unknown>;
        let msg = 'done';
        try {
          switch (u.name) {
            case 'click': {
              const el = h.page.locator(`[data-pt-ref="${Number(input.ref)}"]`);
              const href = await el.getAttribute('href').catch(() => null);
              if (!(await el.count())) msg = `no control [${input.ref}] on screen`;
              else if (href && (FORBIDDEN.test(href) || (/^https?:/.test(href) && !href.startsWith(h.target.origin)))) msg = 'that leads to a guarded screen or off the site; the harness blocked it';
              else { if (p.input === 'touch') await el.tap({ timeout: 3000 }).catch(() => el.click({ timeout: 3000, force: true })); else await el.click({ timeout: 3000 }).catch(() => el.click({ timeout: 3000, force: true })); await h.settle(300); }
              acted = true; res.actions.push(`click ${input.ref}`); break;
            }
            case 'press': await h.key(String(input.key)); acted = true; res.actions.push(`press ${input.key}`); break;
            case 'type': {
              const el = h.page.locator(`[data-pt-ref="${Number(input.ref)}"]`);
              if (await el.evaluate((x) => (x as HTMLInputElement).type === 'password' || !!x.closest('[data-act="doImport"], [data-act="reveal"], [data-act="doUnlock"]')).catch(() => false)) { msg = 'refused: the harness never types into password or recovery-phrase fields'; break; }
              await el.fill(String(input.text)); await el.press('Enter'); await h.settle(300); acted = true; res.actions.push(`type ${input.ref}`); break;
            }
            case 'go': {
              const path = String(input.path);
              if (FORBIDDEN.test(path) && !(h.account && /^\/profile/.test(path))) { msg = 'that screen is guarded in this run'; break; }
              await h.go(path); acted = true; res.actions.push(`go ${path}`); break;
            }
            case 'wait': { const n = Math.max(1, Math.min(60, Number(input.blocks) || 1)); await h.play(n); acted = true; res.actions.push(`wait ${n}`); break; }
            case 'feature': { const f = feature(String(input.id)); if (!f) { msg = 'unknown feature id'; break; } h.mark(f.id, input.status as Coverage['status'], String(input.evidence).slice(0, 400)); msg = 'recorded'; break; }
            case 'note': { const shot = await h.screenshot(`note-${res.notes.length + 1}`); res.notes.push({ severity: input.severity as Note['severity'], title: String(input.title), detail: String(input.detail), step, url: h.page.url(), screenshot: `ai/${p.id}/${shot}` }); msg = 'noted'; break; }
            case 'finish': res.review = input as unknown as Review; msg = 'thanks'; break;
            default: msg = `unknown tool ${u.name}`;
          }
          const here = new URL(h.page.url());
          if (here.origin !== h.target.origin || (FORBIDDEN.test(here.pathname) && !(h.account && here.pathname.startsWith('/profile')))) { await h.go('/console'); msg += ' (left the allowed screens; brought back to the bridge)'; }
        } catch (e) { msg = `error: ${(e as Error).message.split('\n')[0]}`; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: msg });
      }
      res.steps = step + 1;
      // The new view rides inside the last tool result, so context editing can clear old screenshots.
      if (acted && !res.review) { const last = results[results.length - 1]; last.content = [{ type: 'text', text: String(last.content) }, ...(await observe(h, res))] as Anthropic.Beta.BetaToolResultBlockParam['content']; }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    res.error = e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : (e as Error).message;
  } finally {
    res.coverage = Object.fromEntries(h.coverage);
    res.account = h.account;
    await h.close();
  }
  return res;
}

/** The stand-in agent for runs without the Anthropic API: enlist (mock) or open the demo, tour the
 * account, exercise the assigned slice, visit every screen once, and measure each observation. */
export async function playScripted(p: Profile, target: string, out: string, o: AgentOpts): Promise<AiResult> {
  const res = blank(p, 'scripted');
  const h = await Harness.open(p, target, `${out}/ai`, { allow: o.allow, fresh: false });
  try {
    await start(h, p);
    res.account = h.account;
    await observe(h, res);
    if (h.account) { res.actions.push(await STEPS['account-tour'](h)); await observe(h, res); }
    for (const id of p.slice) {
      const f = feature(id)!;
      const { exercise } = await import('../browser/journeys');
      h.step = `feature:${id}`;
      res.actions.push(await exercise(h, f));
      await observe(h, res);
      res.steps++;
    }
    for (const path of ['/console', '/energy', '/market', '/replicants', '/galaxy', '/guild', '/chat', '/sim', '/campaign', '/codex', '/record', '/research', '/tutorial', ...(h.account ? ['/profile'] : [])]) {
      h.step = `visit:${path}`;
      const errs = h.findings.length;
      await h.go(path); await h.tours();
      await observe(h, res);
      const broke = h.findings.slice(errs).filter((x) => x.kind === 'pageerror' || x.kind === 'js.error');
      if (broke.length) res.notes.push({ severity: 'blocker', title: `${path} threw an error`, detail: broke.map((x) => x.message).join(' | ').slice(0, 400), step: res.steps, url: h.page.url() });
      res.steps++;
    }
    const blocked = await h.blocked();
    if (blocked.length) res.notes.push({ severity: 'praise', title: 'Guard rails held', detail: `blocked: ${[...new Set(blocked)].join(', ')}`, step: res.steps, url: h.page.url() });
    for (const f of h.findings.filter((x) => x.severity === 'blocker' || x.severity === 'major')) res.notes.push({ severity: f.severity === 'blocker' ? 'blocker' : 'major', title: f.kind, detail: f.message, step: res.steps, url: '' });
  } catch (e) {
    res.error = (e as Error).message;
  } finally {
    res.coverage = Object.fromEntries(h.coverage);
    res.account = h.account;
    await h.close();
  }
  return res;
}

export interface Triage { headline: string; issues: { title: string; severity: 'blocker' | 'major' | 'minor'; personas: string[]; evidence: string; repro: string; fix: string }[]; praise: string[]; balance: string[] }

/** One call over every persona's notes, coverage and the automated findings: dedupe and rank. */
export async function synthesise(client: Anthropic, input: unknown): Promise<Triage> {
  const schema = obj({
    headline: { type: 'string' },
    issues: { type: 'array', items: obj({ title: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, personas: { type: 'array', items: { type: 'string' } }, evidence: { type: 'string' }, repro: { type: 'string' }, fix: { type: 'string' } }) },
    praise: { type: 'array', items: { type: 'string' } },
    balance: { type: 'array', items: { type: 'string' } },
  });
  const r = await client.messages.create({
    model: MODEL, max_tokens: 16000, thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    system: 'You are the lead of a game studio playtest team. Merge playtest results from AI playtesters and automated probes into one triage list for the developers: deduplicate the same problem seen by several personas, rank by player impact (a blocker stops play; major hurts many players; minor is polish), and keep only issues with evidence. For each, give the evidence, concrete repro steps and a suggested fix. Under balance, summarise what the headless simulation says about strategy balance and difficulty. Under praise, what testers liked.',
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  });
  const text = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Triage;
}

export { accountBudget };
