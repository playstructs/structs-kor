/* The AI playtester: Claude plays the live client as one persona, looking at a screenshot and a
 * numbered list of the controls on screen each turn, acting through a few tools, writing notes as
 * it goes and a review at the end — the session a human playtester would give you, on demand.
 * The history is append-only (every assistant turn goes back exactly as returned). */
import Anthropic from '@anthropic-ai/sdk';
import { Harness, FORBIDDEN } from '../browser/harness';
import type { Profile } from '../profiles';

export const MODEL = process.env.PLAYTEST_MODEL ?? 'claude-opus-5-5';

export interface Note { severity: 'blocker' | 'major' | 'minor' | 'praise'; title: string; detail: string; step: number; url: string; screenshot?: string }
export interface Review { fun: number; clarity: number; difficulty: number; would_return: boolean; summary: string; top_issues: string[]; best_moment: string }
export interface AiResult { persona: string; model: string; steps: number; notes: Note[]; review: Review | null; actions: string[]; usage: { input: number; output: number; cacheRead: number }; error?: string }

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object' as const, properties, required, additionalProperties: false });
const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { name: 'click', description: 'Click (or tap) the control with this number from the list.', strict: true, input_schema: obj({ ref: { type: 'integer' } }) },
  { name: 'press', description: 'Press a keyboard key, e.g. "e", "1", "Escape", "Tab", "Enter", "?", "F10".', strict: true, input_schema: obj({ key: { type: 'string' } }) },
  { name: 'type', description: 'Type text into the input with this number, then press Enter.', strict: true, input_schema: obj({ ref: { type: 'integer' }, text: { type: 'string' } }) },
  { name: 'wait', description: 'Let game time pass: blocks of 4 seconds each (1–60). Use it to see production, raids and events play out.', strict: true, input_schema: obj({ blocks: { type: 'integer' } }) },
  { name: 'note', description: 'Record a playtest observation as you go: a bug, confusion, friction, or something that works well.', strict: true, input_schema: obj({ severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'praise'] }, title: { type: 'string' }, detail: { type: 'string' } }) },
  {
    name: 'finish', description: 'End the session with your review as this persona. Call once, when you have played enough or run out of steps.', strict: true,
    input_schema: obj({
      fun: { type: 'integer', description: '1–10' }, clarity: { type: 'integer', description: '1–10: how well the game explained itself' }, difficulty: { type: 'integer', description: '1–10' },
      would_return: { type: 'boolean' }, summary: { type: 'string' }, top_issues: { type: 'array', items: { type: 'string' } }, best_moment: { type: 'string' },
    }),
  },
];

function system(p: Profile, steps: number) {
  return `You are a playtester for 구조체 STRUCTS, a Korean-language space strategy game played in the browser. You are playing in the free demo base (a pretend base that runs in the browser; nothing touches a real chain or account).

You play as this person, and judge the game through their eyes:
- Who: ${p.name} — ${p.archetype}. ${p.bio}
- Skill with strategy games: ${Math.round(p.skill * 10)}/10. Patience: gives up on a confusing screen after about ${p.patience} actions.
- Device: ${p.device}, ${p.input} input${p.zoom > 1 ? `, ${p.zoom * 100}% zoom` : ''}${p.motion === 'reduced' ? ', reduced motion' : ''}. ${p.input === 'keyboard' ? 'Use the keyboard (press) wherever you can; only click when nothing else works, and note it.' : ''}
- Goals: ${p.goals.join('; ')}.
- Voice: ${p.voice}
- The studio wants this session to answer: ${p.questions.join(' ')}

How to play: each turn you get a screenshot and a numbered list of the controls on screen. Act with click, press, type or wait. Keep a running log with note whenever something confuses, frustrates, breaks or delights this person — be concrete (what you did, what you expected, what happened), so a developer can reproduce it. Do not go to login, enlistment (입대) or wallet screens; stay in the demo. You have about ${steps} actions; call finish with your review before they run out. Write notes and the review in English, quoting Korean UI text where it matters.`;
}

/** Number the visible controls and return a compact text list (refs live in data-pt-ref). */
async function snapshot(h: Harness) {
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

async function observe(h: Harness): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  await h.tours();
  const snap = await snapshot(h).catch(() => ({ url: h.page.url(), controls: '(page not readable)', text: '' }));
  const img = await h.page.screenshot({ type: 'jpeg', quality: 60, scale: 'css' }).catch(() => null);
  const s = await h.demoState();
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (img) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.toString('base64') } });
  blocks.push({ type: 'text', text: `Page ${snap.url} · demo height ${s?.height ?? '—'} · α ${typeof s?.alpha === 'number' ? s.alpha.toFixed(1) : '—'} · ore ${typeof s?.ore === 'number' ? Math.floor(s.ore) : '—'}\nControls:\n${snap.controls}\n\nVisible text (trimmed):\n${snap.text}` });
  return blocks;
}

export async function playAi(client: Anthropic, p: Profile, target: string, out: string, maxSteps = 30): Promise<AiResult> {
  const res: AiResult = { persona: p.id, model: MODEL, steps: 0, notes: [], review: null, actions: [], usage: { input: 0, output: 0, cacheRead: 0 } };
  const h = await Harness.open(p, target, `${out}/ai`, {});
  try {
    await h.go('/');
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'You have just opened the game from a shared link. Start playing.' }, ...(await observe(h))] }];
    for (let step = 0; step < maxSteps + 3 && !res.review; step++) {
      const last = step >= maxSteps;
      if (last) messages.push({ role: 'user', content: [{ type: 'text', text: 'You are out of actions. Call finish now with your review.' }] });
      const r = await client.beta.messages.create({
        model: MODEL, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
        system: [{ type: 'text', text: system(p, maxSteps), cache_control: { type: 'ephemeral' } }],
        tools: TOOLS, tool_choice: { type: 'auto' },
        messages,
      });
      res.usage.input += r.usage.input_tokens; res.usage.output += r.usage.output_tokens; res.usage.cacheRead += r.usage.cache_read_input_tokens ?? 0;
      messages.push({ role: 'assistant', content: r.content });
      if (r.stop_reason === 'refusal') { res.error = `refused: ${r.stop_details?.category ?? ''}`; break; }
      const uses = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (!uses.length) { messages.push({ role: 'user', content: [{ type: 'text', text: 'Use a tool: act on the game, note something, or finish.' }] }); continue; }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      let acted = false;
      for (const u of uses) {
        const input = u.input as Record<string, unknown>;
        let out = 'done';
        try {
          switch (u.name) {
            case 'click': {
              const el = h.page.locator(`[data-pt-ref="${Number(input.ref)}"]`);
              const href = await el.getAttribute('href').catch(() => null);
              if (!(await el.count())) out = `no control [${input.ref}] on screen`;
              else if (href && (FORBIDDEN.test(href) || (/^https?:/.test(href) && !href.startsWith(h.target.origin)))) out = 'that leads outside the demo; the harness blocked it';
              else { if (p.input === 'touch') await el.tap({ timeout: 3000 }).catch(() => el.click({ timeout: 3000, force: true })); else await el.click({ timeout: 3000 }).catch(() => el.click({ timeout: 3000, force: true })); await h.settle(300); }
              acted = true; res.actions.push(`click ${input.ref}`); break;
            }
            case 'press': await h.key(String(input.key)); acted = true; res.actions.push(`press ${input.key}`); break;
            case 'type': { const el = h.page.locator(`[data-pt-ref="${Number(input.ref)}"]`); await el.fill(String(input.text)); await el.press('Enter'); await h.settle(300); acted = true; res.actions.push(`type ${input.ref}`); break; }
            case 'wait': { const n = Math.max(1, Math.min(60, Number(input.blocks) || 1)); await h.play(n); acted = true; res.actions.push(`wait ${n}`); break; }
            case 'note': { const shot = await h.screenshot(`note-${res.notes.length + 1}`); res.notes.push({ severity: input.severity as Note['severity'], title: String(input.title), detail: String(input.detail), step, url: h.page.url(), screenshot: `ai/${p.id}/${shot}` }); out = 'noted'; break; }
            case 'finish': res.review = input as unknown as Review; out = 'thanks'; break;
            default: out = `unknown tool ${u.name}`;
          }
          if (new URL(h.page.url()).origin !== h.target.origin || FORBIDDEN.test(new URL(h.page.url()).pathname)) { await h.go('/console'); out += ' (left the demo; brought back to the bridge)'; }
        } catch (e) { out = `error: ${(e as Error).message.split('\n')[0]}`; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: out });
      }
      res.steps = step + 1;
      // The new view goes with the results so the next turn sees what its actions did.
      const view = acted && !res.review ? await observe(h) : [];
      messages.push({ role: 'user', content: [...results, ...view] });
    }
  } catch (e) {
    res.error = e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : (e as Error).message;
  } finally {
    await h.close();
  }
  return res;
}

export interface Triage { headline: string; issues: { title: string; severity: 'blocker' | 'major' | 'minor'; personas: string[]; evidence: string; repro: string; fix: string }[]; praise: string[]; balance: string[] }

/** One call over every persona's notes, reviews and the automated findings: dedupe and rank. */
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
