# Whiteboard VR

![Banner](media/banner.jpg)

A web-bassed online whiteboard which is platform independent. Use VR, Desktop or Mobile. Share your ideas or educate your students.

## Demo

Video: [https://www.youtube.com/watch?v=YjOsA-EFc9I&feature=youtu.be](https://www.youtube.com/watch?v=YjOsA-EFc9I&feature=youtu.be)

## How to run locally

1. Clone the project `git clone https://github.com/marlon360/whiteboard-vr.git`
2. Navigate to directory `cd whiteboard-vr`
3. Install dependencies `npm install`
4. Build project `npm run build`
5. Start Webserver (with socket.io) `npm run start`. It serves `http://<your IP>:3000`. For VR headsets, run `npm run cert` once first: the server then also serves `https://<your IP>:3443` (accept the self-signed certificate warning once). Browsers only allow VR on https pages.
6. Open the whiteboard in your web browser. Once step 5 is running, the whiteboard works like a website that lives on your own computer:
   - **On the same computer:** open your web browser (Chrome, Edge, Firefox or Safari), type `http://localhost:3000` into the address bar at the top, and press Enter.
   - **On another device** (a phone, tablet, another laptop or a VR headset) connected to the same Wi-Fi: type `http://`, then your computer's IP address, then `:3000`. For example: `http://192.168.1.25:3000`.
   - **Finding your IP address:** this is the number that identifies your computer on your home or office network. On Windows, open Command Prompt, type `ipconfig` and look for "IPv4 Address". On a Mac, open System Settings > Wi-Fi, click **Details** next to your network, and look for "IP address".
   - **In a VR headset:** use `https://` and `:3443` instead, for example `https://192.168.1.25:3443`. The first time, the browser warns that the connection is not private. This is expected, because the security certificate was made on your own computer: choose **Advanced**, then continue to the site.
   - Everyone who opens the same address and room code sees the same whiteboard.

## Running on Steam Frame

VR mode on the Steam Frame needs a browser with WebXR support. To enable WebXR on the Steam Frame you need **SteamOS 0.5.7 or newer** (currently Beta) together with **Chromium 157 or newer**. With older versions the VR page only opens a fullscreen 3D view and can't enter VR.

Open the app on the headset at `https://<your IP>:3443` (run `npm run cert` once first, see step 5 above). Plain `http://` pages are not allowed to start VR.

## How to use guide: Saving, naming and export

Everything you draw is shared live with everyone in the same room, including people who join later. Here's how to keep your work, give it a name and take a copy with you.

### Saving your whiteboard

1. Press **Save**.
2. The first time, you're asked for a name. Type one (for example "Team plan") and confirm.
3. That's it. From now on the whiteboard **saves itself** a few seconds after every change, so you don't need to keep pressing Save. Pressing Save again simply saves straight away.

New whiteboards start with a temporary name like `Whiteboard_4821` until you save them.

### Renaming a whiteboard

Press **Rename** at any time and type the new name.

### Saving every whiteboard at once

**Save all** saves every whiteboard in the room in one go. It only works once every whiteboard has been given a name with its own **Save** button, so until then it's greyed out and tells you how many still need a name, for example "Save all (2 unnamed)".

### Opening a saved whiteboard later

Press **Saved boards** (on a phone, it's in the **☰ Options** menu). You'll see a list of every saved whiteboard. Pick one to open it on screen or in VR.

### Downloading a picture of your whiteboard

Press **Export image** to download the whiteboard as a picture (a PNG file) that you can share, print or keep. This works on the computer, phone and tablet, and in VR too.

### Naming a whiteboard while wearing a headset

A headset can't show a normal typing box inside VR. So when you press **Save** on a new whiteboard, or **Rename**, a small window with a name box pops up. Type the name and press **Save**. If the headset can't open that window, the page steps out of VR and shows the usual name box instead. When you're done, press **VR** to go back in.

### If something goes wrong: getting unsaved work back

Whiteboards that haven't been saved yet are backed up every few seconds. If the server stops before you save them (for example after a crash or a restart), the next time you open the app a list shows them by name and when they were last changed:

- Tick the ones you want, then press **Save selected** to save them straight away under the names shown.
- Or press **Restore and open** to bring them back without saving yet, and open them.
- **Restore all** brings back everything on the list, and **Discard selected** throws away the ones you ticked.
- Press **✎** next to a whiteboard to give it a new name first.

Closed the list by accident? Press **Restore unsaved** in the toolbar to bring it back.

## Technologies

- A-Frame
- Three.js
- Socket.io

## Features

### Drawing

- **Draw anywhere:** on a computer with a mouse, on a phone or tablet with your finger, or in a VR headset with the controllers. Everyone in the room sees each line as it's drawn.
- **Marker:** pick a colour and a pen size (5 to 50 px). In 2D, use the colour swatches and the **Brush size** slider. In VR, touch a colour disc on the tool panel and use the **+** / **−** pen size buttons.
- **Highlighter:** a see-through highlighter in five colours (yellow, green, pink, blue, orange) that sits under your marker lines, so writing stays readable. In 2D, choose **Highlighter**. In VR, press **Pen mode** to step through Dry erase (the marker), then each highlighter colour, and back to Dry erase.
- **Eraser** rubs out anything. **Erase highlights** rubs out only highlighter and leaves the marker lines alone.
- **Erase board** (2D) and **Erase board (x3)** (VR) wipe the whole whiteboard. To avoid accidents it needs three presses in a row, each within 3 seconds.
- Colour, pen size and eraser are shared by all whiteboards, and each pen remembers its own colour and size.

### Rooms and sharing

- **Rooms:** each group works in its own room with a room code. Share the code so others can join, or use **Join other room** to switch.
- **Late joiners see everything:** someone who joins later sees all the whiteboards exactly as they are.
- **Works everywhere:** desktop, phone, tablet and VR headsets. On a phone (or any window up to 800 px wide), the less-used toolbar buttons are in the **☰ Options** menu.
- **VR** in the toolbar opens the VR view, and **← 2D view** goes back.

### Multiple whiteboards

- A room can hold up to 50 whiteboards. **+ Add whiteboard** creates a new one for everyone in the room.
- **On screen (2D):** each whiteboard is a tab above the board. Click a tab to switch. Save, Rename, Export image and Erase board act on the open tab. The address bar includes the whiteboard, so a link opens that exact board.
- **In VR:** every whiteboard is in the scene. The first stays in front of you and new ones appear in a ring around you (left, right, then behind). The board you point at or draw on is the **selected** one, with an orange frame and `>` in its name tag, and the tool panel buttons act on it. **Next board** moves the selection on. Outside a headset, the drop-down in the top corner does the same.
- **Remove whiteboard** (2D) and **Remove board (x3)** (VR) take a whiteboard away for everyone. It needs three presses in a row, each within 3 seconds, and the button counts down ("Click 2 more times"). The last whiteboard in a room can't be removed. A copy of every removed whiteboard is kept in `./data/removed/`, so a mistake can be undone by hand.

### Board sizes and 360° boards

- **Board size:** choose a preset (Standard 1.5 × 1 m, Wide 3 × 1 m, Large 2.5 × 1.5 m, Wall 4 × 2 m, Tall 1 × 2 m) or type your own size (width 0.5 to 4 m, height 0.5 to 2.5 m). Drawings keep their size and stay in the middle. In 2D, press the **Size** button; in VR, the **Size** button steps through the presets. The size changes for everyone.
- **Zoom (2D):** **−**, **+** and **Fit** zoom the board on screen.
- **360° boards:** **+ Add 360° board** adds a round whiteboard that goes all the way around you. In VR, press **Go inside** to stand in the middle and **Step out** to leave. On screen, **◀ Turn** and **Turn ▶** spin the view and **Front** goes back to the front. 360° boards have a fixed size.

### Moving around in VR

- **Moving yourself:** the **Moving** button switches between two ways, and the headset remembers your choice. *Teleport* (the default): push a thumbstick forward, aim the arc and let go to jump there (a red arc means you can't land there). *Smooth*: the left thumbstick walks where you're looking. Either way, pushing a thumbstick left or right turns you 30 degrees. **Back to start** returns you to where you began. You can't go more than 25 m from the start.
- **Long reach:** the pointer reaches 12 m, so you can point at a far whiteboard and pull the trigger to draw on it. A ring shows where you'd draw. The **Reach** button switches to a short 20 cm marker that you touch to the board instead.

### Moving whiteboards

- **In VR:** hold the **grip** button and point at a whiteboard to grab it (pointing at nothing grabs the selected one). Its frame turns blue. Swing, raise or turn the controller to move it. Thumbstick forward or back pushes it away or pulls it closer, and left or right turns it. Let go to drop it. Everyone sees it move, and its place is saved with the board.
- **On a computer outside a headset:** **Move board** in the top corner opens a panel that slides the selected whiteboard left/right, up/down and closer/farther (25 cm steps), turns it (15° steps) or turns it to face you.
- **Reset position** puts a whiteboard back in its automatic spot.

### The VR tool panel

- All the VR buttons sit on one tilted panel in front of you. The **Panel** button chooses where it goes, and the headset remembers your choice:
  - *Follow* (the default): it glides back in front of you when you turn away (more than 30 degrees for a moment) or move more than 1 m. It stays still while you're drawing, pressing a button, holding a board or pointing at it.
  - *Wrist*: a smaller copy rides above your left hand. Point at it with the right controller.
  - *Stay*: it stays where you left it.
- Hold **grip** on the panel's handle to carry it somewhere else, and let go to leave it there.
- **B** or **Y** (the menu button on other controllers) brings the panel in front of you.
- Panel buttons are pressed with the trigger. Buttons light up orange when you point at them and flash when pressed. Problems show as red messages on the panel.

### Saving and export

- Save, name, rename, autosave, Save all, saved board list, PNG export and backup and restore. See the [How to use guide](#how-to-use-guide-saving-naming-and-export) above.
- Saved boards are files in `./data` (change it with the `DATA_DIR` environment variable). Back up that folder to keep your boards. If a backup can't go back to its old spot because that board has content, it comes back as an extra whiteboard in the same room.
- For developers: `GET /api/boards` lists saved boards. `GET /api/boards/<room>` shows the whiteboards in a room. `GET /api/recovery`, `POST /api/recovery/restore` and `POST /api/recovery/discard` (body `{"ids": [...]}`) handle backups.

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