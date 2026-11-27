# Whiteboard VR

![Banner](media/banner.jpg)

A web-bassed online whiteboard which is platform independent. Use VR, Desktop or Mobile. Share your ideas or educate your students.

![Preview](media/demo.gif)

## Demo

Video: [https://www.youtube.com/watch?v=YjOsA-EFc9I&feature=youtu.be](https://www.youtube.com/watch?v=YjOsA-EFc9I&feature=youtu.be)

Try it yourself: [https://whiteboard-vr.herokuapp.com](https://whiteboard-vr.herokuapp.com)

## How to run locally

1. Clone the project `git clone https://github.com/marlon360/whiteboard-vr.git`
2. Navigate to directory `cd whiteboard-vr`
3. Install dependencies `npm install`
4. Build project `npm run build`
5. Start Webserver (with socket.io) `npm run start`

## Saving, naming and export

- Each new whiteboard gets a temporary name like `Whiteboard_4821`. The current board is shared live with everyone in the room, including people who join later.
- The first **Save** on a board asks for a name. After that, changes are **autosaved** to the saved file a few seconds after you make them, and Save saves right away. **Rename** changes the name at any time.
- **Save all** saves every whiteboard in the room. It stays greyed out until each whiteboard has been named with its own Save button.
- **Saved boards** lists every saved board so you can reopen it in 2D or VR.
- **Export image** downloads the board as a PNG, in 2D (toolbar) and in VR (the green boxes left of the board, or the buttons in the top corner outside VR).
- **Naming in a headset:** browsers can't show a text box inside VR. So Save on an unnamed board, or Rename, opens a small 2D window (`name.html`) with a name field and a Save button. If the browser won't open a window, the page leaves VR and shows the normal name box instead, and you press **VR** to go back in.
- **Backup and restore:** whiteboards that have never been saved are backed up every few seconds to `./data/drafts/`. If the server stops before they're saved (a crash or a restart), the next time you open the app it lists them by name and last change. You can restore them one by one, restore all, or discard them. Restored whiteboards still need a name and a Save. **Restore unsaved** in the toolbar brings the list back later.
- **Multiple whiteboards:** a room can hold several whiteboards (up to 50). **+ Add whiteboard** creates a new one with a temporary name for everyone in the room.
  - 2D page: each whiteboard is a tab above the board. Click a tab to switch; Save, Rename, Export image and Erase act on the open tab. The address bar keeps `&board=<id>` so a link opens that board.
  - VR: every whiteboard is in the scene. The first stays in front of you; new ones appear on a ring around you (left, right, then behind). The board you point at (or draw on) is the **selected** one, with an orange frame and `>` in its name tag; the green Save / Rename / Export / Erase All buttons act on it. **Next board** (right column) cycles the selection, and outside a headset the drop-down in the top corner does the same.
  - **Remove whiteboard** takes the current (2D) or selected (VR) board away for everyone. To avoid accidents it needs **three clicks in a row**, each within 3 seconds; the button counts down ("Click 2 more times"). The last board in a room can't be removed. A copy of every removed board is kept in `./data/removed/`, so a mistake can be undone by hand.
  - **Moving whiteboards (VR):** hold the **grip** button on either controller. Point at a board to grab it (pointing at nothing grabs the selected board); its frame turns blue. Swing, raise or turn the controller to move the board; thumbstick forward/back pushes it away or pulls it closer, left/right turns it. Let go to drop it. Boards stay upright and above the floor. Everyone in the room sees it move, and its place is saved with the board. **Auto place** (below the left button column) puts the selected board back in the automatic layout.
  - **Moving whiteboards (outside a headset):** **Move board** in the top corner opens a panel that slides the selected board left/right, up/down, closer/farther (25 cm steps), turns it (15° steps), turns it to face you, or puts it back with Auto place.
  - Colour, size and eraser are shared by all boards.
  - If a backup can't go back to its old spot because that board has content, it comes back as an extra whiteboard in the same room.
- Saved boards are JSON files in `./data` (change it with the `DATA_DIR` environment variable). Back up that folder to keep your boards.
- API: `GET /api/boards` lists saved boards. `GET /api/boards/<room>` shows the whiteboards in a room. `GET /api/recovery`, `POST /api/recovery/restore` and `POST /api/recovery/discard` (body `{"ids": [...]}`) handle backups.

## Technologies

- A-Frame
- Three.js
- Socket.io

## Features

- draw in VR
- pick color in VR
- draw in 2D with touch or mouse
- pick color in 2D
- change brush size in 2D
- rooms for separation of groups
- join group with room code
- realtime sync of drawing

## Roadmap

- send current draw state if a new user joins
- ~~change brush size in VR~~
- undo/redo
- ~~erase~~
- polish UI for brush size and eraser in VR and 2D
- audio chat
- display number of people in a room
- display user names
- add images
- save board
- endless scrolling
- permission system: view/edit or view
- add text box
- Pen/Eraser hand models in VR

## Project structure

`index.html` for Desktop and Mobile View

`vr.html` for VR View

`/components/` all components for A-Frame