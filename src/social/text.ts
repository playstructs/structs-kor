/* A chat message as HTML: escaped first, web links linked (http/https only), object ids chipped, and
 * share links dropped (their card says it). Pure. */
import { esc } from '../ui/dom';
import { linkIds } from './ids';

/** The text of a message, ready to read: ids as chips, share links as nothing (the card says it). */
export function messageText(body: string, base: string): string {
  const stripped = body.replace(/https?:\/\/\S+\/(o\/\d{1,2}-\d{1,9}|s\/S[A-Za-z0-9_-]{8,6000}|sim\/R[A-Za-z0-9_-]+|daily\/\d{4}-\d{2}-\d{2}(\/D[A-Za-z0-9_-]+)?)\S*/g, '').trim();
  // Web links become links (http/https only); ids become chips everywhere else.
  return esc(stripped || body).split(/(https?:\/\/[^\s<]+)/g).map((part, i) => {
    if (i % 2 === 0) return linkIds(part, base);
    const url = part.replace(/[).,!?'"]+$/, ''), tail = part.slice(url.length);
    return `<a class="cm-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
  }).join('');
}
