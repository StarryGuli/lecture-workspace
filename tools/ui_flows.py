#!/usr/bin/env python3
"""Interactive smoke flows for the browser UI with a fake microphone (no model keys needed).

Usage: python3 tools/ui_flows.py --base http://127.0.0.1:8777 [--out DIR] [--viewport 1440x900]
Run against a data directory without API keys: model calls then fail fast, which also
exercises the failure paths (status notice, retry button). Exit 1 on any failed step or
uncaught page error.
"""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8777')
    ap.add_argument('--out', default='qa/ui-flows/latest')
    ap.add_argument('--viewport', default='1440x900')
    ap.add_argument('--browser', default='chromium', choices=['chromium', 'webkit'])
    ap.add_argument('--password-file', help='phone build: log in with this test password when asked')
    ap.add_argument('--audio', help='a short WAV used for the import flow and as the fake microphone')
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    w, h = map(int, args.viewport.split('x'))
    results, errors = [], []

    with sync_playwright() as p:
        fake = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] + ([f'--use-file-for-fake-audio-capture={Path(args.audio).resolve()}'] if args.audio else [])
        launch = dict(args=fake) if args.browser == 'chromium' else {}
        try:
            browser = getattr(p, args.browser).launch(**launch)
        except Exception:
            browser = p.chromium.launch(channel='chrome', **launch)
        ctx = browser.new_context(viewport={'width': w, 'height': h}, permissions=['microphone'] if args.browser == 'chromium' else [],
                                  ignore_https_errors=args.base.startswith('https://localhost'),  # local self-signed test cert only
                                  has_touch=w < 900, is_mobile=w < 600)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        # Network failures are judged by URL (response listener); console only for script errors.
        page.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in ('favicon', 'onnxruntime', 'Failed to fetch', 'Failed to load resource')) and not (args.base.startswith('https://localhost') and 'fetching the script' in m.text) and errors.append('console: ' + m.text[:200]))
        # Model calls fail by design in a keyless test setup; every other failed request is an error.
        page.on('response', lambda r: r.status >= 400 and '/account/model/' not in r.url and not r.url.endswith('/favicon.ico') and errors.append(f'http {r.status} {r.request.method} {r.url[-80:]}'))
        page.on('dialog', lambda d: d.accept())  # paid-call confirmations: accept; with no keys nothing is billed

        def step(name, fn):
            before = len(errors)
            try:
                detail = fn()
                ok = len(errors) == before
                results.append({'step': name, 'ok': ok, 'detail': detail if ok else errors[before:]})
            except Exception as e:
                results.append({'step': name, 'ok': False, 'detail': str(e)[:300]})
            page.screenshot(path=str(out / (name + '.png')))
            print(('OK  ' if results[-1]['ok'] else 'FAIL'), name, '' if results[-1]['ok'] else results[-1]['detail'])

        password = Path(args.password_file).read_text().strip() if args.password_file else None

        def ready(path):
            page.goto(args.base + path)
            if password:
                page.wait_for_function('document.querySelector(".mobile-account-sheet[open]") || document.querySelector("#workspace")?.children.length > 0', timeout=30000)
                if page.is_visible('.mobile-account-sheet[open] input[name=password]'):
                    page.fill('.mobile-account-sheet input[name=password]', password)
                    page.click('.mobile-account-sheet button[type=submit]')
            page.wait_for_function('document.querySelector("#workspace")?.children.length > 0', timeout=20000)
            page.wait_for_timeout(400)

        def menu(label):
            page.click('#workspaceMenu > summary')
            page.get_by_role('button', name=label).or_(page.get_by_role('link', name=label)).first.click()

        def nav_tabs():
            ready('/record')
            for route in ('transcript', 'assist', 'record'):
                page.click(f'.main-nav a[data-route="{route}"]')
                page.wait_for_timeout(250)
                assert page.evaluate('document.documentElement.dataset.view') == route, route
            return 'top navigation switches all three workflows'

        def library():
            ready('/record')
            menu('记录库')
            page.wait_for_selector('#libraryDialog[open]')
            n = page.locator('#sessions .session').count()
            page.fill('#sessionSearch', '示例')
            page.wait_for_timeout(200)
            m = page.locator('#sessions .session').count()
            page.click('[data-close="libraryDialog"]')
            assert not page.evaluate('document.getElementById("libraryDialog").open')
            return f'{n} records, {m} match 示例'

        def open_record():
            ready('/record')
            menu('记录库')
            if page.locator('#sessions .session').count() == 0:
                page.click('[data-close="libraryDialog"]'); menu('载入示例'); page.wait_for_timeout(800); menu('记录库')
            page.locator('#sessions .session').first.click()
            page.wait_for_timeout(600)
            title = page.evaluate('document.getElementById("recordTitle")?.value || document.querySelector(".page-heading h1")?.textContent')
            assert title, 'no title after opening a record'
            return 'opened: ' + title

        def sample():
            ready('/transcript')
            menu('载入示例')
            page.wait_for_selector('.transcript-segment', timeout=8000)
            return f'{page.locator(".transcript-segment").count()} sample segments'

        def question_flow():
            ready('/assist')
            page.click('[data-action="questionDemo"]')
            page.wait_for_selector('#questionAlertDialog[open]', timeout=5000)
            text = page.text_content('#questionAlertText')
            page.click('#viewQuestionAlert')
            page.wait_for_selector('#questionDialog[open]', timeout=5000)
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)
            assert not page.evaluate('document.getElementById("questionDialog").open')
            return 'alert -> answer -> close: ' + (text or '')[:30]

        def settings_tabs():
            ready('/settings')
            names = page.eval_on_selector_all('[data-settings]', 'els => els.map(e => e.dataset.settings)')
            for name in names:
                page.click(f'[data-settings="{name}"]')
                page.wait_for_timeout(150)
                assert page.locator('.settings-content > *').count() > 0, name
            return f'{len(names)} settings tabs render'

        def silence_dialog():
            ready('/record')
            menu('收音与静音')
            page.wait_for_selector('#silenceDialog[open]')
            page.click('[data-close="silenceDialog"]')
            return 'silence dialog opens and closes'

        def theme_toggle():
            ready('/record')
            before = page.evaluate('document.documentElement.dataset.theme')
            menu('深色模式' if before == 'studio' else '浅色模式')
            after = page.evaluate('document.documentElement.dataset.theme')
            assert before != after
            menu('深色模式' if after == 'studio' else '浅色模式')
            return f'{before} -> {after} -> back'

        def record_cycle():
            ready('/record')
            page.click('[data-action="new"]')
            page.wait_for_timeout(400)
            page.click('#start')
            page.wait_for_selector('#stop:not([hidden])', timeout=15000)
            page.wait_for_timeout(6000)
            clock = page.text_content('#clock')
            assert clock and clock != '00:00', 'clock did not advance: ' + str(clock)
            assert page.evaluate('document.documentElement.dataset.recording') == 'true'
            # Navigating while recording keeps the capture and offers a way back.
            page.click('.main-nav a[data-route="transcript"]')
            page.wait_for_timeout(300)
            back = page.is_visible('#returnRecording')
            page.click('#returnRecording') if back else None
            page.wait_for_timeout(300)
            page.click('#stop')
            page.wait_for_function('document.documentElement.dataset.recording === "false"', timeout=30000)
            page.wait_for_timeout(1500)
            status = page.text_content('#status')
            return f'recorded until {clock}; return-to-recording shown={back}; status: {status[:80]}'

        def rename():
            ready('/record')
            page.click('[data-action="new"]'); page.wait_for_timeout(300)
            page.click('#start'); page.wait_for_selector('#stop:not([hidden])', timeout=15000); page.wait_for_timeout(2500)
            page.click('#stop'); page.wait_for_function('document.documentElement.dataset.recording === "false"', timeout=30000); page.wait_for_timeout(800)
            page.keyboard.press('Escape')
            page.evaluate('document.getElementById("keepDialog").open && document.getElementById("keepAudio").click()')
            page.fill('#recordTitle', '自动测试 · 改名')
            page.press('#recordTitle', 'Enter'); page.wait_for_timeout(600)
            menu('记录库'); page.wait_for_selector('#libraryDialog[open]')
            found = page.locator('#sessions .session', has_text='自动测试 · 改名').count()
            page.click('[data-close="libraryDialog"]')
            assert found >= 1, 'renamed record not in library'
            return f'renamed record listed ({found})'

        def mark_during_recording():
            ready('/transcript')
            page.click('[data-action="new"]'); page.wait_for_timeout(300)
            page.click('#start'); page.wait_for_selector('#mark:not([hidden])', timeout=15000); page.wait_for_timeout(2000)
            page.click('#mark'); page.wait_for_timeout(800)
            page.click('#stop'); page.wait_for_function('document.documentElement.dataset.recording === "false"', timeout=30000); page.wait_for_timeout(1000)
            page.evaluate('document.getElementById("keepDialog").open && document.getElementById("keepAudio").click()')
            marks = page.locator('.bookmark-list button[data-seek]').count()
            assert marks >= 1, 'mark not shown after recording'
            return f'{marks} mark(s) listed after recording'

        def edit_version():
            ready('/record')
            menu('载入示例'); page.wait_for_load_state('networkidle'); page.wait_for_timeout(800)
            if page.is_visible('.pill-tabs [data-tab="record"]'): page.click('.pill-tabs [data-tab="record"]'); page.wait_for_timeout(300)
            if not page.is_visible('[data-action="edit"]'):
                page.click('.inline-text-actions > summary'); page.wait_for_timeout(200)
            page.click('[data-action="edit"]'); page.wait_for_selector('.save-editor')
            box = page.locator('.save-editor textarea').first
            box.fill(box.input_value() + '\n（自动测试追加一行）')
            page.click('[data-action="saveEdit"]'); page.wait_for_timeout(800)
            text = page.text_content('#workspace')
            assert '自动测试追加一行' in text, 'edited text not shown'
            return 'edit saved as a new version and displayed'

        def transcript_search():
            ready('/transcript')
            menu('载入示例'); page.wait_for_selector('.transcript-segment', timeout=8000)
            page.wait_for_load_state('networkidle'); page.wait_for_timeout(600)  # auto-reopen of the last record may render once more
            word = page.evaluate("[...document.querySelector('.transcript-segment .segment-text').textContent.replace(/[^\\p{Script=Han}]/gu,'')].slice(2,5).join('')")
            page.click('.inline-text-actions > summary')
            page.fill('#transcriptSearch', word); page.wait_for_timeout(300)
            hits = page.locator('.transcript-segment').count()
            page.fill('#transcriptSearch', '不存在的词语xyz'); page.wait_for_timeout(300)
            none = page.locator('.transcript-segment').count()
            assert hits >= 1 and none == 0, (hits, none)
            return f'search hits {hits}, miss 0'

        def import_audio():
            if not args.audio: return 'skipped (no --audio)'
            ready('/record')
            page.click('[data-action="new"]'); page.wait_for_timeout(300)
            page.set_input_files('#audioUpload', args.audio)
            page.wait_for_selector('#silenceDialog[open]', timeout=60000)
            page.wait_for_timeout(1500)
            visible = page.is_visible('#continueTranscribe')
            page.click('[data-close="silenceDialog"]')
            return f'import opened the silence/cost review (confirm button shown={visible}); nothing sent'

        step('nav_tabs', nav_tabs)
        step('library', library)
        step('open_record', open_record)
        step('sample', sample)
        step('question_flow', question_flow)
        step('settings_tabs', settings_tabs)
        step('silence_dialog', silence_dialog)
        step('theme_toggle', theme_toggle)
        step('transcript_search', transcript_search)
        step('edit_version', edit_version)
        step('import_audio', import_audio)
        if args.browser == 'chromium':
            step('record_cycle', record_cycle)
            step('rename', rename)
            step('mark_during_recording', mark_during_recording)
        browser.close()
    (out / 'flows.json').write_text(json.dumps({'results': results, 'errors': errors}, ensure_ascii=False, indent=1))
    failed = [r for r in results if not r['ok']]
    print(f'{len(results) - len(failed)}/{len(results)} flows passed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
