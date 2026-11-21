// "Your tools": pinned and recently opened tools at the top of the home page, a pin on every tool, and
// filter tabs over the full list. Kept in this browser's storage only; nothing is sent anywhere.
import { t } from './i18n';

const PINS = 'fizzdoc-pins';
const RECENT = 'fizzdoc-recent';
const RECENT_MAX = 8;

const load = (key: string): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
};
const store = (key: string, list: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // storage blocked: pins last for this visit only
  }
};

const pinned = () => load(PINS);
function togglePin(path: string) {
  const pins = pinned();
  store(PINS, pins.includes(path) ? pins.filter((p) => p !== path) : [path, ...pins]);
}

/** A tool page: remember the visit, and offer a pin next to the title. */
function toolPage() {
  const path = location.pathname;
  store(RECENT, [path, ...load(RECENT).filter((p) => p !== path)].slice(0, RECENT_MAX));
  const title = document.querySelector('.hero-tool h1');
  if (!title) return;
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'pin-page';
  const sync = () => {
    const on = pinned().includes(path);
    pin.setAttribute('aria-pressed', String(on));
    pin.textContent = t(on ? 'pin.pageOn' : 'pin.page');
  };
  pin.onclick = () => {
    togglePin(path);
    sync();
  };
  sync();
  title.after(pin);
}

/** The home page: the "Your tools" row, a pin on each card, and the filter tabs. */
function homePage(tools: HTMLElement) {
  const cards = [...tools.querySelectorAll<HTMLAnchorElement>('.tool-card')];
  const byPath = new Map(cards.map((card) => [new URL(card.href).pathname, card]));
  const mine = document.getElementById('mine')!;
  const list = mine.querySelector('ul')!;

  const render = () => {
    const pins = pinned().filter((p) => byPath.has(p));
    const recent = load(RECENT).filter((p) => byPath.has(p) && !pins.includes(p));
    const paths = [...pins, ...recent].slice(0, 12);
    mine.hidden = !paths.length;
    list.replaceChildren(
      ...paths.map((path) => {
        const item = document.createElement('li');
        const card = byPath.get(path)!.cloneNode(true) as HTMLAnchorElement;
        card.removeAttribute('data-spring');
        item.append(card);
        if (pins.includes(path)) item.classList.add('is-pinned');
        return item;
      }),
    );
    for (const button of tools.querySelectorAll<HTMLButtonElement>('.pin')) button.setAttribute('aria-pressed', String(pins.includes(button.dataset.path!)));
  };

  // A pin on every card in the full list.
  for (const [path, card] of byPath) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    pin.dataset.path = path;
    pin.setAttribute('aria-label', t('pin.add', { name: card.querySelector('strong')?.textContent ?? '' }));
    pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>';
    pin.onclick = () => {
      togglePin(path);
      render();
    };
    card.parentElement!.append(pin);
  }
  render();

  // Filter tabs: one kind of file at a time, instead of scrolling past every tool.
  const groups = [...tools.querySelectorAll<HTMLElement>('.format-group')];
  const tabs = document.createElement('div');
  tabs.className = 'filter-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', t('home.filter'));
  const show = (id: string) => {
    for (const group of groups) group.hidden = id !== 'all' && group.id !== id;
    // The side-by-side layout of the smaller groups only makes sense when they all show.
    tools.querySelector('.office-groups')?.classList.toggle('single', id !== 'all');
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String((tab as HTMLElement).dataset.id === id));
  };
  const tab = (id: string, label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = id;
    button.textContent = label;
    button.onclick = () => show(id);
    return button;
  };
  tabs.append(tab('all', t('home.all')), ...groups.map((group) => tab(group.id, [...group.querySelector('h3')!.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim())));
  tools.querySelector('.section-head')!.after(tabs);
  show(location.hash.slice(1) && groups.some((g) => g.id === location.hash.slice(1)) ? location.hash.slice(1) : 'all');
  // The format links in the hero open their tab.
  addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (groups.some((g) => g.id === id)) show(id);
  });
}

export function setUpMine() {
  const tools = document.getElementById('tools');
  if (tools && document.getElementById('mine')) homePage(tools);
  else if (document.body.dataset.tool) toolPage();
}
