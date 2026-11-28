// "Restore unsaved whiteboards" dialog, shared by the 2D page and the VR page.
// After a crash or restart the server keeps backups of boards that were never
// saved. This lists them by name and last change, and lets the user restore
// some or all of them, or discard them.

import { formatDate } from './board-client';

const STYLE = `
.rec-overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; padding: 16px; font-family: sans-serif; }
.rec-overlay.hidden { display: none; }
.rec-box { background: white; color: #222; border-radius: 16px; padding: 24px; width: 100%; max-width: 640px; max-height: calc(100% - 32px); overflow: auto; box-sizing: border-box; }
.rec-box h2 { margin: 0 0 8px 0; font-size: 22px; }
.rec-box p { margin: 0 0 16px 0; line-height: 1.4; color: #444; }
.rec-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #e3e3e3; }
.rec-row input { width: 20px; height: 20px; flex: none; }
.rec-name { font-weight: bold; }
.rec-meta { font-size: 13px; color: #777; }
.rec-done { font-size: 13px; color: rgb(3,140,115); margin-left: auto; white-space: nowrap; }
.rec-done a { color: inherit; }
.rec-row > label { display: flex; align-items: center; gap: 12px; flex: 1 1 auto; min-width: 0; cursor: pointer; }
.rec-name-input { font: bold 16px sans-serif; padding: 2px 6px; width: 100%; max-width: 320px; box-sizing: border-box; }
.rec-edit { flex: none; background: none; border: 1px solid transparent; border-radius: 8px; font-size: 18px; line-height: 1; padding: 4px 8px; cursor: pointer; color: #555; margin: 0; }
.rec-edit:hover { border-color: orange; color: orange; }
.rec-edit:disabled { visibility: hidden; }
.rec-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.rec-actions button { padding: 0.5em 0.9em; font: 14px sans-serif; background: white; color: #444; border: 2px solid gray; border-radius: 10px; cursor: pointer; margin: 0; }
.rec-actions button.primary { background: rgb(3,181,148); border-color: rgb(3,181,148); color: white; }
.rec-actions button:disabled { opacity: 0.45; cursor: not-allowed; }
`;

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

export function createRecoveryUI(options) {
    options = options || {};
    const page = options.page || 'index.html';
    const currentRoom = options.room;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const overlay = el('div', 'rec-overlay hidden');
    const box = el('div', 'rec-box');
    const title = el('h2', null, 'Restore unsaved whiteboards');
    const intro = el('p');
    const list = el('div');
    const actions = el('div', 'rec-actions');
    const later = el('button', null, 'Not now');
    const discard = el('button', null, 'Discard selected');
    // "Save selected" brings the ticked boards back and saves them under the
    // names shown; "Restore and open" brings them back unsaved and opens them.
    const saveSelected = el('button', null, 'Save selected');
    saveSelected.title = 'Bring back the ticked whiteboards and save them now under the names shown (use \u270E to change a name first)';
    const restoreSelected = el('button', null, 'Restore and open');
    restoreSelected.title = 'Bring back the ticked whiteboards and open them, without saving yet';
    const restoreAll = el('button', 'primary', 'Restore all');
    actions.append(later, discard, saveSelected, restoreSelected, restoreAll);
    box.append(title, intro, list, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let items = [];
    let names = {};   // recovery id -> name typed with the pencil
    const listeners = [];

    function selectedIds() {
        return Array.from(list.querySelectorAll('input[type=checkbox]:checked')).map((c) => c.value);
    }

    function updateButtons() {
        const pending = list.querySelectorAll('input[type=checkbox]:not(:disabled)').length;
        const chosen = selectedIds().length;
        restoreSelected.disabled = chosen === 0;
        saveSelected.disabled = chosen === 0;
        discard.disabled = chosen === 0;
        restoreAll.disabled = pending === 0;
    }

    function render(info) {
        items = info.items || [];
        names = {};
        intro.textContent = (info.uncleanShutdown
            ? 'The server didn’t shut down cleanly. '
            : 'These whiteboards were never saved before the server last stopped. ') +
            'Tick the ones to bring back. Save selected saves them straight away under the names shown; ' +
            'Restore and open brings them back to name and save later. Use \u270E to change a name first.';
        list.innerHTML = '';
        items.forEach((item) => {
            const row = el('div', 'rec-row');
            const pick = el('label');
            const check = el('input');
            check.type = 'checkbox';
            check.value = item.id;
            check.addEventListener('change', updateButtons);
            const info = el('div');
            const nameEl = el('div', 'rec-name', item.name);
            info.appendChild(nameEl);
            const strokes = item.strokes === 1 ? '1 stroke' : item.strokes + ' strokes';
            info.appendChild(el('div', 'rec-meta',
                'Last changed ' + (item.modifiedAt ? formatDate(item.modifiedAt) : 'unknown') +
                ' · room ' + item.room + ' · ' + strokes));
            pick.append(check, info);
            const edit = el('button', 'rec-edit', '\u270E');
            edit.type = 'button';
            edit.title = 'Rename before saving or restoring';
            edit.setAttribute('aria-label', 'Rename ' + item.name);
            edit.addEventListener('click', () => startRename(item, nameEl, edit));
            row.append(pick, edit);
            row.dataset.id = item.id;
            list.appendChild(row);
        });
        updateButtons();
    }

    // The pencil: swap the name for a text box. Enter or leaving the box
    // keeps the new name (it's used when the board is saved or restored);
    // Escape keeps the old one.
    function startRename(item, nameEl, edit) {
        if (nameEl.querySelector('input')) return;
        const current = names[item.id] || item.name;
        const input = el('input', 'rec-name-input');
        input.type = 'text';
        input.maxLength = 80;
        input.value = current;
        nameEl.textContent = '';
        nameEl.appendChild(input);
        edit.disabled = true;
        input.focus();
        input.select();
        let done = false;
        const finish = (keep) => {
            if (done) return;
            done = true;
            const value = input.value.trim();
            if (keep && value) names[item.id] = value;
            nameEl.textContent = names[item.id] || item.name;
            edit.disabled = false;
            // Renaming a board is a good sign it should be included.
            const check = list.querySelector('[data-id="' + item.id + '"] input[type=checkbox]');
            if (keep && value && check && !check.disabled) { check.checked = true; updateButtons(); }
        };
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') { evt.preventDefault(); finish(true); }
            if (evt.key === 'Escape') { evt.preventDefault(); evt.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        // Clicks in the box shouldn't tick or untick the row.
        input.addEventListener('click', (evt) => evt.preventDefault());
    }

    function markRow(id, node) {
        const row = list.querySelector('[data-id="' + id + '"]');
        if (!row) return;
        const check = row.querySelector('input[type=checkbox]');
        check.checked = false;
        check.disabled = true;
        const edit = row.querySelector('.rec-edit');
        if (edit) edit.remove();
        row.appendChild(node);
    }

    function post(url, ids, extra) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ ids: ids }, extra || {}))
        }).then((res) => res.json());
    }

    function boardLink(r) {
        return page + '?room=' + encodeURIComponent(r.room) +
            (r.board && r.board !== 'main' ? '&board=' + encodeURIComponent(r.board) : '');
    }

    // Commit a name still being typed before the dialog acts.
    function finishTyping() {
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('rec-name-input')) active.blur();
    }

    // mode: 'open' (Restore and open), 'save' (Save selected) or 'list' (Restore all).
    function restore(ids, mode) {
        finishTyping();
        if (!ids.length) return;
        const picked = {};
        ids.forEach((id) => { if (names[id]) picked[id] = names[id]; });
        post('/api/recovery/restore', ids, { names: picked, save: mode === 'save' }).then((data) => {
            const results = data.results || [];
            listeners.forEach((fn) => fn(data.remaining));
            const ok = results.filter((r) => r.ok);
            // Restore and open: go straight to the board. If they came from
            // different rooms, only one can be opened, so show links instead.
            if (mode === 'open' && ok.length && ok.every((r) => r.room === ok[0].room)) {
                window.location.href = boardLink(ok[0]);
                return;
            }
            results.forEach((r) => {
                const done = el('span', 'rec-done');
                if (!r.ok) {
                    done.textContent = r.error && r.room ? r.error : 'Could not restore';
                } else {
                    const what = r.saved ? 'Saved as \u201c' + r.name + '\u201d' : 'Restored';
                    done.appendChild(document.createTextNode(what + ' · '));
                    const link = el('a', null, 'Open');
                    link.href = boardLink(r);
                    done.appendChild(link);
                }
                markRow(r.id, done);
            });
            updateButtons();
        });
    }

    restoreAll.addEventListener('click', () => {
        restore(Array.from(list.querySelectorAll('input[type=checkbox]:not(:disabled)')).map((c) => c.value), 'list');
    });
    restoreSelected.addEventListener('click', () => restore(selectedIds(), 'open'));
    saveSelected.addEventListener('click', () => restore(selectedIds(), 'save'));
    discard.addEventListener('click', () => {
        const ids = selectedIds();
        if (!ids.length) return;
        if (!window.confirm('Discard ' + ids.length + (ids.length === 1 ? ' whiteboard' : ' whiteboards') + '? This can’t be undone.')) return;
        post('/api/recovery/discard', ids).then((data) => {
            (data.results || []).forEach((r) => markRow(r.id, el('span', 'rec-done', r.ok ? 'Discarded' : 'Could not discard')));
            updateButtons();
            listeners.forEach((fn) => fn(data.remaining));
        });
    });
    later.addEventListener('click', () => overlay.classList.add('hidden'));

    function check(showIfAny) {
        return fetch('/api/recovery').then((res) => res.json()).then((info) => {
            listeners.forEach((fn) => fn((info.items || []).length));
            if ((info.items || []).length && showIfAny) {
                render(info);
                overlay.classList.remove('hidden');
            }
            return info;
        }).catch(() => null);
    }

    return {
        check: check,
        open: () => check(true),
        onCount: (fn) => listeners.push(fn)
    };
}
