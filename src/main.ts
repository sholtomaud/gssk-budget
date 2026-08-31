import './styles/global.css';
import './components/budget-shell/budget-shell.ts';
import { Router } from './core/router/router.ts';

/* The app is served from GitHub Pages at https://<user>.github.io/<repo>/, so
 * the deployment base is a path prefix rather than the domain root. Vite is
 * given the same prefix by `--base ./` at build time; this derives it at run
 * time so the router agrees with wherever the page was actually served from. */
function deploymentBase(): string {
  const onPages = window.location.hostname.endsWith('.github.io');
  const firstSegment = window.location.pathname.split('/')[1];
  return onPages && firstSegment !== undefined && firstSegment !== ''
    ? `/${firstSegment}/`
    : '/';
}

const router = Router.getInstance(deploymentBase());

/* No routes are registered yet, deliberately. The views in §9.2 arrive with the
 * tasks that build them — p1-item-crud, p1-transaction-entry and the rest — and
 * registering a route to a component that does not exist would only produce a
 * 404 that looks like a bug. Until then <budget-shell> is the whole page and
 * its route host shows the scaffold panel. */

export { router };
