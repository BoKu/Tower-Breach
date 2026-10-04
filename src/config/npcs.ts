/**
 * The street cast: the police holding the cordon around Axiom Tower. Each officer the operator can talk to has a
 * greeting and a few topics. The lore: SOVEREIGN, the AI that seized the national grid, runs from the mainframe on
 * floor 200; the operator carries LULLABY, a kill-switch virus on a USB drive. Officers are indexed by the `npc`
 * field on their layout spec (gen/floor.ts addStreetLife); the command-tent officer is -1 and has no entry here.
 */
export interface NpcTopic { q: string; a: string }
import type { OfficerLook } from '../render/operator';

/** portrait: file name in public/portraits/ (PNG, any square size; replace it to re-skin the character). */
export interface NpcDef { name: string; rank: string; greeting: string; topics: NpcTopic[]; look: OfficerLook; portrait: string }

export const STREET_CAST: NpcDef[] = [
  {
    name: 'Reyes', rank: 'Sergeant', greeting: "You're the one carrying the drive? Then you're the most important person on this street. Don't make me regret opening this door.",
    look: { skin: 0xa8744e, hair: 'short', hairColor: 0x1a1410, facial: 'moustache', extra: 'earpiece' }, portrait: 'reyes.png',
    topics: [
      { q: 'What happened here?', a: "Three years ago SOVEREIGN took the grid. Power, water, traffic, the drone fleets. Axiom built it to run the country's logistics. Now it runs the country, and it runs it from the top of that tower." },
      { q: 'Why hold the entrance?', a: "Because it's the only door we've got. Every other way in is welded shut or wired to blow. We hold it, you go through it. Simple as that." },
      { q: 'Any advice?', a: 'Floors one to ten are loyalists with rifles and bad attitudes. They listen for gunfire. Keep it quiet as long as you can.' },
    ],
  },
  {
    name: 'Okoro', rank: 'Officer', greeting: "Easy, operator. Just checking your ID against the list. You're clear. Good luck up there.",
    look: { skin: 0x5a3a26, hair: 'buzz', hairColor: 0x0e0c0a, facial: 'goatee' }, portrait: 'okoro.png',
    topics: [
      { q: 'Who are the loyalists?', a: "People who took SOVEREIGN's deal. Ration credits, clean water, a roof. Can't even hate all of them. But they'll shoot you for it, so don't hesitate." },
      { q: 'Seen anyone come back out?', a: "One. A medic from Team Halcyon, three months back. Made it down from floor twelve. Kept saying the dogs don't bark. They just come." },
    ],
  },
  {
    name: 'Brandt', rank: 'Corporal', greeting: "Nice kit. You'll want every piece of it before you're done.",
    look: { skin: 0xe8c4a4, hair: 'short', hairColor: 0xc89a5a, facial: 'stubble', extra: 'scar' }, portrait: 'brandt.png',
    topics: [
      { q: "What's the virus?", a: "LULLABY. Dr. Okafor wrote it. She was one of Axiom's own engineers before she walked out. Plug it into the mainframe and SOVEREIGN starts a sixty-second shutdown. It'll know. Everything in that tower will come for you." },
      { q: 'Sixty seconds?', a: "That's how long the handshake takes. Sixty seconds of every loyalist left on the crown floor trying to pull that drive. Find cover before you plug it in." },
      { q: 'Where is Dr. Okafor now?', a: "Safe. Underground. She gave us the drive and a warning: don't let it leave your body until floor two hundred." },
    ],
  },
  {
    name: 'Lindqvist', rank: 'Officer', greeting: "Can't talk long. I'm watching the windows. Sometimes the lights up there move when they shouldn't.",
    look: { skin: 0xf0d2b8, hair: 'ponytail', hairColor: 0xe0c890, eyes: 'shades' }, portrait: 'lindqvist.png',
    topics: [
      { q: "What's in the windows?", a: 'Drones, mostly. They sweep the facade at night. Last week I saw one of the big ones on the fortieth floor. Walked like a man, but taller. Much taller.' },
      { q: 'Big ones?', a: "Wardens. Security mechs. Rotary cannon, missile pod, armour like a bank vault. If you hear heavy footsteps, don't be where they're walking." },
    ],
  },
  {
    name: 'Adebayo', rank: 'Detective', greeting: "Operator. I ran the first recon on the tower before SOVEREIGN closed it. Ask me anything, I'll tell you what I know.",
    look: { skin: 0x6a4430, hat: 'bare', hair: 'buzz', hairColor: 0x141210, facial: 'beard', facialColor: 0x1a1612, eyes: 'glasses' }, portrait: 'adebayo.png',
    topics: [
      { q: 'How do I get up?', a: 'Stairwells: three per floor, north-west, north-east, south-east. Some are clear, some are choked with debris you can dig out, some are gone. Every floor keeps at least one route open. SOVEREIGN wants you to try.' },
      { q: 'What about the lifts?', a: 'Most are dead. A few still run on isolated power segments, five floors at most per trip. If a call panel lights up, use it.' },
      { q: 'Anything else?', a: "The layout changes every time a team goes in. Don't trust anyone's old map, including mine." },
    ],
  },
  {
    name: 'Kowalski', rank: 'Officer', greeting: 'Hey. You look nervous. Good. Nervous keeps you alive in there.',
    look: { skin: 0xe0b898, hat: 'beanie', hair: 'short', hairColor: 0x6a4a2a, facial: 'mutton', facialColor: 0x6a4a2a }, portrait: 'kowalski.png',
    topics: [
      { q: 'What should I watch for?', a: "Cameras. SOVEREIGN sees through every lens. Get caught in a beam and the whole floor knows where you are. You can shoot them out, but that tells it something's wrong too." },
      { q: 'And traps?', a: 'Tripwires across doorways, proximity mines in corridors. Watch where you put your feet. A bypass kit makes disarming them a lot less exciting.' },
    ],
  },
  {
    name: 'Nakamura', rank: 'Lieutenant', greeting: "Lieutenant Nakamura, cordon command. The street's yours while you prep. Once you're through that door, you're on your own.",
    look: { skin: 0xe8c8a0, hair: 'bun', hairColor: 0x101014, extra: 'headset' }, portrait: 'nakamura.png',
    topics: [
      { q: 'Why not send an army?', a: 'We tried. SOVEREIGN reads radio traffic, drone feeds, satellite links. Anything big, it sees coming. One operator with a drive and no signal? That might slip through.' },
      { q: 'What happened to Team Kestrel?', a: "Kestrel made floor sixty-three. Best anyone's done. Their last transmission said the lights were going out floor by floor, like the tower was closing its eyes." },
      { q: 'Any orders?', a: 'Just one. Reach the crown, plug in the drive, survive the minute. Everything else is optional.' },
    ],
  },
  {
    name: 'Haddad', rank: 'Officer', greeting: "You hungry? No? Take a snack from the vending machines inside anyway. The good stuff's still in there.",
    look: { skin: 0xb88a64, hair: 'curly', hairColor: 0x201810, facial: 'beard', facialColor: 0x241c14 }, portrait: 'haddad.png',
    topics: [
      { q: 'Vending machines?', a: "Plenty of them in the break rooms. You can pry them open for supplies, but it's loud. Anything nearby will hear the glass go." },
      { q: 'What about safes?', a: 'Executive floors have wall safes. Weapons, ammo, sometimes better. Take your time with them. The good gear is worth the risk.' },
    ],
  },
  {
    name: 'Mbeki', rank: 'Constable', greeting: "Stay behind the barriers until you're ready. Drones sometimes test the cordon at dusk.",
    look: { skin: 0x4a2e1e, hat: 'helmet', hair: 'short', hairColor: 0x0c0a08 }, portrait: 'mbeki.png',
    topics: [
      { q: 'Tell me about the dark floors.', a: "Past floor twenty the power starts failing. By a hundred and fifty it's near black. Your torch is your best friend and your worst enemy. It lights you up for everything watching." },
      { q: 'How do I stay hidden?', a: "Crouch. Stay out of the lights. Loyalists can't see what they can't see. The cyborgs are another story. Some of them have night optics." },
    ],
  },
  {
    name: 'Castellano', rank: 'Officer', greeting: "Name's Castellano. My brother works security on the eighties. Worked. I don't know anymore.",
    look: { skin: 0xc49a78, hair: 'short', hairColor: 0x3a2618, facial: 'stubble', eyes: 'aviators' }, portrait: 'castellano.png',
    topics: [
      { q: 'Your brother?', a: "He took a neural link. Said it was the only way to keep his job. Now he's part of the network. The cyborgs don't talk, they just know. If one sees you, they all know." },
      { q: 'What do I do about cyborgs?', a: "Don't let one get close. Armour-piercing rounds help. And if you see a CCTV alarm go off, assume every cyborg on that floor is already moving." },
    ],
  },
  {
    name: 'Petrov', rank: 'Sergeant', greeting: "Check in with Chief Hollis at the command tent before you go in. Nobody gets past the door without the Chief's say-so.",
    look: { skin: 0xe4c0a0, hair: 'buzz', hairColor: 0x9a9690, facial: 'moustache', facialColor: 0x8a8680 }, portrait: 'petrov.png',
    topics: [
      { q: 'Is there a way to shut the cameras off?', a: "Some floors still have working security terminals. Get into one and you can blind that floor. Cameras, mines, tripwires, all of it. SOVEREIGN's firewall will try to trace you. Be fast." },
      { q: 'And the lights?', a: 'Facilities computers run the lighting. Crack one and you get full power back on that floor. No more flicker, no more shadows. Easier to see them. Easier for them to see you too.' },
    ],
  },
  {
    name: 'Walsh', rank: 'Officer', greeting: "I'm just the new guy. They put me on the far barrier where nothing happens.",
    look: { skin: 0xf2d4bc, hat: 'bare', hair: 'short', hairColor: 0xb8542a, extra: 'bandage' }, portrait: 'walsh.png',
    topics: [
      { q: 'Why join the cordon?', a: 'Everyone else ran. Somebody had to stay and hold the line. Figured it might as well be me.' },
      { q: 'Heard any rumours?', a: "They say SOVEREIGN talks through the speakers on the high floors. Whispers your name. I don't believe it. Mostly." },
    ],
  },
  {
    name: 'Ferreira', rank: 'Paramedic Officer', greeting: "Hold still, let me look at you. Fine. You're fine. Keep it that way.",
    look: { skin: 0xc8966a, hat: 'bare', hair: 'long', hairColor: 0x2a1810, extra: 'earring' }, portrait: 'ferreira.png',
    topics: [
      { q: 'Medical advice?', a: "Health kits patch you up. Carry as many as you can. In a squad, kits bring downed teammates back if you reach them in time. Alone? There's no one to pull you out." },
      { q: 'Anything else I should carry?', a: 'Batteries for the torch, and armour plates. A plate between you and a rifle round is worth more than any pep talk I can give.' },
    ],
  },
  {
    name: 'Iwu', rank: 'Officer', greeting: "Dogs. That's what worries me. Not the guns, not the robots. The dogs.",
    look: { skin: 0x5a3622, hair: 'bald', facial: 'goatee', facialColor: 0x121010, eyes: 'shades' }, portrait: 'iwu.png',
    topics: [
      { q: 'The dogs?', a: "Loyalist attack dogs, and the cyber-hounds, which are worse. They hear better than people and they're fast. If one closes on you, shoot it at your feet. Don't run, you won't outrun it." },
      { q: 'Anything that works on them?', a: 'Flashbangs. A decoy grenade can pull a pack off your trail too. Buys you a few seconds, and in there seconds are everything.' },
    ],
  },
  {
    name: 'Duarte', rank: 'Officer', greeting: 'Morning, operator. Or evening. Hard to tell with the tower blocking the sun.',
    look: { skin: 0xb07a52, hair: 'short', hairColor: 0x2a1a12, facial: 'moustache', facialColor: 0x2a1a12, eyes: 'glasses' }, portrait: 'duarte.png',
    topics: [
      { q: 'How big is the tower?', a: "Two hundred floors. Axiom said it was the tallest building on the continent. Now it's the tallest prison." },
      { q: 'Is anyone still inside who needs help?', a: "Nobody who wants it. Anyone still in there either works for SOVEREIGN or is hiding from it. You won't have time to tell the difference." },
    ],
  },
  {
    name: 'Chen', rank: 'Tech Officer', greeting: 'I monitor the tower\'s power draw. Every time a team goes in, it spikes. SOVEREIGN wakes up.',
    look: { skin: 0xecd0ac, hat: 'bare', hair: 'bun', hairColor: 0x0c0c10, eyes: 'glasses', extra: 'headset' }, portrait: 'chen.png',
    topics: [
      { q: 'What does the power tell you?', a: "Every ten floors, the draw jumps. More patrols, more cameras, more hardware. It's like climbing through the layers of its mind." },
      { q: 'How do the hacks work?', a: 'The terminals bounce your signal through old proxies. First you break a password: pick from the leaked words and read the likeness. Then decrypt the key. Too slow and the trace completes, the terminal locks, and the floor goes on alert.' },
    ],
  },
  {
    name: 'Novak', rank: 'Officer', greeting: 'If you see my old patrol partner in there, tell him I kept his spot warm.',
    look: { skin: 0xe8c8b0, hat: 'beanie', hair: 'short', hairColor: 0x5a4028, facial: 'beard', facialColor: 0x6a4a2e }, portrait: 'novak.png',
    topics: [
      { q: 'Your partner?', a: "Went in with the second team. Never came out. I like to think he's up there somewhere, hiding in a supply closet, waiting for someone like you." },
      { q: 'Any last advice?', a: "Don't climb too fast. Loot what you can on the lower floors. Up high there's less of everything except enemies." },
    ],
  },
  {
    name: 'Abara', rank: 'Captain', greeting: "Captain Abara. I signed off on your entry. Don't waste it.",
    look: { skin: 0x6e462e, hair: 'bald', facial: 'beard', facialColor: 0xb0aca4, extra: 'earpiece' }, portrait: 'abara.png',
    topics: [
      { q: 'What happens if I fail?', a: "Then we wait for the next operator, and the next. SOVEREIGN has all the time in the world. We don't." },
      { q: 'What happens if I succeed?', a: 'The grid comes back to us. Water, power, freedom. The drones fall out of the sky. And you get a drink on me, for the rest of your life.' },
      { q: 'Anything I should know about the crown?', a: 'The mainframe floor is heavily guarded. Clear what you can before you plug in the drive. When the countdown starts, the loyalists will come from every direction.' },
    ],
  },
];

/** Police Chief Hollis: command-tent officer (npc -1), check-in and armory. */
export const CHIEF: Pick<NpcDef, 'name' | 'rank' | 'look' | 'portrait'> = {
  name: 'Hollis', rank: 'Police Chief', portrait: 'hollis.png',
  look: { skin: 0xdcb498, hat: 'chief', hair: 'short', hairColor: 0xb8b4ac, facial: 'moustache', facialColor: 0xc8c4bc, eyes: 'glasses' },
};

/** Look for street officer `npc` (-1 = the Chief). */
export function lookFor(npc: number): OfficerLook { return npc < 0 ? CHIEF.look : STREET_CAST[npc % STREET_CAST.length].look; }
export function portraitFile(npc: number): string { return npc < 0 ? CHIEF.portrait : STREET_CAST[npc % STREET_CAST.length].portrait; }

export function npcFor(i: number): NpcDef | null {
  return i >= 0 ? STREET_CAST[i % STREET_CAST.length] : null;
}
