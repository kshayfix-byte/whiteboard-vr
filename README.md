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

- Each new whiteboard gets a temporary name like `Whiteboard_4821`. While you draw, the current board is shared live with everyone in the room (including people who join later), but it is only written to disk when you press **Save**.
- The first **Save** on a board asks for a name. Later saves keep that name. **Rename** changes it at any time.
- **Save all** saves every whiteboard in the room. It stays greyed out until each whiteboard has been named with its own Save button.
- **Saved boards** lists every saved board so you can reopen it in 2D or VR.
- **Export image** downloads the board as a PNG, in 2D (toolbar) and in VR (the green boxes left of the board, or the buttons in the top corner outside VR). There's also a **Rename** box in VR.
- Browsers can't show a text box inside a headset. So when a board needs a name (first Save or Rename in VR), the page leaves VR, shows the normal name box, and you press **VR** to go back in.
- Saved boards are JSON files in `./data` (change it with the `DATA_DIR` environment variable). Back up that folder to keep your boards.
- **Backup copy:** unsaved changes are also written every few seconds to `./data/drafts/`. If the server crashes or restarts, they come back on the board, marked "Unsaved changes recovered from backup", and you can Save them. The saved version only changes when you press Save. The backup is removed once everything is saved.
- `GET /api/boards` lists saved boards; `GET /api/boards/<room>` shows the whiteboards in a room and whether each one is named and saved.

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