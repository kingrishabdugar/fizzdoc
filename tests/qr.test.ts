import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, contrast, payload, svg } from '../src/engine/qr';

describe('QR payloads', () => {
  it('adds https:// to a bare web address and keeps other schemes', () => {
    expect(payload('url', { url: 'fizzdoc.com' })).toBe('https://fizzdoc.com');
    expect(payload('url', { url: 'mailto:a@b.co' })).toBe('mailto:a@b.co');
    expect(payload('url', { url: '' })).toBe('');
  });

  it('escapes Wi-Fi names and passwords, and leaves the password out of open networks', () => {
    expect(payload('wifi', { ssid: 'Home;Net', password: 'a:b"c', security: 'WPA' })).toBe('WIFI:T:WPA;S:Home\\;Net;P:a\\:b\\"c;;');
    expect(payload('wifi', { ssid: 'Cafe', security: 'nopass', hidden: 'true' })).toBe('WIFI:T:nopass;S:Cafe;H:true;;');
  });

  it('builds a UPI link every UPI app reads', () => {
    expect(payload('upi', { pa: 'shop@okicici', pn: 'Ram & Sons', am: '250' })).toBe('upi://pay?pa=shop%40okicici&pn=Ram%20%26%20Sons&am=250&cu=INR');
  });

  it('makes WhatsApp, phone, SMS and email links', () => {
    expect(payload('whatsapp', { phone: '+91 98765-43210', message: 'Hi there' })).toBe('https://wa.me/919876543210?text=Hi%20there');
    expect(payload('phone', { phone: '+91 98765 43210' })).toBe('tel:+919876543210');
    expect(payload('sms', { phone: '12345', message: 'yes' })).toBe('SMSTO:12345:yes');
    expect(payload('email', { to: 'a@b.co', subject: 'Hello' })).toBe('mailto:a@b.co?subject=Hello');
  });

  it('writes a vCard and a calendar event', () => {
    const card = payload('vcard', { first: 'Asha', last: 'Rao', org: 'A, B', phone: '+91 1', email: 'a@b.co' });
    expect(card.split('\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'N:Rao;Asha;;;', 'FN:Asha Rao', 'ORG:A\\, B', 'TEL;TYPE=CELL:+911', 'EMAIL:a@b.co', 'END:VCARD']);
    expect(payload('event', { summary: 'Launch', start: '2026-11-20T09:30' })).toBe('BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20261120T093000\nEND:VEVENT');
  });

  it('makes location and crypto links', () => {
    expect(payload('location', { lat: '19.0760', lng: '72.8777' })).toBe('geo:19.076,72.8777');
    expect(payload('crypto', { coin: 'ethereum', wallet: '0xabc', amount: '0.1' })).toBe('ethereum:0xabc?amount=0.1');
  });
});

describe('QR drawing', () => {
  it('draws a self-contained SVG with the margin around the code', () => {
    const { svg: code, width, height } = svg('https://fizzdoc.com', DEFAULT_STYLE);
    // Version 2 is 25 modules; 4 modules of margin on each side.
    expect(width).toBe(25 + 8);
    expect(height).toBe(width);
    expect(code.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(code.match(/<rect [^>]*stroke-width/g)).toHaveLength(3); // three corner eyes
  });

  it('adds a label under the code, a gradient and a logo when asked', () => {
    const { svg: code, height, width } = svg('hi', { ...DEFAULT_STYLE, frame: 'label', frameText: 'Pay <here>', gradient: 'radial', logo: 'data:image/png;base64,AA' });
    expect(height).toBeGreaterThan(width);
    expect(code).toContain('Pay &lt;here&gt;');
    expect(code).toContain('radialGradient');
    expect(code).toContain('<image href="data:image/png;base64,AA"');
  });

  it('measures contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#777777', '#888888')).toBeLessThan(1.5);
  });
});
