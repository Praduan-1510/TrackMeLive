/**
 * The page's two live regions (index.html): one polite status region for changes, and an alert kept
 * for the ended heading. A region is emptied first so the same words can be said again, and cleared
 * a while after, so a screen reader's virtual cursor never finds old news.
 */

const SAY_AFTER_MS = 60;
const CLEAR_AFTER_MS = 7000;

class Region {
  private readonly el: HTMLElement;
  private timer = 0;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  say(text: string): void {
    window.clearTimeout(this.timer);
    this.el.textContent = '';
    this.timer = window.setTimeout(() => {
      this.el.textContent = text;
      this.timer = window.setTimeout(() => {
        this.el.textContent = '';
      }, CLEAR_AFTER_MS);
    }, SAY_AFTER_MS);
  }
}

export class Announcer {
  private readonly status: Region;
  private readonly alertRegion: Region;

  constructor(status: HTMLElement, alert: HTMLElement) {
    this.status = new Region(status);
    this.alertRegion = new Region(alert);
  }

  polite(text: string): void {
    this.status.say(text);
  }

  alert(text: string): void {
    this.alertRegion.say(text);
  }
}
