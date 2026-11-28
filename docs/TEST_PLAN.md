# Whiteboard VR test plan

One document for testing the whole app: the original Whiteboard VR features and everything added in PRs #1 to #9. Work through it section by section, fill in the **Result** column, and log anything that fails in the [bug log](#bug-log) at the end.

Out of scope for now: **item 4, text labels and the in-VR keyboard**. It is deferred and will be tested when it is built.

## Contents

1. [How to run the app](#1-how-to-run-the-app)
2. [How to use this document](#2-how-to-use-this-document)
3. [Automated tests](#3-automated-tests)
4. Manual tests
   - [A. Start page and rooms](#a-start-page-and-rooms-original)
   - [B. Drawing in 2D](#b-drawing-in-2d-original)
   - [C. Live sync between people](#c-live-sync-between-people-original)
   - [D. VR basics](#d-vr-basics-original)
   - [E. Naming, saving and export](#e-naming-saving-and-export-pr-1)
   - [F. Autosave, backup and restore](#f-autosave-backup-and-restore-pr-1)
   - [G. Naming and export inside a headset](#g-naming-and-export-inside-a-headset-pr-1)
   - [H. Multiple whiteboards](#h-multiple-whiteboards-pr-2--3)
   - [I. Remove whiteboard](#i-remove-whiteboard-pr-2--3)
   - [J. Board size and 2D zoom](#j-board-size-and-2d-zoom-pr-4)
   - [K. Moving whiteboards](#k-moving-whiteboards-pr-5)
   - [L. Moving yourself and long reach](#l-moving-yourself-and-long-reach-pr-6)
   - [M. Tool panel](#m-tool-panel-pr-7)
   - [N. 360° boards](#n-360-boards-pr-8)
   - [O. Highlighter and Erase highlights](#o-highlighter-and-erase-highlights-pr-9)
   - [Q. Headset fixes, round 1](#q-headset-fixes-round-1-bugs-v1-to-v13-pr-19)
   - [R. Headset fixes, round 2](#r-headset-fixes-round-2-bugs-27-to-31-pr-20)
   - [P. Combined, multi-user and performance checks](#p-combined-multi-user-and-performance-checks)
5. [Known risks and things to watch](#5-known-risks-and-things-to-watch)
6. [Bug log](#bug-log)

---

## 1. How to run the app

### Desktop and phone (plain HTTP)

```bash
npm install          # once
npm run build        # after every code change (builds into dist/)
npm start            # http://localhost:3000
```

- The port can be changed with `PORT=4000 npm start`.
- Saved boards go to `./data/`. For a clean test run, use a fresh folder: `DATA_DIR=./data-test npm start`.
- A phone on the same Wi-Fi can open `http://<your computer's IP>:3000`.

### Headset (needs HTTPS)

Browsers only allow VR on `https://` pages (or `localhost`). Pick one:

1. **HTTPS server in this repo.** Make a self-signed certificate once, in the project folder, then start the server as usual:
   ```bash
   npm run cert         # once: makes key.pem and cert.pem (no passphrase)
   npm run build && npm start
   ```
   The server now runs on two ports, and prints both addresses when it starts:
   - `http://<your computer's IP>:3000` for computers and phones (no VR).
   - `https://<your computer's IP>:3443` for headsets. Accept the certificate warning once on each device ("Advanced", then "Proceed").

   Don't type `https://` with port 3000: that port is plain http, and the browser shows `ERR_SSL_PROTOCOL_ERROR`. Change the ports with `PORT=` and `HTTPS_PORT=`. Don't commit `key.pem` / `cert.pem` (they're in `.gitignore`). A key made the old way, with a passphrase, still works: start with `SSL_PASSPHRASE=<passphrase> npm start`.
2. **USB to a Quest.** Run `npm start`, connect the headset with a cable, run `adb reverse tcp:3000 tcp:3000`, and open `http://localhost:3000` in the headset.
3. **A tunnel** (for example ngrok or Cloudflare Tunnel) that gives an `https://` address for port 3000.

### Making a "crash" for the restore tests

- **Clean stop:** press Ctrl+C once in the server terminal.
- **Crash:** kill the process without warning, for example `kill -9 <pid>` (find it with `ps aux | grep server`), or close the terminal window.

### Useful addresses

| Address | What it shows |
|---|---|
| `/index.html?room=ABCDE` | 2D page for room ABCDE |
| `/index.html?room=ABCDE&board=<id>` | 2D page opened on a particular board |
| `/vr.html?room=ABCDE` | VR page for room ABCDE |
| `/api/boards` | Every saved board |
| `/api/boards/ABCDE` | The boards in room ABCDE, with names, sizes and places |
| `/api/recovery` | Unsaved boards waiting to be restored |

---

## 2. How to use this document

**Platform** column:

| Code | Meaning |
|---|---|
| **D** | 2D page in a desktop browser |
| **M** | 2D page on a phone or tablet (touch) |
| **V** | VR page in a desktop browser, not in a headset (mouse and keyboard) |
| **H** | 🥽 Needs a real headset |
| **S** | Server or files (terminal, `data/` folder, API addresses) |

**Result** column: write **Pass**, **Fail** (add a bug number from the bug log), **Blocked** (can't be run yet, say why) or **Skip**.

Tips:
- Keep two browser windows side by side (for example a normal and a private window) to act as two people in the same room.
- Use a new room code for each section, so earlier boards don't get in the way.
- In the VR page outside a headset, drag with the mouse to look around, and use WASD or the arrow keys to walk.
- Unless a test says otherwise, "a board" means a flat board.

---

## 3. Automated tests

Run `npm test`. It needs Node 18 or newer (tested on Node 22) and takes about a second. It covers the server and the browser logic that doesn't need a screen. Everything that needs a person looking at a screen or a headset is in the manual sections.

| File | IDs | What it checks |
|---|---|---|
| `test/board-store.test.js` | U-01 to U-25 | Room codes, draw validation, highlighter flags, names, sizes, shapes, poses. Adding (max 50) and removing boards (copy kept, last one refused). Save, Rename, Save all rules. Saving and reloading after a restart. Autosave. Resizing around the centre. Old or broken files. Backup, crash detection, restore and discard. |
| `test/realtime.test.js` | S-01 to S-09 | A real server with Socket.io clients: late joiners get the drawing, strokes only reach the same room, bad messages are ignored, Erase all, Add/Remove board, Save/Rename/Save all, resize (including a stroke drawn at the old size), moving boards, and the `/api` addresses. |
| `test/client-logic.test.mjs` | C-01 to C-11 | Highlight colour mixing, drawing across the 360° join, export file names, size presets, the three-click Remove guard, where the VR tool panel and first board go, that Reach only limits drawing, and the panel's colour scheme. |

| ID | Test | Result | Notes |
|---|---|---|---|
| AUTO-1 | `npm test` reports `# fail 0` | | |
| AUTO-2 | `npm run build` finishes without errors | | |

---

## 4. Manual tests

### A. Start page and rooms (original)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| A-01 | D | Welcome screen | Open `http://localhost:3000` | Welcome box shows. The address changes to `index.html?room=XXXXX` (5 random letters/digits) | Pass | |
| A-02 | D | Close welcome | Click **Start drawing!**. Reload, then click outside the box | Both ways close the box and show the board | Pass | |
| A-03 | D | Room code shown | Look at the toolbar | "Room: XXXXX" matches the address | Pass | |
| A-04 | D | Join other room | Click **Join other room**, type `abcde`, OK | Page opens room `ABCDE` (upper case) | Pass | |
| A-05 | D | Join cancelled | Click **Join other room**, press Cancel (and try empty) | Nothing changes | Pass | |
| A-06 | D | VR link | Click **VR** | VR page opens for the same room (and same board, if not the first) | Fail | Bug 1: no way back to 2D from the VR page |
| A-06b | V | Back to 2D | On the VR page, select the 2nd board and click **← 2D view** (top left). Then press the VR button (goes full screen), press Esc, and click **← 2D view** again | 2D page opens for the same room on the selected board. Esc leaves full screen first | Pass | |
| A-07 | V | VR page with no room | Open `/vr.html` with no `?room=` | Address gets a random room code. The scene loads | Pass | |
| A-08 | V | Room label in VR | Open `/vr.html?room=ABCDE` | The scene's room label shows ABCDE | Pass | |
| A-09 | D | Lower-case room in address | Open `index.html?room=abcde` | Same room as `ABCDE` (shows the same drawings) | Pass | |

### B. Drawing in 2D (original)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| B-01 | D | Draw with the mouse | Hold the mouse button and drag | A smooth line with round ends follows the cursor | Pass | |
| B-02 | D | Colour | Pick red in **Colour**, draw | Line is red | Pass | |
| B-03 | D | Brush size | Move **Brush size** from 5 to 50, draw at each end | Line gets thicker. Size range is 5 to 50 px | Pass | |
| B-04 | D | Eraser | Choose **Eraser**, drag over a line | The line is rubbed out back to the board colour | Pass | |
| B-05 | D | Back to marker | After erasing, pick a colour | Tool goes back to the marker with that colour | Pass | |
| B-06 | D | Erase board | Draw, then **Erase board** | The current board is cleared | Pass | Changed by bug 4: now needs 3 clicks, retest with B-10 |
| B-07 | M | Touch drawing | On a phone, draw with a finger | Line follows the finger. The page doesn't scroll while drawing | Pass | |
| B-08 | M | Phone layout | Use the toolbar and tab bar on a phone | All buttons can be reached (the tab bar scrolls sideways) | Fail | Bug 2. Retest with B-08b |
| B-09 | D | Drawing off the edge | Start inside the board, drag out and back in | No stray lines across the board. Drawing stops cleanly when the mouse is released outside | Fail | Bug 3. Retest with B-09b |
| B-08b | M | Phone layout with Options menu | On a phone (portrait): check the tab bar, tools row and toolbar. Tap **☰ Options**, use each button in it, tap outside it | Nothing is cut off at the sides. Tabs scroll sideways on their own row; Add, Size and zoom sit below them. Options opens a pop-up with Rename, Save all, Saved boards, Restore unsaved, Export image, Erase board, Remove whiteboard, Join other room. It closes after a choice (but stays open for Erase and Remove, which need 3 taps) or when you tap outside. On a wide screen the toolbar looks as before | Fail | Bug 6 (iPad landscape). Retest with B-08c |
| B-08c | M | Tablet and phone sideways | On an iPad in landscape (and a phone on its side), open a board at Fit (zoom out greyed) | The whole board, including its bottom edge and grey frame, sits above the toolbar. On a phone on its side the board is small; if it still doesn't fit, the page scrolls so its bottom can be brought above the toolbar | Pass | Fix for bug 6 |
| B-09b | D, M | Leaving and re-entering the board | Hold the mouse button inside the board, drag off the top, along, and back in at another spot, then let go. Repeat with a finger on a phone | Two separate lines: one ends where you left the board, a new one starts where you came back in. Nothing is drawn between the two points | Pass | Fix for bug 3 |
| B-09c | D | Stroke after a drag that started off the board | Press the mouse button on the white area above the board, drag onto the board, let go. Then draw a normal line on the board | The first drag draws nothing. The normal line draws as usual | | Fix for bug 5 |
| B-10 | D | Erase board needs 3 clicks | Draw. Click **Erase board** once, then twice. Wait 4 s, click twice. Then click three times quickly. Also click twice, switch tabs, click once | Button counts down ("Click 2 more times to erase") and turns red. Only the third click within 3 s of the last erases the board, for everyone. Waiting or switching tabs starts the count again | Pass | Bug 4 (new) |

### C. Live sync between people (original)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| C-01 | D | Two people, same room | Open the same room in two windows. Draw in one | The other window shows the line straight away | Pass | |
| C-02 | D | Different rooms stay separate | Open room A and room B. Draw in A | Room B doesn't change | Pass | |
| C-03 | D | Late joiner | Draw in a room, then open the same room in a new window | The new window shows everything already drawn (new: the original showed a blank board) | Pass | |
| C-04 | D | Erase board syncs | Erase the board in one window | The other window is cleared too | Pass | |
| C-05 | D + V | 2D to VR and back | Open the same room in 2D and in the VR page. Draw in each | Each stroke appears on the other | Pass | |
| C-06 | D | Server restart | Draw, stop the server (Ctrl+C) and start it again | Pages reconnect by themselves. Unsaved drawing is offered for restore (see F) | Pass | Works as designed. Restore dialog improvements: bugs 8-10, retest with F-14 to F-17 |
| C-07 | D + M | Phone and desktop | Draw on the phone and the desktop in the same room | Both see each other's lines | Pass | |

### D. VR basics (original)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| D-01 | V | Scene loads | Open `/vr.html?room=ABCDE` | Board, and below it one tilted tool panel with colour discs, Pen size - / +, Highlighter, Eraser, Erase highlights, Erase board and the buttons. No errors in the browser console | Pass | Changed by bugs V1-V5: one tilted panel below the board. Pass (2026-11-28) |
| D-02 | V | Look and walk | Drag with the mouse to look. Use WASD or arrows to walk | Camera turns and moves | Pass | Pass (2026-11-28) |
| D-03 | H | Enter VR | Press the VR button and put on the headset | Immersive view with both controllers visible | Pass | Pass (2026-11-28) |
| D-04 | H | Draw on the board | Hold the controller tip against the board and pull the trigger | A line is drawn where the tip touches. 2D page shows it too | Pass | Pass (2026-11-28) |
| D-05 | H | Pick a colour | Point at a colour disc and pull the trigger | Pen dot changes colour. Next stroke uses it | Pass | Changed by bug V7: trigger, not touch. Pass (2026-11-28) |
| D-06 | H | Pen size | Point at **+** and **-** and pull the trigger | Pen dot grows and shrinks. The label between them shows the size ("Pen size 20"). Strokes match the dot | Pass | Changed by bugs V7, V12. Pass (2026-11-28) |
| D-07 | H | Eraser | Point at the pink **Eraser** box and pull the trigger, then draw over a line | Line is rubbed out | Pass | . Changed by bugs V7, V8. Pass by Q-11 (2026-11-28) |
| D-08 | H | Erase board | Point at the red **Erase board (x3)** box and pull the trigger three times, each within 3 s | Label counts down ("Press 2 more", then "Press 1 more") and the status line asks to confirm. Only the third press erases the selected board, everywhere. Waiting 3 s or selecting another board starts over | Pass | Changed by bug 4. Changed by bug V7: touches no longer count, only trigger presses. Pass (2026-11-28) |
| D-09 | H | Text readable | Look at labels and the room label | Text is readable and not blurry | Pass | Pass (2026-11-28) |
| D-10 | H | Leave VR | Take off / exit VR | The page returns to the normal desktop view without errors | Pass | Pass (2026-11-28) |

### E. Naming, saving and export (PR #1)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| E-01 | D | Temporary name | Open a new room | Toolbar shows `Whiteboard_####` in italics and "Not saved yet" | | |
| E-02 | D | First Save asks for a name | Click **Save** | A box asks for a name, filled in with the temporary name | | |
| E-03 | D | Cancel or empty name | Cancel the box. Then try Save with an empty name | Nothing is saved. Still "Not saved yet" | | |
| E-04 | D | Save with a name | Save as "Planning" | Name shows (not italic) with "Saved at <time>" | | |
| E-05 | D | Later Save | Draw, click Save | Saves straight away without asking for a name | | |
| E-06 | D | Rename | **Rename** to "Planning v2" | New name shows here and in the other window. `/api/boards` shows the new name | | |
| E-07 | D | Rename an unsaved board | On a never-saved board, Rename | Name changes but the board is still "Not saved yet", and Save all stays grey (Rename doesn't count as naming) | | |
| E-08 | D | Save all greyed out | Room with two boards, only one saved | **Save all** is grey | Pass | Pass by Q-17 (2026-11-28) |
| E-09 | D | Save all | Save each board once by itself, then draw on both, then **Save all** | Button is enabled. Both boards saved | | |
| E-10 | D | Saved boards list | Click **Saved boards** | Lists every saved board with **Open** and **Open in VR** links. Links open the right room and board | | |
| E-11 | D | Export image | Click **Export image** | PNG downloads named like `Planning-v2_2026-11-27_0710.png`, at the board's full size | | |
| E-12 | V | VR page toolbar | In the VR page outside a headset, use **Save**, **Rename**, **Save all**, **Export image** in the top corner | Each works on the selected board | | |
| E-13 | S | Name length | Try a name with 100 characters | Name is cut to 80 characters | | |

### F. Autosave, backup and restore (PR #1)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| F-01 | D | Autosave | On a saved board, draw a line | "Autosaving…" then "Saved at …" within about 3 seconds | | |
| F-02 | S | Autosave writes the file | After F-01, look in `data/<ROOM>.json` | The new stroke is in the file. No file for this room in `data/drafts/` | | |
| F-03 | S | Backup of unsaved boards | Draw on a never-saved board, wait 5 s | `data/drafts/<ROOM>.json` exists | | |
| F-04 | D + S | Restore after a crash | Draw on two unsaved boards. Kill the server (`kill -9`). Start it and open the app | **Restore unsaved whiteboards** box says the server didn't shut down cleanly and lists both boards with name, date/time, room and stroke count | | |
| F-05 | D | Restore and open | Tick one board, press **Restore and open** | The page opens that board (in its own room). It shows its strokes, labelled "Restored from backup, not saved yet" | Pass | Button was "Restore selected" (bug 9) |
| F-06 | D | Discard | Discard the other board | Asks to confirm, then it's gone from the list | | |
| F-07 | D | Restore all | Repeat F-04, use **Restore all** | Every board comes back | | |
| F-08 | D | Restore unsaved button | Close the box without choosing | **Restore unsaved (N)** in the toolbar reopens it. Button disappears when the list is empty | | |
| F-09 | D | Clean stop | Draw on an unsaved board, Ctrl+C, start again | Box says the last shutdown was clean and still offers the board | | |
| F-10 | D | Spot already taken | Leave a backup, start the server, draw on the new board in that room, then restore | Backup comes back as an extra whiteboard in the same room. Nothing is overwritten | | |
| F-11 | D | Named board after a crash | Save a board, draw, wait 3 s, kill the server, restart | Board loads complete from autosave. It's not in the restore list | | |
| F-12 | V | Restore box in VR page | After a crash, open the VR page | The restore box is offered there too | | |
| F-13 | S | Backups stay put | Restore a board but don't Save it, then crash again | It's offered again (it still needs a name and a Save) | | |
| F-14 | D | Save selected | After a crash, tick one or more boards and press **Save selected** | Each row says "Saved as “name” · Open". The boards are saved straight away under the names shown: they appear in **Saved boards**, show "Saved at …", and aren't offered for restore again | Pass | Bug 8 (new) |
| F-15 | D | Rename with the pencil | Press **✎** on a row, type a new name, press Enter. Try Escape on another row, and clicking away from the box on a third | Enter and clicking away keep the new name in the list and tick the row; Escape keeps the old name. Clicking in the box doesn't tick or untick the row | Pass | Bug 10 (new) |
| F-16 | D | Pencil, then save or restore | Rename one row with ✎ and press Save selected. Rename another and press Restore and open | The first is saved under the new name. The second opens with the new name, still unsaved (italic, "Not saved yet" style label) | Pass | Bugs 8 and 10 |
| F-17 | D | Restore and open across rooms | Tick boards from two different rooms and press **Restore and open** | Both come back. Since only one room can be open, the page stays on the list and each row shows "Restored · Open" | Pass | Bug 9 |
| F-18 | D, M | Restore dialog layout | Open the restore dialog on a desktop and on a phone | Desktop: all five buttons on one row, filling the width with even gaps. Phone: buttons wrap into full-width rows with no large empty gaps | Pass | Bug 12 |

### G. Naming and export inside a headset (PR #1)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| G-01 | H | Green buttons | Look at the tool panel | **Save**, **Save all**, **Rename**, **Export image** on the panel. Save all is grey until allowed, and pressing it then says why | Pass | . Changed by bugs V1-V5: buttons are on the new panel; bug V13: pressing grey Save all says which boards need a name. Pass by Q-04, Q-16 (2026-11-28) |
| G-02 | H | Save on an unnamed board | Point at **Save** and pull the trigger | A small 2D window opens (`name.html`) with a name field filled with the temporary name | | |
| G-03 | H | Name it in the window | Type a name (headset keyboard), press Save | Window says saved. The VR name tag updates. 2D page shows the name | | |
| G-04 | H | Back to VR after the window | Close the window | You're back in VR (or press VR to go back in). Note which one happens on your headset | | |
| G-05 | H | Fallback if no window | If the browser blocks the window | Page leaves VR and shows the normal name box. Pressing VR goes back in | | |
| G-06 | H | Rename from VR | Trigger on **Rename** | Same window opens for renaming | | |
| G-07 | H | Export from VR | Trigger on **Export image** | PNG downloads (check the headset's downloads) | | |
| G-08 | H | Acts on the selected board | With 2+ boards, select the second and use Save, Rename and Export | They act on the selected board, not the first one | | |

### H. Multiple whiteboards (PR #2 / #3)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| H-01 | D | Add whiteboard | Click **+ Add whiteboard** | New tab with a temporary name appears in this and the other window | | |
| H-02 | D | Tabs | Switch tabs | Board changes. Italic = temporary name, red dot = unsaved changes | | |
| H-03 | D | Address keeps the board | Switch to the 2nd tab, copy the address, open it in a new window | Opens on the same board (`&board=<id>`) | | |
| H-04 | D | Tools act on the open tab | On tab 2: Save, Rename, Export, Erase | Only tab 2 is affected | | |
| H-05 | D | Shared pen settings | Change colour and size, switch tabs | Same colour and size on every board | | |
| H-06 | M | Draw on a later tab | On a phone, open tab 2 and draw | Drawing works | | |
| H-07 | S | 50 board limit | Add boards until 50 | The 51st is refused with a message | | |
| H-08 | V | Boards in the VR scene | Make 4 boards, open VR page | First board in front. Others on a ring: left, right, then behind | | |
| H-09 | V | Selected board | Point at (or draw on) a board | Orange frame and `>` in its name tag. "Selected: name (2 of 4)" shows | | |
| H-10 | V | Drop-down | Outside a headset, pick a board in the top corner list | Selection changes | | |
| H-11 | H | Add and Next board in VR | Trigger **Add whiteboard**, then **Next board** | New board appears on the ring. Next cycles the orange selection | | |
| H-12 | H | Side and back boards | Walk to the side and back boards and draw | They can be reached and drawn on. Lighting looks fine | | |
| H-13 | D + V | Sync both ways | Add, draw, rename in 2D and VR | Every change shows on the other page. Tab names update | | |
| H-14 | S | Restart keeps order | Make 3 named boards, restart the server | All 3 come back in the same order with names | | |

### I. Remove whiteboard (PR #2 / #3)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| I-01 | D | Needs three clicks | Click **Remove whiteboard** once, then twice | Button counts down ("Click 2 more times…"). Board is still there | | |
| I-02 | D | Third click removes | Click three times, each within 3 s | Board is removed for everyone. Page moves to the next board | | |
| I-03 | D | Count resets after 3 s | Click once, wait 4 s, click twice | Board is not removed | | |
| I-04 | D | Count resets on tab switch | Click twice, switch tabs, click once | Nothing is removed | | |
| I-05 | D | Last board | Room with one board | Remove is disabled (or refused with a message) | | |
| I-06 | S | Copy kept | After I-02, look in `data/removed/` | A file `<ROOM>.<board id>.<time>.json` holds the removed board | | |
| I-07 | S | Removed stays removed | Remove a saved board, restart the server | It doesn't come back | | |
| I-08 | H | Remove in VR | Trigger the red **Remove board (x3)** box three times | Label counts down. Only the selected board is removed | | |
| I-09 | V | Ring closes the gap | Remove a middle board in the VR page | Later auto-placed boards move along the ring. Boards placed by hand stay | | |

### J. Board size and 2D zoom (PR #4)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| J-01 | D | Size button | Look at the tab bar, switch tabs | **Size: 1.5 × 1 m** shows each board's size | | |
| J-02 | D | Presets | Apply Standard, Wide, Large, Wall, Tall in turn | Each applies and the board keeps its shape on screen | | |
| J-03 | D | Custom size | Width 2.2, height 1.3 | Board becomes 2.2 × 1.3 m | | |
| J-04 | D | Out of range | Width 9 m (or height 0.2 m) | Error message. Nothing changes | | |
| J-05 | D | Grow keeps drawings centred | Draw in the middle, change to Wall | Drawing stays in the middle, same size | | |
| J-06 | D | Shrink crops, grow brings back | Draw near the edge, shrink to Tall, then back to Standard | The edge drawing is hidden, then comes back exactly | | |
| J-07 | D | Others see the resize | Resize in one window | Other window updates at once | | |
| J-08 | D | Drawing during a resize | Keep drawing in window 2 while window 1 resizes | Strokes land in the right place | | |
| J-09 | D | Zoom | Use −, +, Fit | Zoom changes, percentage shows on Fit, up to 200% | | |
| J-10 | D | Draw while zoomed | Zoom to 200%, scroll, draw | Line appears under the cursor | | |
| J-11 | D | Tab bar while scrolling | Scroll a zoomed board | Tab bar stays at the top. Switching tabs resets to Fit | | |
| J-12 | D | Export size | Export a Wall board | PNG is 4000 × 2000 px | | |
| J-13 | S | Size is saved | Resize a named board, restart. Resize an unsaved board, crash, restore | Size is kept both times | | |
| J-14 | V | VR board size | Use the desktop size picker in the VR page. Set a custom size from 2D | Plane resizes. Picker shows "Custom (…)" for the custom size | | |
| J-15 | H | Board size button | Trigger **Board size** repeatedly | Cycles Standard → Wide → Large → Wall → Tall → Standard. Label updates | | |
| J-16 | H | Wide first board | Make the first board Wall | Board sits behind the button columns. Buttons can still be pressed | | |
| J-17 | H | No overlaps | Mix sizes across 5+ boards | Side boards don't overlap. A full ring starts a new ring further out | | |
| J-18 | H | Big board speed | Draw quickly on a Wall board | No noticeable stutter. Text is sharp | | |
| J-19 | H | Pen dot | Draw on each size | Pen dot matches the stroke width | | |
| J-20 | H | No stray pen dot | Resize or remove a board you were drawing on | No leftover pen-dot sphere | | |

### K. Moving whiteboards (PR #5)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| K-01 | H | Grip tip | Enter VR | A tip about holding the grip button shows | | |
| K-02 | H | Grab a pointed board | Point at a board, hold grip | Board is selected and its frame turns blue | | |
| K-03 | H | Grab with nothing pointed | Point at the floor, hold grip | The selected board is grabbed | | |
| K-04 | H | Move, raise, turn | Swing, raise and twist the controller | Board follows smoothly, stays upright, never goes below the floor | | |
| K-05 | H | Push and pull | Thumbstick forward / back while holding | Board moves away / closer. Stops at about 0.2 m | | |
| K-06 | H | Turn on the spot | Thumbstick left / right while holding | Board turns | | |
| K-07 | H | Drop | Let go of grip | Board stays. Frame goes back to orange | | |
| K-08 | H | Two hands | Grab with one hand, press and release grip on the other | Nothing happens. The first hand keeps the board | | |
| K-09 | H | Leave VR while holding | Exit VR mid-grab | Board drops where it is | | |
| K-10 | H | Auto place | Select a moved board and press **Reset position** | Board goes back to the ring. On a board that wasn't moved, the message says it is already in its own place | Pass | . Changed by bug V11: renamed Reset position, always pressable. Pass by Q-14 (2026-11-28) |
| K-11 | H | Draw on a moved board | Move a board, then draw on it | Drawing works | | |
| K-12 | V | Desktop Move board panel | **Move board**: Left, Right, Up, Down, Closer, Farther, both Turns, **Face me**, **Auto place** | Each moves the selected board one step (25 cm / 15°). Status says "Placed by hand" / "Placed automatically" correctly when switching boards | |. Auto place is now called Reset position (bug V11) |
| K-13 | V | Others see moves | Move a board in one window | The other window sees it move live and its final place | | |
| K-14 | S | Place is saved | Move a named board, wait, restart. Move an unsaved board, crash, restore | Place kept both times | | |
| K-15 | V | Old rooms | Open a room saved before PR #5 | Boards use the automatic layout | | |
| K-16 | V | Resize or add keeps hand placement | Resize a moved board. Add and remove other boards | Moved board stays put | | |
| K-17 | D | 2D ignores places | Move boards in VR, look at 2D | 2D page is unaffected | | |

### L. Moving yourself and long reach (PR #6)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| L-01 | H | Default is Teleport | Look at the bottom row of the panel | Label reads "Moving: Teleport" | |. Changed by bugs V1-V5 |
| L-02 | H | Teleport left / right stick | Push a stick forward, aim, let go | Arc and ring come from that controller. You land on the ring | | |
| L-03 | H | Can't land | Aim at the sky or very far | Arc turns red. Letting go doesn't move you | | |
| L-04 | H | Snap turn | Stick left / right | Turns 30° once per push. Holding doesn't keep turning. Your position doesn't shift | | |
| L-05 | H | Smooth mode | Press **Moving** | "Moving: Smooth". Left stick walks where you look, sideways strafes. Right stick snap-turns. Right stick forward does nothing | | |
| L-06 | H | Setting remembered | Reload the page | Moving mode stays as chosen | | |
| L-07 | H | 25 m limit | Keep moving away | You can't go past 25 m from the start | | |
| L-08 | H | Back to start | Press **Back to start** | You're back at the start facing the first board | | |
| L-09 | H | Stick belongs to the held board | Grip a board, use that stick. Use the other stick | Held board moves, you don't. The other stick still moves you | | |
| L-10 | H | Grab after moving | Teleport, then grab a board. Use Face me (desktop) | Both still work | | |
| L-11 | H | Draw from across the room | Point at a far board, pull the trigger | Ring shows where you'll draw. Line is reasonably steady | | |
| L-12 | H | Close drawing unchanged | Draw up close | Feels the same as before | | |
| L-13 | H | Only the first hit counts | Put one board in front of another, draw | Only the front board gets ink | | |
| L-14 | H | Far sweep over tools | Sweep the pointer over colours and the eraser from far | Nothing changes. A trigger press picks one | Pass | . Changed by bug V7: from any distance, only the trigger picks one. Pass by Q-09, Q-10 (2026-11-28) |
| L-15 | H | Far sweep over Erase board | Sweep over Erase board, then pull the trigger 3 times | Sweep keeps the board. Three trigger presses erase | Pass | Changed by bug 4. Changed by bug V7: touching within 20 cm no longer counts. Pass by Q-09, Q-10 (2026-11-28) |
| L-16 | H | Buttons from far | Use Save, Next board, etc. from a distance | They work with the trigger | | |
| L-17 | H | Reach 20 cm | Press **Reach** | "Reach: 20 cm". Drawing only works within 20 cm of a board, and no pen dot shows further away. Panel buttons still work from any distance. Press again for Long | Pass | . Changed by bug V9: panel buttons still work from far with 20 cm. Pass by Q-12 (2026-11-28) |
| L-18 | V | Desktop still works | VR page without headset | Mouse drawing, WASD, buttons all work | | |
| L-19 | D + H | Others see far strokes | Draw from far in VR | 2D page shows the strokes | | |

### M. Tool panel (PR #7)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| M-01 | H | Panel modes | Trigger **Panel** repeatedly. Reload | Cycles Panel: Follow → Wrist → Stay. Choice survives reload | | |
| M-02 | H | Follow: in front at start | Enter VR in Follow | Panel is in front of you | Pass | Pass by Q-01 (2026-11-28) |
| M-03 | H | Follow: small turns | Turn your head less than 30° | Panel stays still (changed by bug 32: was ~50°) | | |
| M-04 | H | Follow: big turns | Turn fully away and wait | Panel glides in front of you after a moment | | |
| M-05 | H | Follow: moving | Teleport or walk more than 1 m | Panel comes along | | |
| M-06 | H | Follow: never mid-action | Turn away while drawing, pointing at the panel, or holding a board | Panel doesn't move until you stop | | |
| M-07 | H | Follow: snap turn | One 30° snap turn | Panel doesn't move | | |
| M-08 | H | Follow: sitting | Sit down, turn away | Panel comes back lower | | |
| M-09 | H | Panel doesn't block the board | Face the board | You can still draw on the middle of it | Pass | . Changed by bugs V1-V5: the panel is below the board now. Pass by Q-19 (2026-11-28) |
| M-10 | H | Wrist: position | Choose Wrist | Small panel above the left hand, readable, facing you. Note any size, offset or tilt changes wanted | | |
| M-11 | H | Wrist: using it | Use the right controller on the wrist panel (trigger and touch) | Buttons and colours work | Pass | Pass by Q-09, Q-10 (trigger only now) (2026-11-28) |
| M-12 | H | Wrist: left hand still works | With the wrist panel, draw, grab and teleport with the left hand | All work | | |
| M-13 | H | Off the wrist | Switch Wrist → Stay | Full size again, in front of you | Pass | Pass by Q-03 (2026-11-28) |
| M-14 | H | Stay | Choose Stay, move around. Press B or Y | Panel stays put. B/Y brings it in front | | |
| M-15 | H | Back to start brings panel | In Follow and Stay, press Back to start | Panel comes back too | | |
| M-16 | H | Leave VR | Exit VR | Panel is back at the start spot for the desktop view | | |
| M-17 | H | Every button in every mode | In each mode, try colours, size, eraser, highlighter, Erase board, Save, Rename, Save all, Export, Add/Next/Remove board, Size, Auto place, Moving, Reach, Back to start, Add 360 board, Go inside | All work | |. Auto place is now Reset position (bug V11) |
| M-18 | H | Lighting | Turn around with the panel following | Board lighting doesn't change | | |

### N. 360° boards (PR #8)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| N-01 | D | Add 360° board | **+ Add 360° board** | Tab "360° Whiteboard_####". Size button shows "360°: 8 m around × 1.8 m high" and is disabled | | |
| N-02 | D | Turn the view | ◀ Turn / Turn ▶ / Front | View turns 45° each press. Front resets. "front (in VR)" and "behind (edges join here)" tags show | | |
| N-03 | D | Draw across the join | Turn so the "behind" line is in the middle, draw across it | Line carries on across the join with no gap or jump | | |
| N-04 | D | Export | Export a 360° board | 8000 × 1800 PNG without the front/behind tags | | |
| N-05 | D + V | Sync | Draw and Erase board on a 360° board in 2D, VR page and a second window | All stay in step | | |
| N-06 | H | Add from VR | Trigger **Add 360 board** on the panel | A grey drum appears behind the start. Message says to press Go inside | |. Changed by bugs V1-V5 |
| N-07 | H | Go inside / Step out | Select the drum, press **Go inside**. Press again, or Back to start | You're in the middle facing the front. Label says "Step out". Pressing again or Back to start takes you out. Go inside is grey unless a 360° board is selected | | |
| N-08 | H | Draw all round | Draw all the way round, including behind you across the join | Ink appears everywhere. Pen dot shows on the wall | | |
| N-09 | H | Not from outside | Point at the drum from outside | No pen dot and no drawing | | |
| N-10 | H | Selected and name tag | Select the 360° board | Rims turn orange. Name tag readable inside and outside ("360: …") | | |
| N-11 | H | Fixed size | Press Board size on a 360° board | Board size label reads "Size: fixed (360)" and the button is grey. Pressing it says 360 boards have a fixed size | Pass | . Changed by bug V10. Pass by Q-13 (2026-11-28) |
| N-12 | H | Can't grab | Grip on a 360° board | Message says it can't be grabbed. Desktop Move board panel still moves it. Auto place puts it back | |. Auto place is now Reset position (bug V11) |
| N-13 | H | Export from VR | Export a 360° board in VR | Panorama PNG downloads | | |
| N-14 | D + S | Save and restore | Save, Rename, autosave, Save all, restore unsaved and Remove (×3) on a 360° board. Restart | All work. It reloads as a 360° board | | |
| N-15 | V | Several 360° boards | Add 3 | They line up one behind another. Flat boards keep their layout | | |
| N-16 | H | Performance and comfort | Draw on the wall for a minute. Step in and out with teleport | Smooth frame rate. Wall readable at 1.27 m | | |

### O. Highlighter and Erase highlights (PR #9)

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| O-01 | D | Even colour | Choose **Highlighter**, scribble over the same spot many times | Colour stays even, no darker blotches | | |
| O-02 | D | Writing stays readable | Highlight over writing. Then write over a highlight | Writing is on top and readable both ways | | |
| O-03 | D | Colours | Try each of the 5 swatches and the colour picker. Cross two colours | Colour changes. Crossing colours mix (yellow + pink = orange) | | |
| O-04 | D | Pens remember settings | Set marker red 10 px, highlighter green 40 px, switch back and forth | Each pen keeps its own colour and size. Highlighter starts at 30 px | | |
| O-05 | D | Eraser removes both | **Eraser** over writing and highlight | Both are rubbed out | | |
| O-06 | D | Erase highlights | **Erase highlights** over writing and highlight | Highlight goes, writing stays | | |
| O-07 | D | Colour while erasing | While erasing, pick a colour | Goes back to that pen | | |
| O-08 | D | Sync and reload | Second window watches. Then reload both | Highlights and both erasers show live, and look the same after reload | | |
| O-09 | S | Save and restore | Save and reload a board with highlights. Crash and restore an unsaved one | Highlights and highlight-erasing come back the same | | |
| O-10 | D + H | Export | Export in 2D and VR | Highlights see-through in the PNG, writing on top | | |
| O-11 | D + H | 360° join | Highlight and highlight-erase across the join (Turn ×4 in 2D, behind you in VR) | Even on both sides | | |
| O-12 | D | Resize | Resize a highlighted board | Highlights move with everything else | | |
| O-13 | H | Pick up the highlighter | Pull the trigger on **Pen mode** (top left of the pen rows) again and again | Label goes Dry erase → Highlighter, yellow → green → pink → blue → orange → Dry erase. The pen dot shows each colour | Pass | . Changed by bug V7: trigger, not touch. Changed: the Highlighter box is now Pen mode (R-15). Pass by R-15 (2026-11-28) |
| O-14 | H | Eraser boxes | Pull the trigger on **Eraser**, draw. Then on **Erase highlights**, draw. Then on **Eraser** again | Pink **Eraser** rubs out writing and highlights. Yellow **Erase highlights** rubs out highlights only. Pressing either again keeps that eraser. The box in use is a bit bigger | |. Changed by bug V8: two boxes instead of one that toggled |
| O-15 | H | Colour cylinder | While highlighting, pull the trigger on a colour disc | Pen mode goes back to Dry erase and the marker uses that colour, at its old size | Pass | . Changed by bug V7: trigger, not touch. Pass by R-15 (2026-11-28) |
| O-16 | H | +/- | Press +/- with marker, then highlighter | Only the pen in use changes | | |
| O-17 | H | Boxes reachable | In Follow, Wrist and Stay panel modes | Highlighter and Eraser boxes can be reached | | |

### Q. Headset fixes, round 1 (bugs V1 to V13, PR #19)

The VR tool panel was rebuilt as one tilted plate below the board, with a grab handle. Run these in a headset unless marked V. Use a new room.

**Retest round 1 (2026-11-28):** Q-01, Q-09, Q-12 and Q-18 failed, and two more bugs turned up (Follow didn't turn with you, bug 32; a line joined two spots after leaving the board, bug 34). The fixes are in PR #20 and the expected results below are updated to match. Rerun these Q tests, plus section R for the new checks. Q tests with no result yet still need a first run.

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| Q-01 | H | Panel at first load (V1) | Enter VR in Follow | The panel is in front of you below eye level (about 75 cm ahead), leaning back like a lectern. The board is beyond it (1.7 m) and above it. No button is hidden by the board | Pass | Retest 2026-11-28: height good, too close (bug 27). Now 75 cm ahead, board at 1.7 m. Retest with R-01 |
| Q-02 | H | Big board (V1, V2) | Set the first board to Wall (4 × 2 m), then Tall. Try Stay and Follow | Every panel button stays visible and reachable. The board doesn't cover the panel | Pass |  |
| Q-03 | H | Back to Follow / Stay (V3) | Panel: Wrist, then press Panel until Stay, then Follow. Also press B or Y | Each time it comes back at a comfortable distance and height in front of you, not too close or low | Pass | Distance changed by bug 27 (now 75 cm) |
| Q-04 | H | Buttons don't overlap (V4) | Look at Highlighter and Next board | Separate boxes, each with its own label. Next board works | Pass |  |
| Q-05 | H | Messages readable (V5) | Press Reach, Pen size +, Next board | Each message shows in the top strip of the panel, not behind anything | Pass |  |
| Q-06 | H | Grab the panel (V6) | Point at the dark "Grip here" handle (or anywhere on the plate) and hold the grip. Move your hand, then let go | The panel moves with your hand and keeps facing you. On letting go it stays there and the label says "Panel: Stay". No whiteboard moves | Pass |  |
| Q-07 | H | Grab from the wrist (V6) | Panel: Wrist, then grip the wrist panel with the right controller | It comes off the wrist at full size and can be placed. Then "Panel: Stay" | Pass |  |
| Q-08 | H | Thumbstick while holding the panel (V6) | Hold the panel with the grip and push that thumbstick | You don't teleport or turn while the grip holds the panel | Pass |  |
| Q-09 | H | No hover clicks (V7) | In Wrist and in Follow, sweep the pointer slowly over every colour, Eraser, Erase highlights, Highlighter, Erase board and every button, without pulling the trigger. Also rest the controller tip on them | Nothing changes. Every control except the colour discs turns the same orange while pointed at | Pass | Retest 2026-11-28: no more hover clicks, but in Wrist the top row (colours, pen size) did not respond (bug 28); Erase board erased after 2 presses (bug 29); colours unified (bug 31). Retest with R-02 to R-04, R-06 to R-09 |
| Q-10 | H | Trigger clicks (V7) | Pull the trigger on each of the above | Each works once per pull. It flashes white and grows for a moment (bug 31). Erase board needs three pulls | Pass | See bug 28 for the wrist top row and bug 29 for double presses. Retest with R-02 to R-04 |
| Q-11 | H | Eraser not stuck (V8) | Draw and highlight. **Erase highlights** over both, then **Eraser** over both, then a colour | Erase highlights removes only the highlight. Eraser then removes writing too. The colour goes back to the marker | Pass |  |
| Q-12 | H | Reach only limits drawing (V9) | Reach: 20 cm. Use panel buttons from where you stand. Point at a board 1 m away and pull the trigger. Walk up and draw within 20 cm | Buttons all work. The far board isn't drawn on, shows no pen dot, and the laser stops at 20 cm on it. Close up it draws. Pointing at the panel or the sky, the laser shows full length | Pass | Retest 2026-11-28: drawing limit right, but the laser still showed full length on a board (bug 30). Retest with R-05 |
| Q-13 | H + V | 360 board size (V10) | Select a 360 board, look at the Size button, press it | Label "Size: fixed (360)", button grey. Pressing says the fixed size. Desktop size menu is greyed out too | Pass |  |
| Q-14 | H + V | Reset position (V11) | Press **Reset position** on a board that wasn't moved. Then grip-move a board and press it | First: message says it hasn't been moved. Second: the board goes back to its own place | Pass |  |
| Q-15 | H | Pen size (V12) | Press - and + with the marker, then the highlighter | The label between them shows "Pen size N" and a message says Marker / Highlighter size. Pen dot changes | Pass |  |
| Q-16 | H + V | Grey buttons explain themselves (V13) | With one board, press grey Next board, Remove board, Go inside. With two unsaved boards, press Save all | Each gives a short reason. Save all lists the boards that still need a name | Pass |  |
| Q-17 | D + V | Save all label (V13) | Room with two boards, one never saved | The grey button reads "Save all (1 unnamed)". Its tooltip names the board. After saving it, it reads "Save all" and works | Pass |  |
| Q-18 | V | Desktop VR page | Open the VR page without a headset | The panel is visible below the board. Clicking every panel button with the mouse works, including Pen size - and +, and doesn't draw on the board behind it | Pass | Retest 2026-11-28: Pen size - and + ignored clicks (bug 33). Also bug 34 (line joining two spots after leaving the board). Retest with R-12, R-13 |
| Q-19 | H | Drawing past the panel | Draw on the lower part of the first board | You can reach the whole board. Point through the panel and nothing is drawn behind it | Pass |  |

### R. Headset fixes, round 2 (bugs 27 to 31, PR #20)

From Kate's retest of section Q on 2026-11-28.

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| R-01 | H | Panel distance (bug 27) | Enter VR in Follow | Same height as before, about 20 cm further away. The first board is a little further back too (1.7 m). Note if it should move again | Pass | Pass by Q-01 (2026-11-28) |
| R-02 | H | Wrist top row (bug 28) | Panel: Wrist. Pull the trigger on every colour disc, then **-** and **+**, from the angle you'd naturally use | Every press works first time: the colour changes, the pen size label changes | Pass | Pass by Q-10 in Wrist (2026-11-28) |
| R-03 | H | Erase board count (bug 29) | Pull the trigger on **Erase board (x3)** once, then again, then again | Label reads "Press 2 more", then "Press 1 more". Only the third pull erases | Pass | Pass (2026-11-28) |
| R-04 | H | One pull, one step | Pull the trigger once on **+** and once on the Highlighter | Pen size goes up by 10 (not 20). Highlighter moves on one colour | Pass | Pass by Q-10 (2026-11-28) |
| R-05 | H | Laser shows the reach (bug 30) | Reach: 20 cm. Point at a board across the room, then at the panel, then at the sky | On the board the laser stops at 20 cm. On the panel and the sky it goes the full length. Reach: Long: full length on the board too | Pass | Pass by Q-12 (2026-11-28) |
| R-06 | H + V | One colour scheme (bug 31) | Look at every panel control | All buttons are teal (Erase board and Remove board red, grey when they can't be used). Colour discs show their own colour | Pass | Pass (2026-11-28) |
| R-07 | H + V | Hover colour (bug 31) | Point at each button, the handle, Erase board and Remove board | Each turns the same orange. Colour discs don't change colour | Pass | Pass by Q-09 (2026-11-28) |
| R-08 | H + V | Active modes (bug 31) | Pick the highlighter, then Eraser, Erase highlights, a colour. Go inside a 360 board | The box of the tool in use turns blue (the colour disc in use is bigger instead). Go inside is blue while you're inside | Pass | Pass (2026-11-28) |
| R-09 | H + V | Press feedback (bug 31) | Press each control | It flashes white and grows for a moment, then goes back | Pass | Pass by Q-10 (2026-11-28) |
| R-10 | H | Follow keeps up with turns (bug 32) | Panel: Follow. Rest both controllers pointing at the panel, then turn 45° and 90° left and right, and turn all the way round | After each turn the panel glides back in front of you within about half a second | Pass | Pass (2026-11-28) |
| R-11 | H | Follow doesn't move under the pointer (bug 32) | Point at a button and turn your head a little to read a label | The panel stays still while you aim at a button | Pass | Pass (2026-11-28) |
| R-12 | V | Pen size with the mouse (bug 33) | VR page without a headset: click **+** and **-** | The "Pen size" label goes up and down by 10 (5 to 50) and the button flashes | Pass | Pass by Q-18 (2026-11-28) |
| R-13 | V + H | Leaving the board ends the line (bug 34) | Hold the mouse button (desktop) or trigger (headset), draw, go off the edge, come back further along, let go | Two separate lines, nothing joining them. Same for both controllers | Pass | Pass (2026-11-28) |
| R-14 | H | Two controllers (bug 34) | Rest the left controller pointing at the board, draw with the right. Then draw with both at once | Lines go where each pointer is, with no jumps between the two | Pass | Pass (2026-11-28) |
| R-15 | H + V | Pen mode button | Pull the trigger on **Pen mode** seven times. Then highlight, and press a colour disc. Then pick Eraser and press Pen mode | Label shows "Pen mode: Dry erase", then "Highlighter, yellow", green, pink, blue, orange, then Dry erase again. Box is blue while highlighting. A colour disc switches back to Dry erase. From the eraser, Pen mode goes to Dry erase | Pass | Kate's change 2026-11-28 |
| R-16 | H | Board name steady (bug 36) | Look at the room name and the "Selected:" line under it, with one board and then several. Point at different boards | Both lines are steady and don't overlap. The name changes when you select another board | Pass |  |
| R-17 | H | Wrist aiming (bug 37) | Panel: Wrist. Hold the left hand still, aim the right laser straight at the middle of each button, pull the trigger. Then move the left hand slowly and try again | The button the laser touches turns orange and presses. If you still have to aim off it, note which way (above, below, left, right) and by about how much | Pass |  |
| R-18 | H + V | Error messages in red (bug 38) | With one board, press the grey Remove board. Also press grey Next board, Go inside and Save all | Each message shows in red on the panel. Normal messages (e.g. "Added …") stay dark grey | Pass | Pass (2026-11-28) |

### P. Combined, multi-user and performance checks

| ID | Platform | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|---|
| P-01 | D + V + H | Three people | One 2D desktop, one phone, one headset in the same room. Each adds a board, draws, renames | Everyone sees everything. No duplicate or lost strokes | | |
| P-02 | D + H | Same board, same time | Two people draw on the same board at once | Both sets of strokes appear for everyone | | |
| P-03 | V | Two people move the same board | Both drag the same board | Last one to let go wins. No errors | | |
| P-04 | H | Memory with many boards | 1 Wall board + 2 × 360° boards + 4 standard. Use for 10 minutes | No crash or reload. Frame rate acceptable | | |
| P-05 | H | 360° memory | Load and draw on a 360° board on a standalone headset | No crash (about 170 MB of canvas memory) | | |
| P-06 | D | Network drop | Turn Wi-Fi off and on while drawing | Page reconnects. Board is up to date after reconnecting (strokes drawn while offline may be lost; note what happens) | | |
| P-07 | S | Server log | Look at the server terminal during all tests | No error messages | | |
| P-08 | D | Browser console | Keep DevTools open during sections A to O | No red errors | | |
| P-09 | D | Browsers | Run A, B, C, E in Chrome, Firefox, Safari and Edge | Same results | | |
| P-10 | H | Headset browsers | Run D and G on each headset you have (e.g. Quest Browser, Pico, PC VR in Chrome) | Same results. Note differences | | |

---

## 5. Known risks and things to watch

These come from the feature PRs and from reading the code. Each points to the tests that would catch it.

| Risk | Where to look |
|---|---|
| Never tested on a real headset: everything in sections D, G and K to O marked **H** | All **H** tests |
| Every stroke re-uploads the whole board texture. A 4 × 2.5 m board is about 40 MB, so drawing may stutter | J-18, P-04 |
| 360° boards with the highlighter use about 170 MB of canvas memory | N-16, P-05 |
| The naming pop-up window may not open from inside VR on some headset browsers (there's a fallback) | G-02 to G-05 |
| The Wrist panel's size, offset, tilt and hand are guesses | M-10 |
| Guessed values to tune: teleport default, 30° snap turn, 2 m/s walking, 25 m limit, 12 m reach, 65° / 0.6 s follow, highlighter 50% and 30 px, 360° board 8 m × 1.8 m | L, M, N, O |
| Strokes drawn while the connection is down may be lost | P-06 |
| Hand-placed boards don't take part in the ring, so an auto-placed board can overlap one | I-09, K-16 |
| On touch screens, dragging on a zoomed board draws, so you scroll with the scrollbars | J-10, B-07 |
| Vive-style trackpads can't push, pull or turn a held board (thumbstick only) | K-05, K-06 |
| The pages still load the original author's Google Analytics tag, so visits are reported to them | Not a test. Remove it if that matters |
| `package.json` still says Node 10, but the build and tests run on current Node | AUTO-1, AUTO-2 |

---

## Bug log

Copy a row for each problem. Put the bug number in the test's Notes column.

| Bug # | Test ID | Platform / device / browser | What happened | What should happen | Steps to repeat | Severity (blocker / major / minor) | Status |
|---|---|---|---|---|---|---|---|
| 1 | A-06 | V, desktop browser | Once the VR page is open there is no way back to the 2D page. Pressing the VR button again only goes full screen | A button that returns to the 2D view | Click VR on the 2D page, then look for a way back | Major | Resolved (retest passed 2026-11-27): **← 2D view** button in the VR page toolbar (opens the 2D page on the same room and selected board). Retest with A-06b |
| 2 | B-08 | M, iPhone | On a phone many toolbar and tab-bar buttons are off the edge of the screen and can't be reached | Every button can be reached; extra ones in an options menu | Open the 2D page on a phone in portrait | Major | Resolved (retest passed 2026-11-27): on screens up to 800 px wide the toolbar wraps, the extra buttons move into a **☰ Options** pop-up, and the tab bar wraps onto two rows. Retest with B-08b |
| 3 | B-09 | D, desktop browser | Dragging off the board and back in draws a straight line between where the pen left and where it came back | The line stops at the edge and a new one starts where the pen comes back in | Hold the mouse button, drag off the top of the board and back in further along | Minor | Resolved (retest passed 2026-11-27): leaving the board ends the line; coming back with the button held starts a new one. Letting go outside the board now also ends the stroke. Same for touch. Retest with B-09b |
| 4 | B-06 (new feature) | D, H | **Erase board** (2D) and **Erase board** (VR) clear the board with one press, with no confirmation | Three presses in a row, like Remove whiteboard | Press Erase board once | Feature | Resolved (retest passed 2026-11-27): 2D button needs 3 clicks within 3 s each and counts down. The VR box is now "Erase board (x3)" and needs 3 touches or trigger presses. Retest with B-10, D-08, L-15 |
| 5 | B-09c (found while fixing bug 3) | D, desktop browser | After pressing the mouse button above the board and dragging onto it, later strokes on the board stopped after the first bit (the browser was dragging the selected text instead) | Strokes always draw | Press above the board, drag onto it, let go, then draw | Minor | Resolved (retest passed 2026-11-27): pressing on the board no longer selects or drags page text. Retest with B-09c |
| 6 | B-08b | M, iPad landscape | At Fit (fully zoomed out), the bottom of the board is hidden behind the toolbar | The whole board fits above the toolbar | Open the 2D page on an iPad in landscape | Major | Resolved (retest passed 2026-11-27): Fit now measures the tab bar and toolbar and keeps the board between them; it re-fits when the toolbar changes height. On very short screens the page gets room to scroll the board above the toolbar. Retest with B-08c |
| 7 | B-10 (wording) | D, V, H | Erase button called "Erase whole board" in 2D and "Erase All" in VR | The same name, "Erase board", in both | Compare the two pages | Minor | Resolved (retest passed 2026-11-27): "Erase board" in 2D, "Erase board (x3)" on the VR box, and a new **Erase board** button in the VR page's desktop toolbar (same 3 clicks) |
| 8 | C-06 (new feature) | D, V | The restore list can only bring boards back unsaved, so each one then needs its own Save | A way to save them straight away under their names | Crash the server with unsaved boards, open the app | Feature | Resolved (retest passed 2026-11-27): **Save selected** restores the ticked boards and saves them under the names shown. Retest with F-14, F-16 |
| 9 | C-06 (wording) | D, V | "Restore selected" doesn't say the boards will open | A clearer label | Same as bug 8 | Minor | Resolved (retest passed 2026-11-27): renamed **Restore and open**. It now opens the restored board (or, for boards from several rooms, shows an Open link on each row). Retest with F-05, F-17 |
| 10 | C-06 (new feature) | D, V | No way to rename a board in the restore list before saving or restoring | A small edit symbol on each row | Same as bug 8 | Feature | Resolved (retest passed 2026-11-27): **✎** on each row turns the name into a text box. The new name is used by Save selected, Restore and open and Restore all. Retest with F-15, F-16 |
| 11 | F-15 | D, Safari | The rename box from ✎ is extremely narrow, so only part of one character shows while typing | The box is wide enough to see the name | Press ✎ on a row and type | Minor | Resolved (retest passed 2026-11-27): the name area now fills the row and the box is at least 16 characters wide. Retest with F-15 |
| 12 | F-14 (layout) | D, M | The restore dialog's buttons sit to the right with empty space on the left, and Restore all wraps onto a line of its own | Buttons spread evenly across the dialog | Open the restore dialog | Minor | Resolved (retest passed 2026-11-27): the buttons stretch to share the full width; on a desktop they sit on one row, on a phone they wrap into even rows. Retest with F-18 |
| 13 | Setup (headset) | D, V | Opening `https://<IP>:3000` gives ERR_SSL_PROTOCOL_ERROR | The https page loads | Start with `npm start`, open the https address | Major | Resolved (retest passed 2026-11-28): `npm start` now serves http on 3000 and, after `npm run cert`, https on 3443; the start-up message prints both addresses. Retest: open `https://<IP>:3443` |
| 14 | Headset notes (V1) | H | Default panel layout too tight on first load; options partly hidden by the board | Every option visible | Enter VR | Major | Resolved (retest passed 2026-11-28): the panel is now one tilted plate below the board, not a frame around it; the first board moved to 1.5 m away. Retest with Q-01 |
| 15 | Headset notes (V2) | H | In Stay mode the panel doesn't grow when the board is resized | The board never covers the panel | Resize the board in Stay | Major | Resolved (retest passed 2026-11-28): the panel no longer goes around the board, so a bigger board can't cover it. Retest with Q-02 |
| 16 | Headset notes (V3) | H | Switching back to Stay/Follow puts the panel too close and too low | Comfortable distance and height | Wrist, then Stay or Follow | Major | Resolved (retest passed 2026-11-28): it comes back 55 cm ahead and 55 cm below your eyes, facing you; Stay also starts in front of you on entering VR. Retest with Q-03 |
| 17 | Headset notes (V4) | H | Highlighter box covers Next board | Separate buttons | Look at the right column | Major | Resolved (retest passed 2026-11-28): new grid layout. Retest with Q-04 |
| 18 | Headset notes (V5) | H | Reach message hidden behind the colour chooser | Messages readable | Press Reach | Minor | Resolved (retest passed 2026-11-28): messages show in the panel's top strip. Retest with Q-05 |
| 19 | Headset notes (V6) | H | No way to grab and move the panel | A handle to move it |  | Feature | Resolved (retest passed 2026-11-28): grip the "Grip here" handle or the plate; letting go leaves it there (Panel: Stay). Retest with Q-06 to Q-08 |
| 20 | Headset notes (V7) | H | Some controls fire on hover, not click (colours, Erase board), maybe only in Wrist | Only a trigger press activates | Sweep over the colours | Major | Resolved (retest passed 2026-11-28): controls used to fire when the pointer touched them within 20 cm, which on the wrist happens all the time. Now only the trigger counts. Retest with Q-09, Q-10 |
| 21 | Headset notes (V8) | H | Erase gets stuck in erase-highlights mode | Normal erasing always possible | Press Eraser twice | Major | Resolved (retest passed 2026-11-28): the one box that toggled is now two boxes, **Eraser** and **Erase highlights**. Retest with Q-11, O-14 |
| 22 | Headset notes (V9) | H | Reach distance also limits reaching the panel | Reach only limits drawing | Reach: 20 cm, use a button | Major | Resolved (retest passed 2026-11-28): the pointer always reaches 12 m; Reach only decides how close a board must be to draw. Retest with Q-12, L-17 |
| 23 | Headset notes (V10) | H | Resize does nothing on 360° boards | Clear feedback | Select a 360 board, press Size | Minor | Resolved (retest passed 2026-11-28): 360 boards have a fixed size by design; the button now says "Size: fixed (360)", is grey, and explains when pressed (the explanation was hidden by bug 18). Resizable 360 boards would be a new feature. Retest with Q-13 |
| 24 | Headset notes (V11) | H | Auto Place purpose unclear, seems to do nothing | Clear purpose | Press Auto place | Minor | Resolved (retest passed 2026-11-28): it puts a board you moved back in its automatic place, and did nothing (grey) for boards never moved. Renamed **Reset position**, always pressable, says what it did. Retest with Q-14, K-10 |
| 25 | Headset notes (V12) | H | Round +/- buttons have no visible effect | Clear purpose | Press + / - | Minor | Resolved (retest passed 2026-11-28): they change the pen size (5 to 50 px). They now have a "Pen size N" label and a message. Retest with Q-15, D-06 |
| 26 | V (screenshot) | V, H | Save all is greyed out with several boards in the room | Clear reason | Two boards, one with a temporary name | Minor | Resolved (retest passed 2026-11-28): working as designed (Save all waits until every board has been named with its own Save), but it didn't say so. The button now reads "Save all (N unnamed)", its tooltip names them, and in VR pressing it explains. Retest with Q-16, Q-17 |
| 27 | Q-01 | H | In Follow the panel is at a good height but too close | Further away | Enter VR | Minor | Resolved (retest passed 2026-11-28): 75 cm ahead (was 55 cm); first board moved to 1.7 m. Retest with R-01 |
| 28 | Q-09 | H | Wrist mode: the top row (colour discs and pen size - / +) doesn't respond to the trigger | Every control works | Panel: Wrist, press a colour | Major | Resolved (retest passed 2026-11-28): at a slant the pointer hit the edge of the panel's backing plate first, and the press was lost. Controls now look past the plate (it still stops drawing on boards behind the panel). Retest with R-02 |
| 29 | Q-09 (found in retest) | H | Erase board (x3) erases after two presses; the label said "Touch 2 more" | Three presses | Press Erase board | Major | Resolved (retest passed 2026-11-28): some controllers report one trigger pull twice; panel controls now ignore a second press within 0.25 s. Label now says "Press N more". Retest with R-03, R-04 |
| 30 | Q-12 | H | With Reach: 20 cm the laser still shows full length on a board | The laser shows the real reach on boards, full length elsewhere | Reach: 20 cm, point at a far board | Minor | Resolved (retest passed 2026-11-28): the line stops at 20 cm when it points at a board further away. Retest with R-05 |
| 31 | Q-09 (feature) | H, V | Button colours are mixed; no sign of the mode in use or of a press | One scheme, active colour, press feedback | Look at the panel | Feature | Resolved (retest passed 2026-11-28): teal buttons (red for Erase / Remove board), one orange hover colour (not on colour discs), blue for the mode in use, a white flash and grow on every press. Retest with R-06 to R-09 |
| 32 | Q-09 (found in retest) | H | In Follow the panel follows you when you move but not when you turn | It stays in front of you when you turn | Panel: Follow, turn | Major | Resolved (retest passed 2026-11-28): the panel never followed while a pointer touched it, and the new big backing plate is in front of a resting controller nearly all the time. Now only aiming at an actual control pauses it, and it follows after a 30° turn for 0.3 s (was 65° for 0.6 s). Retest with R-10, R-11, M-03, M-04 |
| 33 | Q-18 | V | On the VR page without a headset, the Pen size - and + don't respond to clicks | Mouse clicks work | Click + | Minor | Resolved (retest passed 2026-11-28): they only listened to the controller trigger (also true before this round); now a mouse click works too. Retest with R-12 |
| 34 | (found in retest) | V, H | Drawing on a board, moving off it and back on somewhere else draws a straight line between the two spots | The stroke ends at the edge; coming back starts a new one | Hold the mouse button (or trigger), drag off the board and back on | Major | Resolved (retest passed 2026-11-28): each pen (mouse, left and right controller) now keeps its own stroke, ends it when it leaves the board, and starts a new one when it comes back. Before, the mouse never ended its stroke and both controllers shared one. Retest with R-13, R-14 |
| 35 | (change request) | H, V | The Highlighter box should be a Pen mode button | One button cycles Dry erase → Highlighter, yellow → … → orange → Dry erase; a colour disc goes back to Dry erase |  | Feature | Resolved (retest passed 2026-11-28): **Pen mode** button with a two-line label. From an eraser it goes back to Dry erase. Mouse clicks on it now work outside a headset too (they missed before). Retest with R-15, O-13 |
| 36 | (found in retest) | H | The "Selected:" board name under the room name flickers (z-fighting) | Steady text | Look at the top left of the panel | Minor | Resolved (retest passed 2026-11-28): the room line and the board-name line were see-through text planes overlapping at the same depth. The name is now lower and slightly in front, and only redrawn when it changes. Retest with R-16 |
| 37 | (found in retest) | H | In Wrist mode you have to aim well below a button to press it | The button under the laser presses | Panel: Wrist, aim at a button | Major | Resolved (retest passed 2026-11-28): the pointer may have been tested against where the wrist panel was drawn the frame before; the panel's position is now worked out before the pointers test it. The wrist panel is also 20% bigger. Not confirmed as the cause. Retest with R-17 |
| 38 | (change request) | H, V | "The last whiteboard in a room can't be removed" shows in black, like any message | Error messages stand out in red | Press grey Remove board with one board | Minor | Resolved (retest passed 2026-11-28): messages for things that can't be done (grey buttons, and errors such as "Could not save") show in red on the panel. Retest with R-18 |
| 39 | | | | | | | |
