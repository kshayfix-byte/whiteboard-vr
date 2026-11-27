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

## Saved boards and export

- Every room's board is saved on the server as you draw, so people who join later (or come back after a restart) see everything that's already there.
- Boards are stored as JSON files in `./data` (change it with the `DATA_DIR` environment variable). Back up that folder to keep your boards.
- **Name board** gives the current board a name; **Saved boards** lists every saved board so you can reopen it in 2D or VR.
- **Export image** downloads the board as a PNG, in 2D (toolbar) and in VR (the green box above the eraser, or the button in the corner outside VR).
- `GET /api/boards` lists saved boards; `GET /api/boards/<room>` returns one board's data.

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