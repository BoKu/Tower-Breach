<p align="center">
  <img src="docs/screenshots/banner.jpg" alt="TOWER BREACH" width="100%">
</p>

<p align="center">
  <b>Two hundred floors between you and the mainframe.</b><br>
  An isometric co-op tactical survival game for the desktop and the browser.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/download-latest%20release-29d3ff?style=for-the-badge" alt="Download"></a>
  <img src="https://img.shields.io/badge/status-BETA-ff9f1a?style=for-the-badge" alt="Status: beta">
  <img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux">
  <br>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/three.js-000000?style=flat-square&logo=threedotjs&logoColor=white" alt="three.js">
  <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/co--op-up%20to%205-ff3a8c?style=flat-square" alt="Co-op up to 5">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License: AGPL-3.0"></a>
</p>

---

> [!WARNING]
> **Tower Breach is in BETA.** It's playable from the street to the crown, but expect bugs, balance changes and the
> odd rough edge, especially in online co-op and voice chat, which are new. Saves and settings may not carry over
> between beta versions, and co-op players and the server must all run **exactly the same version** (the server
> refuses any other release and says which versions don't match). Found a problem? Please
> [open an issue](../../issues) with your OS, the version shown on the main menu, and what happened.

Three years ago an AI called **SOVEREIGN** took the grid. It runs the country from the top of a 200-floor tower.
You carry **LULLABY**, a kill-switch virus on a USB drive. Fight, sneak and hack your way up, floor by floor, then
plug it into the mainframe. That starts a 60-second shutdown, and everything left in the tower comes for you.

You get one life. Each run is a new tower. You can go in alone, with up to four AI squadmates, or with up to four
friends.

<p align="center"><img src="docs/screenshots/firefight.jpg" alt="A firefight on floor 12" width="100%"></p>

## Features

- 🏢 **200 generated floors.** Each run builds a new tower of offices, boardrooms, kitchens, plant rooms and
  stairwells. The enemies, traps and darkness get worse every 10 floors.
- 🥷 **Stealth or a firefight.** Light, noise, stance and line of sight all matter. Crouch in the dark, kill the
  lights, take someone out with a backstab, or go loud.
- 🔦 **Darkness.** From floor 20 each floor gets darker. Your gun torch shows you traps, and it also shows the enemy
  where you are.
- 🤖 **Six enemy types:** loyalists, attack dogs, patrol drones, cyborgs, cyber-hounds and Warden mechs. The machines
  share an AI network and respond to each other's alarms.
- 💻 **Hacking.** Beat three random puzzles before the trace finishes. Security terminals throw password cracking,
  byte decrypting, camera sequences, signal jamming and keypad code-breaking at you. Lighting terminals throw wiring,
  breakers, circuit routing, voltage calibration and load balancing. A security terminal kills the cameras and traps
  on its floor. A lighting terminal brings the lights back.
- 🪜 **A route up.** Stairwells can be on fire, full of debris or collapsed, and only some lifts have power. Every
  floor has at least one way up.
- 🚪 **Doors and master keys.** Some doorways have doors you can open, shut and lock. Each floor hides one master
  key that opens its locked rooms, and lets you lock a door behind you. Enemies open doors but can't pass a locked
  one.
- 🪙 **Coins and vending machines.** Collect coins from desks and safes, and buy drinks and snacks quietly from
  vending machines instead of smashing them open.
- 🛒 **Armory.** Spend your budget on 22 guns, armour, five grenade types and gear. After that, you only have what
  you find on the way up.
- 🎯 **Weapon roles.** Every gun class has a job: pistols land double-damage sneak shots and take a Suppressor
  (as do SMGs), shotguns stagger and one-shot dogs, sniper rounds pierce two enemies, machine guns pin enemies down.
- 🎨 **Your operator, your look.** Pick a skin tone, a uniform colour, a camo pattern (woodland, desert digital,
  urban, tiger stripe) and an optional balaclava in the armory, with a live 3D preview. Your squad sees it too.
- 🪖 **AI squad (single player).** Take up to four squadmates, each with a class: Rifleman, Breacher, Gunner,
  Commando, Marksman, Grenadier, Medic or Recon. They follow you floor to floor, fight to their class, heal, and
  revive you (you go down instead of dying while one is standing). Each run gives them a new name and rank.
- 🏆 **Points and a speedrun clock.** Score for new floors, speed, kills (double for knife kills), accuracy, hacks and
  searches, plus a bonus for the upload. A discreet `hh:mm:ss.ssss` clock starts at the tower door. Every run, won or
  lost, goes into the Hall of Records, with a top-score board and a fastest board.
- 🎬 **End credits.** Win and the story closes with a credits roll, its own closing theme, and a post-credits scene.
- 👥 **Co-op for up to 5.** Cross-play between the desktop app and the browser, proximity voice chat, and revives
  with a Health Kit. Friendly fire is optional.
- ✨ **Lighting and reflections.** Every lamp casts its own coloured light, mirrors show you and the enemy, and an
  optional ray-traced mode adds a sheen to floors and the street.
- 🎃 **Holiday themes.** Halloween, Christmas and Easter versions of the street and the tower.
- 🖼️ **Wall posters you can swap.** Drop any `.jpg` into `public/posters/` (up to 512 × 512; transparency shows
  black) and it turns up on the tower's walls. In the desktop app that folder sits next to the app (`resources/app.asar.unpacked/dist/posters`).
- 🎛️ **Everything else is generated in code.** All models, textures, animations, sound effects and music. The
  exceptions: the street ambience is a recording, and the character portraits and the squad's radio voices were made
  with generative tools.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/street.jpg" alt="The street"><br><sub><b>The street.</b> Check in with Police Chief Hollis and gear up, then breach the Axiom Tower entrance.</sub></td>
    <td width="50%"><img src="docs/screenshots/dark-floor.jpg" alt="Dark floor"><br><sub><b>Floor 160.</b> A cyborg in the torch beam. Darkness here is 39%.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/hacking.jpg" alt="Hacking"><br><sub><b>Uplink.</b> Beat three puzzles before the trace reaches 100%. Here: route power to the bulb on a lighting terminal.</sub></td>
    <td><img src="docs/screenshots/armory.jpg" alt="Armory"><br><sub><b>The armory.</b> Every weapon class has a role. Your budget depends on the difficulty.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/stairwell.jpg" alt="Stairwell"><br><sub><b>Stairwells.</b> Walk up the steps to reach the next floor. Debris has to be cleared first.</sub></td>
    <td><img src="docs/screenshots/mainframe.jpg" alt="Mainframe"><br><sub><b>Floor 200.</b> Hold the mainframe for 60 seconds while SOVEREIGN shuts down.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/appearance.jpg" alt="Appearance"><br><sub><b>Appearance.</b> Skin tone, uniform colour, camo and a balaclava, with a live preview. Your squad sees it too.</sub></td>
    <td><img src="docs/screenshots/doors.jpg" alt="Doors"><br><sub><b>Doors.</b> Shut one to break line of sight. A red light means it's locked: find the floor's master key.</sub></td>
  </tr>
</table>

## Download and play

Get the latest build from **[Releases](../../releases/latest)**:

| Platform | File | First run |
|---|---|---|
| **Windows** | `Tower Breach Setup <version>.exe` (installer) or `TowerBreach-<version>-portable.exe` (no install) | The build is unsigned. If SmartScreen appears, click **More info → Run anyway**. |
| **macOS** | `TowerBreach-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) | Drag the app to Applications. The first time, **right-click the app → Open**. |
| **Linux** (Debian/Ubuntu) | `tower-breach_<version>_amd64.deb` | `sudo apt install ./tower-breach_*.deb` |
| **Co-op server** (optional) | `towerbreach-server-windows-x64.exe`, `-macos-arm64`, `-macos-x64` or `-linux-x64` | Only the person hosting needs it. See **[docs/HOSTING.md](docs/HOSTING.md)**. |

**Co-op with cross-play.** Someone runs the **dedicated server**: a single download for Windows, macOS or Linux
(`towerbreach-server-<os>`), or a small VPS. Friends join it from the **desktop app on any OS** (Co-op → server
address → **Join server**), or from a **browser** by opening `http://<server>:8787` (`https://` if the server has a
certificate or a tunnel). Both kinds of player can be in the same squad. The server runs the game itself, so the run
carries on when anyone leaves, and they can rejoin with the same callsign. Late friends can still join while the squad is on the street; once someone enters the tower the
squad is locked. Squadmates on the same floor and close by can talk with **proximity voice chat** (push-to-talk,
routed through the server). It works in the desktop app with no setup. Browsers only allow voice chat on `https://`
pages, so browser players need an https address: the Cloudflare tunnel (below) or a certificate (`--tls-cert` /
`--tls-key`).

**No port forwarding?** No problem. The server notices that friends can't reach it and opens a free Cloudflare
tunnel by itself, then prints a public `https://….trycloudflare.com` address. Friends just open it, and browser voice chat works too. The server's options (password,
difficulty, holiday theme, friendly fire and more), port forwarding and firewalls are all in
**[docs/HOSTING.md](docs/HOSTING.md)**. Browser players can also still host a squad in their own browser through the
relay (`npm start`, 5-letter codes). See the [co-op notes](docs/DEVELOPMENT.md#playing-co-op-online).

📖 **New to the game? Read the [player manual](docs/MANUAL.md).**

## Controls

| Action | Keyboard and mouse | Controller |
|---|---|---|
| Move | W A S D | Left stick |
| Aim / fire | Mouse / left click | Right stick / RT |
| Aim down sights | Right click (hold, or a quick click to lock the scope) | LT |
| Sprint (loud) | Left Ctrl | Left stick click |
| Crouch / sneak | Left Shift | Right stick click |
| Jump / vault / clear tripwires | Space | A |
| Reload | R | X |
| Knife | V | D-pad ← |
| Interact, loot, revive, clear stair debris, use lifts | E (tap or hold) | Y |
| Hotbar: weapons / belt items | 1–3 / 4–8, or the mouse wheel | LB / RB |
| Use selected belt item | C | D-pad ↓ |
| Drop a Health Kit (for a squadmate) | Q | B |
| Throw grenade / switch grenade | G / B | tap / hold D-pad → |
| Torch | T | D-pad ↑ |
| Pause | Esc | Menu |

The defaults follow Minecraft's (Ctrl sprints, Shift sneaks, Q drops, a 1–8 hotbar). In a web browser, sprint is
Shift and crouch is C, since browsers keep Ctrl for themselves. You can remap every key under
**Settings → Controls**. The [manual](docs/MANUAL.md#3-controls) lists every control.

## Holiday themes

Themes switch on automatically at **Halloween**, **Christmas** and **Easter**, on the day and the 3 days before each,
using your device's date. At Halloween the tower fills with zombies, skeleton dogs, bats and ogres. At Christmas the
street is under snow, the police wear Santa suits and the loyalists are armed elves. At Easter the street turns to
chocolate, the police cars are giant baskets, the police wear bunny suits and the enemies are dentists. Each theme has
its own lift music. In the browser build, add `?holiday=halloween`, `?holiday=xmas`, `?holiday=easter` or
`?holiday=none` to the URL to choose a theme.

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/halloween.jpg" alt="Halloween street"><br><sub><b>Halloween</b></sub></td>
    <td width="33%"><img src="docs/screenshots/christmas.jpg" alt="Christmas street"><br><sub><b>Christmas</b></sub></td>
    <td width="33%"><img src="docs/screenshots/easter.jpg" alt="Easter street"><br><sub><b>Easter</b></sub></td>
  </tr>
</table>

## Build from source

You need Node.js 18 or later (22 or later to run the tests).

```bash
npm install
npm run dev          # play at http://localhost:5173
npm run build        # production build into dist/
npm start            # game + co-op relay at http://localhost:8080
npm run server       # dedicated co-op server at http://localhost:8787 (after npm run build)
npm run server -- --holiday xmas --password secret   # server options go after the --
npm test             # headless test suite

npm run dist:win     # Windows installer + portable exe
npm run dist:mac     # macOS dmg (x64 + arm64)
npm run dist:linux   # Debian .deb
npm run dist:server  # dedicated server binaries for Windows, macOS (x64, arm64), Linux (needs Bun)
npx install-electron && npm run desktop   # run the desktop app locally
```

Options for `npm run server` go after `--`, otherwise npm keeps them for itself. A single option such as
`npm run server --holiday xmas` still works, and the server tells you the right command if it can't work out the rest.

`npm run online` starts a server with a public Cloudflare link you can share for co-op. Test URLs, the architecture,
the asset pipeline and modding notes are in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

## Credits

Design and development: BoKu.

Third-party components:

- [three.js](https://threejs.org) (MIT)
- [ws](https://github.com/websockets/ws) (MIT), used by the relay and the dedicated server
- [Bun](https://bun.sh) (MIT) compiles the standalone dedicated-server binaries and is included in them
- [cloudflared](https://github.com/cloudflare/cloudflared) (Apache-2.0), downloaded by the server only when it opens
  a tunnel
- Chakra Petch UI font (SIL Open Font License 1.1), via `@fontsource/chakra-petch`
- Street ambience: "citystreet3" by sagetyrtle (CC0 1.0). See [public/audio/CREDITS.txt](public/audio/CREDITS.txt).
- Wall posters: 50 photos and posters under CC BY 2.0, CC BY-SA 2.0, CC0 and the Public Domain Mark, cropped and
  resized. Every title, author, source and licence is in [public/posters/CREDITS.txt](public/posters/CREDITS.txt).

## License

Tower Breach is free software, licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE). If
you run a modified version as a network service (for example, the web build and relay), you must offer its source to
its users.
