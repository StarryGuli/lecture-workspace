#!/usr/bin/env python3
"""Screenshot matrix + layout assertions for the browser UI (no model calls).

Usage:
  python3 tools/ui_check.py --base http://127.0.0.1:8777 --out qa/ui-check/before
Run against a server whose data directory has no API keys, so nothing is billed. Each
case loads one page state at one viewport and theme, saves a PNG and records
measurable layout problems in report.json. Exit status 1 when any case fails.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

VIEWPORTS = {
    'desktop-1440': (1440, 900, False),
    'laptop-1024': (1024, 768, False),
    'ipad-820': (820, 1180, True),
    'phone-390': (390, 844, True),
    'phone-360': (360, 740, True),
}
# (name, path, session id loaded through the app's own load() or None)
STATES = [
    ('record-empty', '/record', None),
    ('record-filled', '/record', '87643325eb8d4afc9436447f6a6026b6'),
    ('transcript-empty', '/transcript', None),
    ('transcript-filled', '/transcript', 'd3a357072d944f6f8991acf3cfacf907'),
    ('assist-empty', '/assist', None),
    ('assist-filled', '/assist', '63e63b0cc17b4de79425938eddca5d3c'),
    ('settings', '/settings', None),
    # Dialog states: opened through the app's own functions (state name, path, JS to open).
    ('dialog-library', '/record', 'js:document.getElementById("openLibrary").click()'),
    ('dialog-silence', '/record', 'js:openGate()'),
    ('dialog-question', '/assist', 'js:(async()=>{await questionDemo();await new Promise(r=>setTimeout(r,300));document.getElementById("viewQuestionAlert").click();await new Promise(r=>setTimeout(r,300));document.querySelector("#questionDialog .request-details").open=true;})()'),
]

PROBE = r"""
() => {
  const vw = innerWidth, vh = innerHeight, issues = [];
  // Visible = rendered and not scrolled/clipped out of every overflow ancestor.
  const visible = e => {
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
    if (e.closest('dialog:not([open])')) return false;
    // Closed <details> keep their content laid out in current Chrome; only the summary shows.
    for (let d = e.parentElement && e.parentElement.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) {
      const summary = d.querySelector(':scope > summary');
      if (!(summary && summary.contains(e))) return false;
    }
    const vr = clipped(e); return vr.width > 0.5 && vr.height > 0.5;
  };
  // The part of an element actually on screen after every clipping (overflow) ancestor.
  const clipped = e => {
    let r = e.getBoundingClientRect(); let box = {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        box = {left: Math.max(box.left, pr.left), top: Math.max(box.top, pr.top), right: Math.min(box.right, pr.right), bottom: Math.min(box.bottom, pr.bottom)};
      }
    }
    return {...box, width: box.right - box.left, height: box.bottom - box.top};
  };
  const inHScroller = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const label = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '')) + ' "' + (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 24) + '"';
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) issues.push({type: 'page-horizontal-scroll', detail: doc.scrollWidth + ' > ' + vw});
  const recorder = document.getElementById('recorder');
  const rec = recorder && visible(recorder) ? recorder.getBoundingClientRect() : null;
  const controls = [...document.querySelectorAll('#workspace button, #workspace a[href], #workspace input, #workspace select, #workspace textarea, #workspace summary, header button, header summary, #recorder button')].filter(visible);
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inHScroller(el)) issues.push({type: 'control-outside-viewport', detail: label(el) + ' x=' + Math.round(r.left) + '..' + Math.round(r.right)});
    // Clipped by an ancestor with overflow hidden/auto that does not scroll to it.
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(hidden|clip)/.test(s.overflowX + s.overflowY)) {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 2 || r.bottom > pr.bottom + 2 && s.overflowY !== 'auto' && s.overflowY !== 'scroll') { issues.push({type: 'control-clipped', detail: label(el) + ' in ' + label(p)}); }
        break;
      }
    }
    if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).whiteSpace === 'nowrap') issues.push({type: 'button-text-overflow', detail: label(el)});
    const minTarget = matchMedia('(pointer: coarse)').matches ? 32 : 24;
    if (['BUTTON', 'SUMMARY', 'A'].includes(el.tagName) && (r.height < minTarget - 0.5) && !el.closest('.inline-link,.text-link')) issues.push({type: 'small-touch-target', detail: label(el) + ' h=' + Math.round(r.height)});
  }
  // Overlapping text blocks inside the workspace (sibling elements drawn on top of each other).
  const blocks = [...document.querySelectorAll('#workspace h1, #workspace h2, #workspace h3, #workspace p, #workspace label, #workspace button')].filter(visible);
  let overlaps = 0;
  for (let i = 0; i < blocks.length && overlaps < 8; i++) for (let j = i + 1; j < blocks.length && overlaps < 8; j++) {
    const a = blocks[i], b = blocks[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = clipped(a), rb = clipped(b);
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ix > 4 && iy > 4) { overlaps++; issues.push({type: 'overlap', detail: label(a) + ' x ' + label(b)}); }
  }
  // Main work area use: on the three workflow pages the primary panel should fill the screen.
  const ws = document.getElementById('workspace');
  let fill = null;
  const primary = document.querySelector('.record-grid > :first-child, .transcript-layout > :first-child, .assist-workbench > :first-child');
  if (primary && visible(primary)) {
    const top = primary.getBoundingClientRect().top + scrollY;
    const bottomLimit = (rec ? rec.top : vh) + scrollY;
    fill = Math.round(primary.getBoundingClientRect().height / Math.max(1, bottomLimit - top) * 100);
  }
  // Last workspace content must not be hidden behind the fixed recorder bar at the end of the page.
  let hiddenBehindRecorder = false;
  if (rec && getComputedStyle(recorder).position === 'fixed') {
    scrollTo(0, doc.scrollHeight);
    const kids = [...ws.querySelectorAll('*')].filter(visible);
    const lastBottom = Math.max(...kids.map(k => clipped(k).bottom));
    if (lastBottom > recorder.getBoundingClientRect().top + 2) hiddenBehindRecorder = true;
    scrollTo(0, 0);
  }
  if (hiddenBehindRecorder) issues.push({type: 'content-under-recorder'});
  // Text contrast (WCAG AA): 4.5 for body text, 3 for large text. Catches dark-on-dark theme leaks.
  // Parses rgb()/rgba() and Chrome's color(srgb r g b / a) form (0-1 channels).
  const channels = c => { const m = (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number); return c.startsWith('color(') ? [...m.slice(0, 3).map(v => v * 255), m[3] ?? 1] : [...m.slice(0, 3), m[3] ?? 1]; };
  const lum = c => { const m = channels(c); return m.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0); };
  const bgOf = e => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (channels(c)[3] > .5 && c !== 'rgba(0, 0, 0, 0)') return c; } return getComputedStyle(document.body).backgroundColor; };
  let lowContrast = 0;
  for (const e of document.querySelectorAll('body *')) {
    if (lowContrast >= 6 || !visible(e) || e.closest('button:disabled,[aria-disabled="true"],.question-alert-dialog:not([open]),canvas')) continue;
    if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(e), size = parseFloat(s.fontSize), large = size >= 18 || (size >= 14 && +s.fontWeight >= 600);
    const l1 = lum(s.color), l2 = lum(bgOf(e)), ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
    if (ratio < (large ? 3 : 4.5)) { lowContrast++; issues.push({type: 'low-contrast', detail: label(e) + ' ' + ratio.toFixed(2)}); }
  }
  return {issues, fill, docHeight: doc.scrollHeight, vh, theme: doc.dataset.theme};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8777')
    ap.add_argument('--out', default='qa/ui-check/latest')
    ap.add_argument('--only', help='comma list of state names')
    ap.add_argument('--viewports', help='comma list of viewport names')
    ap.add_argument('--themes', default='light,dark')
    ap.add_argument('--browser', default='chromium', choices=['chromium', 'webkit'])
    ap.add_argument('--password-file', help='phone build: log in with this test password; filled states use samples')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    states = [s for s in STATES if not args.only or s[0] in args.only.split(',')]
    vps = {k: v for k, v in VIEWPORTS.items() if not args.viewports or k in args.viewports.split(',')}
    report, failed = [], 0
    with sync_playwright() as p:
        try:
            browser = getattr(p, args.browser).launch()
        except Exception:
            # Installed Playwright browsers may not match the Python package; fall back to local Chrome.
            browser = p.chromium.launch(channel='chrome')
        for theme in args.themes.split(','):
            for vp, (w, h, touch) in vps.items():
                ctx = browser.new_context(viewport={'width': w, 'height': h}, color_scheme=theme, has_touch=touch,
                                          ignore_https_errors=args.base.startswith('https://localhost'),  # local self-signed test cert only
                                          is_mobile=touch and w < 600 and args.browser == 'chromium', device_scale_factor=1)
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                for name, path, sid in states:
                    errors.clear()
                    page.goto(args.base + path)
                    if args.password_file:
                        page.wait_for_function('document.querySelector(".mobile-account-sheet[open]") || document.querySelector("#workspace")?.children.length > 0', timeout=30000)
                        if page.is_visible('.mobile-account-sheet[open] input[name=password]'):
                            page.fill('.mobile-account-sheet input[name=password]', Path(args.password_file).read_text().strip())
                            page.click('.mobile-account-sheet button[type=submit]')
                        if sid and not sid.startswith('js:'): sid = 'js:sample()'
                    page.wait_for_function('document.querySelector("#workspace") && document.querySelector("#workspace").children.length > 0', timeout=20000)
                    if sid and sid.startswith('js:'):
                        page.evaluate(sid[3:])
                    elif sid:
                        page.evaluate(f"(async()=>{{await load({json.dumps(sid)});}})()")
                    page.wait_for_timeout(700)
                    result = page.evaluate(PROBE)
                    shot = out / f'{name}__{vp}__{theme}.png'
                    page.screenshot(path=str(shot), full_page=False)
                    result['errors'] = list(errors)
                    if errors:
                        result['issues'].append({'type': 'js-error', 'detail': errors[0][:200]})
                    ok = not result['issues'] and (result['fill'] is None or result['fill'] >= 70)
                    failed += not ok
                    result['appTheme'] = result.pop('theme')
                    report.append({'state': name, 'viewport': vp, 'theme': theme, 'ok': ok, **result, 'shot': shot.name})
                    print(('OK  ' if ok else 'FAIL'), name, vp, theme, 'fill=%s' % result['fill'], '; '.join(i['type'] + (':' + i.get('detail', '') if i.get('detail') else '') for i in result['issues'][:4]))
                ctx.close()
        browser.close()
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(f'{len(report) - failed}/{len(report)} cases passed; report {out / "report.json"}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
