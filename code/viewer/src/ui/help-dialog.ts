/**
 * "How to turn it on": after the viewer (or their browser's settings) said no to location, the page
 * explains how to allow it again, for the browser in hand (FSD §9: the page explains how to turn
 * location on and try again).
 *
 * A native modal <dialog>: the page behind it is inert, Tab stays inside, Escape closes it, and focus
 * goes back to the button that opened it (or the page's heading, if that button is gone).
 */

import { esc } from './dom';

export type BrowserFamily = 'safari-ios' | 'safari-mac' | 'chromium' | 'firefox' | 'other';

export function browserFamily(ua: string): BrowserFamily {
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/CriOS\/|EdgiOS\//.test(ua)) return 'other';
  if (/iPhone|iPad|iPod/.test(ua)) return 'safari-ios';
  if (/Chrome\/|Chromium\/|Edg\/|SamsungBrowser\//.test(ua)) return 'chromium';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'safari-mac';
  return 'other';
}

const STEPS: Record<BrowserFamily, readonly string[]> = {
  'safari-ios': [
    'Tap the page menu at the left of the address bar.',
    'Tap Website Settings, then set Location to Allow.',
    'If that doesn’t help, open Settings, then Privacy & Security, then Location Services, and set Safari Websites to While Using the App.',
  ],
  'safari-mac': ['In Safari, open Settings, then Websites.', 'Choose Location, then set this site to Allow.'],
  chromium: ['Tap the icon at the left of the address bar.', 'Tap Permissions or Site settings.', 'Turn on Location.'],
  firefox: ['Tap the icon at the left of the address bar.', 'Clear the blocked location permission.'],
  other: ['Open your browser’s settings for this site.', 'Allow location.'],
};

export function openLocationHelp(doc: Document, family: BrowserFamily, onClosed: () => void): void {
  const dialog = doc.createElement('dialog');
  dialog.className = 'dlg';
  dialog.setAttribute('aria-labelledby', 'dlg-t');
  dialog.setAttribute('aria-describedby', 'dlg-d');
  dialog.innerHTML = `<h2 id="dlg-t">Turn on location for this page</h2>
    <ol class="steps" id="dlg-d">${STEPS[family].map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="fine">Then come back here and tap Try again.</p>
    <div class="dlg-btns"><button class="btn neutral" type="button" autofocus>Done</button></div>`;
  dialog.querySelector('button')?.addEventListener('click', () => {
    dialog.close();
  });
  // A tap on the backdrop (outside the dialog's box) closes it too.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClosed();
  });
  doc.body.append(dialog);
  dialog.showModal();
}
