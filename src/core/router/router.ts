/* Client-side routing over a static host.
 *
 * The app is served from GitHub Pages at https://<user>.github.io/<repo>/, so
 * the browser's pathname and the app's own path differ by that prefix. The two
 * conversions are pure functions and are unit-tested, because getting them
 * wrong shows up only once deployed.
 */

export interface Route {
  path: string;
  component: string;
  beforeEnter?: (to: RouteTarget) => boolean | string | Promise<boolean | string>;
}

export interface CompiledRoute extends Route {
  regex: RegExp;
  paramNames: string[];
}

export interface RouteMatch {
  route: CompiledRoute;
  params: Record<string, string>;
}

export interface RouteTarget {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

/* A parameter is one path segment. `[^/]+` rather than `.+` is what stops
 * /items/:id matching /items/a/b and mounting the wrong component. */
const PARAM = /:([^/]+)/g;

function normalise(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function withTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

export function compileRoute(route: Route): CompiledRoute {
  const path = normalise(route.path);
  const paramNames: string[] = [];
  const source = path.replace(PARAM, (_match, name: string) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { ...route, path, regex: new RegExp(`^${source}$`), paramNames };
}

export function matchRoute(routes: CompiledRoute[], path: string): RouteMatch | null {
  for (const route of routes) {
    const found = path.match(route.regex);
    if (found === null) continue;

    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      const raw = found[i + 1];
      if (raw !== undefined) params[name] = decodeURIComponent(raw);
    });
    return { route, params };
  }
  return null;
}

/** The app path for a browser location, with the deployment base removed. */
export function appPathFrom(pathname: string, search: string, base: string): string {
  const prefix = withTrailingSlash(base);

  if (prefix.length > 1) {
    /* `/repo` with no trailing slash is the same place as `/repo/`. */
    if (pathname === prefix.slice(0, -1)) return `/${search}`.replace(/\/$/, '/') + '' || '/';
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length);
      return normalise(rest === '' ? '/' : rest) + search;
    }
    /* Outside the base. Returned unchanged rather than rewritten, so a wrong
     * base shows up as a 404 instead of a route that silently half-works. */
    return normalise(pathname) + search;
  }

  return normalise(pathname) + search;
}

/** The browser path for an app path. The inverse of `appPathFrom`. */
export function publicPathFor(appPath: string, base: string): string {
  const prefix = withTrailingSlash(base);
  const [path = '/', query] = normalise(appPath).split('?');
  return prefix + path.replace(/^\//, '') + (query === undefined ? '' : `?${query}`);
}

export class Router {
  private static instance: Router | undefined;
  private readonly routes: CompiledRoute[] = [];
  private currentPath = '';

  private readonly base: string;

  private constructor(base: string) {
    this.base = base;
    window.addEventListener('popstate', () => { void this.handleRoute(); });
  }

  static getInstance(base?: string): Router {
    Router.instance ??= new Router(base ?? '/');
    return Router.instance;
  }

  registerRoute(route: Route): void {
    this.routes.push(compileRoute(route));
  }

  getAppPath(): string {
    return appPathFrom(window.location.pathname, window.location.search, this.base);
  }

  navigate(appPath: string): void {
    const target = publicPathFor(appPath, this.base);
    if (window.location.pathname + window.location.search !== target) {
      window.history.pushState({}, '', target);
    }
    void this.handleRoute();
  }

  async handleRoute(): Promise<void> {
    const appPath = this.getAppPath();
    const [path = '/', queryString] = appPath.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryString ?? '').entries());

    const hit = matchRoute(this.routes, path);
    if (hit === null) {
      this.showNotFound(path);
      return;
    }

    if (hit.route.beforeEnter !== undefined) {
      const verdict = await hit.route.beforeEnter({ path, params: hit.params, query });
      if (verdict === false) {
        if (this.currentPath !== '' && this.currentPath !== appPath) this.navigate(this.currentPath);
        return;
      }
      if (typeof verdict === 'string') {
        this.navigate(verdict);
        return;
      }
    }

    this.currentPath = appPath;
    await this.mount(hit.route.component, hit.params, query);
  }

  private async mount(
    tagName: string,
    params: Record<string, string>,
    query: Record<string, string>,
  ): Promise<void> {
    const outlet = document.querySelector('#router-outlet');
    if (outlet === null) return;

    try {
      if (customElements.get(tagName) === undefined) {
        await import(`../../components/${tagName}/${tagName}.ts`);
      }
      const element = document.createElement(tagName);
      Object.assign(element, { params, query });
      outlet.replaceChildren(element);
    } catch (error) {
      console.error(`Failed to load component '${tagName}'`, error);
      this.showNotFound(tagName);
    }
  }

  /* Plain elements and design tokens — ADR 2 removed the utility classes boba's
   * scaffold used here. The text sets no expectation it cannot meet. */
  private showNotFound(what: string): void {
    const outlet = document.querySelector('#router-outlet');
    if (outlet === null) return;
    outlet.replaceChildren();

    const wrap = document.createElement('section');
    const heading = document.createElement('h1');
    heading.textContent = 'Not found';
    const detail = document.createElement('p');
    detail.textContent = `There is nothing at ${what}.`;
    const back = document.createElement('a');
    back.href = publicPathFor('/', this.base);
    back.textContent = 'Back to the ledger';

    wrap.append(heading, detail, back);
    outlet.appendChild(wrap);
  }
}
