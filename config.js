/* =====================================================================
   config.js  —  ALL the personal content for the game lives in here.
   You can edit this file freely without touching game.js.

   ---------------------------------------------------------------
   HOW TO ADD A NEW LANDMARK (using Google Maps)
   ---------------------------------------------------------------
   1. In Google Maps, right-click the exact spot (e.g. the front door).
   2. The first line of the menu is the coordinates, e.g.
         51.52470, -0.13390
      Click it — that copies it to your clipboard.
   3. Copy one of the landmark blocks below (from { to },) and paste
      it at the end of the `landmarks` list.
   4. Paste the numbers in: the FIRST number is `lat`, the SECOND is `lng`.
   5. Give it a unique `id`, a `name`, a `sprite` type (list below),
      a `tag` and your `notes`.
   6. Save, then reload index.html. The game places it on the map
      automatically (and nudges it if it would overlap something).

   Sprite types you can use (each has its own pixel building + icon):
     "home"                 house icon
     "tube"                 train icon      (add `station:` to join the tube network)
     "big station"          train icon
     "campus"               graduation cap
     "library tower"        open book
     "cinema"               film strip
     "karaoke"              microphone
     "supermarket"          shopping trolley
     "restaurant"           fork & spoon
     "climbing gym"         mountain
     "garden square"        tree
     "neighbourhood marker" map pin
     "cafe"                 coffee cup

   Tags: "last year", "this year", "always"
     ("last year" places get a teal marker so the move from
      Holloway to Euston is easy to see.)

   `sign` is the short text written on the building's pixel sign
   (max ~10 letters, A–Z, 0–9, space, . - ' &).

   `station` (tube landmarks only) links the landmark to a real tube
   station so you can ride the network from it. Valid ids are listed
   in game.js under "STATIONS" (e.g. "warren-street", "angel").

   `notes` is a list of pages. Each "..." is one page of the dialog box.

   SEARCH FOR:
     PLACEHOLDER  -> notes/letter text you still want to rewrite
     CHECK        -> names/places I'd like you to confirm
   ===================================================================== */

window.CONFIG = {

  // ------------------------------------------------------------------
  // Names
  // ------------------------------------------------------------------
  myName: "Safwan",
  herName: "Edriana",

  // Title screen text
  songTitle: "Here, There and Everywhere",
  subtitle: "a little map of my London, made for Edriana",

  // Used for the live distance + clocks on the title screen / HUD
  places: {
    london: { label: "London",       lat: 51.5246, lng: -0.1340, timeZone: "Europe/London" },
    kl:     { label: "Kuala Lumpur", lat: 3.1390,  lng: 101.6869, timeZone: "Asia/Kuala_Lumpur" }
  },

  // ------------------------------------------------------------------
  // Character colours (hex colours). hairLength: "short" or "long"
  // ------------------------------------------------------------------
  characters: {
    me: {
      hair:   "#1c1714",
      skin:   "#c99272",   // same as Edriana
      top:    "#2e4a7d",
      bottom: "#3a3a46",
      shoes:  "#1d1d22",
      hairLength: "short"
    },
    her: {
      hair:   "#4a2e1e",
      hairTip: "#8a5a36",   // lighter ends of her long hair (optional)
      skin:   "#c99272",
      top:    "#e77fa3",
      bottom: "#f3e3c3",
      shoes:  "#7a4a3a",
      hairLength: "long"
    }
  },

  // ------------------------------------------------------------------
  // WARDROBE — the "OUTFITS" button on the title screen.
  // Each outfit can set:
  //   top, bottom, shoes  colours
  //   sleeves  "short" | "long" | "none" (sleeveless)
  //   collar   a colour for a shirt / polo collar (optional)
  //   buttons  true for a button-down shirt (little buttons down the front)
  //   pattern  "stripes" | "plaid" | "batik" | "floral" | "lace" | "flag" (optional)
  //   top2, top3  extra colours used by the pattern
  // Accessories: "none", "bucket hat", "sunglasses", "bandana", "backpack",
  //   "shoulder bag", "necklace", "apron"
  // (Inspired by the photos in Outfit_reference — the photos themselves are not used.)
  // ------------------------------------------------------------------
  outfits: {
    me: [
      { name: "Black tee",        top: "#232326", bottom: "#3a3a46", shoes: "#1d1d22", sleeves: "short" },
      { name: "Waterfall hike",   top: "#202024", bottom: "#2f3338", shoes: "#3a3a40", sleeves: "short", acc: "bucket hat" },
      { name: "Striped shirt",    top: "#e9f1fa", top2: "#9cbbe0", pattern: "stripes", collar: "#ffffff", bottom: "#2f3a52", shoes: "#1d1d22", sleeves: "short" },
      { name: "Maroon polo",      top: "#4a1d1d", collar: "#3a1414", bottom: "#2b2b30", shoes: "#1d1d22", sleeves: "short" },
      { name: "Navy knit polo",   top: "#1f2a44", collar: "#f4f1ea", bottom: "#3a3a46", shoes: "#1d1d22", sleeves: "short", acc: "apron" },
      { name: "Night drive",      top: "#1d2b2b", bottom: "#2b2b30", shoes: "#1d1d22", sleeves: "long", acc: "necklace" },
      { name: "Lilac check shirt", top: "#ffffff", top2: "#b8b2ea", top3: "#a9c6ee", pattern: "plaid", collar: "#ffffff", buttons: true, bottom: "#3a3a46", shoes: "#1d1d22", sleeves: "long" },
      { name: "Cream stripe shirt", top: "#efe2c6", top2: "#ffffff", pattern: "stripes", collar: "#fff8ea", buttons: true, bottom: "#3a3a46", shoes: "#1d1d22", sleeves: "long" },
      { name: "Long sleeve tee",  top: "#9aa0a8", bottom: "#2f3a52", shoes: "#1d1d22", sleeves: "long" }
    ],
    her: [
      { name: "Teal blouse",      top: "#1f9a94", top2: "#4fc3bb", bottom: "#2e3a55", shoes: "#3a2a24", sleeves: "short", acc: "shoulder bag" },
      { name: "Waterfall day",    top: "#cfeee6", bottom: "#3a4a5a", shoes: "#f4f1ea", sleeves: "long", acc: "backpack" },
      { name: "London tee",       top: "#1d1d26", pattern: "flag", bottom: "#2e3a55", shoes: "#f4f1ea", sleeves: "short", acc: "necklace" },
      { name: "Black cami",       top: "#1b1a1f", bottom: "#2b2b30", shoes: "#3a2a24", sleeves: "none", acc: "necklace" },
      { name: "Blue shirt",       top: "#1f4f7a", collar: "#2a5f8f", bottom: "#2b2b30", shoes: "#1d1d22", sleeves: "long" },
      { name: "Plaid top",        top: "#c3c8cc", top2: "#d9a0a8", top3: "#7f9aa8", pattern: "plaid", collar: "#d3d8dc", bottom: "#3a3a46", shoes: "#f4f1ea", sleeves: "none" },
      { name: "Batik blouse",     top: "#7a7a3a", top2: "#c8402e", top3: "#e8c060", pattern: "batik", bottom: "#2e3a55", shoes: "#3a2a24", sleeves: "short", acc: "bandana" },
      { name: "White lace",       top: "#f6eaea", top2: "#ffffff", pattern: "lace", bottom: "#f2e6e0", shoes: "#d9b8a8", sleeves: "long", acc: "apron" },
      { name: "Olive cardigan",   top: "#4a5636", top2: "#c9a46a", pattern: "floral", bottom: "#2b2b30", shoes: "#3a2a24", sleeves: "long", acc: "necklace" }
    ]
  },

  // ------------------------------------------------------------------
  // Map settings
  // ------------------------------------------------------------------
  map: {
    // The real-world rectangle the game map covers.
    north: 51.5625,
    south: 51.5070,
    west:  -0.1960,
    east:  -0.0980,
    // Size of the map in 16x16 tiles
    widthTiles: 200,
    heightTiles: 162,
    // Random seed for the procedural buildings/trees (change for a new look)
    seed: 1105
  },

  // "Bloomsbury stretch": magnifies the dense area around Euston /
  // Bloomsbury so landmarks never sit on top of each other.
  //   lat/lng   = centre of the magnified area
  //   radiusKm  = how far the effect reaches (outside it, nothing moves)
  //   strength  = how much the centre is magnified (1 = off, keep below 4)
  stretch: {
    lat: 51.5245,
    lng: -0.1320,
    radiusKm: 2.4,
    strength: 2.4
  },

  // ------------------------------------------------------------------
  // MUSIC  (files live in the music/ folder)
  //   opening: plays as soon as the game opens
  //   shuffle: plays in random order while she explores (every song plays once
  //            before any repeats, and never the same song twice in a row)
  //   ending:  plays on the letter screen when all the love is collected
  // `file` must match the file name exactly; `title` is what Settings shows.
  // `start` (optional) skips that many seconds at the beginning of a song.
  // Missing files are skipped silently, so the game never breaks.
  // ------------------------------------------------------------------
  music: {
    opening: { file: "music/The Beatles - Here, There and Everywhere (piano cover) - Roman's piano channel.mp3",
               title: "Here, There and Everywhere (Piano) - Roman's Piano", start: 6 },
    ending:  { file: "music/The Beatles - Here, There and Everywhere - TheBeatlesVEVO.mp3",
               title: "Here, There and Everywhere - The Beatles" },
    shuffle: [
      { file: "music/Amore mio aiutami (Main Theme) - Piero Piccioni.mp3",                  title: "Amore Mio Aiutami - Piero Piccioni" },
      { file: "music/Lady Love - Piero Piccioni.mp3",                                       title: "Lady Love - Piero Piccioni" },
      { file: "music/L'amore dice ciao (Slow Take) - Armando Trovajoli.mp3",                title: "L'amore Dice Ciao - Armando Trovajoli" },
      { file: "music/To Freedom - Ruiqi Zhao.mp3",                                          title: "To Freedom - Ruiqi Zhao" },
      { file: "music/American strings - Piero Piccioni.mp3",                                title: "American Strings - Piero Piccioni" },
      { file: "music/The Beatles - Here, There and Everywhere (piano cover) - Roman's piano channel.mp3",
        title: "Here, There and Everywhere (Piano) - Roman's Piano", start: 6 }
    ]
  },

  // Walking speed in tiles per second (roadSpeed is used on main roads)
  walkSpeed: 3.4,
  roadSpeed: 4,
  // Speed of the 29 bus you ride (tiles per second)
  busSpeed: 6,

  // When a trip would take longer than this many real-life minutes on
  // foot, the game asks: walk, tube or bus?
  travelMenuMinutes: 20,

  // Force day or night for testing: null (real London time), "day" or "night"
  timeOverride: null,

  // Faded area names painted on the ground
  areaLabels: [
    { name: "CAMDEN TOWN", lat: 51.5405, lng: -0.1395 },
    { name: "BLOOMSBURY",  lat: 51.5205, lng: -0.1245 },
    { name: "FITZROVIA",   lat: 51.5192, lng: -0.1395 },
    { name: "ISLINGTON",   lat: 51.5410, lng: -0.1085 },
    { name: "ANGEL",       lat: 51.5300, lng: -0.1060 },
    { name: "HOLLOWAY",    lat: 51.5540, lng: -0.1250 },
    { name: "MARYLEBONE",  lat: 51.5190, lng: -0.1535 },
    { name: "SOHO",        lat: 51.5135, lng: -0.1345 },
    { name: "BAYSWATER",   lat: 51.5145, lng: -0.1900 },
    { name: "PADDINGTON",  lat: 51.5172, lng: -0.1720 },
    { name: "THE REGENT'S PARK", lat: 51.5315, lng: -0.1560 },
    { name: "PRIMROSE HILL", lat: 51.5428, lng: -0.1610 },
    { name: "HYDE PARK",   lat: 51.5090, lng: -0.1650 },
    { name: "KING'S CROSS", lat: 51.5338, lng: -0.1205 },
    { name: "ST JOHN'S WOOD", lat: 51.5350, lng: -0.1770 },
    { name: "KENTISH TOWN", lat: 51.5520, lng: -0.1420 }
  ],

  // ------------------------------------------------------------------
  // LANDMARKS  (names + coordinates checked online, October 2026)
  // ------------------------------------------------------------------
  landmarks: [
    {
      id: "home-new",
      name: "New house",
      sprite: "home",
      lat: 51.5297, lng: -0.1405,   // Hawkshead, Stanhope Street, Regent's Park Estate, NW1 3RJ
      sign: "HOME",
      notes: [
        "I live here (currently). Perhaps the best decision I've ever made because it wasn't easy getting a house this good. Location-wise it's a 10-minute walk to school!",
        "We shed blood and tears to get this house. Mmm say hi to Swan and Thura!"
      ]
    },
    {
      id: "home-old",
      name: "Old house",
      sprite: "home",
      lat: 51.5574, lng: -0.1196,   // iQ The Arcade, 385-401 Holloway Road, N7 0RY
      sign: "HOME",
      color: "#5a7fa8",              // optional roof colour for this house
      notes: [
        "I lived here last year. It was an okay commute to school and living here groomed me to love the tube xd",
        "I made my first ever international friends here! Say hi to Abbey, Sam, Ezra and Danny!"
      ]
    },
    {
      id: "holloway-road-stn",
      name: "Holloway Road station",
      sprite: "tube",
      station: "holloway-road",
      lat: 51.5527, lng: -0.1131,
      sign: "HOLLOWAY RD",
      notes: [
        "Last year I took the tube from this station to go everywhere. #PiccadillyLine"
      ]
    },
    {
      id: "euston-square-stn",
      name: "Euston Square station",
      sprite: "tube",
      station: "euston-square",
      lat: 51.5257, lng: -0.1356,
      sign: "EUSTON SQ",
      notes: [
        "I'd stop at this station whenever I wanted to go to the main campus or the Student Centre."
      ]
    },
    {
      id: "russell-square-stn",
      name: "Russell Square station",
      sprite: "tube",
      station: "russell-square",
      lat: 51.5231, lng: -0.1244,
      sign: "RUSSELL SQ",
      notes: [
        "I'd stop at this station on days I have classes because my classes are held at the Institute of Education, UCL."
      ]
    },
    {
      id: "ioe",
      name: "IOE, UCL's Faculty of Education and Society",
      sprite: "campus",
      lat: 51.5230, lng: -0.1279,   // 20 Bedford Way, WC1H 0AL
      sign: "IOE",
      notes: [
        "My classes are mostly held here because it's the faculty with a hall big enough to fit my class size.",
        "Regardless of how large my class is I would always find myself sitting with Alfie and occasionally Ryan."
      ]
    },
    {
      id: "vue-angel",
      name: "Vue Islington (Angel Central)",
      sprite: "cinema",
      lat: 51.5343, lng: -0.1063,   // 36 Parkfield Street, N1 0PS
      sign: "CINEMA",
      notes: [
        "I normally watch movies at this cinema.",
        "I've had some very pleasant experiences here with Imanuel and my other film society friends. They're always down for impromptu movie nights! Say hi to Felicia and Gayatri!"
      ]
    },
    {
      id: "ucl-main",
      name: "UCL Bloomsbury Campus (the Portico)",
      sprite: "campus",
      lat: 51.5247, lng: -0.1339,   // Wilkins Building, Gower Street, WC1E 6BT
      sign: "UCL",
      notes: [
        "My main campus. The main quad looks amazing when the sun shines on it.",
        "It's a very US-looking campus if you ask me (MIT & Columbia)."
      ]
    },
    {
      id: "bloomsbury-lanes",
      name: "Bloomsbury Bowling Lanes",
      sprite: "karaoke",
      lat: 51.5240, lng: -0.1284,   // Lower level, Tavistock Hotel, Bedford Way, WC1H 9EU
      sign: "KARAOKE",
      notes: [
        "I went to karaoke for the first time in my life here. Definitely a core memory."
      ]
    },
    {
      id: "senate-house",
      name: "Senate House, University of London",
      sprite: "library tower",
      lat: 51.5207, lng: -0.1287,   // Malet Street, WC1E 7HU
      sign: "",
      notes: [
        "A super sick library and one of the main libraries I went to during exam season.",
        "Fun fact: some scenes in Batman Begins and The Dark Knight Rises were shot here."
      ]
    },
    {
      id: "prince-charles",
      name: "Prince Charles Cinema",
      sprite: "cinema",
      lat: 51.5115, lng: -0.1302,   // 7 Leicester Place, WC2H 7BY
      sign: "PRINCE CHARLES",
      notes: [
        "I catch classic movies here because they rescreen great old films.",
        "I made Imanuel and Sophie watch a 3-hour Taiwanese movie here. Best movie ever. I doubt they liked it that much xd"
      ]
    },
    {
      id: "gordon-square",
      name: "Gordon Square",
      sprite: "garden square",
      lat: 51.5244, lng: -0.1305,
      sign: "GORDON SQ",
      notes: [
        "My go-to park to touch grass when I feel jaded."
      ]
    },
    {
      id: "lidl-holloway",
      name: "Lidl Holloway Road (Nag's Head)",
      sprite: "supermarket",
      lat: 51.5574, lng: -0.1182,   // 422-434 Holloway Road, N7 6QD
      sign: "LIDL",
      notes: [
        "I shopped for my groceries here last year."
      ]
    },
    {
      id: "lidl-tcr",
      name: "Lidl Tottenham Court Road",
      sprite: "supermarket",
      lat: 51.5243, lng: -0.1373,   // 145 Tottenham Court Road, W1T 7NE
      sign: "LIDL",
      notes: [
        "I shop for my groceries here now."
      ]
    },


    {
      id: "euston-wall",
      name: "EustonWall Climbing Centre",
      sprite: "climbing gym",
      lat: 51.5245, lng: -0.1420,   // 350 Euston Road (Regent's Place), NW1 3AX
      sign: "EUSTONWALL",
      notes: [
        "THE bouldering gym. I've made some good friends here.",
        "It's an iconic place for me because I finally found a sport that I really enjoy and am fairly natural at.",
        "Say hi to Hayley, Gayatri and the dozens of other people I managed to suck into bouldering!"
      ]
    },
    {
      id: "roti-king",
      name: "Roti King (Euston)",
      sprite: "restaurant",
      lat: 51.5291, lng: -0.1320,   // 40 Doric Way, NW1 1LH (just off Ossulston Street)
      sign: "ROTI KING",
      notes: [
        "My favourite Malaysian restaurant. They don't take reservations so queueing is non-negotiable and the line starts at 12 pm!",
        "Interestingly the line is almost always filled with Caucasians."
      ]
    },
    {
      id: "med-salleh",
      name: "Med Salleh Kopitiam (Bayswater)",
      sprite: "restaurant",
      // CHECK: there is also a Med Salleh at 320 Kentish Town Road (51.5516, -0.1408).
      // If that's the one you mean, swap these coordinates.
      lat: 51.5121, lng: -0.1868,   // 35-39 Inverness Terrace, W2 3JS
      sign: "MED SALLEH",
      notes: [
        "My second favourite Malaysian restaurant. Second because it's in Bayswater where there's a very high chance of meeting an insufferable Malaysian family (jk).",
        "Sophie, Imanuel, Adrian and I became close here over a meal in our very first week in London last year."
      ]
    }
  ],

  // ------------------------------------------------------------------
  // "HOW TO PLAY" pages (button on the title screen, and "HELP" in game).
  // {total} becomes the number of places, {her} and {me} become the names.
  // art: "mission", "walk", "places", "travel", "map" or "letter"
  // ------------------------------------------------------------------
  instructions: [
    {
      art: "mission",
      title: "Your mission",
      text: "{her}, I've left a little piece of love at {total} places in my London. Find every one of them and you'll understand the city I live in."
    },
    {
      art: "walk",
      title: "Walk with me",
      text: "Use the arrow keys or WASD to walk, or just click or tap anywhere and we'll stroll there. I lead the way and you follow one step behind."
    },
    {
      art: "travel",
      title: "Ride like a Londoner",
      text: "London is big. When a place is far away, I'll ask: walk, take the tube, or hop on a bus? Every station on the map works, so you can ride wherever you like."
    },
    {
      art: "map",
      title: "Never get lost",
      text: "Press M for the full map and click any place to head straight there. The clocks at the top show my time and yours, and when it's night in London the windows light up."
    }
  ],

  // ------------------------------------------------------------------
  // The letter shown when every place has been visited.
  // Each "..." is one paragraph.
  // ------------------------------------------------------------------
  finalLetter: [
    "Dear Edriana,",
    "You've now walked through every corner of my London with me. Every place on this map is somewhere I've thought about you.",
    "I wish that one day I could properly experience London with you.",
    "And now it's your turn to lead the way. From here on, you walk in front and I'll follow you wherever you want to go.",
    "Love, Safwan"
  ]
};
