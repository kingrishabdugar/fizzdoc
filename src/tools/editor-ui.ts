// Building blocks shared by the Photo Editor and the Collage Maker: buttons, our own line icons, rulers and
// the tab bar. The look lives in photo-edit.css (.pe-*).

export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

export const button = (label: string, className = 'bg-btn') => {
  const node = element('button', className, label);
  node.type = 'button';
  return node;
};

// Our own line icons, drawn like the site's tool icons.
const ICONS = {
  looks: '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="9" r="5"/><circle cx="12" cy="15" r="5"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  light: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  compare: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 3v18"/>',
  save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  layout: '<rect x="3" y="3" width="8" height="18" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>',
  space: '<path d="M4 4v16M20 4v16M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2"/>',
};
export type Icon = keyof typeof ICONS;

/** A button with one of the icons above and a visible label. */
export const iconButton = (icon: Icon, label: string, className: string) => {
  const node = button('', className);
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  node.append(element('span', '', label));
  return node;
};

/** A labelled group of buttons. */
export const row = (label: string, className: string) => {
  const node = element('div', className);
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', label);
  return node;
};

/** A ruler: the browser's own range input (so keys and screen readers work), with its name and a big value. */
export function slider(label: string, min: number, max: number, step: number, show: (value: number) => string, onInput: (value: number) => void) {
  const range = element('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.setAttribute('aria-label', label);
  const value = element('span', 'pe-value');
  value.setAttribute('aria-hidden', 'true'); // the range announces itself through aria-valuetext
  const head = element('span', 'pe-slider-head');
  head.append(element('span', 'pe-name', label), value);
  const wrap = element('label', min < 0 ? 'pe-slider' : 'pe-slider from-start');
  wrap.append(head, range);
  const set = (v: number) => {
    range.value = String(v);
    value.textContent = show(v);
    range.setAttribute('aria-valuetext', value.textContent);
    // -1…1 for the fill from the middle, or 0…1 from the start when the ruler starts at its lowest value.
    range.style.setProperty('--v', String(min < 0 ? v / max : (v - min) / (max - min)));
  };
  range.oninput = () => {
    set(Number(range.value));
    onInput(Number(range.value));
  };
  return { range, wrap, set };
}

/**
 * The tab bar and one panel per tab. `show(key)` switches; arrow keys, Home and End move between tabs.
 * `viewer.dataset.tab` names the open one, for CSS.
 */
export function tabs<K extends string>(viewer: HTMLElement, keys: readonly K[], label: (key: K) => [Icon, string], onShow: () => void) {
  let current = keys[0];
  const tabList = element('div', 'pe-tabs');
  tabList.setAttribute('role', 'tablist');
  const panels = {} as Record<K, HTMLElement>;
  const buttons = keys.map((key) => {
    const node = iconButton(...label(key), 'pe-tab');
    node.id = `pe-tab-${key}`;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', `pe-${key}`);
    node.onclick = () => show(key);
    const panel = element('div', 'pe-panel');
    panel.id = `pe-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', node.id);
    panels[key] = panel;
    return node;
  });
  tabList.append(...buttons);
  tabList.addEventListener('keydown', (event) => {
    const at = keys.indexOf(current);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: keys.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(keys[(next + keys.length) % keys.length]);
    buttons[keys.indexOf(current)].focus();
  });
  function show(key: K) {
    current = key;
    viewer.dataset.tab = key;
    keys.forEach((k, i) => {
      buttons[i].setAttribute('aria-selected', String(k === key));
      buttons[i].tabIndex = k === key ? 0 : -1;
      panels[k].hidden = k !== key;
    });
    onShow();
  }
  return { tabList, panels, show, current: () => current };
}
