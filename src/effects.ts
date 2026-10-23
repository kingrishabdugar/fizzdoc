// Small, optional delights: theme switch, a ripple on background clicks, and elements that can be
// dragged around and spring back. Everything is transform/opacity only and respects reduced motion.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function setUpThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const root = document.documentElement;
  button?.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', root.dataset.theme);
    } catch {
      // Private mode: the choice just won't be remembered.
    }
  });
}

function setUpRipple() {
  document.addEventListener('pointerdown', (event) => {
    if (reducedMotion.matches || event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('a, button, input, select, textarea, label, summary, dialog, [data-spring], .workspace')) return;
    const ripple = document.createElement('span');
    ripple.className = 'tap-ripple';
    ripple.style.left = `${event.clientX}px`;
    ripple.style.top = `${event.clientY}px`;
    ripple.addEventListener('animationend', () => ripple.remove());
    document.body.append(ripple);
  });
}

/** Lets an element follow the pointer, then springs it back to where it started. */
function springDrag(element: HTMLElement) {
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let moved = false;

  element.addEventListener('pointerdown', (event) => {
    // Links only drag with a mouse, so taps and scrolling on touch screens behave normally.
    if (event.button !== 0 || (element instanceof HTMLAnchorElement && event.pointerType !== 'mouse')) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
  });
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved) {
      if (Math.hypot(dx, dy) < 6) return;
      moved = true;
      element.setPointerCapture(event.pointerId);
      element.classList.remove('returning');
      element.classList.add('dragging');
    }
    element.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 25}deg)`;
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    if (!moved) return;
    element.classList.remove('dragging');
    element.classList.add('returning');
    element.style.transform = '';
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('transitionend', () => element.classList.remove('returning'));
  // A drag that ends on a link must not also open it.
  element.addEventListener(
    'click',
    (event) => {
      if (!moved) return;
      event.preventDefault();
      moved = false;
    },
    true,
  );
}

/** The language menu opens the same page in the chosen language. A one-time tip points to it. */
function setUpLanguage() {
  const select = document.getElementById('lang-select') as HTMLSelectElement | null;
  const tip = document.getElementById('lang-tip');
  if (!select || !tip) return;
  select.addEventListener('change', () => location.assign(select.value));
  try {
    if (localStorage.getItem('langTip')) return;
    localStorage.setItem('langTip', '1');
  } catch {
    return; // no storage, no way to show it only once: skip it
  }
  // Written in the visitor's own language when we have it, otherwise in the page's.
  const tips = JSON.parse(select.dataset.tips ?? '{}') as Record<string, string>;
  const own = navigator.languages.map((code) => code.slice(0, 2)).find((code) => code in tips);
  tip.querySelector('span')!.textContent = tips[own ?? document.documentElement.lang] ?? tips.en;
  tip.hidden = false;
  const close = () => (tip.hidden = true);
  tip.querySelector('button')!.addEventListener('click', close);
  select.addEventListener('focus', close);
  setTimeout(close, 9000);
}

/** Header share button: the phone's share sheet when there is one, otherwise a small menu of links. */
function setUpShare() {
  const button = document.getElementById('share-btn');
  const pop = document.getElementById('share-pop');
  const close = () => {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  };
  button?.addEventListener('click', async () => {
    const links = pop?.querySelector<HTMLElement>('.share-links');
    if (navigator.share && matchMedia('(pointer: coarse)').matches && links) {
      try {
        await navigator.share({ title: document.title, text: links.dataset.text, url: links.dataset.url });
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return; // they closed the sheet
      }
    }
    if (!pop) return;
    pop.hidden = !pop.hidden;
    button.setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('.share')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  // Copy link, wherever the share links appear.
  document.addEventListener('click', async (event) => {
    const copy = (event.target as Element).closest<HTMLButtonElement>('.share-copy');
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy.dataset.url!);
    } catch {
      return; // no clipboard access (old browser or insecure page): the other links still work
    }
    const label = copy.getAttribute('aria-label')!;
    copy.classList.add('done');
    copy.setAttribute('aria-label', copy.dataset.done!);
    copy.title = copy.dataset.done!;
    setTimeout(() => {
      copy.classList.remove('done');
      copy.setAttribute('aria-label', label);
      copy.title = label;
    }, 2000);
  });
}

/** iPhone and iPad (iPadOS reports itself as a Mac, but with touch). */
export const isAppleMobile = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/**
 * "Install Fizzdoc": opens the browser's own install prompt where it offers one (Chrome, Edge). iPhone
 * and iPad have no prompt, so there the button opens the Add to Home Screen steps (a native popover).
 */
function setUpInstall() {
  const button = document.getElementById('install-btn');
  if (!button || matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) return;
  let offer: (Event & { prompt(): Promise<unknown> }) | undefined;
  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event as typeof offer;
    button.hidden = false;
  });
  addEventListener('appinstalled', () => (button.hidden = true));
  button.addEventListener('click', async () => {
    if (!offer) return;
    await offer.prompt();
    offer = undefined; // a prompt can only be shown once
    button.hidden = true;
  });
  if (isAppleMobile()) {
    button.setAttribute('popovertarget', 'install-tip');
    button.hidden = false;
  }
}

export function setUpEffects() {
  setUpThemeToggle();
  setUpShare();
  setUpInstall();
  setUpLanguage();
  setUpRipple();
  document.querySelectorAll<HTMLElement>('[data-spring]').forEach(springDrag);
}
