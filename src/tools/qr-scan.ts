// QR & Barcode Scanner: reads codes from the camera, a photo or a pasted screenshot, on the device.
// Nothing is sent anywhere and nothing is kept: close the page and the results are gone.
import type { Found } from '../engine/scan';
import { t } from '../i18n';
import './qr-scan.css';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const button = (text: string, className = 'button') => Object.assign(element('button', className, text), { type: 'button' as const });

/** A file the person keeps (a contact card, a calendar event), made from the code's own text. */
const saveFile = (text: string, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(element('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** Fields of a WIFI:T:WPA;S:name;P:pass;; code, with its backslash escapes undone. */
export function wifiFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [, key, value] of text.slice(5).matchAll(/([A-Z]):((?:\\.|[^;])*);/g)) fields[key] = value.replace(/\\(.)/g, '$1');
  return fields;
}

/** What a code is and what can be done with it: open a link, join Wi-Fi, save a contact, pay… */
function actionsFor(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  const link = (href: string, label: string) => {
    const a = Object.assign(element('a', 'button primary', label), { href, rel: 'noopener noreferrer', target: '_blank' });
    out.push(a);
  };
  const copy = (value: string, label: string) => {
    const b = button(label);
    b.onclick = async () => {
      await navigator.clipboard.writeText(value).catch(() => {});
      b.textContent = t('scan.copied');
      setTimeout(() => (b.textContent = label), 1500);
    };
    out.push(b);
  };
  if (/^https?:\/\//i.test(text)) link(text, t('scan.open'));
  else if (/^WIFI:/i.test(text)) {
    const f = wifiFields(text);
    out.push(element('p', 'scan-detail', t('scan.wifi', { name: f.S ?? '' })));
    if (f.P) copy(f.P, t('scan.copyPassword'));
  } else if (/^upi:\/\/pay/i.test(text)) {
    const q = new URLSearchParams(text.slice(text.indexOf('?') + 1));
    out.push(element('p', 'scan-detail', t('scan.upi', { name: q.get('pn') || q.get('pa') || '', id: q.get('pa') ?? '', amount: q.get('am') ? `₹${q.get('am')}` : '' })));
    link(text, t('scan.pay'));
  } else if (/^BEGIN:VCARD/i.test(text)) {
    const b = button(t('scan.contact'), 'button primary');
    b.onclick = () => saveFile(text, 'contact.vcf', 'text/vcard');
    out.push(b);
  } else if (/^BEGIN:VEVENT/i.test(text)) {
    const b = button(t('scan.event'), 'button primary');
    b.onclick = () => saveFile(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${text.replace(/\r?\n/g, '\r\n')}\r\nEND:VCALENDAR\r\n`, 'event.ics', 'text/calendar');
    out.push(b);
  } else if (/^(tel|mailto|sms|smsto|geo):/i.test(text)) link(text.replace(/^smsto:([^:]*):?(.*)$/i, (_, n, m) => `sms:${n}${m ? `?body=${encodeURIComponent(m)}` : ''}`), t('scan.open'));
  copy(text, t('scan.copy'));
  return out;
}

export function openScanner(root: HTMLElement) {
  root.classList.add('scan');
  const controls = element('div', 'actions');
  const cameraButton = button(t('scan.camera'), 'button primary');
  const photoButton = button(t('scan.photo'));
  const photoInput = Object.assign(element('input'), { type: 'file', accept: 'image/*', hidden: true });
  photoInput.setAttribute('aria-label', t('scan.photo'));
  controls.append(cameraButton, photoButton, photoInput);
  const hint = element('p', 'hint', t('scan.hint'));
  const stage = element('div', 'scan-stage');
  stage.hidden = true;
  const video = Object.assign(element('video'), { muted: true, playsInline: true });
  video.setAttribute('aria-label', t('scan.cameraView'));
  const still = Object.assign(element('img', 'scan-still'), { alt: '' });
  const overlay = element('canvas', 'scan-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  stage.append(video, still, overlay);
  const status = element('p', 'status');
  status.setAttribute('role', 'status');
  const list = element('ol', 'scan-results');
  list.setAttribute('aria-label', t('scan.results'));
  root.replaceChildren(controls, hint, stage, status, list);

  const seen = new Set<string>();
  const show = (found: Found[]) => {
    for (const code of found) {
      if (!code.text || seen.has(code.text)) continue;
      seen.add(code.text);
      const item = element('li', 'scan-result');
      const head = element('p', 'scan-format', code.format.replace(/QRCode$/, 'QR code').replace(/^(EAN|UPC)(\w+)$/, '$1-$2'));
      const text = element('pre', 'scan-text', code.text);
      text.tabIndex = 0;
      const row = element('div', 'actions');
      row.append(...actionsFor(code.text));
      item.append(head, text, row);
      list.prepend(item);
      navigator.vibrate?.(60);
    }
  };
  /** Outlines each code on the picture, so the person sees which one was read. */
  const outline = (found: Found[], width: number, height: number) => {
    overlay.width = width;
    overlay.height = height;
    const context = overlay.getContext('2d')!;
    context.clearRect(0, 0, width, height);
    context.lineWidth = Math.max(3, width / 200);
    context.strokeStyle = '#22c55e';
    for (const { position: p } of found) {
      context.beginPath();
      context.moveTo(p.topLeft.x, p.topLeft.y);
      for (const point of [p.topRight, p.bottomRight, p.bottomLeft]) context.lineTo(point.x, point.y);
      context.closePath();
      context.stroke();
    }
  };

  // ---- A photo, a dropped picture or a pasted screenshot ----
  const readPicture = async (file: Blob) => {
    stopCamera();
    status.textContent = t('scan.reading');
    const { readCodes } = await import('../engine/scan');
    const found = await readCodes(file);
    const bitmap = await createImageBitmap(file);
    if (still.src) URL.revokeObjectURL(still.src);
    still.src = URL.createObjectURL(file);
    still.hidden = false;
    video.hidden = true;
    stage.hidden = false;
    outline(found, bitmap.width, bitmap.height);
    status.textContent = found.length ? t('scan.found', { n: found.length }) : t('scan.none');
    show(found);
  };
  photoButton.onclick = () => photoInput.click();
  photoInput.onchange = () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (file) void readPicture(file);
  };
  addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) void readPicture(file);
  });
  root.addEventListener('dragover', (event) => event.preventDefault());
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) void readPicture(file);
  });

  // ---- Camera: frames are read a few times a second until it is turned off ----
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function stopCamera() {
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.srcObject = null;
    cameraButton.textContent = t('scan.camera');
  }
  const frame = element('canvas');
  const tick = async () => {
    if (!stream) return;
    if (video.videoWidth) {
      // A smaller copy of the frame reads faster, and codes are still big enough at 960 px.
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      frame.width = Math.round(video.videoWidth * scale);
      frame.height = Math.round(video.videoHeight * scale);
      const context = frame.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(video, 0, 0, frame.width, frame.height);
      const { readCodes } = await import('../engine/scan');
      const found = await readCodes(context.getImageData(0, 0, frame.width, frame.height), true);
      outline(found, frame.width, frame.height);
      if (found.length) status.textContent = t('scan.found', { n: found.length });
      show(found);
    }
    timer = setTimeout(tick, 150);
  };
  cameraButton.onclick = async () => {
    if (stream) return stopCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch {
      status.textContent = t('scan.noCamera');
      return;
    }
    video.srcObject = stream;
    await video.play();
    still.hidden = true;
    video.hidden = false;
    stage.hidden = false;
    cameraButton.textContent = t('scan.stop');
    status.textContent = t('scan.looking');
    void tick();
  };
  addEventListener('pagehide', stopCamera);
}
