import './styles/app.css';
import { route, startRouter } from './router';
import { shell } from './ui/shell';
import { session } from './api/session';
import { wallet } from './wallet/wallet';

shell(document.getElementById('app')!);

route('/', () => import('./screens/home'));
route('/login', () => import('./screens/login'));
route('/start', () => import('./screens/login'));
route('/console', () => import('./screens/console'));
route('/energy', () => import('./screens/energy'));
route('/market', () => import('./screens/market'));
route('/replicants', () => import('./screens/replicants'));
route('/sim', () => import('./screens/sim'));
route('/chat', () => import('./screens/chat'));
route('/tutorial', () => import('./screens/tutorial'));
route('/profile', () => import('./screens/profile'));
route('/404', () => import('./screens/notfound'));

// A device-sealed vault opens itself, then the guild session resumes, then the screen renders.
void wallet.restore().catch(() => null).then(() => session.resume()).finally(startRouter);
