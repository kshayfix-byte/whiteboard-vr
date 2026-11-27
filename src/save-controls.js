// Save / Rename / Save all, shared by the 2D page and the VR page's
// on-screen buttons. The server keeps the live board; these buttons write it
// to disk. A new board starts with a temporary name (e.g. Whiteboard_4821),
// and its first Save asks for a real name.

function shortTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? 'at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function createSaveControls(options) {
    const socket = options.socket;
    const room = options.room;
    let boardId = options.boardId || 'main'; // the board the buttons act on
    const els = options.elements || {};
    const onChange = options.onChange || function () {};

    let info = null;
    let statusTimer = null;

    function current() {
        if (!info) return null;
        return info.boards.find((b) => b.id === boardId) || null;
    }

    function setStatus(text, isError) {
        if (!els.status) return;
        els.status.textContent = text || '';
        els.status.classList.toggle('error', !!isError);
        clearTimeout(statusTimer);
        if (text && !isError) statusTimer = setTimeout(() => setStatus(''), 4000);
    }

    function render() {
        const board = current();
        if (els.name) {
            els.name.textContent = board ? board.name : '';
            els.name.title = board && !board.named ? 'Temporary name. Press Save to choose a name.' : '';
            els.name.classList.toggle('temporary', !!(board && !board.named));
        }
        if (els.state) {
            let text = '';
            if (board) {
                if (!board.named) text = board.restored ? 'Restored from backup, not saved yet' : 'Not saved yet';
                else if (board.dirty) text = 'Autosaving\u2026';
                else text = 'Saved ' + shortTime(board.savedAt);
            }
            els.state.textContent = text;
        }
        if (els.save) els.save.disabled = !board;
        if (els.rename) els.rename.disabled = !board;
        if (els.saveAll) {
            const enabled = !!(info && info.allNamed);
            els.saveAll.disabled = !enabled;
            els.saveAll.title = enabled ? 'Save every whiteboard in this room'
                : 'Available once every whiteboard has been named with its own Save button';
        }
        onChange(board, info);
    }

    function setInfo(newInfo) {
        if (!newInfo || newInfo.room !== room) return;
        info = newInfo;
        render();
    }

    socket.on('roomInfo', setInfo);
    socket.on('boardState', (state) => setInfo(state.info));

    function save(name) {
        socket.emit('saveBoard', { room: room, board: boardId, name: name }, (result) => {
            if (result && result.ok) setStatus('Saved “' + result.name + '”');
            else setStatus((result && result.error) || 'Could not save.', true);
        });
    }

    // Save this board. If it still has its temporary name, ask for a name first.
    // `ask` lets the VR scene skip the prompt (prompts don't show inside a headset).
    function saveCurrent(ask) {
        const board = current();
        if (!board) return { ok: false };
        if (board.named) {
            save();
            return { ok: true };
        }
        if (ask === false) return { ok: false, needsName: true };
        const entered = window.prompt('Name this whiteboard:', board.name);
        if (entered == null) return { ok: false }; // canceled
        if (!entered.trim()) {
            setStatus('Please enter a name to save this whiteboard.', true);
            return { ok: false };
        }
        save(entered);
        return { ok: true };
    }

    function renameCurrent() {
        const board = current();
        if (!board) return;
        const entered = window.prompt('Rename this whiteboard:', board.name);
        if (entered == null) return;
        socket.emit('renameBoard', { room: room, board: boardId, name: entered }, (result) => {
            if (result && result.ok) setStatus('Renamed to “' + result.name + '”');
            else setStatus((result && result.error) || 'Could not rename.', true);
        });
    }

    function saveAll() {
        if (!info || !info.allNamed) return { ok: false };
        socket.emit('saveAll', { room: room }, (result) => {
            if (result && result.ok) setStatus('Saved ' + result.count + (result.count === 1 ? ' whiteboard' : ' whiteboards'));
            else setStatus((result && result.error) || 'Could not save.', true);
        });
        return { ok: true };
    }

    if (els.save) els.save.addEventListener('click', () => saveCurrent(true));
    if (els.rename) els.rename.addEventListener('click', renameCurrent);
    if (els.saveAll) els.saveAll.addEventListener('click', saveAll);
    render();

    // Point the buttons at another board (2D tab switch, VR board selection).
    function setBoard(id) {
        if (!id || id === boardId) return;
        boardId = id;
        render();
    }

    return {
        setBoard: setBoard,
        boardId: () => boardId,
        info: () => info,
        saveCurrent: saveCurrent,
        saveAll: saveAll,
        renameCurrent: renameCurrent,
        currentBoard: current,
        setStatus: setStatus
    };
}
