import './styles/app.css';
import './styles/game.css';
import './styles/structicons.css';
import './styles/sui.css';
import './game/sfx';
import './game/keys';
import './game/music';
import { demo } from './game/demo';
import './game/director';
import './game/medals';
import { href, onRoute, route, startRouter } from './router';
import { applySeo } from './seo';
import { SITE_URL } from './config';
import { shell } from './ui/shell';
import { session } from './api/session';
import { wallet } from './wallet/wallet';

shell(document.getElementById('app')!);
onRoute((path) => applySeo(path, SITE_URL, href('')));
demo.run();

route('/', () => import('./screens/home'));
route('/login', () => import('./screens/login'));
route('/start', () => import('./screens/login'));
route('/console', () => import('./screens/console'));
route('/energy', () => import('./screens/energy'));
route('/market', () => import('./screens/market'));
route('/research', () => import('./screens/research'));
route('/record', () => import('./screens/record'));
route('/galaxy', () => import('./screens/galaxy'));
route('/campaign', () => import('./screens/campaign'));
route('/guild', () => import('./screens/guild'));
route('/replicants', () => import('./screens/replicants'));
route('/sim', () => import('./screens/sim'));
route('/chat', () => import('./screens/chat'));
route('/tutorial', () => import('./screens/tutorial'));
route('/codex', () => import('./screens/codex'));
route('/profile', () => import('./screens/profile'));
route('/404', () => import('./screens/notfound'));

// A device-sealed vault opens itself, then the guild session resumes, then the screen renders.
void wallet.restore().catch(() => null).then(() => session.resume()).finally(startRouter);
