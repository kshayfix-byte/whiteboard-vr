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
    const restoreSelected = el('button', null, 'Restore selected');
    const restoreAll = el('button', 'primary', 'Restore all');
    actions.append(later, discard, restoreSelected, restoreAll);
    box.append(title, intro, list, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let items = [];
    const listeners = [];

    function selectedIds() {
        return Array.from(list.querySelectorAll('input[type=checkbox]:checked')).map((c) => c.value);
    }

    function updateButtons() {
        const pending = list.querySelectorAll('input[type=checkbox]:not(:disabled)').length;
        const chosen = selectedIds().length;
        restoreSelected.disabled = chosen === 0;
        discard.disabled = chosen === 0;
        restoreAll.disabled = pending === 0;
    }

    function render(info) {
        items = info.items || [];
        intro.textContent = (info.uncleanShutdown
            ? 'The server didn’t shut down cleanly. '
            : 'These whiteboards were never saved before the server last stopped. ') +
            'Pick the ones to bring back. Restored whiteboards still need a name and a Save.';
        list.innerHTML = '';
        items.forEach((item) => {
            const row = el('label', 'rec-row');
            const check = el('input');
            check.type = 'checkbox';
            check.value = item.id;
            check.addEventListener('change', updateButtons);
            const info = el('div');
            info.appendChild(el('div', 'rec-name', item.name));
            const strokes = item.strokes === 1 ? '1 stroke' : item.strokes + ' strokes';
            info.appendChild(el('div', 'rec-meta',
                'Last changed ' + (item.modifiedAt ? formatDate(item.modifiedAt) : 'unknown') +
                ' · room ' + item.room + ' · ' + strokes));
            row.append(check, info);
            row.dataset.id = item.id;
            list.appendChild(row);
        });
        updateButtons();
    }

    function markRow(id, node) {
        const row = list.querySelector('[data-id="' + id + '"]');
        if (!row) return;
        const check = row.querySelector('input');
        check.checked = false;
        check.disabled = true;
        row.appendChild(node);
    }

    function post(url, ids) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        }).then((res) => res.json());
    }

    function restore(ids) {
        if (!ids.length) return;
        post('/api/recovery/restore', ids).then((data) => {
            (data.results || []).forEach((r) => {
                const done = el('span', 'rec-done');
                if (!r.ok) {
                    done.textContent = 'Could not restore';
                } else if (r.room === currentRoom) {
                    done.textContent = 'Restored here';
                } else {
                    done.appendChild(document.createTextNode('Restored · '));
                    const link = el('a', null, 'Open');
                    link.href = page + '?room=' + encodeURIComponent(r.room);
                    done.appendChild(link);
                }
                markRow(r.id, done);
            });
            updateButtons();
            listeners.forEach((fn) => fn(data.remaining));
        });
    }

    restoreAll.addEventListener('click', () => {
        restore(Array.from(list.querySelectorAll('input[type=checkbox]:not(:disabled)')).map((c) => c.value));
    });
    restoreSelected.addEventListener('click', () => restore(selectedIds()));
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
