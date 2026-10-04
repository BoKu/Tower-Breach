# TOWER BREACH: developer guide

How to build, run, test, package and modify the game. For how to play, see the [player manual](MANUAL.md).

- [Requirements](#requirements)
- [Running locally](#running-locally)
- [Playing co-op online](#playing-co-op-online)
- [Developer test URLs](#developer-test-urls)
- [Desktop builds](#desktop-builds)
- [How the systems fit together](#how-the-systems-fit-together)
- [Asset pipeline](#asset-pipeline)
- [Look and feel](#look-and-feel)
- [Modding: NPC portraits](#modding-npc-portraits)
- [Assumptions and design decisions](#assumptions-and-design-decisions)
- [Project records](#project-records)

## Requirements

- Node.js 18 or later. The test suite needs Node 22 or later because it uses the built-in WebSocket client.
- A current desktop browser (Chrome, Edge, Firefox or Safari) on macOS, Windows or Linux.

## Running locally

```bash
npm install

# Single player, development
npm run dev              # http://localhost:5173

# Co-op, development: run the relay in a second terminal
npm run relay            # WebSocket relay on :8787 (the dev server proxies /ws to it)

# Production: build once, then one server hosts both the game and the relay
npm run build
npm start                # http://localhost:8080  (PORT=xxxx to change)

npm test                 # headless tests: generation, simulation, AI, combat, networking
npm run typecheck        # tsc --noEmit
```

## Playing co-op online

**Easiest: `npm run online`.** This builds the game, starts the server and opens a free Cloudflare quick tunnel. The
first time, it offers to install `cloudflared` with Homebrew. It prints a public `https://….trycloudflare.com` link
and copies it to the clipboard. Share the link, everyone opens it, and one player hosts. Ctrl+C stops everything. You
get a new link each run. Use `npm run online -- 8090` for another port.

Alternatively, run `npm start` on a machine your friends can reach, or behind a reverse proxy with WebSocket support.
Everyone opens that URL. One player hosts and shares the 5-letter code. The **Server** field on the co-op screen can
point to any relay (`wss://your-host/ws`).

## Developer test URLs

Append these to the game URL. They work in single player only.

| Parameter | Effect |
|---|---|
| `?dev=1` | Skip the menus and start a run with a test loadout |
| `&floor=N` | Start on floor N (0 = street, 200 = mainframe) |
| `&floor=sandbox` | Asset sandbox: every character, animal, weapon, gear and prop model on a labelled grid in all its poses and orientations, plus CCTV, traps, hazards, vending, light types and stair conditions. Two hack terminals (security and lighting) stand at the west end. No AI, no saving; the god, ammo and torch cheats are on |
| `&floor=sandbox-xmas`, `sandbox-easter`, `sandbox-halloween` | The same sandbox with every model dressed for that holiday. Models that keep their default look are left out (weapons, CCTV, traps, pipes, couches, chairs, monitors, plant-room machinery and so on) |
| `?holiday=xmas\|easter\|halloween\|none` | Force a holiday theme, or none, in any game including normal play, e.g. `localhost:5173/?holiday=halloween` |
| `&diff=hard` / `insane` | Difficulty |
| `&torch=1` | Torch on, and the battery never drains |
| `&god=1` | Take no damage |
| `&ammo=1` | Magazines and grenades never run out |
| `&q=low` / `high` / `ultra` | Graphics preset |
| `?dev=portraits` | Render the procedural 3D officer portraits with download links |

Example: `http://localhost:5173/?dev=1&floor=150&god=1&ammo=1&torch=1`

Live games use a holiday theme automatically on the holiday and the 3 days before it, going by the device's date
(`src/config/holiday.ts`). Halloween (`src/render/halloween.ts`) and Christmas (`src/render/christmas.ts`) are built.
Easter is on the calendar, but has no models yet.

## Desktop builds

The desktop app is an Electron shell (`desktop/main.cjs`) around the production build. It is single player: Co-op is
hidden because there is no relay server, and saves live in the app's own storage.

| Command | Output (in `release/`) |
|---|---|
| `npm run dist:win` | `Tower Breach Setup <version>.exe` (installer) and `TowerBreach-<version>-portable.exe` (runs without installing). Also works from macOS |
| `npm run dist:mac` | `TowerBreach-<version>-x64.dmg` (Intel) and `TowerBreach-<version>-arm64.dmg` (Apple Silicon) |
| `npm run dist:linux` | `tower-breach_<version>_amd64.deb` for Debian/Ubuntu (`sudo apt install ./tower-breach_<version>_amd64.deb`) |
| `npm run desktop` | Builds the game and opens it in Electron locally. Run `npx install-electron` once first |

- The builds are unsigned. Windows SmartScreen warns on first run ("More info" → "Run anyway"). On macOS,
  right-click the app and choose Open the first time.
- To use a custom Windows icon, add `"icon": "build/icon.ico"` under `build.win` in `package.json` and change
  `signAndEditExecutable` to `true`. On a Mac, that step needs Wine.

## How the systems fit together

```
Input (kb/mouse/gamepad) ─► PlayerInput ─► Sim.tick (60 Hz, pure TS, authoritative)
                                             │  players · AI · combat · CCTV · traps · loot · objective
                                             ▼
                                        SimEvents + state ─► Renderer (Three.js) · HUD/minimap (DOM) · Audio (WebAudio)

Co-op: host browser runs the Sim ─► 15 Hz floor-scoped snapshots + events ─► relay ─► clients (ClientView)
       clients ─► inputs + predicted own position (30 Hz) ─► relay ─► host validates and applies
```

- **`src/gen`: deterministic generation.**
  - `BuildingPlan(seed)` sets every floor's stair conditions and elevator power across all 200 floors. It guarantees
    a route up from every floor.
  - `generateFloor(plan, n)` builds each floor in this order:
    1. A layout from a spine corridor, BSP room blocks and 14 authored room modules.
    2. Fixed stairwells and lifts, then connectivity repair.
    3. Furniture, placed so that it never cuts off walkable space.
    4. Lights, CCTV, traps, hazards and encounter squads, scaled by `pressure()`.
  - Every client regenerates the same floors from the shared seed.
- **`src/sim`:** the whole game, with no DOM or Three.js. It is fully unit-tested.
- **`src/render`:**
  - the floor mesh builder and the wall cutaway shader
  - procedural character rigs
  - particle, tracer and decal effects
  - a pool of real lights, assigned to the brightest nearby lamps
  - torch spotlights
- **`src/audio`:** a synthesiser for gunshots, formant "voices", footsteps per surface, ambience and stingers, plus
  HRTF panning and reverb.
- **`src/net` + `server/server.mjs`:** WebSocket relay rooms, the host session, and the client mirror and prediction.

## Asset pipeline

There are no asset files for models, textures or effects. Everything is built on startup:

- **Textures:** `src/render/textures.ts` draws these on canvases: carpet, tile, concrete, metal, asphalt, wall,
  facade, wood, blood, scorch and hazard textures.
- **Models:** `src/render/models.ts` builds props and characters from primitives with vertex colours. They are merged
  into a few draw calls per floor.
- **Audio:** `src/audio/synth.ts` and `src/audio/audio.ts` synthesise every sound effect and music cue live, using
  noise buffers, oscillators, formant filters and convolution reverb. `src/audio/soundscape.ts` runs the ambience:
  - Random event timers drive the ambience, so it never audibly loops. The background beds are noise buffers of
    about 20 seconds with slow LFOs.
  - **Street:** a real binaural recording of a busy city street, `public/audio/street.mp3` ("citystreet3" by
    sagetyrtle, CC0; see `public/audio/CREDITS.txt`).
    - It loops about every 2½ minutes. The first 35 s are skipped and the end is cross-faded into the start, so
      there is no seam.
    - Synth events play on top: an aeroplane overhead about every 70 to 120 s, a distant train, sirens, police radios,
      horns, bus air brakes, dogs, a jackhammer and birds.
    - Modders can replace the file. If it is missing, the game falls back to a soft synth traffic wash with no low hum.
  - **Tower:** creaking hinges, doors that open and sometimes slam, a breathy whisper close by, drips, electrical
    sparks, distant footsteps, impacts and groans. Sometimes there are 7 to 13 s of eerie silence, when the floor
    fades almost to nothing.
  - **Elevators:** standing in a powered car plays tinny, slightly out-of-tune bossa-nova muzak on the music bus, and
    muffles the floor ambience while you ride. Dead cars stay silent.
  - **Main menu:** a 90s acid-techno loop inspired by the *Hackers* soundtrack (`src/audio/menuMusic.ts`).
    - It runs 16 bars at 132 bpm (29 s): a kick, claps, hats, a 303-style bassline, a delayed arp, a pad, and a
      breakdown with a riser.
    - It is rendered once into a buffer and looped sample-accurately. The lead-in tails are baked in, so the seam is
      inaudible.

## Look and feel

The UI is styled as a Japanese-cyberpunk field terminal:

- cyan holographic frames with chamfered corners and notched accent bars, in pure CSS
- vertical Japanese labels on panel edges
- kanji sub-labels

The font is Chakra Petch (SIL Open Font License 1.1, bundled locally through `@fontsource/chakra-petch`). Kanji use the
system Japanese font.

## Modding: NPC portraits

Officer portraits are PNG files in `public/portraits/`. They are 512×512 and copied to `dist/portraits/` on build.

- **Replacing a portrait:** save your own square PNG under the same file name, and the game uses it in the chat
  window. If a file is missing, the game falls back to a live 3D render of that officer.
- **Regenerating a portrait:** the shipped portraits were generated with an AI image model (Gemini,
  `gemini-3-pro-image`), each from a description of that officer's look in `src/config/npcs.ts`.
- **Using the 3D renders:** `?dev=portraits` renders the procedural 3D versions with download links. Save those over
  the files to replace the photo portraits.

## Assumptions and design decisions

- **Team colours:** there are four colours (blue, green, yellow, purple) for up to five players. Colours are assigned
  relative to each viewer: you are white, and your four teammates get the four colours. Red is used only for enemy
  markers.
- **Networking:** the host is authoritative and clients predict their own movement. The relay only routes messages.
  If the host leaves, the run ends for everyone. A player who disconnects can rejoin with the same callsign and gets
  their operator back.
- **Saving:** single player autosaves on every floor change. Resuming regenerates the current floor's enemies, but
  keeps the inventory and run state. The pause menu has two ways out:
  - **Save & quit to menu** saves where you stand.
  - **Quit to menu without saving** asks you to confirm, then leaves without saving, so Continue resumes from the
    last autosave.
- **Armory:** the categories mirror a modern counter-terror buy menu, with original names, stats and descriptions:
  - pistols, heavy pistols, SMGs, shotguns, rifles, marksman rifles and machine guns
  - kevlar and helmet
  - frag, flash, smoke, incendiary and decoy grenades
  - a defusal-style bypass kit

  You buy only before deployment. After that you scavenge.
