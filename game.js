/* =====================================================================
   game.js — "Here, There and Everywhere"
   A tiny pixel-art overworld of London. Everything is drawn in code.

   Sections (search for "SECTION:"):
     1. Setup & helpers
     2. Projection (lat/lng <-> tiles, with the Bloomsbury stretch)
     3. Map data (roads, parks, canal, railways, zones, tube, bus 29, decor)
     4. Map generation (fills the tile grid)
     5. Entities: landmarks, tube stations, famous buildings + buildings
     6. Tile painting (pre-renders the whole map once)
     7. Sprites (characters, icons, landmark & decor buildings, vehicles)
     8. Movement, A* pathfinding, journeys and the follower
     9. Transport: tube network, bus 29, traffic
    10. Camera & drawing each frame
    11. Minimap & full screen map
    12. Dialog, menus, train ride
    13. Title screen, HUD, clocks, day/night, audio, ending
    14. Input (keyboard, mouse, touch)
    15. Boot
   ===================================================================== */
(function () {
  'use strict';

  /* ===================================================================
     SECTION: 1. Setup & helpers
     =================================================================== */
  const CFG = window.CONFIG;
  if (!CFG) { alert('config.js did not load — check it for typos.'); return; }

  const TILE = 16;
  const W = CFG.map.widthTiles;
  const H = CFG.map.heightTiles;
  const N = W * H;
  const WORLD_W = W * TILE;
  const WORLD_H = H * TILE;
  const D2R = Math.PI / 180;
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const FONT = '"PixelFont", monospace';
  const HASH = (location.hash || '').toLowerCase();   // debug: #play #night #day #map

  const $ = (id) => document.getElementById(id);

  // Small seeded random generator so the map looks the same every time
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Deterministic 0..1 hash of a tile position (+ salt)
  function hash2(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // Smooth value noise (used for tree clusters)
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const a = hash2(xi, yi, 7), b = hash2(xi + 1, yi, 7);
    const c = hash2(xi, yi + 1, 7), d = hash2(xi + 1, yi + 1, 7);
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

  // Lighten (amt > 0) or darken (amt < 0) a hex colour
  const shadeCache = {};
  function shade(hex, amt) {
    const key = hex + amt;
    if (shadeCache[key]) return shadeCache[key];
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    const out = '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
    shadeCache[key] = out;
    return out;
  }

  // Safe localStorage (can throw in private mode / file://)
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  // ---- Player settings (saved in this browser) ----
  const ZOOMS = [{ name: 'FAR', m: 0.7 }, { name: 'NORMAL', m: 1 }, { name: 'CLOSE', m: 1.35 }, { name: 'CLOSER', m: 1.7 }];
  const settings = Object.assign({ zoom: 1, music: true, musicVol: 70, sfx: true, sfxVol: 60 }, store.get('htae-settings') || {});
  if (store.get('htae-muted') === true) settings.music = false;   // older saves
  settings.zoom = clamp(settings.zoom | 0, 0, ZOOMS.length - 1);
  const saveSettings = () => store.set('htae-settings', settings);

  // ---- Little sound effects, synthesised with WebAudio (no files needed) ----
  let actx = null;
  function sfx(type) {
    if (!settings.sfx || settings.sfxVol <= 0) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const now = actx.currentTime, vol = settings.sfxVol / 100 * 0.18;
      const tone = (freq, start, dur, wave, v) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = wave || 'square'; o.frequency.setValueAtTime(freq, now + start);
        g.gain.setValueAtTime(0.0001, now + start);
        g.gain.exponentialRampToValueAtTime((v || 1) * vol, now + start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        o.connect(g).connect(actx.destination); o.start(now + start); o.stop(now + start + dur + 0.02);
      };
      switch (type) {
        case 'blip': tone(880, 0, 0.06, 'square', 0.6); break;
        case 'open': tone(660, 0, 0.07); tone(990, 0.06, 0.09); break;
        case 'heart': [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.07, 0.16, 'triangle', 1.2)); break;
        case 'ding': tone(1175, 0, 0.35, 'sine', 1.4); tone(1568, 0.12, 0.4, 'sine', 1.1); break;
        case 'train': [220, 196, 175].forEach((f, k) => tone(f, k * 0.12, 0.2, 'sawtooth', 0.5)); break;
        case 'close': tone(660, 0, 0.06); tone(440, 0.05, 0.08); break;
      }
    } catch (e) { /* audio not available — ignore */ }
  }

  // Tiny binary heap used by A*, Dijkstra and the path carver
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  };
  Object.defineProperty(Heap.prototype, 'size', { get() { return this.k.length; } });

  /* ===================================================================
     SECTION: 2. Projection
     lat/lng -> tile coordinates. Points near the stretch centre are
     pushed outwards with a smooth curve so the dense Euston/Bloomsbury
     area gets more room. The curve is monotonic, so nothing ever folds.
     =================================================================== */
  const ST = CFG.stretch;
  const KX = 111.32 * Math.cos(ST.lat * D2R);   // km per degree of longitude
  const KY = 110.57;                            // km per degree of latitude
  const stretchF = (r) => { const q = 1 - r / ST.radiusKm; return 1 + (ST.strength - 1) * q * q; };

  function project(lat, lng) {
    let dx = (lng - ST.lng) * KX;
    let dy = (lat - ST.lat) * KY;
    const r = Math.hypot(dx, dy);
    if (r > 0 && r < ST.radiusKm) { const f = stretchF(r); dx *= f; dy *= f; }
    const lng2 = ST.lng + dx / KX, lat2 = ST.lat + dy / KY;
    const m = CFG.map;
    return {
      x: (lng2 - m.west) / (m.east - m.west) * W,
      y: (m.north - lat2) / (m.north - m.south) * H
    };
  }
  // The reverse: tile coordinates -> real lat/lng (used for real-life travel times)
  function unproject(x, y) {
    const m = CFG.map;
    const lng2 = m.west + x / W * (m.east - m.west), lat2 = m.north - y / H * (m.north - m.south);
    let dx = (lng2 - ST.lng) * KX, dy = (lat2 - ST.lat) * KY;
    const rp = Math.hypot(dx, dy);
    if (rp > 0 && rp < ST.radiusKm) {
      let lo = 0, hi = ST.radiusKm;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (mid * stretchF(mid) < rp) lo = mid; else hi = mid; }
      const r = (lo + hi) / 2; dx *= r / rp; dy *= r / rp;
    }
    return { lat: ST.lat + dy / KY, lng: ST.lng + dx / KX };
  }

  // Add extra points along long segments (so curves bend correctly through the stretch)
  function densify(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      out.push(a);
      if (i === pts.length - 1) break;
      const b = pts[i + 1];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.0004);
      for (let s = 1; s < n; s++) out.push([lerp(a[0], b[0], s / n), lerp(a[1], b[1], s / n)]);
    }
    return out;
  }
  const projPts = (pts) => densify(pts).map((p) => project(p[0], p[1]));

  // Rectangle / circle shapes in real-world metres -> [lat,lng] polygons
  function geoRect(lat, lng, wM, hM) {
    const dLat = hM / 2 / 110570, dLng = wM / 2 / (111320 * Math.cos(lat * D2R));
    return [[lat + dLat, lng - dLng], [lat + dLat, lng + dLng], [lat - dLat, lng + dLng], [lat - dLat, lng - dLng]];
  }
  function geoCircle(lat, lng, rM, n) {
    const out = [];
    n = n || 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push([lat + Math.sin(a) * rM / 110570, lng + Math.cos(a) * rM / (111320 * Math.cos(lat * D2R))]);
    }
    return out;
  }

  /* ===================================================================
     SECTION: 3. Map data — real-world shapes as [lat, lng] lists
     (Approximate, traced by eye from the reference map.)
     =================================================================== */
  const GEO = {
    // Main roads (3 tiles wide, walk faster on these)
    mainRoads: [
      // Westway -> Marylebone Road -> Euston Road -> Pentonville Road -> Angel
      [[51.5218, -0.1960], [51.5212, -0.1860], [51.5203, -0.1760], [51.5200, -0.1700], [51.5212, -0.1640],
       [51.5226, -0.1570], [51.5235, -0.1480], [51.5240, -0.1430], [51.5250, -0.1386], [51.5262, -0.1350],
       [51.5272, -0.1310], [51.5290, -0.1265], [51.5305, -0.1235], [51.5315, -0.1180], [51.5320, -0.1120],
       [51.5322, -0.1058], [51.5318, -0.0980]],
      // Bayswater Road -> Oxford Street -> New Oxford Street
      [[51.5112, -0.1960], [51.5108, -0.1878], [51.5118, -0.1755], [51.5125, -0.1660], [51.5132, -0.1590],
       [51.5142, -0.1490], [51.5153, -0.1415], [51.5163, -0.1310], [51.5172, -0.1255], [51.5178, -0.1200],
       [51.5182, -0.1100]],
      // Tottenham Court Road -> Hampstead Road -> Camden High Street
      [[51.5163, -0.1310], [51.5205, -0.1345], [51.5250, -0.1386], [51.5300, -0.1390], [51.5343, -0.1387],
       [51.5392, -0.1426]],
      // Edgware Road
      [[51.5132, -0.1595], [51.5200, -0.1700], [51.5245, -0.1760], [51.5300, -0.1850], [51.5340, -0.1910], [51.5380, -0.1960]],
      // Park Lane
      [[51.5132, -0.1590], [51.5070, -0.1520]],
      // Caledonian Road
      [[51.5305, -0.1210], [51.5380, -0.1185], [51.5470, -0.1175], [51.5560, -0.1188]],
      // Upper Street -> Holloway Road -> Nag's Head -> Archway
      [[51.5322, -0.1058], [51.5380, -0.1030], [51.5460, -0.1040], [51.5490, -0.1065], [51.5526, -0.1125],
       [51.5560, -0.1162], [51.5573, -0.1172], [51.5600, -0.1210], [51.5625, -0.1245]],
      // Seven Sisters Road (from Nag's Head, where bus 29 heads off)
      [[51.5573, -0.1172], [51.5598, -0.1125], [51.5625, -0.1080]],
    ],
    // Secondary roads (2 tiles wide)
    secondaryRoads: [
      [[51.5392, -0.1426], [51.5440, -0.1530], [51.5480, -0.1600]],                         // Chalk Farm Road
      [[51.5392, -0.1426], [51.5450, -0.1415], [51.5503, -0.1404], [51.5560, -0.1395], [51.5625, -0.1390]], // Kentish Town Road
      [[51.5392, -0.1426], [51.5420, -0.1380], [51.5450, -0.1325], [51.5490, -0.1265], [51.5530, -0.1215], [51.5560, -0.1188], [51.5573, -0.1172]], // Camden Road
      [[51.5300, -0.1700], [51.5362, -0.1610], [51.5376, -0.1530], [51.5380, -0.1470], [51.5392, -0.1426]],  // Prince Albert Road
      [[51.5178, -0.1210], [51.5215, -0.1235], [51.5250, -0.1265], [51.5276, -0.1298]],   // Southampton Row / Woburn Place
      [[51.5305, -0.1230], [51.5250, -0.1185], [51.5190, -0.1135]],                        // Gray's Inn Road
      [[51.5310, -0.1225], [51.5400, -0.1250], [51.5470, -0.1270]],                        // York Way
      [[51.5100, -0.1350], [51.5153, -0.1415], [51.5200, -0.1450], [51.5235, -0.1460]],   // Regent Street + Portland Place
      [[51.5163, -0.1305], [51.5133, -0.1293], [51.5113, -0.1283], [51.5070, -0.1272]],   // Charing Cross Road
      [[51.5137, -0.1565], [51.5235, -0.1575]],                                            // Baker Street
      [[51.5108, -0.1878], [51.5170, -0.1882], [51.5215, -0.1890]],                        // Queensway
      [[51.5282, -0.1743], [51.5320, -0.1779], [51.5345, -0.1805], [51.5380, -0.1860]],   // Abbey Road
      [[51.5282, -0.1743], [51.5300, -0.1700]]                                             // Grove End Road link
    ],
    // Small named streets (1 tile wide)
    minorRoads: [
      [[51.5190, -0.1315], [51.5262, -0.1345]],                    // Gower Street
      [[51.5195, -0.1298], [51.5250, -0.1322]],                    // Malet Street
      [[51.5205, -0.1288], [51.5256, -0.1279]],                    // Bedford Way
      [[51.5255, -0.1395], [51.5315, -0.1410]],                    // Stanhope Street
      [[51.5280, -0.1325], [51.5345, -0.1385]],                    // Eversholt Street
      [[51.5250, -0.1440], [51.5350, -0.1450]],                    // Albany Street
      [[51.5280, -0.1297], [51.5320, -0.1310]],                    // Ossulston Street
      [[51.5300, -0.1270], [51.5360, -0.1305]],                    // Pancras Road
      [[51.5130, -0.1345], [51.5160, -0.1290]],                    // Shaftesbury Avenue-ish
      [[51.5116, -0.1340], [51.5116, -0.1250]],                    // Leicester Square / Coventry St
      [[51.5121, -0.1868], [51.5160, -0.1862]]                     // Inverness Terrace
    ],
    // Parks
    regentsPark: [[51.5240, -0.1460], [51.5232, -0.1530], [51.5240, -0.1600], [51.5262, -0.1650], [51.5300, -0.1665],
                  [51.5330, -0.1630], [51.5352, -0.1570], [51.5360, -0.1510], [51.5355, -0.1465], [51.5310, -0.1450], [51.5270, -0.1452]],
    primroseHill: [[51.5418, -0.1640], [51.5420, -0.1585], [51.5395, -0.1555], [51.5372, -0.1580], [51.5370, -0.1625], [51.5390, -0.1660]],
    primroseSummit: [51.5395, -0.1608],
    hydePark: [[51.5125, -0.1750], [51.5132, -0.1595], [51.5070, -0.1520], [51.5040, -0.1520], [51.5040, -0.1750]],
    kensingtonGardens: [[51.5115, -0.1880], [51.5125, -0.1750], [51.5040, -0.1750], [51.5040, -0.1880]],
    otherGreens: [
      [[51.5500, -0.1052], [51.5500, -0.1022], [51.5462, -0.1018], [51.5462, -0.1040]],   // Highbury Fields
      geoRect(51.5248, -0.1203, 140, 110),                                                 // Coram's Fields
      geoRect(51.5212, -0.1795, 90, 70),                                                   // Paddington Green
      geoRect(51.5340, -0.1040, 70, 40),                                                   // Islington Green
      geoRect(51.5512, -0.1255, 160, 110)                                                  // Caledonian Park area
    ],
    lords: [[51.5310, -0.1745], [51.5310, -0.1700], [51.5282, -0.1700], [51.5282, -0.1745]],
    // Lakes
    lakes: [
      [[51.5288, -0.1640], [51.5278, -0.1612], [51.5266, -0.1590], [51.5256, -0.1568], [51.5249, -0.1578],
       [51.5258, -0.1605], [51.5268, -0.1630], [51.5280, -0.1652]],
      [[51.5294, -0.1626], [51.5302, -0.1600], [51.5296, -0.1592], [51.5284, -0.1614]],
      [[51.5110, -0.1764], [51.5108, -0.1750], [51.5072, -0.1738], [51.5040, -0.1730], [51.5040, -0.1752], [51.5072, -0.1754]]
    ],
    innerCircle: { lat: 51.5262, lng: -0.1525, r: 170 },
    // Park paths
    parkPaths: [
      [[51.5240, -0.1497], [51.5357, -0.1490]],                                          // The Broad Walk
      [[51.5262, -0.1500], [51.5272, -0.1452]],                                          // Chester Road
      [[51.5247, -0.1530], [51.5234, -0.1540]],                                          // York Bridge
      [[51.5262, -0.1550], [51.5285, -0.1600], [51.5310, -0.1640]],
      [[51.5277, -0.1520], [51.5320, -0.1540], [51.5355, -0.1560]],
      [[51.5395, -0.1608], [51.5418, -0.1640]], [[51.5395, -0.1608], [51.5372, -0.1580]],  // Primrose Hill
      [[51.5395, -0.1608], [51.5372, -0.1625]], [[51.5395, -0.1608], [51.5418, -0.1585]],
      [[51.5125, -0.1690], [51.5070, -0.1640]], [[51.5132, -0.1595], [51.5075, -0.1700]], // Hyde Park
      [[51.5115, -0.1860], [51.5040, -0.1860]], [[51.5112, -0.1820], [51.5060, -0.1775]]  // Kensington Gardens
    ],
    // Big train-station roofs (not walkable)
    stations: [
      [[51.5333, -0.1246], [51.5333, -0.1226], [51.5312, -0.1226], [51.5312, -0.1246]],   // King's Cross
      [[51.5340, -0.1276], [51.5340, -0.1256], [51.5313, -0.1256], [51.5313, -0.1276]],   // St Pancras
      [[51.5172, -0.1792], [51.5177, -0.1750], [51.5160, -0.1745], [51.5155, -0.1787]],   // Paddington
      [[51.5232, -0.1640], [51.5232, -0.1618], [51.5218, -0.1618], [51.5218, -0.1640]]    // Marylebone
    ],
    // Railways fanning out of the big stations: [width, points]
    railways: [
      [4, [[51.5298, -0.1345], [51.5330, -0.1385], [51.5365, -0.1420], [51.5400, -0.1462], [51.5440, -0.1540], [51.5470, -0.1620], [51.5495, -0.1720]]], // Euston
      [4, [[51.5334, -0.1236], [51.5370, -0.1232], [51.5420, -0.1212], [51.5480, -0.1196], [51.5560, -0.1172], [51.5625, -0.1135]]], // King's Cross
      [3, [[51.5341, -0.1266], [51.5370, -0.1287], [51.5420, -0.1340], [51.5470, -0.1400], [51.5520, -0.1450], [51.5625, -0.1490]]], // St Pancras
      [4, [[51.5165, -0.1793], [51.5180, -0.1835], [51.5188, -0.1900], [51.5192, -0.1960]]],                        // Paddington
      [2, [[51.5233, -0.1630], [51.5262, -0.1690], [51.5300, -0.1765], [51.5340, -0.1830], [51.5380, -0.1895]]]   // Marylebone
    ],
    // Regent's Canal (Little Venice -> Regent's Park -> Camden -> King's Cross -> Islington tunnel)
    canal: [
      [[51.5240, -0.1960], [51.5228, -0.1900], [51.5218, -0.1840], [51.5235, -0.1800], [51.5255, -0.1745],
       [51.5275, -0.1700], [51.5300, -0.1672], [51.5325, -0.1652], [51.5345, -0.1612], [51.5354, -0.1560],
       [51.5357, -0.1510], [51.5360, -0.1472], [51.5385, -0.1462], [51.5412, -0.1458], [51.5410, -0.1420],
       [51.5398, -0.1370], [51.5385, -0.1330], [51.5365, -0.1300], [51.5352, -0.1265], [51.5355, -0.1240],
       [51.5348, -0.1200], [51.5340, -0.1170], [51.5345, -0.1135]],
      [[51.5185, -0.1745], [51.5200, -0.1790], [51.5218, -0.1840]]
    ],
    // Garden squares: [lat, lng, width m, height m]
    squares: [
      [51.5245, -0.1302, 80, 140],   // Gordon Square
      [51.5253, -0.1285, 110, 100],  // Tavistock Square
      [51.5236, -0.1294, 40, 110],   // Woburn Square
      [51.5213, -0.1262, 170, 170],  // Russell Square
      [51.5187, -0.1307, 100, 100],  // Bedford Square
      [51.5193, -0.1225, 80, 80],    // Bloomsbury Square
      [51.5240, -0.1225, 80, 90],    // Brunswick Square
      [51.5251, -0.1188, 90, 110],   // Mecklenburgh Square
      [51.5228, -0.1408, 70, 70],    // Fitzroy Square
      [51.5268, -0.1335, 120, 40],   // Euston Square gardens
      [51.5277, -0.1215, 60, 60],    // Regent Square
      [51.5155, -0.1320, 80, 80],    // Soho Square
      [51.5167, -0.1446, 90, 90],    // Cavendish Square
      [51.5157, -0.1565, 100, 100],  // Portman Square
      [51.5165, -0.1527, 60, 60],    // Manchester Square
      [51.5340, -0.1380, 70, 70],    // Harrington Square
      [51.5385, -0.1080, 90, 60],    // Thornhill Square-ish
      [51.5140, -0.1840, 60, 110]    // Porchester / Leinster Square-ish
    ],
    // Abbey Road zebra crossing (for a Beatles fan)
    abbeyCrossing: [51.5320, -0.1779]
  };

  // Architecture zones: decide what style of buildings grow where
  const Z = { DEFAULT: 0, GEORGIAN: 1, STUCCO: 2, ESTATE: 3, OFFICE: 4, SOHO: 5, CAMDEN: 6, KINGSX: 7, OXFORD: 8 };
  const ZONES = [   // later entries win
    [Z.GEORGIAN, [[51.5280, -0.1450], [51.5285, -0.1180], [51.5175, -0.1170], [51.5160, -0.1450]]],          // Bloomsbury + Fitzrovia
    [Z.GEORGIAN, [[51.5235, -0.1640], [51.5235, -0.1450], [51.5145, -0.1450], [51.5140, -0.1640]]],          // Marylebone
    [Z.GEORGIAN, [[51.5470, -0.1150], [51.5470, -0.0980], [51.5300, -0.0980], [51.5300, -0.1150]]],          // Islington / Angel / Barnsbury
    [Z.STUCCO,   [[51.5240, -0.1960], [51.5240, -0.1690], [51.5112, -0.1690], [51.5108, -0.1960]]],          // Bayswater / Paddington
    [Z.STUCCO,   [[51.5460, -0.1720], [51.5460, -0.1490], [51.5368, -0.1490], [51.5368, -0.1720]]],          // Primrose Hill
    [Z.STUCCO,   [[51.5370, -0.1700], [51.5370, -0.1450], [51.5228, -0.1450], [51.5228, -0.1700]]],          // Nash terraces around Regent's Park
    [Z.ESTATE,   [[51.5332, -0.1452], [51.5332, -0.1392], [51.5262, -0.1392], [51.5262, -0.1452]]],          // Regent's Park Estate (home!)
    [Z.ESTATE,   [[51.5345, -0.1340], [51.5340, -0.1275], [51.5292, -0.1280], [51.5296, -0.1335]]],          // Somers Town
    [Z.ESTATE,   [[51.5530, -0.1240], [51.5530, -0.1150], [51.5440, -0.1150], [51.5440, -0.1240]]],          // Caledonian Road estates
    [Z.OFFICE,   [[51.5254, -0.1460], [51.5264, -0.1386], [51.5276, -0.1350], [51.5286, -0.1310], [51.5304, -0.1265],
                  [51.5318, -0.1235], [51.5293, -0.1235], [51.5278, -0.1265], [51.5260, -0.1310], [51.5250, -0.1350],
                  [51.5238, -0.1386], [51.5226, -0.1460]]],                                                    // Euston Road
    [Z.OFFICE,   [[51.5250, -0.1395], [51.5250, -0.1370], [51.5165, -0.1295], [51.5160, -0.1325]]],          // Tottenham Court Road
    [Z.SOHO,     [[51.5160, -0.1420], [51.5160, -0.1265], [51.5070, -0.1265], [51.5070, -0.1420]]],          // Soho
    [Z.CAMDEN,   [[51.5455, -0.1500], [51.5455, -0.1385], [51.5360, -0.1385], [51.5360, -0.1500]]],          // Camden Town
    [Z.KINGSX,   [[51.5410, -0.1300], [51.5410, -0.1180], [51.5330, -0.1180], [51.5330, -0.1300]]],          // King's Cross / Granary Square
    [Z.OXFORD,   [[51.5150, -0.1600], [51.5175, -0.1310], [51.5185, -0.1200], [51.5168, -0.1200], [51.5156, -0.1310], [51.5126, -0.1600]]] // Oxford Street
  ];

  // Tube stations inside the map (real positions)
  const STATIONS = [
    { id: 'arsenal', name: 'Arsenal', lat: 51.5586, lng: -0.1059, sign: 'ARSENAL' },
    { id: 'holloway-road', name: 'Holloway Road', lat: 51.5527, lng: -0.1131, sign: 'HOLLOWAY RD' },
    { id: 'caledonian-road', name: 'Caledonian Road', lat: 51.5481, lng: -0.1188, sign: 'CALEDONIAN' },
    { id: 'highbury-islington', name: 'Highbury & Islington', lat: 51.5461, lng: -0.1040, sign: 'HIGHBURY' },
    { id: 'kings-cross', name: "King's Cross St Pancras", lat: 51.5308, lng: -0.1238, sign: "KING'S X" },
    { id: 'angel', name: 'Angel', lat: 51.5322, lng: -0.1058, sign: 'ANGEL' },
    { id: 'russell-square', name: 'Russell Square', lat: 51.5231, lng: -0.1244, sign: 'RUSSELL SQ' },
    { id: 'holborn', name: 'Holborn', lat: 51.5174, lng: -0.1201, sign: 'HOLBORN' },
    { id: 'covent-garden', name: 'Covent Garden', lat: 51.5129, lng: -0.1243, sign: 'COVENT GDN' },
    { id: 'leicester-square', name: 'Leicester Square', lat: 51.5113, lng: -0.1281, sign: 'LEICESTER' },
    { id: 'piccadilly-circus', name: 'Piccadilly Circus', lat: 51.5098, lng: -0.1342, sign: 'PICCADILLY' },
    { id: 'tottenham-court-road', name: 'Tottenham Court Road', lat: 51.5165, lng: -0.1310, sign: 'TOTTENHAM' },
    { id: 'goodge-street', name: 'Goodge Street', lat: 51.5205, lng: -0.1347, sign: 'GOODGE ST' },
    { id: 'warren-street', name: 'Warren Street', lat: 51.5247, lng: -0.1383, sign: 'WARREN ST' },
    { id: 'euston', name: 'Euston', lat: 51.5282, lng: -0.1337, sign: 'EUSTON' },
    { id: 'euston-square', name: 'Euston Square', lat: 51.5257, lng: -0.1356, sign: 'EUSTON SQ' },
    { id: 'mornington-crescent', name: 'Mornington Crescent', lat: 51.5343, lng: -0.1387, sign: 'MORNINGTON' },
    { id: 'camden-town', name: 'Camden Town', lat: 51.5392, lng: -0.1426, sign: 'CAMDEN TOWN' },
    { id: 'chalk-farm', name: 'Chalk Farm', lat: 51.5441, lng: -0.1538, sign: 'CHALK FARM' },
    { id: 'kentish-town', name: 'Kentish Town', lat: 51.5503, lng: -0.1404, sign: 'KENTISH TN' },
    { id: 'great-portland-street', name: 'Great Portland Street', lat: 51.5238, lng: -0.1438, sign: 'GT PORTLAND' },
    { id: 'regents-park', name: "Regent's Park", lat: 51.5234, lng: -0.1466, sign: "REGENT'S PK" },
    { id: 'oxford-circus', name: 'Oxford Circus', lat: 51.5152, lng: -0.1415, sign: 'OXFORD CIR' },
    { id: 'bond-street', name: 'Bond Street', lat: 51.5142, lng: -0.1494, sign: 'BOND ST' },
    { id: 'marble-arch', name: 'Marble Arch', lat: 51.5136, lng: -0.1586, sign: 'MARBLE ARCH' },
    { id: 'baker-street', name: 'Baker Street', lat: 51.5226, lng: -0.1571, sign: 'BAKER ST' },
    { id: 'marylebone', name: 'Marylebone', lat: 51.5225, lng: -0.1631, sign: 'MARYLEBONE' },
    { id: 'edgware-road', name: 'Edgware Road', lat: 51.5200, lng: -0.1690, sign: 'EDGWARE RD' },
    { id: 'paddington', name: 'Paddington', lat: 51.5154, lng: -0.1755, sign: 'PADDINGTON' },
    { id: 'lancaster-gate', name: 'Lancaster Gate', lat: 51.5119, lng: -0.1756, sign: 'LANCASTER' },
    { id: 'queensway', name: 'Queensway', lat: 51.5107, lng: -0.1871, sign: 'QUEENSWAY' },
    { id: 'bayswater', name: 'Bayswater', lat: 51.5122, lng: -0.1879, sign: 'BAYSWATER' },
    { id: 'st-johns-wood', name: "St John's Wood", lat: 51.5347, lng: -0.1740, sign: 'ST JOHNS WD' }
  ];
  // Lines (stations in order). Same name = same line, so no "change".
  const LINES = [
    { name: 'Piccadilly line', color: '#1c3f94', seq: ['arsenal', 'holloway-road', 'caledonian-road', 'kings-cross', 'russell-square', 'holborn', 'covent-garden', 'leicester-square', 'piccadilly-circus'] },
    { name: 'Northern line', color: '#1a1a1a', seq: ['kentish-town', 'camden-town', 'mornington-crescent', 'euston', 'warren-street', 'goodge-street', 'tottenham-court-road', 'leicester-square'] },
    { name: 'Northern line', color: '#1a1a1a', seq: ['chalk-farm', 'camden-town'] },
    { name: 'Northern line (Bank branch)', color: '#1a1a1a', seq: ['camden-town', 'euston', 'kings-cross', 'angel'] },
    { name: 'Victoria line', color: '#0098d4', seq: ['highbury-islington', 'kings-cross', 'euston', 'warren-street', 'oxford-circus'] },
    { name: 'Central line', color: '#e32017', seq: ['queensway', 'lancaster-gate', 'marble-arch', 'bond-street', 'oxford-circus', 'tottenham-court-road', 'holborn'] },
    { name: 'Circle line', color: '#ffd329', seq: ['kings-cross', 'euston-square', 'great-portland-street', 'baker-street', 'edgware-road', 'paddington', 'bayswater'] },
    { name: 'Bakerloo line', color: '#b36305', seq: ['paddington', 'edgware-road', 'marylebone', 'baker-street', 'regents-park', 'oxford-circus', 'piccadilly-circus'] },
    { name: 'Jubilee line', color: '#a0a5a9', seq: ['st-johns-wood', 'baker-street', 'bond-street'] },
    { name: 'Elizabeth line', color: '#6950a1', seq: ['paddington', 'bond-street', 'tottenham-court-road'] }
  ];

  // Bus route 29: Trafalgar Square -> Charing Cross Rd -> Tottenham Court Rd -> Hampstead Rd
  //               -> Camden Town -> Camden Road -> Holloway, Nag's Head -> (Seven Sisters Rd)
  const BUS29 = [
    { name: 'Trafalgar Square', lat: 51.5076, lng: -0.1276 },
    { name: 'Leicester Square', lat: 51.5113, lng: -0.1284 },
    { name: 'Cambridge Circus', lat: 51.5133, lng: -0.1293 },
    { name: 'Tottenham Court Road', lat: 51.5168, lng: -0.1313 },
    { name: 'Goodge Street', lat: 51.5207, lng: -0.1348 },
    { name: 'Warren Street', lat: 51.5252, lng: -0.1387 },
    { name: 'Robert Street', lat: 51.5290, lng: -0.1391 },
    { name: 'Mornington Crescent', lat: 51.5340, lng: -0.1388 },
    { name: 'Camden Town', lat: 51.5390, lng: -0.1424 },
    { name: 'Camden Road Station', lat: 51.5420, lng: -0.1380 },
    { name: 'Camden Road / Brecknock Road', lat: 51.5490, lng: -0.1265 },
    { name: "Holloway, Nag's Head", lat: 51.5571, lng: -0.1176 },
    { name: 'Seven Sisters Road', lat: 51.5600, lng: -0.1122 }
  ];

  // Other real bus routes that link the places together (stops in order)
  const BUS_ROUTES = [
    { num: '29', color: '#d42a2a', stops: BUS29 },
    { num: '91', color: '#d42a2a', stops: [      // Trafalgar Sq - Holborn - Russell Sq - Euston - King's Cross - Caledonian Rd - Nag's Head
      { name: 'Trafalgar Square', lat: 51.5076, lng: -0.1276 },
      { name: 'Holborn', lat: 51.5177, lng: -0.1207 },
      { name: 'Russell Square', lat: 51.5218, lng: -0.1239 },
      { name: 'Tavistock Square', lat: 51.5255, lng: -0.1268 },
      { name: 'Euston', lat: 51.5276, lng: -0.1300 },
      { name: "King's Cross", lat: 51.5306, lng: -0.1230 },
      { name: 'Caledonian Road Station', lat: 51.5481, lng: -0.1179 },
      { name: "Holloway, Nag's Head", lat: 51.5571, lng: -0.1176 }
    ] },
    { num: '43', color: '#d42a2a', stops: [      // Nag's Head - Holloway Rd - Highbury & Islington - Upper St - Angel
      { name: "Holloway, Nag's Head", lat: 51.5571, lng: -0.1176 },
      { name: 'Holloway Road Station', lat: 51.5526, lng: -0.1125 },
      { name: 'Highbury & Islington', lat: 51.5461, lng: -0.1040 },
      { name: 'Islington Town Hall', lat: 51.5412, lng: -0.1030 },
      { name: 'Angel', lat: 51.5322, lng: -0.1058 }
    ] },
    { num: '205', color: '#d42a2a', stops: [     // Marble Arch - Baker St - Euston Rd - King's Cross - Angel
      { name: 'Marble Arch', lat: 51.5132, lng: -0.1590 },
      { name: 'Baker Street', lat: 51.5226, lng: -0.1572 },
      { name: "Regent's Park", lat: 51.5236, lng: -0.1470 },
      { name: 'Great Portland Street', lat: 51.5240, lng: -0.1432 },
      { name: 'Warren Street', lat: 51.5250, lng: -0.1395 },
      { name: 'Euston Square', lat: 51.5262, lng: -0.1352 },
      { name: 'Euston', lat: 51.5276, lng: -0.1300 },
      { name: "King's Cross", lat: 51.5306, lng: -0.1230 },
      { name: 'Angel', lat: 51.5322, lng: -0.1058 }
    ] },
    { num: '94', color: '#d42a2a', stops: [      // Queensway - Lancaster Gate - Marble Arch - Oxford St - Piccadilly Circus
      { name: 'Queensway', lat: 51.5108, lng: -0.1878 },
      { name: 'Lancaster Gate', lat: 51.5118, lng: -0.1756 },
      { name: 'Marble Arch', lat: 51.5132, lng: -0.1590 },
      { name: 'Bond Street', lat: 51.5142, lng: -0.1494 },
      { name: 'Oxford Circus', lat: 51.5153, lng: -0.1415 },
      { name: 'Piccadilly Circus', lat: 51.5100, lng: -0.1350 }
    ] }
  ];

  // Famous buildings drawn as decoration (hover for their names)
  const DECOR = [
    { id: 'bt-tower', name: 'BT Tower', sprite: 'bt tower', lat: 51.5215, lng: -0.1389 },
    { id: 'british-museum', name: 'The British Museum', sprite: 'british museum', lat: 51.5194, lng: -0.1270 },
    { id: 'st-pancras', name: 'St Pancras', sprite: 'st pancras', lat: 51.5303, lng: -0.1262 },
    { id: 'kings-cross-stn', name: "King's Cross station", sprite: 'kings cross', lat: 51.5306, lng: -0.1236 },
    { id: 'centre-point', name: 'Centre Point', sprite: 'centre point', lat: 51.5158, lng: -0.1300 },
    { id: 'all-souls', name: 'All Souls Church', sprite: 'church', lat: 51.5175, lng: -0.1432 },
    { id: 'st-pancras-church', name: 'St Pancras Church', sprite: 'church', lat: 51.5266, lng: -0.1302 },
    { id: 'marble-arch-monument', name: 'Marble Arch', sprite: 'marble arch', lat: 51.5128, lng: -0.1589 },
    { id: 'camden-lock', name: 'Camden Lock Market', sprite: 'camden lock', lat: 51.5416, lng: -0.1468 },
    { id: 'abbey-road-studios', name: 'Abbey Road Studios', sprite: 'abbey road studios', lat: 51.5320, lng: -0.1785 },
    { id: 'lords', name: "Lord's Cricket Ground", sprite: 'pavilion', lat: 51.5294, lng: -0.1728 },
    { id: 'london-zoo', name: 'London Zoo', sprite: 'zoo', lat: 51.5353, lng: -0.1534 }
  ];

  /* ===================================================================
     SECTION: 4. Map generation
     =================================================================== */
  const T = {
    BLOCK: 0, GRASS: 1, PATH: 2, ROAD: 3, MINOR: 4, WATER: 5, CANAL: 6, TOWPATH: 7, RAIL: 8,
    TREE: 9, HEDGE: 10, PLAZA: 11, BUILDING: 12, STATION: 13, GARDEN: 14, LANDMARK: 15, PITCH: 16
  };
  const WALK = new Uint8Array(20);
  [T.GRASS, T.PATH, T.ROAD, T.MINOR, T.TOWPATH, T.PLAZA, T.GARDEN, T.PITCH].forEach((t) => (WALK[t] = 1));
  // A* cost per tile (lower = preferred). Main roads are fastest.
  const COST = new Float32Array(20).fill(1);
  COST[T.ROAD] = 0.55; COST[T.PATH] = 0.8; COST[T.TOWPATH] = 0.8; COST[T.MINOR] = 0.85; COST[T.PLAZA] = 0.9;

  const tiles = new Uint8Array(N);
  const bridge = new Uint8Array(N);   // 1 = road/rail crossing over water or rail
  const railDir = new Uint8Array(N);  // 0 = horizontal tracks, 1 = vertical
  const parkFlag = new Uint8Array(N); // 1 = inside a park (trees can grow)
  const hill = new Uint8Array(N);     // Primrose Hill height level (0..3)
  const zone = new Uint8Array(N);     // architecture zone
  const zebra = new Uint8Array(N);    // 1 = crossing walked north-south, 2 = east-west
  const abbey = new Uint8Array(N);    // 1 = the Abbey Road crossing
  const bid = new Int32Array(N);      // building id (0 = none)
  const entAt = new Int16Array(N);    // entity index + 1 for footprint tiles
  const entEntr = new Int16Array(N);  // entity index + 1 for entrance tiles
  const stopAt = new Int16Array(N);   // bus stop index + 1
  let buildings = [null];             // building id -> info

  const I = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const get = (x, y) => (inb(x, y) ? tiles[I(x, y)] : -1);
  const isWalk = (x, y) => inb(x, y) && WALK[tiles[I(x, y)]] === 1;

  // Visit every tile along a polyline, keeping the line 4-connected
  function lineCells(pts, cb) {
    let lx = null, ly = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
      for (let s = 0; s <= n; s++) {
        const x = Math.floor(a.x + (b.x - a.x) * s / n), y = Math.floor(a.y + (b.y - a.y) * s / n);
        if (x === lx && y === ly) continue;
        if (lx !== null && x !== lx && y !== ly) cb(x, ly, a, b);
        cb(x, y, a, b);
        lx = x; ly = y;
      }
    }
  }
  // Thick lines: diagonal stretches use a slightly thinner brush, because a
  // square brush moving diagonally covers more ground than one moving straight.
  function stroke(latlngs, width, fn) {
    lineCells(projPts(latlngs), (cx, cy, a, b) => {
      const ddx = Math.abs(b.x - a.x), ddy = Math.abs(b.y - a.y);
      const diag = width > 1 && Math.min(ddx, ddy) > 0.45 * Math.max(ddx, ddy);
      const w = diag ? width - 1 : width;
      const lo = -Math.floor((w - 1) / 2), hi = lo + w - 1;
      for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) {
        if (inb(cx + dx, cy + dy)) fn(cx + dx, cy + dy, a, b);
      }
    });
  }
  function fillPoly(latlngs, fn) {
    const p = projPts(latlngs.concat([latlngs[0]]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    p.forEach((q) => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
        const px = x + 0.5, py = y + 0.5;
        let inside = false;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          if ((p[i].y > py) !== (p[j].y > py) && px < (p[j].x - p[i].x) * (py - p[i].y) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
        }
        if (inside) fn(x, y);
      }
    }
  }

  function generateMap() {
    const rng = mulberry32(CFG.map.seed || 1);
    tiles.fill(T.BLOCK);

    ZONES.forEach(([z, poly]) => fillPoly(poly, (x, y) => { zone[I(x, y)] = z; }));

    // Parks
    const park = (x, y) => { tiles[I(x, y)] = T.GRASS; parkFlag[I(x, y)] = 1; };
    fillPoly(GEO.regentsPark, park);
    fillPoly(GEO.hydePark, park);
    fillPoly(GEO.kensingtonGardens, park);
    GEO.otherGreens.forEach((g) => fillPoly(g, park));
    fillPoly(GEO.lords, (x, y) => { tiles[I(x, y)] = T.PITCH; });

    const sum = project(GEO.primroseSummit[0], GEO.primroseSummit[1]);
    fillPoly(GEO.primroseHill, (x, y) => {
      park(x, y);
      const d = Math.hypot(x + 0.5 - sum.x, (y + 0.5 - sum.y) * 1.2);
      hill[I(x, y)] = clamp(3 - Math.floor(d / 2.2), 0, 3);
    });

    const ic = GEO.innerCircle;
    fillPoly(geoCircle(ic.lat, ic.lng, ic.r), (x, y) => { tiles[I(x, y)] = T.GARDEN; });
    stroke(geoCircle(ic.lat, ic.lng, ic.r).concat([geoCircle(ic.lat, ic.lng, ic.r)[0]]), 1, (x, y) => { tiles[I(x, y)] = T.PATH; });

    GEO.lakes.forEach((l) => fillPoly(l, (x, y) => { tiles[I(x, y)] = T.WATER; }));

    GEO.parkPaths.forEach((p) => stroke(p, 1, (x, y) => {
      const t = tiles[I(x, y)];
      if (t === T.GRASS || t === T.GARDEN || t === T.PITCH) tiles[I(x, y)] = T.PATH;
    }));

    GEO.stations.forEach((s) => fillPoly(s, (x, y) => { tiles[I(x, y)] = T.STATION; }));

    // Regent's Canal (2 tiles of water + a towpath either side)
    GEO.canal.forEach((c) => stroke(c, 2, (x, y) => {
      const t = tiles[I(x, y)];
      if (t !== T.STATION && t !== T.WATER) tiles[I(x, y)] = T.CANAL;
    }));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[I(x, y)] !== T.CANAL) continue;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const t = get(x + dx, y + dy);
        if (t === T.BLOCK || t === T.GRASS) tiles[I(x + dx, y + dy)] = T.TOWPATH;
      });
    }

    GEO.railways.forEach(([w, pts]) => stroke(pts, w, (x, y, a, b) => {
      const i = I(x, y), t = tiles[i];
      if (t === T.STATION) return;
      bridge[i] = (t === T.CANAL || t === T.WATER) ? 1 : 0;
      tiles[i] = T.RAIL;
      railDir[i] = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 0 : 1;
    }));

    const road = (type) => (x, y) => {
      const i = I(x, y), t = tiles[i];
      if (t === T.STATION) return;
      if (type === T.MINOR && t === T.ROAD) return;
      if (t === T.CANAL || t === T.WATER || t === T.RAIL) bridge[i] = 1;
      if (type === T.MINOR && t === T.PATH) return;
      tiles[i] = type;
    };
    GEO.mainRoads.forEach((r) => stroke(r, 3, road(T.ROAD)));
    GEO.secondaryRoads.forEach((r) => stroke(r, 2, road(T.ROAD)));
    stroke(GEO.regentsPark.concat([GEO.regentsPark[0]]), 1, road(T.MINOR));
    GEO.minorRoads.forEach((r) => stroke(r, 1, road(T.MINOR)));

    // Garden squares: hedge border with gates, trees in the corners
    GEO.squares.forEach(([lat, lng, w, h]) => {
      const cells = [];
      fillPoly(geoRect(lat, lng, w, h), (x, y) => {
        const t = tiles[I(x, y)];
        if (t === T.BLOCK || t === T.MINOR) cells.push([x, y]);
      });
      if (!cells.length) return;
      const key = new Set(cells.map(([x, y]) => I(x, y)));
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      cells.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
      const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
      cells.forEach(([x, y]) => {
        const edge = !key.has(I(x + 1, y)) || !key.has(I(x - 1, y)) || !key.has(I(x, y + 1)) || !key.has(I(x, y - 1));
        let t = T.GRASS;
        if (edge && x !== mx && y !== my) t = T.HEDGE;
        else if (!edge && (x1 - x0) >= 4 && (y1 - y0) >= 4 &&
                 (x === x0 + 1 || x === x1 - 1) && (y === y0 + 1 || y === y1 - 1)) t = T.TREE;
        else if (!edge && x === mx && y === my) t = T.GARDEN;
        tiles[I(x, y)] = t;
      });
    });

    // Procedural side-street grid across the built-up blocks
    const hOff = Array.from({ length: Math.ceil(W / 22) + 1 }, () => Math.floor(rng() * 8));
    const vOff = Array.from({ length: Math.ceil(H / 16) + 1 }, () => Math.floor(rng() * 9));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[I(x, y)] !== T.BLOCK) continue;
      if ((y + hOff[Math.floor(x / 22)]) % 8 === 0 || (x + vOff[Math.floor(y / 16)]) % 9 === 0) tiles[I(x, y)] = T.MINOR;
    }

    // Trees in the parks
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = I(x, y);
      if (!parkFlag[i] || tiles[i] !== T.GRASS) continue;
      const p = 0.03 + 0.32 * Math.pow(noise2(x / 5, y / 5), 3) - hill[i] * 0.05;
      if (hash2(x, y, 3) < p) tiles[i] = T.TREE;
    }

    // Zebra crossings where a side street meets a main road
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tiles[I(x, y)] !== T.MINOR || hash2(x, y, 44) > 0.45) continue;
      [[0, 1, 1], [1, 0, 2]].forEach(([dx, dy, kind]) => {
        // the side street must run towards the road (not alongside it)
        if (get(x + dy, y + dx) === T.MINOR || get(x - dy, y - dx) === T.MINOR) return;
        if (zebra[I(clamp(x + dy, 0, W - 1), clamp(y + dx, 0, H - 1))]) return;
        const run = [];
        let cx = x + dx, cy = y + dy;
        while (get(cx, cy) === T.ROAD && run.length < 5) { run.push(I(cx, cy)); cx += dx; cy += dy; }
        if (run.length >= 2 && run.length <= 4 && get(cx, cy) !== T.ROAD && !run.some((i) => bridge[i])) run.forEach((i) => (zebra[i] = kind));
      });
    }
    // The Abbey Road crossing
    const ab = project(GEO.abbeyCrossing[0], GEO.abbeyCrossing[1]);
    for (let y = Math.floor(ab.y) - 2; y <= Math.floor(ab.y) + 2; y++) for (let x = Math.floor(ab.x) - 2; x <= Math.floor(ab.x) + 2; x++) {
      if (get(x, y) === T.ROAD) { abbey[I(x, y)] = 1; zebra[I(x, y)] = 1; }
    }
  }

  /* ===================================================================
     SECTION: 5. Entities (landmarks, stations, decor) + buildings
     =================================================================== */
  // Footprint [w, h] in tiles + total sprite height (sprites can rise above their footprint)
  const SPRITE_SIZE = {
    'home': [3, 3, 3], 'tube': [3, 2, 2], 'big station': [7, 3, 3], 'campus': [5, 4, 4], 'library tower': [3, 3, 5],
    'cinema': [4, 3, 3], 'karaoke': [3, 3, 3], 'supermarket': [4, 3, 3], 'restaurant': [3, 3, 3], 'climbing gym': [3, 3, 3],
    'garden square': [4, 4, 4], 'neighbourhood marker': [3, 2, 2], 'cafe': [3, 3, 3],
    // decor
    'bt tower': [2, 2, 7], 'british museum': [7, 3, 4], 'st pancras': [5, 3, 5], 'kings cross': [5, 2, 3],
    'centre point': [2, 2, 6], 'church': [2, 2, 5], 'marble arch': [3, 2, 2], 'camden lock': [4, 3, 3],
    'abbey road studios': [3, 2, 3], 'pavilion': [4, 2, 3], 'zoo': [3, 2, 3]
  };
  const LANDMARK_TYPES = ['home', 'tube', 'big station', 'campus', 'library tower', 'cinema', 'karaoke', 'supermarket',
    'restaurant', 'climbing gym', 'garden square', 'neighbourhood marker', 'cafe'];
  const TUBE_TYPES = ['tube', 'big station'];

  const ENT = [];
  function addEntity(o) {
    const size = SPRITE_SIZE[o.sprite] || SPRITE_SIZE.home;
    o.w = size[0]; o.h = size[1]; o.sh = size[2];
    o.i = ENT.length; ENT.push(o);
    return o;
  }

  // Landmarks from config.js
  const LM = CFG.landmarks.map((d, li) => {
    const sprite = LANDMARK_TYPES.indexOf(d.sprite) >= 0 ? d.sprite : 'home';
    if (sprite !== d.sprite) console.warn('Unknown sprite type "' + d.sprite + '" for ' + d.id + ' — using "home".');
    return addEntity(Object.assign({}, d, {
      kind: 'landmark', li, sprite,
      notes: (d.notes && d.notes.length) ? d.notes : ['...'],
      lastYear: (d.tag || '').toLowerCase() === 'last year',
      isTube: TUBE_TYPES.indexOf(sprite) >= 0
    }));
  });

  // Tube stations: reuse a landmark if one is that station, otherwise add a small station building
  const STN_BY = {};
  const normName = (s) => String(s || '').toLowerCase().replace(/station|underground|tube|[^a-z]/g, '');
  STATIONS.forEach((s) => {
    STN_BY[s.id] = s;
    s.lines = [];
    s.ent = LM.find((l) => l.isTube && (l.station === s.id || (!l.station && normName(l.name) === normName(s.name))));
    if (s.ent) s.ent.stn = s;
  });
  LINES.forEach((L) => L.seq.forEach((id) => { const s = STN_BY[id]; if (s && s.lines.indexOf(L.name) < 0) s.lines.push(L.name); }));
  STATIONS.forEach((s) => {
    if (!s.ent) s.ent = addEntity({ kind: 'station', id: 'stn-' + s.id, name: s.name + ' station', sprite: 'tube', sign: s.sign, lat: s.lat, lng: s.lng, stn: s });
  });
  // Famous buildings
  DECOR.forEach((d) => addEntity(Object.assign({ kind: 'decor' }, d)));

  // Tiles a footprint is allowed to sit on
  const CAN_BUILD = new Uint8Array(20);
  [T.BLOCK, T.GRASS, T.TREE, T.HEDGE, T.GARDEN, T.MINOR, T.PITCH].forEach((t) => (CAN_BUILD[t] = 1));

  function placeEntities() {
    const reserved = new Uint8Array(N);
    ENT.forEach((e) => {
      const p = project(e.lat, e.lng);
      const px = clamp(Math.floor(p.x), 2, W - 3), py = clamp(Math.floor(p.y), e.h + 1, H - 2);
      let best = null, bestScore = Infinity;
      const R = e.kind === 'decor' ? 10 : 16;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const dist = Math.hypot(dx, dy);
        if (dist > R || dist >= bestScore) continue;
        const ex = px + dx, ey = py + dy;
        const fx = ex - Math.floor(e.w / 2), fy = ey - e.h;
        if (fx < 1 || fy < 1 || fx + e.w >= W - 1 || ey >= H - 1) continue;
        let ok = true, minor = 0;
        for (let y = fy; y <= ey && ok; y++) for (let x = fx; x < fx + e.w; x++) {
          const i = I(x, y);
          if (reserved[i]) { ok = false; break; }
          if (y < ey) {
            if (!CAN_BUILD[tiles[i]]) { ok = false; break; }
            if (tiles[i] === T.MINOR) minor++;
          }
        }
        if (!ok) continue;
        const et = tiles[I(ex, ey)];
        if (et === T.WATER || et === T.CANAL || et === T.RAIL || et === T.STATION) continue;
        const touches = isWalk(ex, ey) || isWalk(ex, ey + 1) || isWalk(ex - 1, ey) || isWalk(ex + 1, ey);
        const score = dist + minor * 0.35 + (touches ? 0 : 2.5);
        if (score < bestScore) { bestScore = score; best = { ex, ey, fx, fy }; }
      }
      if (!best) {
        if (e.kind === 'decor') { e.skip = true; console.warn('No room for decor ' + e.id); return; }
        console.warn('Could not find free space for ' + e.id + ' — forcing it.');
        best = { ex: px, ey: py, fx: px - Math.floor(e.w / 2), fy: py - e.h };
      }
      Object.assign(e, best);
      for (let y = e.fy; y < e.ey; y++) for (let x = e.fx; x < e.fx + e.w; x++) {
        tiles[I(x, y)] = T.LANDMARK; entAt[I(x, y)] = e.i + 1; bridge[I(x, y)] = 0; zebra[I(x, y)] = 0;
      }
      if (tiles[I(e.ex, e.ey)] !== T.ROAD) tiles[I(e.ex, e.ey)] = T.PLAZA;
      bridge[I(e.ex, e.ey)] = 0;
      entEntr[I(e.ex, e.ey)] = e.i + 1;
      for (let y = e.fy - 1; y <= e.ey + 1; y++) for (let x = e.fx - 1; x <= e.fx + e.w; x++) {
        if (inb(x, y)) reserved[I(x, y)] = 1;
      }
    });
  }
  const PLACED = () => ENT.filter((e) => !e.skip);

  function components() {
    const comp = new Int32Array(N).fill(-1);
    const sizes = [];
    const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0 || !WALK[tiles[s]]) continue;
      const id = sizes.length; let head = 0, tail = 0, size = 0;
      q[tail++] = s; comp[s] = id;
      while (head < tail) {
        const u = q[head++]; size++;
        const x = u % W, y = (u / W) | 0;
        if (x > 0) visit(u - 1); if (x < W - 1) visit(u + 1);
        if (y > 0) visit(u - W); if (y < H - 1) visit(u + W);
      }
      sizes.push(size);
      function visit(v) { if (comp[v] < 0 && WALK[tiles[v]]) { comp[v] = id; q[tail++] = v; } }
    }
    let mainId = 0;
    sizes.forEach((s, i) => { if (s > sizes[mainId]) mainId = i; });
    return { comp, mainId };
  }

  // Make sure every entrance can be walked to; if not, carve a little alley/bridge.
  function ensureReachable() {
    let { comp, mainId } = components();
    PLACED().forEach((e) => {
      const s = I(e.ex, e.ey);
      if (comp[s] === mainId) return;
      const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
      const heap = new Heap();
      dist[s] = 0; heap.push(0, s);
      let found = -1;
      while (heap.size) {
        const u = heap.pop();
        if (comp[u] === mainId) { found = u; break; }
        const x = u % W, y = (u / W) | 0;
        const nb = [];
        if (x > 0) nb.push(u - 1); if (x < W - 1) nb.push(u + 1);
        if (y > 0) nb.push(u - W); if (y < H - 1) nb.push(u + W);
        for (const v of nb) {
          const t = tiles[v];
          if (t === T.LANDMARK) continue;
          const c = WALK[t] ? 1 : (t === T.WATER || t === T.CANAL || t === T.RAIL) ? 10 : t === T.STATION ? 40 : 3;
          const nd = dist[u] + c;
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
        }
      }
      if (found < 0) { console.warn('Could not connect ' + e.id); return; }
      for (let u = found; u !== -1; u = prev[u]) {
        const t = tiles[u];
        if (WALK[t]) continue;
        if (t === T.WATER || t === T.CANAL || t === T.RAIL) bridge[u] = 1;
        tiles[u] = T.MINOR;
      }
      ({ comp, mainId } = components());
    });
  }

  // ---- London building styles ----
  const SLATES = ['#5d6470', '#666c78', '#525863', '#6e6a66', '#5a5f6a', '#7a5a4a', '#8f4f3d'];
  const STYLES = {
    terrace:    { roofKind: 'slate',   walls: ['#c9a466', '#bf9a5e', '#b8915a', '#c7a873', '#a8865a'], roofs: SLATES, frows: 1 },
    georgian:   { roofKind: 'parapet', walls: ['#8e5a3e', '#9c6448', '#a5704f', '#7f5038', '#94603f'], roofs: SLATES, frows: 1 },
    stucco:     { roofKind: 'slate',   walls: ['#f1ece0', '#ece4d2', '#f4efe6', '#e9e1cf'], roofs: SLATES, frows: 1 },
    mansion:    { roofKind: 'mansard', walls: ['#a3463a', '#b0503f', '#9a4436'], roofs: ['#4a4f58', '#555b66'], frows: 2 },
    office:     { roofKind: 'flat',    walls: ['#4f7590', '#5a8098', '#3f6a84', '#6a8a9a', '#7a96a6'], roofs: ['#9aa3a8', '#8f989e'], frows: 2 },
    estate:     { roofKind: 'flat',    walls: ['#b8b0a2', '#a89f90', '#8c6b55', '#9a7a62', '#c2b8a6'], roofs: ['#a8a297', '#9d978b'], frows: 2 },
    shop:       { roofKind: 'slate',   walls: ['#c9a466', '#a5704f', '#e8e0d0', '#bf9a5e'], roofs: SLATES, frows: 1 },
    camdenshop: { roofKind: 'flat',    walls: ['#ff7aa2', '#ffd166', '#4fd1c5', '#9b6bd6', '#7cc05a', '#ff9f5a', '#5aa9ff'], roofs: ['#8f8a80'], frows: 1 },
    pub:        { roofKind: 'slate',   walls: ['#c9a466', '#9c6448', '#e8e0d0'], roofs: SLATES, frows: 1 },
    warehouse:  { roofKind: 'slate',   walls: ['#8a4a36', '#94523c', '#7f4432'], roofs: ['#5d6470', '#4f5560'], frows: 2 },
    dept:       { roofKind: 'flat',    walls: ['#e3dccb', '#d9d0bc', '#ebe4d6'], roofs: ['#a8a297'], frows: 2 }
  };
  const ACCENTS = ['#b0282f', '#1f5a3a', '#1d2f5a', '#222226', '#6b1f3a', '#1f6b6b', '#7a4a1f', '#2b5a8a'];
  const DOORS = ['#1f1f24', '#a3242b', '#24457a', '#2e6b45', '#d4a52a', '#5a2a4a', '#2f2f6a', '#1f1f24'];

  // Choose a style for a building from its zone + whether it faces a main road
  function chooseStyle(z, nearRoad, r) {
    const T2 = (list) => { let acc = 0; for (const [name, p] of list) { acc += p; if (r < acc) return name; } return list[list.length - 1][0]; };
    switch (z) {
      case Z.GEORGIAN: return nearRoad ? T2([['shop', 0.35], ['pub', 0.12], ['georgian', 0.53]]) : T2([['georgian', 0.85], ['mansion', 0.15]]);
      case Z.STUCCO: return nearRoad ? T2([['shop', 0.25], ['pub', 0.1], ['stucco', 0.65]]) : T2([['stucco', 0.88], ['mansion', 0.12]]);
      case Z.ESTATE: return T2([['estate', 0.85], ['terrace', 0.15]]);
      case Z.OFFICE: return T2([['office', 0.75], ['mansion', 0.25]]);
      case Z.SOHO: return T2([['shop', 0.45], ['pub', 0.2], ['georgian', 0.25], ['office', 0.1]]);
      case Z.CAMDEN: return nearRoad ? T2([['camdenshop', 0.6], ['pub', 0.2], ['terrace', 0.2]]) : T2([['terrace', 0.7], ['warehouse', 0.1], ['estate', 0.2]]);
      case Z.KINGSX: return T2([['warehouse', 0.45], ['office', 0.35], ['terrace', 0.2]]);
      case Z.OXFORD: return T2([['dept', 0.5], ['shop', 0.3], ['office', 0.2]]);
      default: return nearRoad ? T2([['shop', 0.4], ['pub', 0.15], ['terrace', 0.45]]) : T2([['terrace', 0.75], ['mansion', 0.1], ['estate', 0.15]]);
    }
  }
  const BIG_ZONES = [Z.OFFICE, Z.ESTATE, Z.OXFORD, Z.KINGSX];

  function makeBuildings() {
    const rng = mulberry32((CFG.map.seed || 1) * 7 + 3);
    const seen = new Uint8Array(N);
    buildings = [null];
    for (let s = 0; s < N; s++) {
      if (seen[s] || tiles[s] !== T.BLOCK) continue;
      const cells = [s]; seen[s] = 1;
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (let k = 0; k < cells.length; k++) {
        const u = cells[k], x = u % W, y = (u / W) | 0;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          if (!inb(x + dx, y + dy)) return;
          const v = I(x + dx, y + dy);
          if (!seen[v] && tiles[v] === T.BLOCK) { seen[v] = 1; cells.push(v); }
        });
      }
      const cz = zone[I((x0 + x1) >> 1, (y0 + y1) >> 1)];
      const big = BIG_ZONES.indexOf(cz) >= 0;
      // cut into columns and rows
      const cols = [], rows = [];
      for (let x = x0; x <= x1;) { const w = big ? 4 + Math.floor(rng() * 4) : 2 + Math.floor(rng() * 3); cols.push(x); x += w; }
      const bh = y1 - y0 + 1;
      if (bh <= (big ? 6 : 4)) rows.push(y0);
      else for (let y = y0; y <= y1;) { let h = (big ? 3 : 2) + Math.floor(rng() * 3); if (y1 - (y + h) + 1 < 2) h = y1 - y + 1; rows.push(y); y += h; }
      const base = buildings.length;
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
        const bx0 = cols[c], bx1 = (c + 1 < cols.length ? cols[c + 1] : x1 + 1) - 1;
        const by1 = (r + 1 < rows.length ? rows[r + 1] : y1 + 1) - 1;
        const cxm = clamp((bx0 + bx1) >> 1, 0, W - 1), cym = clamp(by1, 0, H - 1);
        let nearRoad = false;
        for (let x = bx0; x <= bx1 && !nearRoad; x++) for (let d = 1; d <= 2; d++) if (get(x, by1 + d) === T.ROAD) nearRoad = true;
        const style = chooseStyle(zone[I(cxm, cym)], nearRoad, rng());
        const S = STYLES[style];
        buildings.push({
          style, roofKind: S.roofKind, frows: S.frows,
          roof: pick(S.roofs, rng()), wall: pick(S.walls, rng()),
          accent: pick(ACCENTS, rng()), doorColor: pick(DOORS, rng()),
          door: bx0 + Math.floor(rng() * (bx1 - bx0 + 1)),
          awning: rng() < 0.5, x0: bx0, x1: bx1, seed: rng()
        });
      }
      const idx = (arr, v) => { let k = 0; while (k + 1 < arr.length && arr[k + 1] <= v) k++; return k; };
      cells.forEach((u) => {
        const x = u % W, y = (u / W) | 0;
        tiles[u] = T.BUILDING;
        bid[u] = base + idx(rows, y) * cols.length + idx(cols, x);
      });
    }
  }

  /* ===================================================================
     SECTION: 6. Tile painting — the whole map is pre-rendered once
     =================================================================== */
  const PAL = {
    grass: '#7cbf4f', grassD: '#5f9e3b', grassL: '#9ad665',
    path: '#e4c992', pathD: '#c8a96e',
    road: '#5a5c66', roadEdge: '#a3a5ac', roadLine: '#d9d4c4',
    minor: '#8e9098', minorEdge: '#bdb8ad',
    water: '#4b93db', waterL: '#8cc4f5', waterD: '#3a78bd',
    canal: '#3f8296', canalL: '#6fb3c4', stone: '#8f8a7e',
    tow: '#cdb98d', towD: '#b39f74',
    ballast: '#8a7e72', sleeper: '#5b4535', rail: '#c7cbd3',
    hedge: '#3f7d36', hedgeD: '#2c5d27', hedgeL: '#58a04a',
    plaza: '#d8d0bf', plazaD: '#c2b9a6',
    station: '#8aa2b4', stationD: '#5f7688', stationL: '#b9ccd9',
    ink: '#2b2233',
    glass: '#36475e', lit: '#ffd66b',
    red: '#c8102e'
  };

  let world = null;
  const mapWindows = [];          // [x, y, w, h] windows that light up at night
  const mapLamps = [];            // [x, y] street lamps that glow at night

  function paintWorld() {
    world = document.createElement('canvas');
    world.width = WORLD_W; world.height = WORLD_H;
    const g = world.getContext('2d');
    const r = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintTile(g, r, x, y);

    // Soft shadows south of buildings, hedges and station roofs
    g.fillStyle = 'rgba(30,20,40,0.2)';
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tiles[I(x, y)], up = tiles[I(x, y - 1)];
      if ((up === T.BUILDING || up === T.STATION || up === T.HEDGE || up === T.LANDMARK) &&
          t !== T.BUILDING && t !== T.STATION && t !== T.HEDGE && t !== T.LANDMARK) g.fillRect(x * TILE, y * TILE, TILE, 3);
    }

    paintStreetFurniture(r);

    // Faded area names on the ground
    g.font = '16px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    (CFG.areaLabels || []).forEach((l) => {
      const p = project(l.lat, l.lng);
      const x = clamp(p.x * TILE, 140, WORLD_W - 140), y = clamp(p.y * TILE, 20, WORLD_H - 20);
      g.globalAlpha = 0.35; g.fillStyle = '#fff6e0'; g.fillText(l.name, x + 2, y + 2);
      g.globalAlpha = 0.45; g.fillStyle = '#2b2233'; g.fillText(l.name, x, y);
      g.globalAlpha = 1;
    });
    // little sign next to the Abbey Road crossing
    const ab = project(GEO.abbeyCrossing[0], GEO.abbeyCrossing[1]);
    const sx = Math.round(ab.x * TILE) + 26, sy = Math.round(ab.y * TILE) - 22;
    r(sx - 1, sy - 1, 42, 9, PAL.ink); r(sx, sy, 40, 7, '#f4f1e8');
    drawTinyCentered(g, 'ABBEY RD', sx + 20, sy + 1, '#c8102e');
    r(sx + 19, sy + 8, 2, 12, '#3a3a40');
  }

  function paintTile(g, r, x, y) {
    const i = I(x, y), t = tiles[i], px = x * TILE, py = y * TILE;
    const nb = (dx, dy) => { const v = get(x + dx, y + dy); return v === -1 ? t : v; };
    const h = (s) => hash2(x, y, s);

    const grass = () => {
      const lvl = hill[i];
      const base = lvl ? shade(PAL.grass, lvl * 0.07) : PAL.grass;
      r(px, py, TILE, TILE, base);
      for (let k = 0; k < 3; k++) {
        const tx = px + Math.floor(h(10 + k) * 13), ty = py + Math.floor(h(20 + k) * 13);
        r(tx, ty, 1, 1, PAL.grassD); r(tx + 2, ty, 1, 1, PAL.grassD); r(tx + 1, ty + 1, 1, 1, PAL.grassD);
      }
      if (h(30) < 0.5) r(px + Math.floor(h(31) * 15), py + Math.floor(h(32) * 15), 1, 1, PAL.grassL);
      if (lvl && get(x, y + 1) !== -1 && hill[I(x, y + 1)] < lvl) { r(px, py + 13, TILE, 2, shade(base, -0.25)); r(px, py + 12, TILE, 1, shade(base, 0.15)); }
    };

    switch (t) {
      case T.GRASS: grass(); break;
      case T.PITCH: r(px, py, TILE, TILE, (x % 2) ? '#86c95a' : '#74b84a'); break;
      case T.GARDEN: {
        grass();
        const cols = ['#ff7aa2', '#ffd166', '#ffffff', '#c58cff', '#ff9f5a'];
        for (let k = 0; k < 6; k++) r(px + 1 + Math.floor(h(40 + k) * 13), py + 1 + Math.floor(h(50 + k) * 13), 2, 2, cols[Math.floor(h(60 + k) * cols.length)]);
        break;
      }
      case T.TREE: {
        grass();
        const c = h(70) < 0.5 ? '#3e8e3a' : '#357f37';
        r(px + 3, py + 13, 10, 2, 'rgba(20,40,20,0.3)');
        r(px + 7, py + 10, 2, 4, '#6b4a2b');
        r(px + 4, py + 1, 8, 1, PAL.ink); r(px + 2, py + 2, 12, 1, PAL.ink);
        r(px + 1, py + 3, 14, 8, PAL.ink); r(px + 2, py + 11, 12, 1, PAL.ink);
        r(px + 4, py + 2, 8, 1, c); r(px + 2, py + 3, 12, 8, c);
        r(px + 2, py + 9, 12, 2, shade(c, -0.22));
        r(px + 4, py + 4, 5, 3, shade(c, 0.25)); r(px + 5, py + 3, 2, 1, shade(c, 0.35));
        break;
      }
      case T.HEDGE:
        r(px, py, TILE, TILE, PAL.hedgeD);
        r(px, py, TILE, 11, PAL.hedge);
        for (let k = 0; k < 4; k++) r(px + Math.floor(h(80 + k) * 14), py + Math.floor(h(90 + k) * 9), 2, 1, PAL.hedgeL);
        break;
      case T.PATH:
        r(px, py, TILE, TILE, PAL.path);
        for (let k = 0; k < 3; k++) r(px + Math.floor(h(100 + k) * 15), py + Math.floor(h(110 + k) * 15), 1, 1, PAL.pathD);
        if (nb(0, -1) !== T.PATH && WALK[nb(0, -1)] && nb(0, -1) !== T.PLAZA) r(px, py, TILE, 1, PAL.pathD);
        break;
      case T.TOWPATH:
        r(px, py, TILE, TILE, PAL.tow);
        for (let k = 0; k < 3; k++) r(px + Math.floor(h(120 + k) * 15), py + Math.floor(h(130 + k) * 15), 1, 1, PAL.towD);
        break;
      case T.ROAD:
      case T.MINOR: {
        const main = t === T.ROAD;
        const base = main ? PAL.road : PAL.minor, edge = main ? PAL.roadEdge : PAL.minorEdge;
        r(px, py, TILE, TILE, base);
        if (h(140) < 0.4) r(px + Math.floor(h(141) * 15), py + Math.floor(h(142) * 15), 1, 1, shade(base, -0.12));
        const isRoad = (v) => v === T.ROAD || v === T.MINOR || v === T.PLAZA;
        const ew = main ? 2 : 1;
        if (!isRoad(nb(0, -1))) r(px, py, TILE, ew, edge);
        if (!isRoad(nb(0, 1))) r(px, py + TILE - ew, TILE, ew, edge);
        if (!isRoad(nb(-1, 0))) r(px, py, ew, TILE, edge);
        if (!isRoad(nb(1, 0))) r(px + TILE - ew, py, ew, TILE, edge);
        if (main && !bridge[i] && !zebra[i]) {
          const R3 = (ox, oy) => get(x + ox, y + oy) === T.ROAD;
          const vRun = (ox) => R3(ox, 0) && R3(ox, -1) && R3(ox, 1) && !R3(ox, -2) && !R3(ox, 2);   // 3 tall
          const hRun = (oy) => R3(0, oy) && R3(-1, oy) && R3(1, oy) && !R3(-2, oy) && !R3(2, oy);   // 3 wide
          if (vRun(-1) && vRun(0) && vRun(1)) r(px + 4, py + 7, 7, 1, PAL.roadLine);
          else if (hRun(-1) && hRun(0) && hRun(1)) r(px + 7, py + 4, 1, 7, PAL.roadLine);
        }
        if (zebra[i] === 1) for (let k = 1; k < 16; k += 4) r(px + 2, py + k, 12, 2, '#f2f0ea');
        if (zebra[i] === 2) for (let k = 1; k < 16; k += 4) r(px + k, py + 2, 2, 12, '#f2f0ea');
        if (bridge[i]) {
          // parapet only on the edges that look down onto the tracks / water
          const under = (v) => v === T.CANAL || v === T.WATER || v === T.RAIL;
          const rail = '#e7e2d3';
          if (under(nb(0, -1))) { r(px, py, TILE, 2, rail); r(px, py + 2, TILE, 1, PAL.ink); }
          if (under(nb(0, 1))) { r(px, py + 13, TILE, 1, PAL.ink); r(px, py + 14, TILE, 2, rail); }
          if (under(nb(-1, 0))) { r(px, py, 2, TILE, rail); r(px + 2, py, 1, TILE, PAL.ink); }
          if (under(nb(1, 0))) { r(px + 13, py, 1, TILE, PAL.ink); r(px + 14, py, 2, TILE, rail); }
        }
        break;
      }
      case T.PLAZA:
      case T.LANDMARK:
        r(px, py, TILE, TILE, PAL.plaza);
        r(px, py + 7, TILE, 1, PAL.plazaD); r(px + ((y % 2) ? 3 : 11), py, 1, 7, PAL.plazaD); r(px + ((y % 2) ? 11 : 3), py + 8, 1, 8, PAL.plazaD);
        break;
      case T.WATER: {
        r(px, py, TILE, TILE, PAL.water);
        if (h(150) < 0.5) r(px + 2 + Math.floor(h(151) * 10), py + 3 + Math.floor(h(152) * 10), 4, 1, PAL.waterD);
        const land = (v) => v !== T.WATER;
        if (land(nb(0, -1))) r(px, py, TILE, 2, PAL.waterL);
        if (land(nb(0, 1))) r(px, py + 14, TILE, 2, PAL.waterD);
        if (land(nb(-1, 0))) r(px, py, 2, TILE, PAL.waterL);
        if (land(nb(1, 0))) r(px + 14, py, 2, TILE, PAL.waterL);
        break;
      }
      case T.CANAL: {
        r(px, py, TILE, TILE, PAL.canal);
        const land = (v) => v !== T.CANAL && v !== T.RAIL && !(v === T.ROAD || v === T.MINOR);
        if (land(nb(0, -1))) r(px, py, TILE, 2, PAL.stone);
        if (land(nb(0, 1))) r(px, py + 14, TILE, 2, shade(PAL.stone, -0.2));
        if (land(nb(-1, 0))) r(px, py, 2, TILE, PAL.stone);
        if (land(nb(1, 0))) r(px + 14, py, 2, TILE, PAL.stone);
        // the odd narrowboat
        if (h(155) < 0.05) {
          const cols = ['#2e6b45', '#a3242b', '#24457a', '#5a2a4a'];
          const c = cols[Math.floor(h(156) * cols.length)];
          if (nb(-1, 0) === T.CANAL || nb(1, 0) === T.CANAL) { r(px + 1, py + 5, 14, 6, PAL.ink); r(px + 2, py + 6, 12, 4, c); r(px + 4, py + 7, 8, 2, '#e8c060'); }
          else { r(px + 5, py + 1, 6, 14, PAL.ink); r(px + 6, py + 2, 4, 12, c); r(px + 7, py + 4, 2, 8, '#e8c060'); }
        }
        break;
      }
      case T.RAIL: {
        r(px, py, TILE, TILE, bridge[i] ? '#6d5c4c' : PAL.ballast);
        if (!bridge[i]) for (let k = 0; k < 3; k++) r(px + Math.floor(h(160 + k) * 15), py + Math.floor(h(170 + k) * 15), 1, 1, shade(PAL.ballast, -0.15));
        if (railDir[i] === 0) {
          for (let k = 1; k < 16; k += 4) r(px + k, py + 3, 2, 10, PAL.sleeper);
          r(px, py + 4, TILE, 1, PAL.rail); r(px, py + 5, TILE, 1, '#7d818a');
          r(px, py + 10, TILE, 1, PAL.rail); r(px, py + 11, TILE, 1, '#7d818a');
        } else {
          for (let k = 1; k < 16; k += 4) r(px + 3, py + k, 10, 2, PAL.sleeper);
          r(px + 4, py, 1, TILE, PAL.rail); r(px + 5, py, 1, TILE, '#7d818a');
          r(px + 10, py, 1, TILE, PAL.rail); r(px + 11, py, 1, TILE, '#7d818a');
        }
        break;
      }
      case T.STATION:
        r(px, py, TILE, TILE, PAL.station);
        for (let k = 0; k < 16; k += 4) r(px + k, py, 1, TILE, PAL.stationD);
        if (nb(0, -1) !== T.STATION) r(px, py, TILE, 2, PAL.stationL);
        if (nb(0, 1) !== T.STATION) r(px, py + 12, TILE, 4, '#c9bfae');
        if (nb(-1, 0) !== T.STATION) r(px, py, 1, TILE, PAL.ink);
        if (nb(1, 0) !== T.STATION) r(px + 15, py, 1, TILE, PAL.ink);
        break;
      case T.BUILDING:
      default:
        paintBuilding(r, x, y, px, py);
    }
  }

  // ---- Buildings: roof tiles on top, a front wall (1-2 floors) at the bottom ----
  function paintBuilding(r, x, y, px, py) {
    const b = bid[I(x, y)];
    const B = buildings[b] || { style: 'terrace', roofKind: 'slate', frows: 1, roof: SLATES[0], wall: '#c9a466', door: -1, x0: x, x1: x, accent: '#b0282f', doorColor: '#1f1f24', seed: 0 };
    const same = (dx, dy) => inb(x + dx, y + dy) && bid[I(x + dx, y + dy)] === b;
    let rb = 0; while (same(0, rb + 1)) rb++;
    let ra = 0; while (same(0, -(ra + 1))) ra++;
    const colH = ra + rb + 1;
    const fr = colH === 1 ? 1 : Math.min(B.frows, colH - 1);
    const o = { B, left: same(-1, 0), right: same(1, 0), up: same(0, -1), top: ra === 0, rb, fr, colH };
    if (rb >= fr) paintRoof(r, x, y, px, py, o);
    else paintFacade(r, x, y, px, py, o);
  }

  function chimney(r, px, py) {
    r(px + 1, py - 4, 7, 8, PAL.ink);
    r(px + 2, py - 3, 5, 7, '#9a5a42'); r(px + 2, py - 3, 5, 1, '#b8735a');
    r(px + 2, py - 6, 2, 3, PAL.ink); r(px + 5, py - 6, 2, 3, PAL.ink);
    r(px + 2, py - 6, 1, 2, '#d2763f'); r(px + 5, py - 6, 1, 2, '#d2763f');
  }

  function paintRoof(r, x, y, px, py, o) {
    const B = o.B, roof = B.roof;
    const sides = () => {
      if (!o.left) r(px, py, 1, TILE, shade(roof, -0.4));
      if (!o.right) r(px + 15, py, 1, TILE, shade(roof, -0.4));
    };
    switch (B.roofKind) {
      case 'flat': {
        r(px, py, TILE, TILE, roof);
        for (let k = 0; k < 4; k++) r(px + Math.floor(hash2(x, y, 200 + k) * 15), py + Math.floor(hash2(x, y, 210 + k) * 15), 1, 1, shade(roof, -0.15));
        if (o.top) r(px, py, TILE, 2, shade(roof, -0.25));
        if (!o.left) r(px, py, 2, TILE, shade(roof, -0.25));
        if (!o.right) r(px + 14, py, 2, TILE, shade(roof, -0.25));
        if (o.rb === o.fr) r(px, py + 14, TILE, 2, shade(roof, -0.3));
        const hh = hash2(x, y, 220);
        if (hh < 0.22) { r(px + 4, py + 4, 7, 6, PAL.ink); r(px + 5, py + 5, 5, 4, '#c9cdd2'); r(px + 6, py + 6, 3, 2, '#7f858c'); }   // AC unit
        else if (hh < 0.32) { r(px + 3, py + 4, 9, 6, '#8fb3c9'); r(px + 3, py + 4, 9, 1, '#c6dbe8'); }                                  // skylight
        else if (hh < 0.38 && B.style === 'estate') { r(px + 5, py + 3, 6, 8, PAL.ink); r(px + 6, py + 4, 4, 6, '#d0c8b8'); }            // stair core
        if (o.top) r(px, py, TILE, 1, PAL.ink);
        break;
      }
      case 'mansard': {
        r(px, py, TILE, TILE, roof);
        for (let k = (y % 2) ? 1 : 3; k < 16; k += 4) r(px, py + k, TILE, 1, shade(roof, -0.15));
        if (o.top) { r(px, py, TILE, 3, '#8c939c'); r(px, py, TILE, 1, PAL.ink); }
        if (o.rb === o.fr) {   // dormer windows on the bottom roof row
          [3, 10].forEach((wx) => {
            r(px + wx - 1, py + 5, 5, 8, '#f1ece0'); r(px + wx, py + 7, 3, 5, PAL.glass);
            r(px + wx - 1, py + 4, 5, 1, PAL.ink);
            if (hash2(x * 3 + wx, y, 21) < 0.5) mapWindows.push([px + wx, py + 7, 3, 5]);
          });
        }
        sides();
        break;
      }
      case 'parapet': {
        r(px, py, TILE, TILE, roof);
        for (let k = (y % 2) ? 1 : 3; k < 16; k += 4) r(px, py + k, TILE, 1, shade(roof, -0.12));
        if (o.top) { r(px, py, TILE, 3, B.wall); r(px, py + 3, TILE, 1, shade(B.wall, -0.35)); r(px, py, TILE, 1, PAL.ink); }
        if (o.rb === o.fr) { r(px, py + 13, TILE, 3, B.wall); r(px, py + 13, TILE, 1, '#efe6d4'); }
        sides();
        if (o.top && x === B.x0) chimney(r, px, py + 4);
        break;
      }
      default: {   // pitched slate
        r(px, py, TILE, TILE, roof);
        for (let k = (y % 2) ? 1 : 3; k < 16; k += 4) r(px, py + k, TILE, 1, shade(roof, -0.12));
        if (o.top) { r(px, py, TILE, 2, shade(roof, 0.22)); r(px, py, TILE, 1, PAL.ink); }
        if (o.rb === o.fr) r(px, py + 15, TILE, 1, shade(roof, -0.35));
        sides();
        if (o.top && x === B.x0 && B.style !== 'warehouse') chimney(r, px, py + 4);
        if (B.style === 'warehouse' && o.top) { for (let k = 2; k < 16; k += 5) r(px + k, py + 2, 2, 5, '#9fb6c6'); }   // roof lights
      }
    }
  }

  // window helper used by facades
  function sash(r, x, y, w, h, frame, glass, chance, salt) {
    r(x - 1, y - 1, w + 2, h + 2, frame);
    r(x, y, w, h, glass || PAL.glass);
    r(x, y, 1, Math.min(2, h), '#7f97b5');
    if (h >= 6) r(x, y + (h >> 1), w, 1, frame);
    if (hash2(x, y, salt || 9) < (chance === undefined ? 0.55 : chance)) mapWindows.push([x, y, w, h]);
  }

  function paintFacade(r, x, y, px, py, o) {
    const B = o.B, wall = B.wall;
    const ground = o.rb === 0;
    const single = o.colH === 1;
    const topF = o.rb === o.fr - 1;
    const isDoor = ground && B.door === x;
    r(px, py, TILE, TILE, wall);

    // roof strip for single-row buildings
    let top = 0;
    if (single) { top = 4; r(px, py, TILE, 4, B.roof); r(px, py, TILE, 1, PAL.ink); r(px, py + 1, TILE, 1, shade(B.roof, 0.2)); }

    const brickTexture = () => {
      for (let k = 0; k < 5; k++) r(px + Math.floor(hash2(x, y, 230 + k) * 15), py + top + Math.floor(hash2(x, y, 240 + k) * (15 - top)), 2, 1, shade(wall, -0.1));
    };
    const edges = () => {
      if (!o.left) r(px, py, 1, TILE, shade(wall, -0.35));
      if (!o.right) r(px + 15, py, 1, TILE, shade(wall, -0.35));
      if (ground) r(px, py + 15, TILE, 1, shade(wall, -0.45));
    };
    const eave = () => { if (topF && !single) r(px, py, TILE, 2, shade(B.roof, -0.3)); };
    const door = (c, fan) => {
      r(px + 5, py + 7, 6, 9, PAL.ink); r(px + 6, py + 8, 4, 8, c);
      if (fan) { r(px + 6, py + 6, 4, 2, '#f1ece0'); r(px + 7, py + 6, 2, 1, PAL.glass); }
      r(px + 9, py + 12, 1, 1, '#e8c060'); r(px + 4, py + 15, 8, 1, '#d8d2c4');
    };
    const railings = () => { r(px, py + 12, TILE, 1, PAL.ink); for (let k = 0; k < 16; k += 2) r(px + k, py + 12, 1, 4, PAL.ink); };
    const shopfront = (fascia, awning) => {
      r(px, py + top + 1, TILE, 4, fascia); r(px, py + top + 1, TILE, 1, shade(fascia, 0.25));
      if (hash2(x, y, 250) < 0.7) for (let k = 2; k < 14; k += 2) if (hash2(x + k, y, 251) < 0.7) r(px + k, py + top + 3, 1, 1, '#f4ecd0');
      if (isDoor) { r(px + 6, py + top + 5, 4, 11 - top, PAL.ink); r(px + 7, py + top + 6, 2, 10 - top, '#6f86a3'); }
      else {
        r(px + 1, py + top + 6, 14, 9 - top, PAL.ink); r(px + 2, py + top + 7, 12, 8 - top, '#5b7389');
        for (let k = 0; k < 4; k++) r(px + 3 + k * 3, py + 12, 2, 2, ['#ff7aa2', '#ffd166', '#7cc05a', '#ffffff', '#ff9f5a'][Math.floor(hash2(x, k, 252) * 5)]);
        mapWindows.push([px + 2, py + top + 7, 12, 8 - top]);
      }
      if (awning) for (let k = 0; k < 16; k += 4) { r(px + k, py + top + 5, 2, 3, fascia); r(px + k + 2, py + top + 5, 2, 3, '#f4efe4'); }
    };

    switch (B.style) {
      case 'georgian':
        brickTexture(); eave();
        if (topF && !single) { r(px, py, TILE, 2, '#efe6d4'); r(px, py + 2, TILE, 1, shade(wall, -0.3)); }
        if (isDoor) { railings(); r(px + 4, py + 11, 8, 5, wall); door(B.doorColor === '#d4a52a' ? '#1f1f24' : B.doorColor, true); }
        else if (ground) { sash(r, px + 3, py + top + 4, 3, 6, '#f4efe6'); sash(r, px + 10, py + top + 4, 3, 6, '#f4efe6'); railings(); }
        else { sash(r, px + 3, py + 4, 3, 9, '#f4efe6'); sash(r, px + 10, py + 4, 3, 9, '#f4efe6'); }
        break;
      case 'stucco':
        eave();
        if (ground) for (let k = top + 3; k < 15; k += 3) r(px, py + k, TILE, 1, shade(wall, -0.08));
        if (isDoor) {
          door(B.doorColor, false);
          r(px + 2, py + 5, 12, 2, '#ffffff'); r(px + 3, py + 7, 2, 8, '#ffffff'); r(px + 11, py + 7, 2, 8, '#ffffff');
          r(px + 2, py + 4, 12, 1, PAL.ink);
        } else if (ground) { sash(r, px + 3, py + top + 4, 3, 6, '#ffffff', '#2f3e52'); sash(r, px + 10, py + top + 4, 3, 6, '#ffffff', '#2f3e52'); railings(); }
        else { sash(r, px + 3, py + 4, 3, 8, '#ffffff', '#2f3e52'); sash(r, px + 10, py + 4, 3, 8, '#ffffff', '#2f3e52'); r(px, py + 13, TILE, 1, '#ffffff'); }
        break;
      case 'mansion':
        brickTexture();
        r(px, py + (topF && !single ? 0 : 1), TILE, 2, '#ece4d4');
        if (isDoor) { r(px + 3, py + 4, 10, 12, '#ece4d4'); door(B.doorColor, true); }
        else { sash(r, px + 2, py + top + 5, 4, 7, '#f4efe6'); sash(r, px + 10, py + top + 5, 4, 7, '#f4efe6'); }
        break;
      case 'office': {
        r(px, py, TILE, TILE, wall);
        for (let k = 0; k < 16; k += 4) r(px + k, py, 1, TILE, shade(wall, 0.35));
        for (let k = 3; k < 16; k += 5) r(px, py + k, TILE, 1, shade(wall, 0.3));
        if ((x + y) % 5 === 0) for (let k = 0; k < 6; k++) r(px + 2 + k, py + 11 - k, 1, 1, '#c6dbe8');
        for (let k = 1; k < 16; k += 4) if (hash2(x + k, y, 260) < 0.45) mapWindows.push([px + k, py + 4, 3, 3]);
        if (ground) { r(px, py + 9, TILE, 7, '#2d3e4c'); r(px, py + 9, TILE, 1, '#9cc0d6'); if (isDoor) { r(px + 5, py + 10, 6, 6, '#8fb3c9'); r(px + 8, py + 10, 1, 6, '#2d3e4c'); } }
        if (topF && !single) r(px, py, TILE, 2, shade(wall, -0.3));
        break;
      }
      case 'estate':
        for (let k = 0; k < 3; k++) r(px + Math.floor(hash2(x, y, 270 + k) * 15), py + Math.floor(hash2(x, y, 275 + k) * 15), 1, 1, shade(wall, -0.1));
        eave();
        sash(r, px + 2, py + top + 3, 4, 4, '#e8e4dc', PAL.glass, 0.5);
        sash(r, px + 10, py + top + 3, 4, 4, '#e8e4dc', PAL.glass, 0.5);
        if (!isDoor) { r(px, py + 10, TILE, 4, shade(wall, -0.18)); r(px, py + 9, TILE, 1, '#f0ece4'); for (let k = 1; k < 16; k += 3) r(px + k, py + 9, 1, 3, '#f0ece4'); }
        else door('#3a5a7a', false);
        break;
      case 'shop':
        brickTexture();
        if (ground) shopfront(B.accent, B.awning);
        else { eave(); sash(r, px + 3, py + 4, 3, 7, '#f4efe6'); sash(r, px + 10, py + 4, 3, 7, '#f4efe6'); }
        break;
      case 'camdenshop':
        if (ground) {
          shopfront(shade(wall, -0.45), false);
          if (topF && x === B.x0 && hash2(B.x0, y, 280) < 0.5) {   // Camden's giant shop sculptures (a boot!)
            r(px + 3, py - 10, 6, 10, PAL.ink); r(px + 4, py - 9, 4, 9, '#2a1f1a'); r(px + 3, py - 2, 10, 3, PAL.ink); r(px + 4, py - 1, 8, 1, '#2a1f1a');
          }
        } else { eave(); sash(r, px + 3, py + 4, 3, 7, '#ffffff'); sash(r, px + 10, py + 4, 3, 7, '#ffffff'); }
        break;
      case 'pub':
        brickTexture();
        if (ground) {
          const pc = ['#1f4a32', '#5a1f2a', '#1f1f24', '#1d2f5a'][Math.floor(B.seed * 4)];
          r(px, py + top + 1, TILE, 15 - top, pc);
          r(px, py + top + 1, TILE, 1, '#d4a52a'); r(px, py + top + 5, TILE, 1, '#d4a52a');
          if (isDoor) { r(px + 6, py + top + 6, 4, 10 - top, '#3a2418'); }
          else { r(px + 2, py + top + 7, 12, 6, '#d9a24a'); r(px + 2, py + top + 7, 12, 1, '#f2d38a'); r(px + 7, py + top + 7, 1, 6, pc); mapWindows.push([px + 2, py + top + 7, 12, 6]); }
          if (x === B.x0) { r(px + 1, py + top - 1, 1, 6, PAL.ink); r(px + 2, py + top, 5, 5, PAL.ink); r(px + 3, py + top + 1, 3, 3, '#d4a52a'); }
          if (hash2(x, y, 290) < 0.5) { r(px + 11, py + top + 1, 4, 2, '#e05a8a'); r(px + 11, py + top + 3, 4, 1, '#4a8a3a'); }
        } else { eave(); sash(r, px + 3, py + 4, 3, 7, '#f4efe6'); sash(r, px + 10, py + 4, 3, 7, '#f4efe6'); }
        break;
      case 'warehouse':
        brickTexture(); eave();
        [3, 10].forEach((wx) => {
          r(px + wx - 1, py + top + 4, 5, 9, PAL.ink); r(px + wx, py + top + 5, 3, 8, '#3d4f60');
          r(px + wx - 1, py + top + 3, 1, 1, wall); r(px + wx + 3, py + top + 3, 1, 1, wall);
          r(px + wx + 1, py + top + 5, 1, 8, PAL.ink);
          if (hash2(px + wx, y, 300) < 0.5) mapWindows.push([px + wx, py + top + 5, 3, 8]);
        });
        if (isDoor) { r(px + 3, py + 6, 10, 10, PAL.ink); r(px + 4, py + 7, 8, 9, '#5a3624'); }
        break;
      case 'dept':
        if (ground) {
          r(px, py + 2, TILE, 14, '#f2ede2');
          r(px + 1, py + 5, 14, 10, PAL.ink); r(px + 2, py + 6, 12, 9, '#7a93a8');
          r(px + 4, py + 9, 2, 6, '#ff7aa2'); r(px + 9, py + 9, 2, 6, '#ffd166');
          mapWindows.push([px + 2, py + 6, 12, 9]);
          r(px, py + 2, TILE, 2, B.accent);
        } else {
          r(px + 1, py + 2, 2, 14, shade(wall, -0.12)); r(px + 13, py + 2, 2, 14, shade(wall, -0.12));
          sash(r, px + 5, py + 4, 6, 9, '#c9bfa8');
          if (topF && x % 2 === 0) { r(px + 7, py - 8, 1, 9, PAL.ink); r(px + 8, py - 8, 5, 3, B.accent); }
        }
        break;
      default:   // Victorian terrace
        brickTexture(); eave();
        if (isDoor) door(B.doorColor, true);
        else if (ground) {
          r(px + 1, py + top + 4, 14, 11 - top, PAL.ink); r(px + 2, py + top + 5, 12, 10 - top, '#f4efe6');
          r(px + 3, py + top + 6, 3, 8 - top, PAL.glass); r(px + 7, py + top + 6, 2, 8 - top, PAL.glass); r(px + 10, py + top + 6, 3, 8 - top, PAL.glass);
          if (hash2(x, y, 310) < 0.55) mapWindows.push([px + 3, py + top + 6, 10, 8 - top]);
        } else { sash(r, px + 3, py + 4, 3, 7, '#f4efe6'); sash(r, px + 10, py + 4, 3, 7, '#f4efe6'); }
    }
    edges();
  }

  // ---- Street furniture: lamp posts, red phone boxes, post boxes ----
  function paintStreetFurniture(r) {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const t = tiles[I(x, y)], px = x * TILE, py = y * TILE;
      if (t === T.ROAD && !bridge[I(x, y)] && !zebra[I(x, y)]) {
        if (hash2(x, y, 400) < 0.12) {
          const up = get(x, y - 1), down = get(x, y + 1), left = get(x - 1, y), right = get(x + 1, y);
          const kerb = (v) => v !== T.ROAD && v !== T.MINOR && v !== -1;
          let lx = -1, ly = -1;
          if (kerb(up)) { lx = px + 8; ly = py + 2; }
          else if (kerb(down)) { lx = px + 8; ly = py + 13; }
          else if (kerb(left)) { lx = px + 2; ly = py + 8; }
          else if (kerb(right)) { lx = px + 13; ly = py + 8; }
          if (lx >= 0) {
            r(lx, ly - 9, 1, 10, '#2b2b33'); r(lx - 1, ly, 3, 1, '#2b2b33');
            r(lx - 1, ly - 11, 3, 2, '#2b2b33'); r(lx, ly - 10, 1, 1, '#f4e3a0');
            mapLamps.push([lx, ly - 10]);
          }
        }
      }
      if (t === T.MINOR && get(x, y - 1) === T.BUILDING) {
        const hv = hash2(x, y, 410);
        if (hv < 0.025) {   // red telephone box
          r(px + 2, py - 2, 6, 11, PAL.ink); r(px + 3, py - 1, 4, 9, PAL.red);
          r(px + 3, py - 1, 4, 1, '#ffffff'); r(px + 4, py + 1, 2, 5, '#f2e6c8');
          r(px + 3, py + 9, 6, 1, 'rgba(0,0,0,0.25)');
          mapWindows.push([px + 4, py + 1, 2, 5]);
        } else if (hv < 0.05) {   // red pillar box
          r(px + 11, py, 4, 7, PAL.ink); r(px + 11, py + 1, 4, 6, PAL.red); r(px + 11, py, 4, 1, '#1f1f24'); r(px + 12, py + 2, 2, 1, PAL.ink);
        }
      }
    }
  }

  /* ===================================================================
     SECTION: 7. Sprites
     =================================================================== */
  // ---- Tiny 3x5 font for signs (A-Z, 0-9, space . - ' &) ----
  const TINY = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
    9: '111101111001110', ' ': '000000000000000', '.': '000000000000010', '-': '000000111000000',
    "'": '010010000000000', '&': '010101010101011'
  };
  function drawTiny(g, text, x, y, color) {
    g.fillStyle = color;
    text = String(text).toUpperCase();
    for (let c = 0; c < text.length; c++) {
      const glyph = TINY[text[c]] || TINY[' '];
      for (let k = 0; k < 15; k++) if (glyph[k] === '1') g.fillRect(x + c * 4 + (k % 3), y + Math.floor(k / 3), 1, 1);
    }
  }
  const tinyWidth = (text) => String(text).length * 4 - 1;
  function drawTinyCentered(g, text, cx, y, color) { drawTiny(g, text, Math.round(cx - tinyWidth(text) / 2), y, color); }

  // ---- 9x9 pixel icons for each kind of place ----
  const ICONS = {
    'home':          ['....#....', '...###...', '..#####..', '.#######.', '#########', '.###.###.', '.###.###.', '.###.###.', '.###.###.'],
    'tube':          ['.#######.', '#########', '##.....##', '##.....##', '#########', '#########', '##.###.##', '#########', '.#.....#.'],
    'big station':   ['.#######.', '##.....##', '##.....##', '#########', '##.###.##', '#########', '.##...##.', '#########', '#.#.#.#.#'],
    'campus':        ['....#....', '..#####..', '#########', '..#####.#', '...###..#', '..#####.#', '..#####.#', '...###.##', '.........'],
    'library tower': ['.........', '.##...##.', '####.####', '####.####', '####.####', '####.####', '####.####', '..##.##..', '....#....'],
    'cinema':        ['#########', '#.#####.#', '#########', '#.#...#.#', '###...###', '#.#...#.#', '#########', '#.#####.#', '#########'],
    'karaoke':       ['...###...', '..#####..', '..#####..', '..#####..', '.#.###.#.', '.#.....#.', '..#####..', '....#....', '..#####..'],
    'supermarket':   ['##.......', '.#.......', '.########', '.#######.', '..######.', '..#####..', '..#......', '..######.', '...#..#..'],
    'restaurant':    ['#.#.#..#.', '#.#.#.###', '#####.###', '.###...#.', '..#....#.', '..#....#.', '..#....#.', '..#....#.', '..#....#.'],
    'climbing gym':  ['....##...', '....#....', '....#....', '...###...', '..#####..', '..######.', '.#######.', '#########', '#########'],
    'garden square': ['...###...', '.#######.', '#########', '#########', '.#######.', '...###...', '....#....', '....#....', '..#####..'],
    'neighbourhood marker': ['..#####..', '.#######.', '###...###', '###...###', '.#######.', '..#####..', '...###...', '....#....', '.........'],
    'cafe':          ['..#.#.#..', '...#.#...', '.........', '#######..', '########.', '#######.#', '########.', '.#####...', '#########'],
    'bus':           ['.#######.', '#########', '#.......#', '#.......#', '#########', '#########', '#.#####.#', '#########', '.#.....#.']
  };
  function drawIcon(g, type, x, y, color) {
    const ic = ICONS[type] || ICONS.home;
    g.fillStyle = color;
    for (let j = 0; j < 9; j++) for (let k = 0; k < 9; k++) if (ic[j][k] === '#') g.fillRect(x + k, y + j, 1, 1);
  }
  // A 13x13 bubble with the icon inside
  function drawBubble(g, type, x, y, fill, iconCol) {
    g.fillStyle = PAL.ink; g.fillRect(x + 1, y, 11, 13); g.fillRect(x, y + 1, 13, 11);
    g.fillStyle = fill; g.fillRect(x + 1, y + 1, 11, 11);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 1, y + 1, 11, 1);
    drawIcon(g, type, x + 2, y + 2, iconCol || PAL.ink);
  }

  // ---- Characters: 16x16 templates. k=outline h=hair s=skin e=eye t=top b=bottom o=shoes ----
  const TPL = {
    down: [
      '................', '.....kkkkkk.....', '....khhhhhhk....', '...khhhhhhhhk...',
      '...khhhhhhhhk...', '...khsssssshk...', '...kssessessk...', '...kssssssssk...',
      '....kssssssk....', '....kttttttk....', '...kttttttttk...', '..ksttttttttsk..',
      '..ksttttttttsk..', '...kbbbbbbbbk...', '....kbbkkbbk....', '....kookkook....'
    ],
    up: [
      '................', '.....kkkkkk.....', '....khhhhhhk....', '...khhhhhhhhk...',
      '...khhhhhhhhk...', '...khhhhhhhhk...', '...khhhhhhhhk...', '...kshhhhhhsk...',
      '....kssssssk....', '....kttttttk....', '...kttttttttk...', '..ksttttttttsk..',
      '..ksttttttttsk..', '...kbbbbbbbbk...', '....kbbkkbbk....', '....kookkook....'
    ],
    left: [
      '................', '.....kkkkkk.....', '....khhhhhhk....', '...khhhhhhhhk...',
      '...khhhhhhhhk...', '...kshhhhhhhk...', '...ksesshhhhk...', '...ksssshhhhk...',
      '....ksssshhk....', '.....kttttk.....', '....kttttttk....', '....kttsttttk...',
      '....kttsttttk...', '....kbbbbbbk....', '.....kbbbbk.....', '.....kooook.....'
    ]
  };
  const LEGS = {
    front: [['....kbbkkook....', '....kook........'], ['....kookkbbk....', '........kook....']],
    side: [['....kbbkkbbk....', '...kook..kook...'], ['....kbbkkbbk....', '...kook..kook...']]
  };
  function setPx(rows, y, x, ch) { if (rows[y]) rows[y] = rows[y].substring(0, x) + ch + rows[y].substring(x + 1); }

  // Build the walking frames for one character.
  //   base   = CONFIG.characters.me / .her   (hair, skin, hairLength...)
  //   outfit = one entry from CONFIG.outfits  (top colours, sleeves, collar, pattern)
  //   acc    = accessory name ("bucket hat", "backpack", "apron"...)
  function buildCharacter(base, outfit, acc, charm) {
    const c = Object.assign({ sleeves: 'short' }, base, outfit || {});
    const ink = '#241c2c';
    const long = (c.hairLength || '').toLowerCase() === 'long';
    const topAt = (x, y, dir) => {
      const h = hash2(x, y, 77);
      switch (c.pattern) {
        case 'stripes': return y % 2 === 0 ? (c.top2 || shade(c.top, -0.2)) : c.top;
        case 'plaid': return x % 3 === 0 ? (c.top2 || shade(c.top, -0.2)) : (y % 3 === 0 ? (c.top3 || c.top2 || c.top) : c.top);
        case 'batik': return h < 0.28 ? (c.top2 || c.top) : h < 0.45 ? (c.top3 || c.top) : c.top;
        case 'floral': return h < 0.22 ? (c.top2 || c.top) : c.top;
        case 'lace': return (x + y) % 4 === 0 ? (c.top2 || '#ffffff') : c.top;
        default: return c.top;
      }
    };
    const frames = {};
    ['down', 'up', 'left'].forEach((dir) => {
      const list = [];
      for (let f = 0; f < 3; f++) {
        const rows = TPL[dir].slice();
        if (f > 0) { const legs = (dir === 'left' ? LEGS.side : LEGS.front)[f - 1]; rows[14] = legs[0]; rows[15] = legs[1]; }
        if (long) {
          if (dir === 'down') for (let y = 5; y <= 10; y++) { setPx(rows, y, 3, 'h'); setPx(rows, y, 12, 'h'); setPx(rows, y, 2, 'k'); setPx(rows, y, 13, 'k'); }
          if (dir === 'up') for (let y = 7; y <= 10; y++) { for (let x = 4; x <= 11; x++) setPx(rows, y, x, 'h'); setPx(rows, y, 3, 'k'); setPx(rows, y, 12, 'k'); }
          if (dir === 'left') for (let y = 8; y <= 11; y++) { for (let x = 9; x <= 11; x++) setPx(rows, y, x, 'h'); setPx(rows, y, 12, 'k'); }
        }
        // letters -> colours
        const G = rows.map((row, y) => Array.from(row).map((ch, x) => {
          switch (ch) {
            case 'k': return ink;
            case 'h': return (c.hairTip && y >= 8) ? c.hairTip : c.hair;
            case 's': return c.skin;
            case 'e': return '#1a1420';
            case 't': return topAt(x, y, dir);
            case 'b': return c.bottom;
            case 'o': return c.shoes || '#222';
            default: return null;
          }
        }));
        const set = (x, y, col) => { if (y >= 0 && y < 16 && x >= 0 && x < 16) G[y][x] = col; };
        const side = dir === 'left', front = dir === 'down';
        // sleeves
        if (c.sleeves === 'long') { if (side) set(7, 11, c.top); else { set(3, 11, c.top); set(12, 11, c.top); } }
        if (c.sleeves === 'none') { if (side) set(7, 10, c.skin); else { set(4, 10, c.skin); set(11, 10, c.skin); } }
        // collar (only where the shirt shows — never over long hair)
        if (c.collar) {
          const cx = front ? [5, 6, 9, 10] : side ? [6, 7] : [5, 6, 7, 8, 9, 10];
          cx.forEach((x) => { if (rows[9][x] === 't') set(x, 9, c.collar); });
        }
        // buttons down the front of a button-down shirt
        if (c.buttons && front) { const bc = shade(c.collar || c.top, -0.35); set(8, 10, bc); set(8, 12, bc); }
        // a little flag on the "London tee"
        if (c.pattern === 'flag' && front) {
          ['#1f3f8f', '#c8102e', '#c8102e', '#1f3f8f'].forEach((col, k) => set(6 + k, 10, col));
          ['#c8102e', '#ffffff', '#ffffff', '#c8102e'].forEach((col, k) => set(6 + k, 11, col));
        }
        drawAccessory(set, acc, dir, c);
        if (charm) drawCharm(set, charm, dir);
        const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
        const g = cv.getContext('2d');
        G.forEach((row, y) => row.forEach((col, x) => { if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } }));
        list.push(cv);
      }
      frames[dir] = list;
    });
    frames.right = frames.left.map((src) => {
      const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
      const g = cv.getContext('2d'); g.translate(16, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
      return cv;
    });
    return frames;
  }

  // Accessories drawn on top of the 16x16 character (dir: down / up / left)
  function drawAccessory(set, acc, dir, c) {
    const ink = '#241c2c', front = dir === 'down', back = dir === 'up', side = dir === 'left';
    const row = (y, x0, x1, col) => { for (let x = x0; x <= x1; x++) set(x, y, col); };
    switch (acc) {
      case 'bucket hat': {
        const hc = c.hat || '#3a3a3e', dk = shade(hc, -0.35);
        row(0, 5, 10, ink); row(1, 4, 11, hc); set(4, 1, ink); set(11, 1, ink);
        row(2, 3, 12, hc); set(3, 2, ink); set(12, 2, ink);
        row(3, 1, 14, dk); set(1, 3, ink); set(14, 3, ink);
        row(2, 4, 11, side ? hc : shade(hc, 0.12));
        break;
      }
      case 'sunglasses':
        if (side) { row(2, 4, 10, '#8a4a22'); set(5, 2, '#1d1d22'); set(6, 2, '#1d1d22'); }
        else { row(2, 4, 11, '#8a4a22'); if (front) { set(5, 2, '#1d1d22'); set(6, 2, '#1d1d22'); set(9, 2, '#1d1d22'); set(10, 2, '#1d1d22'); } }
        break;
      case 'bandana': {
        const w = '#f4f1ea', dot = '#c9c2b4';
        row(2, 5, 10, w); row(3, 4, 11, w); set(6, 3, dot); set(9, 3, dot);
        if (back) { set(7, 4, w); set(8, 4, w); set(7, 5, w); }
        if (side) { set(12, 4, w); set(13, 4, w); set(12, 5, w); }
        break;
      }
      case 'backpack': {
        const pc = c.strap || (c.hairLength === 'long' ? '#3f9a8c' : '#2b2b33');
        if (front) { for (let y = 10; y <= 12; y++) { set(5, y, pc); set(10, y, pc); } }
        else if (back) {
          row(9, 4, 11, ink);
          for (let y = 10; y <= 13; y++) { set(4, y, ink); set(11, y, ink); row(y, 5, 10, pc); }
          row(14, 4, 11, ink); row(11, 6, 9, shade(pc, 0.3)); row(12, 6, 9, shade(pc, 0.3));
        } else {
          for (let y = 9; y <= 13; y++) { set(13, y, ink); set(10, y, pc); set(11, y, pc); set(12, y, pc); }
          row(14, 10, 13, ink); set(11, 11, shade(pc, 0.3));
        }
        break;
      }
      case 'shoulder bag': {
        const cream = '#efe6d2', strap = '#2b2b33';
        if (front) { set(10, 9, strap); set(11, 10, strap); row(11, 12, 14, cream); row(12, 12, 14, cream); row(13, 12, 14, ink); set(15, 11, ink); set(15, 12, ink); set(13, 12, '#2b2b33'); }
        else if (back) { set(5, 9, strap); set(4, 10, strap); row(11, 1, 3, cream); row(12, 1, 3, cream); row(13, 1, 3, ink); set(0, 11, ink); set(0, 12, ink); }
        else { set(8, 9, strap); set(8, 10, strap); row(11, 8, 10, cream); row(12, 8, 10, cream); row(13, 8, 10, ink); }
        break;
      }
      case 'necklace':
        if (front) { set(6, 9, '#2b2b33'); set(9, 9, '#2b2b33'); set(7, 10, '#f4f4f4'); set(8, 10, '#e8d8c8'); }
        else if (side) set(5, 10, '#f4f4f4');
        break;
      case 'apron': {
        const ap = '#f2eee6', dk = '#d9d2c4';
        if (front) { set(5, 9, ap); set(10, 9, ap); for (let y = 10; y <= 13; y++) row(y, 5, 10, ap); row(13, 5, 10, dk); }
        else if (back) { for (let y = 10; y <= 12; y++) { set(5 + (y - 10), y, ap); set(10 - (y - 10), y, ap); } }
        else { for (let y = 10; y <= 13; y++) { set(4, y, ap); set(5, y, ap); } set(4, 13, dk); }
        break;
      }
    }
  }

  // Our couple Monchhichi charms in school uniform, hanging at the hip.
  // 'boy' = grey shirt, navy tie, blue shorts; 'girl' = pink top, red ribbon, red plaid skirt + bow.
  function drawCharm(set, kind, dir) {
    const F = '#6b4a2e', D = '#4a3220', C = '#efd2b0', ink = '#241c2c';
    const girl = kind === 'girl';
    const top = girl ? '#f6d2dc' : '#d9dce0', mid = girl ? '#c8102e' : '#1f2a55', low = girl ? '#b8323a' : '#4a6a9a';
    // the charm hangs on her left / his right, so in the front view they mirror each other
    let x0;
    if (dir === 'left') x0 = 12;                       // seen from the side: hanging behind the hip
    else if (dir === 'down') x0 = girl ? 0 : 13;
    else x0 = girl ? 13 : 0;                           // back view: other side
    const px = (dx, y, col) => set(x0 + dx, y, col);
    px(1, 10, ink);                                   // little string
    px(0, 11, F); px(1, 11, F); px(2, 11, F);         // head
    px(0, 12, F); px(1, 12, C); px(2, 12, F);         // face
    px(0, 13, top); px(1, 13, mid); px(2, 13, top);   // school top + ribbon / tie
    px(0, 14, low); px(1, 14, low); px(2, 14, low);   // skirt / shorts
    px(0, 15, D); px(2, 15, D);                       // feet
    if (girl) px(dir === 'down' ? 2 : 0, 10, '#e8a6c8');   // pink bow
  }

  // ---- Wardrobe: which outfit + accessory each of us is wearing ----
  const ACC_LIST = {
    me: ['none', 'bucket hat', 'sunglasses', 'backpack', 'necklace', 'apron'],
    her: ['none', 'sunglasses', 'bandana', 'backpack', 'shoulder bag', 'necklace', 'apron', 'bucket hat']
  };
  const outfitList = (who) => ((CFG.outfits && CFG.outfits[who] && CFG.outfits[who].length) ? CFG.outfits[who] : [{ name: 'Default' }]);
  const wardrobe = (() => {
    const saved = store.get('htae-wardrobe') || {};
    const fix = (who) => {
      const w = saved[who] || {};
      const list = outfitList(who);
      const o = Number.isInteger(w.o) && w.o >= 0 && w.o < list.length ? w.o : 0;
      const a = ACC_LIST[who].indexOf(w.a) >= 0 ? w.a : (list[o].acc || 'none');
      return { o, a, charm: w.charm !== false };   // the Monchhichi charm is on by default
    };
    return { me: fix('me'), her: fix('her') };
  })();
  function applyOutfits() {
    charMe = buildCharacter(CFG.characters.me, outfitList('me')[wardrobe.me.o], wardrobe.me.a, wardrobe.me.charm ? 'boy' : null);
    charHer = buildCharacter(CFG.characters.her, outfitList('her')[wardrobe.her.o], wardrobe.her.a, wardrobe.her.charm ? 'girl' : null);
    store.set('htae-wardrobe', wardrobe);
  }

  // ---- Small pixel heart (7x6) ----
  const HEART = ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];
  function drawHeart(g, x, y, color, outline) {
    if (outline) {
      g.fillStyle = outline;
      HEART.forEach((row, j) => { for (let k = 0; k < 7; k++) if (row[k] === 'x') { g.fillRect(x + k - 1, y + j, 3, 1); g.fillRect(x + k, y + j - 1, 1, 3); } });
    }
    g.fillStyle = color;
    HEART.forEach((row, j) => { for (let k = 0; k < 7; k++) if (row[k] === 'x') g.fillRect(x + k, y + j, 1, 1); });
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 1, y + 1, 1, 1);
  }

  // ---- Building sprites for landmarks + famous buildings ----
  // Each painter draws into a canvas of (w*16) x (sh*16) pixels.
  // `win(x,y,w,h)` paints a window and remembers it so it can glow at night.
  const PAINTERS = {
    'home'(p) {
      const roof = p.color || '#c4553e', wall = '#efe2c8';
      p.box(33, 1, 7, 10, '#9a5b47'); p.r(34, 0, 2, 2, '#d2763f'); p.r(37, 0, 2, 2, '#d2763f');
      p.box(2, 5, 44, 22, roof);
      for (let y = 9; y < 26; y += 4) p.r(3, y, 42, 1, shade(roof, -0.15));
      p.r(3, 6, 42, 2, shade(roof, 0.22));
      p.box(4, 26, 40, 22, wall);
      p.r(5, 27, 38, 2, shade(wall, -0.25));
      p.win(9, 31, 8, 7); p.win(31, 31, 8, 7);
      p.box(19, 33, 10, 15, '#7b4a2e'); p.r(26, 40, 1, 1, '#f2c14e');
      p.r(9, 39, 8, 2, '#5b9a3d'); p.r(10, 38, 1, 1, '#ff7aa2'); p.r(14, 38, 1, 1, '#ffd166');
      p.r(31, 39, 8, 2, '#5b9a3d'); p.r(33, 38, 1, 1, '#ffffff'); p.r(37, 38, 1, 1, '#ff7aa2');
      p.box(18, 14, 13, 11, '#f7e7c6'); p.icon('home', 20, 15, '#3a2a20');   // house plaque on the roof
    },
    'tube'(p) {
      const red = '#8f2a2a';
      p.box(0, 5, 48, 27, red);
      for (let x = 4; x < 47; x += 6) p.r(x, 18, 1, 13, shade(red, -0.2));
      p.r(0, 2, 48, 4, '#5e1b1b'); p.r(0, 2, 48, 1, PAL.ink);
      p.box(1, 7, 46, 9, '#1f3f8f'); p.r(2, 8, 44, 1, '#3b5fb5');
      p.tinyC(p.sign || 'TUBE', 24, 9, '#ffffff');
      p.archWin(5, 19, 9, 8); p.archWin(34, 19, 9, 8);
      p.box(17, 18, 14, 14, '#2a2026');
      for (let x = 19; x < 30; x += 3) p.r(x, 20, 1, 12, '#77778a');
      p.r(0, 31, 48, 1, shade(red, -0.5));
    },
    'big station'(p) {
      const W2 = p.W;
      p.box(0, 6, W2, 42, '#bdb7a9');
      p.r(0, 6, W2, 5, '#4e5866'); p.r(0, 6, W2, 1, PAL.ink); p.r(0, 10, W2, 1, '#6e7a8a');
      const sw = Math.max(40, tinyWidth(p.sign || 'STATION') + 10);
      p.box(Math.round(W2 / 2 - sw / 2), 12, sw, 9, '#26303d');
      p.tinyC(p.sign || 'STATION', W2 / 2, 14, '#ffffff');
      p.box(W2 - 22, 12, 9, 9, '#f4f1e8'); p.r(W2 - 18, 14, 1, 3, '#222'); p.r(W2 - 18, 16, 3, 1, '#222');
      p.icon('big station', 8, 12);
      p.r(4, 23, W2 - 8, 13, '#4a6075');
      for (let x = 6; x < W2 - 8; x += 8) p.win(x, 24, 6, 11, true);
      for (let x = 2; x < W2; x += 16) p.r(x, 36, 3, 12, '#9f9989');
      p.box(Math.round(W2 / 2 - 12), 37, 24, 11, '#1d252e'); p.r(Math.round(W2 / 2), 37, 1, 11, '#6b7c8f');
      p.r(0, 47, W2, 1, '#7d776b');
    },
    'campus'(p) {
      const s = '#ece5d4', sd = '#c9c0aa', sdd = '#a49a84';
      p.box(0, 28, 12, 30, s); p.box(68, 28, 12, 30, s);
      p.win(3, 34, 6, 6); p.win(3, 46, 6, 6); p.win(71, 34, 6, 6); p.win(71, 46, 6, 6);
      p.box(28, 14, 24, 10, s);
      for (let x = 30; x < 51; x += 4) p.r(x, 16, 1, 7, sdd);
      for (let y = 0; y < 12; y++) {
        const hw = Math.round(Math.sqrt(144 - (12 - y) * (12 - y)));
        p.r(40 - hw - 1, 3 + y, hw * 2 + 2, 1, PAL.ink);
        p.r(40 - hw, 3 + y, hw * 2, 1, y < 2 ? '#b8c9cb' : '#93a9ab');
      }
      p.r(34, 6, 2, 7, '#c9d9da'); p.box(38, 0, 4, 4, s);
      p.r(10, 36, 60, 20, sdd);
      for (let k = 0; k < 14; k++) {
        const hw = Math.round(32 - k * 2.25);
        p.r(40 - hw, 35 - k, hw * 2, 1, s);
        p.r(40 - hw, 35 - k, 2, 1, PAL.ink); p.r(40 + hw - 2, 35 - k, 2, 1, PAL.ink);
      }
      p.r(30, 27, 20, 3, sd);
      p.r(8, 35, 64, 3, sd); p.r(8, 35, 64, 1, PAL.ink);
      for (let k = 0; k < 10; k++) {
        const cx = Math.round(12 + k * 6.2);
        p.r(cx, 38, 3, 17, s); p.r(cx + 2, 38, 1, 17, sd); p.r(cx - 1, 38, 5, 1, sd);
      }
      p.r(37, 46, 6, 10, '#4a3a2e');
      if (p.sign) p.tinyC(p.sign, 40, 29, '#5a5040');
      p.icon('campus', 2, 18, '#5a5040');
      p.r(6, 55, 68, 3, '#ddd5c3'); p.r(4, 58, 72, 3, '#d0c7b3'); p.r(2, 61, 76, 3, '#c4bba6');
    },
    'library tower'(p) {
      const s = '#e9dfc7', sd = '#cbbf9f';
      p.box(2, 50, 44, 30, s); p.box(8, 30, 32, 21, s); p.box(13, 14, 22, 17, s); p.box(17, 5, 14, 10, s);
      p.r(38, 51, 7, 28, sd); p.r(33, 31, 6, 19, sd); p.r(29, 15, 5, 15, sd); p.r(27, 6, 3, 8, sd);
      p.r(23, 0, 1, 6, '#555'); p.r(24, 0, 4, 3, '#c0392b');
      for (let x = 5; x < 43; x += 4) { if (x > 15 && x < 31) continue; p.win(x, 54, 2, 8, true); p.win(x, 66, 2, 8, true); }
      for (let x = 11; x < 37; x += 4) { p.win(x, 34, 2, 6, true); p.win(x, 43, 2, 6, true); }
      for (let x = 16; x < 33; x += 4) { p.win(x, 18, 2, 5, true); p.win(x, 25, 2, 4, true); }
      p.win(20, 8, 2, 5, true); p.win(26, 8, 2, 5, true);
      p.box(18, 64, 12, 16, '#3b3128'); p.r(19, 63, 10, 1, PAL.ink);
      p.box(18, 52, 13, 11, '#f7e7c6'); p.icon('library tower', 20, 53, '#3b3128');
    },
    'cinema'(p) {
      p.box(0, 6, 64, 42, '#6f1d3a'); p.r(0, 3, 64, 4, '#4a1226'); p.r(0, 3, 64, 1, PAL.ink);
      p.box(1, 15, 62, 12, '#f3e6c4');
      p.tinyC(p.sign || 'CINEMA', 32, 19, '#7a1f3d');
      for (let x = 3; x < 62; x += 4) { p.light(x, 16, 1, 1, '#ffcf4a'); p.light(x, 25, 1, 1, '#ffcf4a'); }
      p.icon('cinema', 27, 5, '#ffcf4a');
      p.box(4, 31, 10, 14, '#2f5d8a'); p.r(6, 33, 6, 4, '#ffd166'); p.r(6, 39, 6, 1, '#fff');
      p.box(50, 31, 10, 14, '#3b8a5a'); p.r(52, 33, 6, 4, '#ff7aa2'); p.r(52, 39, 6, 1, '#fff');
      p.box(22, 31, 20, 17, '#2a1e2a'); p.win(24, 33, 7, 12, true); p.win(33, 33, 7, 12, true);
    },
    'karaoke'(p) {
      p.box(0, 5, 48, 43, '#33204f'); p.r(0, 2, 48, 4, '#1f1333'); p.r(0, 2, 48, 1, PAL.ink);
      const neon = '#ff5fd2';
      p.light(3, 9, 42, 1, neon); p.light(3, 21, 42, 1, neon); p.light(3, 9, 1, 13, neon); p.light(44, 9, 1, 13, neon);
      p.tinyC(p.sign || 'KARAOKE', 24, 13, '#7ef9ff');
      p.icon('karaoke', 4, 26, '#ffd166');
      p.r(37, 25, 3, 2, '#f4f4f4'); p.r(36, 27, 5, 1, '#e23b3b'); p.r(37, 28, 3, 2, '#f4f4f4'); p.r(36, 30, 5, 6, '#f4f4f4');
      p.box(18, 31, 12, 17, '#120b1c'); p.win(20, 33, 8, 6, true);
    },
    'supermarket'(p) {
      p.box(0, 6, 64, 42, '#ecebe6'); p.r(0, 3, 64, 4, '#8a8f98'); p.r(0, 3, 64, 1, PAL.ink);
      p.box(0, 9, 64, 11, '#2f7d4f');
      p.icon('supermarket', 3, 10, '#fff7d6');
      p.tinyC(p.sign || 'MARKET', 34, 12, '#fff7d6');
      [3, 39].forEach((x) => {
        p.box(x, 23, 22, 18, '#3d556d');
        p.lightWin(x + 1, 24, 20, 16);
        for (let k = 0; k < 3; k++) {
          p.r(x + 2, 28 + k * 5, 18, 1, '#c9b18a');
          for (let j = 0; j < 6; j++) p.r(x + 3 + j * 3, 26 + k * 5, 2, 2, ['#e8554e', '#ffd166', '#7cc05a', '#ff9f5a'][(j + k) % 4]);
        }
      });
      p.box(27, 25, 10, 23, '#5f7d96'); p.r(32, 25, 1, 23, '#c8d6e0');
    },
    'restaurant'(p) {
      p.box(0, 5, 48, 43, '#a65a3e'); p.r(0, 2, 48, 4, '#5a2e20'); p.r(0, 2, 48, 1, PAL.ink);
      for (let y = 30; y < 47; y += 4) p.r(1, y, 46, 1, shade('#a65a3e', -0.15));
      p.box(1, 7, 46, 9, '#1f4d3a');
      const rs = p.sign || 'FOOD';
      if (tinyWidth(rs) <= 32) { p.icon('restaurant', 2, 7, '#ffd166'); p.tinyC(rs, 27, 9, '#ffd166'); }
      else p.tinyC(rs, 24, 9, '#ffd166');   // long names: no room for the icon on the sign
      for (let x = 0; x < 48; x += 6) { p.r(x, 18, 3, 7, '#d9443f'); p.r(x + 3, 18, 3, 7, '#f4efe4'); p.r(x + 1, 25, 2, 1, '#d9443f'); p.r(x + 4, 25, 2, 1, '#f4efe4'); }
      p.r(0, 17, 48, 1, PAL.ink);
      p.box(4, 28, 18, 13, '#3a4c5e'); p.lightWin(5, 29, 16, 11);
      p.r(9, 35, 8, 3, '#f4efe4'); p.r(10, 38, 6, 1, '#cfc8b8'); p.r(11, 31, 1, 3, '#dfe7ee'); p.r(14, 32, 1, 2, '#dfe7ee');
      p.box(28, 28, 12, 20, '#5a3624'); p.r(37, 38, 1, 1, '#f2c14e');
      p.light(1, 19, 3, 4, '#e23b3b'); p.light(44, 19, 3, 4, '#e23b3b');
    },
    'climbing gym'(p) {
      p.box(0, 7, 48, 41, '#6c7884'); p.r(0, 4, 48, 4, '#47505a'); p.r(0, 4, 48, 1, PAL.ink);
      for (let x = 2; x < 47; x += 3) p.r(x, 21, 1, 26, '#5d6873');
      p.box(1, 10, 46, 9, '#f08a24');
      p.tinyC(p.sign || 'CLIMB', 24, 12, '#24180c');
      const holds = ['#ff5d5d', '#ffd166', '#4fd1c5', '#c58cff', '#7cc05a', '#ffffff'];
      for (let k = 0; k < 14; k++) p.r(3 + Math.floor(hash2(k, 1, 5) * 40), 22 + Math.floor(hash2(k, 2, 5) * 22), 2, 2, holds[k % holds.length]);
      p.icon('climbing gym', 4, 23, '#ffd166');
      p.box(16, 30, 16, 18, '#9aa4ae');
      for (let y = 32; y < 47; y += 2) p.r(17, y, 14, 1, '#7f8994');
    },
    'garden square'(p) {
      const W2 = p.W, H2 = p.Hh;
      p.r(0, 0, W2, H2, PAL.grass);
      for (let k = 0; k < 30; k++) p.r(Math.floor(hash2(k, 3, 8) * W2), Math.floor(hash2(k, 4, 8) * H2), 1, 1, PAL.grassD);
      const hedge = (x, y, w, h) => { p.r(x, y, w, h, PAL.hedge); p.r(x, y + h - 2, w, 2, PAL.hedgeD); };
      hedge(0, 0, W2, 5); hedge(0, 0, 5, H2); hedge(W2 - 5, 0, 5, H2);
      hedge(0, H2 - 5, W2 / 2 - 5, 5); hedge(W2 / 2 + 5, H2 - 5, W2 / 2 - 5, 5);
      for (let x = 1; x < W2; x += 4) p.r(x, 0, 1, 2, PAL.ink);
      p.r(W2 / 2 - 3, 5, 6, H2 - 5, PAL.path); p.r(5, H2 / 2 - 3, W2 - 10, 6, PAL.path);
      [[9, 9], [W2 - 23, 9], [9, H2 - 23], [W2 - 23, H2 - 23]].forEach(([x, y], k) => {
        p.r(x, y, 14, 14, PAL.grassD);
        for (let j = 0; j < 8; j++) p.r(x + 1 + Math.floor(hash2(j, k, 9) * 12), y + 1 + Math.floor(hash2(k, j, 9) * 12), 2, 2, ['#ff7aa2', '#ffd166', '#ffffff', '#c58cff'][j % 4]);
      });
      const cx = W2 / 2, cy = H2 / 2 - 4;
      p.r(cx - 8, cy + 9, 16, 3, 'rgba(20,40,20,0.3)'); p.r(cx - 1, cy + 4, 3, 7, '#6b4a2b');
      for (let y = -9; y <= 6; y++) { const hw = Math.round(Math.sqrt(90 - y * y)); p.r(cx - hw - 1, cy + y, hw * 2 + 2, 1, PAL.ink); }
      for (let y = -8; y <= 5; y++) { const hw = Math.round(Math.sqrt(81 - y * y)); p.r(cx - hw, cy + y, hw * 2, 1, y > 2 ? '#2f7a32' : '#3e8e3a'); }
      p.r(cx - 5, cy - 6, 5, 3, '#5fb04f');
      p.r(12, H2 / 2 + 6, 8, 3, '#8b5a2b'); p.r(W2 - 20, H2 / 2 + 6, 8, 3, '#8b5a2b');
      if (p.sign) { const sw = tinyWidth(p.sign) + 6; p.box(W2 / 2 - sw / 2, 0, sw, 8, '#23412a'); p.tinyC(p.sign, W2 / 2, 2, '#f7e7c6'); }
    },
    'neighbourhood marker'(p) {
      p.r(22, 12, 4, 20, '#6b4a2b'); p.r(22, 12, 1, 20, '#8a6440');
      const sw = Math.min(46, Math.max(28, tinyWidth(p.sign || 'HERE') + 8));
      p.box(24 - sw / 2, 2, sw, 11, '#f3e6c4'); p.r(24 - sw / 2 + 1, 11, sw - 2, 1, '#d8c69f');
      p.tinyC(p.sign || 'HERE', 24, 5, '#3a2a20');
      p.box(12, 25, 24, 7, '#8a6a4a');
      for (let k = 0; k < 6; k++) p.r(14 + k * 3.5, 23 + (k % 2), 2, 2, ['#ff7aa2', '#ffd166', '#ffffff'][k % 3]);
      for (let k = 0; k < 5; k++) p.r(26 - sw / 2 + k * (sw / 5), 0, 3, 2, ['#e23b3b', '#ffd166', '#1f3f8f'][k % 3]);
    },
    'cafe'(p) {
      p.box(0, 6, 48, 42, '#efe0c5'); p.r(0, 3, 48, 4, '#6b4a3a'); p.r(0, 3, 48, 1, PAL.ink);
      p.box(3, 9, 42, 8, '#3b2a20');
      p.tinyC(p.sign || 'CAFE', 24, 11, '#f7e7c6');
      for (let x = 0; x < 48; x += 6) { p.r(x, 19, 3, 6, '#3f8f5a'); p.r(x + 3, 19, 3, 6, '#f4efe4'); }
      p.r(0, 18, 48, 1, PAL.ink);
      p.box(4, 28, 18, 13, '#3a4c5e'); p.lightWin(5, 29, 16, 11);
      p.icon('cafe', 8, 30, '#f4efe4');
      p.box(28, 28, 12, 20, '#4f7a5a'); p.r(37, 38, 1, 1, '#f2c14e');
    },

    // ---------- famous London buildings (decoration) ----------
    'bt tower'(p) {
      const H2 = p.Hh;
      p.box(3, H2 - 16, 26, 16, '#b9b4a8'); p.r(13, H2 - 10, 6, 10, '#2d3e4c');
      p.r(10, 22, 12, H2 - 38, PAL.ink); p.r(11, 22, 10, H2 - 38, '#c9ccd2'); p.r(18, 22, 3, H2 - 38, '#a9adb4');
      for (let y = 60; y < H2 - 18; y += 5) p.win(11, y, 10, 2, true);
      p.box(7, 34, 18, 5, '#e6e6e6');
      [[5, 40], [23, 44], [5, 48], [23, 52]].forEach(([x, y]) => { p.box(x - 1, y, 5, 5, '#f4f4f4'); p.r(x, y + 1, 3, 3, '#d8d8d8'); });
      p.light(10, 57, 12, 2, '#4fd1c5');
      p.box(12, 10, 8, 13, '#d6d8dc');
      p.r(15, 1, 2, 10, '#8a8f98'); p.light(15, 0, 2, 2, '#e23b3b');
    },
    'british museum'(p) {
      const s = '#e8e1cf', sd = '#c9c0aa', W2 = p.W;
      p.box(0, 24, 18, 32, s); p.box(W2 - 18, 24, 18, 32, s);
      for (let x = 3; x < 16; x += 4) { p.r(x, 28, 2, 26, sd); p.r(W2 - 16 + x - 3, 28, 2, 26, sd); }
      p.r(18, 26, W2 - 36, 30, '#a99f8a');
      for (let k = 0; k < 16; k++) {
        const hw = Math.round(44 - k * 2.6);
        p.r(W2 / 2 - hw, 25 - k, hw * 2, 1, s);
        p.r(W2 / 2 - hw, 25 - k, 2, 1, PAL.ink); p.r(W2 / 2 + hw - 2, 25 - k, 2, 1, PAL.ink);
      }
      p.r(14, 25, W2 - 28, 4, sd); p.r(14, 25, W2 - 28, 1, PAL.ink);
      p.tinyC('BRITISH MUSEUM', W2 / 2, 26, '#5a5040');
      for (let k = 0; k < 12; k++) { const cx = 20 + k * 6.4; p.r(cx, 30, 3, 24, s); p.r(cx + 2, 30, 1, 24, sd); }
      p.r(W2 / 2 - 4, 44, 8, 10, '#4a3a2e');
      p.r(12, 54, W2 - 24, 3, '#ddd5c3'); p.r(8, 57, W2 - 16, 3, '#d0c7b3'); p.r(4, 60, W2 - 8, 4, '#c4bba6');
    },
    'st pancras'(p) {
      const brick = '#a8433a', stone = '#e6d8bf', W2 = p.W, H2 = p.Hh;
      p.box(0, 36, W2, H2 - 36, brick);
      p.r(0, 34, W2, 4, '#5d6470'); p.r(0, 34, W2, 1, PAL.ink);
      for (let x = 30; x < W2 - 4; x += 10) { p.r(x + 2, 28, 6, 8, '#5d6470'); p.r(x + 4, 25, 2, 3, '#5d6470'); p.win(x + 3, 30, 4, 4, true); }
      for (let y = 42; y < H2 - 14; y += 10) for (let x = 28; x < W2 - 4; x += 8) { p.win(x, y, 4, 6, true); p.r(x, y - 1, 4, 1, stone); }
      p.r(0, H2 - 12, W2, 1, stone);
      p.box(W2 / 2 + 6, H2 - 12, 14, 12, '#3a2a24');
      // clock tower
      p.box(6, 12, 18, H2 - 12, brick);
      for (let k = 0; k < 12; k++) p.r(15 - (k >> 1) - 1, k, 2 + k, 1, k === 0 ? PAL.ink : '#5d6470');
      p.r(7, 12, 16, 2, stone);
      p.box(10, 16, 10, 10, '#f4f1e8'); p.r(15, 18, 1, 4, PAL.ink); p.r(15, 21, 3, 1, PAL.ink);
      for (let y = 32; y < H2 - 6; y += 9) p.win(12, y, 6, 5, true);
      p.r(2, 30, 2, 8, '#5d6470'); p.r(26, 30, 2, 8, '#5d6470');
    },
    'kings cross'(p) {
      const brick = '#d9b878', W2 = p.W, H2 = p.Hh;
      p.box(0, 10, W2, H2 - 10, brick);
      [6, 44].forEach((x) => {
        for (let y = 0; y < 15; y++) { const hw = Math.round(Math.sqrt(225 - (15 - y) * (15 - y))); p.r(x + 15 - hw, 14 + y, hw * 2, 1, '#6f8aa0'); }
        p.r(x, 29, 30, 12, '#6f8aa0');
        for (let k = 0; k < 30; k += 5) p.r(x + k, 15, 1, 26, '#4e6474');
        p.lightWin(x + 2, 20, 26, 20);
      });
      p.box(36, 0, 8, 22, brick); p.box(37, 4, 6, 6, '#f4f1e8'); p.r(40, 5, 1, 3, PAL.ink); p.r(40, 7, 2, 1, PAL.ink);
      p.r(0, H2 - 6, W2, 6, '#c9a866');
    },
    'centre point'(p) {
      const c = '#cfc8b8', H2 = p.Hh;
      p.box(0, H2 - 14, 32, 14, '#b9b2a2');
      p.r(5, 6, 22, H2 - 18, PAL.ink); p.r(6, 6, 20, H2 - 18, c);
      for (let y = 8; y < H2 - 14; y += 3) for (let x = 7; x < 25; x += 3) { p.r(x, y, 2, 2, '#4a5866'); if (hash2(x, y, 33) < 0.3) p.lightWin(x, y, 2, 2); }
      p.r(20, 6, 6, H2 - 18, 'rgba(0,0,0,0.12)');
      p.box(8, 0, 16, 8, '#bdb6a6');
      p.r(10, H2 - 10, 12, 10, '#2d3e4c');
    },
    'church'(p) {
      const s = '#ddd3bd', sd = '#bfb49b', H2 = p.Hh;
      p.box(1, H2 - 34, 30, 34, s);
      p.r(1, H2 - 36, 30, 3, '#5d6470');
      p.box(9, 26, 14, H2 - 58, s);
      for (let k = 0; k < 26; k++) { const hw = Math.max(1, Math.round(k * 0.26)); p.r(16 - hw, k, hw * 2, 1, k < 2 ? PAL.ink : sd); }
      p.box(12, 32, 8, 8, '#f4f1e8'); p.r(15, 34, 1, 3, PAL.ink); p.r(15, 36, 2, 1, PAL.ink);
      p.win(4, H2 - 26, 4, 10, true); p.win(24, H2 - 26, 4, 10, true);
      p.r(12, H2 - 16, 8, 16, PAL.ink); p.r(13, H2 - 15, 6, 15, '#5a3a2a'); p.r(13, H2 - 16, 6, 1, s);
    },
    'marble arch'(p) {
      const m = '#f2efe8', md = '#d8d3c8';
      p.box(1, 4, 46, 26, m);
      p.r(0, 2, 48, 4, md); p.r(0, 2, 48, 1, PAL.ink);
      p.r(19, 14, 10, 16, PAL.grass); p.r(20, 12, 8, 2, PAL.grass); p.r(22, 11, 4, 1, PAL.grass);
      p.r(6, 18, 6, 12, PAL.grass); p.r(36, 18, 6, 12, PAL.grass);
      [3, 14, 31, 42].forEach((x) => p.r(x, 8, 2, 22, md));
      p.r(1, 29, 46, 1, PAL.ink);
    },
    'camden lock'(p) {
      p.box(0, 4, 64, 22, '#6b3a2c');
      for (let x = 3; x < 62; x += 6) p.win(x, 16, 3, 6, true);
      p.box(8, 6, 48, 9, '#ffd166'); p.tinyC('CAMDEN LOCK', 32, 8, '#2a1f1a');
      const aw = ['#e23b3b', '#4fd1c5', '#9b6bd6', '#7cc05a'];
      for (let k = 0; k < 4; k++) {
        const x = 2 + k * 15;
        for (let j = 0; j < 12; j += 4) { p.r(x + j, 28, 2, 6, aw[k]); p.r(x + j + 2, 28, 2, 6, '#f4efe4'); }
        p.r(x, 27, 12, 1, PAL.ink);
        p.r(x, 36, 12, 6, '#8b5a2b');
        for (let j = 0; j < 4; j++) p.r(x + 1 + j * 3, 37, 2, 2, ['#ffd166', '#ff7aa2', '#ffffff', '#5aa9ff'][(j + k) % 4]);
        p.light(x + 5, 34, 2, 1, '#ffd66b');
      }
    },
    'abbey road studios'(p) {
      const w = '#f3efe6';
      p.box(2, 8, 44, 40, w);
      p.r(0, 4, 48, 6, '#5d6470'); p.r(0, 4, 48, 1, PAL.ink);
      p.win(7, 14, 7, 8); p.win(34, 14, 7, 8); p.win(7, 28, 7, 8); p.win(34, 28, 7, 8);
      p.box(19, 30, 10, 18, '#1f1f24'); p.r(18, 26, 12, 3, '#ffffff');
      p.box(4, 0, 40, 7, '#ffffff'); p.tinyC('ABBEY ROAD', 24, 1, '#1f1f24');
      for (let k = 0; k < 18; k++) p.r(3 + Math.floor(hash2(k, 7, 3) * 40), 40 + Math.floor(hash2(k, 8, 3) * 6), 2, 1, ['#ff5fd2', '#4fd1c5', '#ffd166', '#5aa9ff', '#7cc05a'][k % 5]);
    },
    'pavilion'(p) {
      const brick = '#a8533e';
      p.box(0, 14, 64, 34, brick);
      p.r(0, 10, 64, 5, '#5d6470'); p.r(0, 10, 64, 1, PAL.ink);
      [8, 46].forEach((x) => { p.box(x, 2, 10, 12, brick); p.r(x + 1, 0, 8, 3, '#5d6470'); });
      p.r(2, 26, 60, 4, '#f4efe6'); for (let x = 4; x < 62; x += 4) p.r(x, 22, 1, 8, '#f4efe6');
      for (let x = 4; x < 60; x += 8) p.win(x, 34, 5, 8);
      p.box(28, 34, 8, 14, '#2a2024');
    },
    'zoo'(p) {
      p.box(0, 12, 48, 36, '#d8c9a8');
      p.r(0, 8, 48, 5, '#2e6b45'); p.r(0, 8, 48, 1, PAL.ink);
      p.box(6, 14, 36, 8, '#2e6b45'); p.tinyC('ZOO', 24, 16, '#ffd166');
      // a little giraffe peeking over the wall
      p.r(36, 0, 3, 14, '#e8b04a'); p.r(34, 0, 6, 3, '#e8b04a'); p.r(37, 4, 1, 1, '#8a5a2a'); p.r(37, 8, 1, 1, '#8a5a2a'); p.r(33, 1, 1, 1, PAL.ink);
      for (let x = 4; x < 46; x += 3) p.r(x, 26, 1, 22, '#4a3a2e');
      p.r(2, 30, 44, 1, '#4a3a2e');
      p.box(18, 32, 12, 16, '#3a2a20');
    }
  };

  function buildEntitySprite(e) {
    const cv = document.createElement('canvas');
    cv.width = e.w * TILE; cv.height = e.sh * TILE;
    const g = cv.getContext('2d');
    const lights = [];
    const r = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const p = {
      W: cv.width, Hh: cv.height, sign: (e.sign || '').toUpperCase(), color: e.color, r,
      box(x, y, w, h, c) { r(x, y, w, h, PAL.ink); r(x + 1, y + 1, w - 2, h - 2, c); },
      win(x, y, w, h, plain) {
        if (!plain) r(x - 1, y - 1, w + 2, h + 2, '#f7f1e3');
        r(x, y, w, h, PAL.glass); r(x, y, 1, Math.min(2, h), '#7f97b5');
        if (!plain && w > 4) r(x + (w >> 1), y, 1, h, '#f7f1e3');
        lights.push([x, y, w, h]);
      },
      archWin(x, y, w, h) { p.win(x, y, w, h); r(x - 1, y - 1, 1, 1, '#8f2a2a'); r(x + w, y - 1, 1, 1, '#8f2a2a'); },
      lightWin(x, y, w, h) { lights.push([x, y, w, h]); },
      light(x, y, w, h, c) { r(x, y, w, h, c); lights.push([x, y, w, h, c]); },
      tinyC(text, cx, y, c) { drawTinyCentered(g, text, cx, y, c); },
      icon(type, x, y, c) { drawIcon(g, type, x, y, c || PAL.ink); }
    };
    (PAINTERS[e.sprite] || PAINTERS.home)(p);
    e.canvas = cv;
    e.lights = lights;
  }

  // ---- Vehicles (drawn facing right; rotated when driving up/down) ----
  const VEH = {};
  function buildVehicles() {
    const mk = (w, h, fn) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); fn((x, y, ww, hh, c) => { g.fillStyle = c; g.fillRect(x, y, ww, hh); }, g); return cv; };
    VEH.cab = mk(14, 8, (r) => {
      r(1, 0, 12, 8, PAL.ink); r(0, 1, 14, 6, PAL.ink);
      r(1, 1, 12, 6, '#1d1d24'); r(4, 1, 5, 6, '#2c2c36');
      r(10, 1, 2, 6, '#6f86a3'); r(2, 1, 1, 6, '#6f86a3');
      r(6, 3, 2, 2, '#ffd23f');
      r(13, 1, 1, 1, '#fff6c0'); r(13, 6, 1, 1, '#fff6c0');
    });
    const bus = (num) => (r, g) => {
      r(0, 0, 24, 10, PAL.ink);
      r(1, 1, 22, 8, '#d42a2a'); r(2, 2, 20, 6, '#e04646');
      r(22, 1, 1, 8, '#36475e'); r(1, 1, 1, 8, '#36475e');
      r(5, 3, 3, 4, '#c42424');
      if (num) drawTiny(g, num, 11, 3, '#ffffff'); else { r(11, 4, 8, 1, '#f4c0c0'); r(11, 5, 8, 1, '#f4c0c0'); }
    };
    BUS_ROUTES.forEach((def) => { VEH['bus_' + def.num] = mk(24, 10, bus(def.num)); });
    VEH.bus29 = VEH.bus_29;
    VEH.bus = mk(24, 10, bus(''));
  }

  /* ===================================================================
     SECTION: 8. Movement, A* pathfinding, journeys and the follower
     =================================================================== */
  const mkActor = () => ({ x: 0, y: 0, fx: 0, fy: 0, p: 1, dir: 'down', parity: 0, moving: false, speed: 5 });
  const me = mkActor(), her = mkActor();
  let charMe = null, charHer = null;
  let path = [];                      // remaining tiles of the current walk
  let journey = null;                 // { steps, i, final } — a multi-step trip (walk / tube / bus)
  let hidden = false;                 // true while we're inside a bus
  const held = [];
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function dirFrom(fx, fy, tx, ty) {
    if (tx > fx) return 'right'; if (tx < fx) return 'left';
    if (ty > fy) return 'down'; if (ty < fy) return 'up';
    return null;
  }
  function stepSpeed(fx, fy, tx, ty) {
    const onRoad = tiles[I(fx, fy)] === T.ROAD && tiles[I(tx, ty)] === T.ROAD;
    let s = onRoad ? (CFG.roadSpeed || 10) : (CFG.walkSpeed || 5.5);
    return s;
  }
  function startStep(nx, ny) {
    her.fx = her.x; her.fy = her.y;
    her.x = me.x; her.y = me.y;
    her.moving = her.fx !== her.x || her.fy !== her.y;
    if (her.moving) her.dir = dirFrom(her.fx, her.fy, her.x, her.y);
    me.fx = me.x; me.fy = me.y;
    me.x = nx; me.y = ny;
    me.dir = dirFrom(me.fx, me.fy, nx, ny) || me.dir;
    me.p = 0; her.p = 0; me.moving = true;
    me.parity ^= 1; her.parity = me.parity ^ 1;
    me.speed = stepSpeed(me.fx, me.fy, nx, ny);
    hidePrompt();
  }
  function tryNextStep() {
    if (path.length) {
      const n = path.shift();
      if (isWalk(n.x, n.y)) { startStep(n.x, n.y); return; }
      path = []; journey = null;
    }
    if (held.length) {
      const d = held[held.length - 1], [dx, dy] = DIRS[d];
      me.dir = d;
      if (isWalk(me.x + dx, me.y + dy)) startStep(me.x + dx, me.y + dy);
    }
  }
  function updateMovement(dt) {
    if (me.moving) {
      me.p += dt * me.speed;
      if (me.p >= 1) {
        const left = (me.p - 1) / me.speed;
        me.p = 1; her.p = 1; me.moving = false; her.moving = false;
        onArriveTile();
        if (!blocking()) { tryNextStep(); if (me.moving) me.p = Math.min(0.99, left * me.speed); }
      }
      her.p = me.p;
    } else if (!blocking()) {
      tryNextStep();
    }
  }

  let lastAbbey = -10;
  function onArriveTile() {
    if (path.length) return;
    if (journey) { nextJourneyStep(); return; }
    const i = I(me.x, me.y);
    if (abbey[i] && time - lastAbbey > 4) { lastAbbey = time; popHeart(); setTimeout(popHeart, 250); setTimeout(popHeart, 500); flashHover('Abbey Road crossing! Walk it like the Beatles'); }
    const e = entEntr[i];
    if (e) arriveAt(ENT[e - 1], false);
    else if (stopAt[i]) showPrompt((touchDevice() ? 'TAP' : 'SPACE') + ': CATCH A BUS (' + busNumsAt(i).join(', ') + ') AT ' + escapeHtml(stopNameAt(i).toUpperCase()));
  }

  // Generic A* on the 4-neighbour grid. `roadOnly` = only main roads (for vehicles).
  function astar(sx, sy, gx, gy, roadOnly) {
    const ok = (t) => (roadOnly ? t === T.ROAD : WALK[t] === 1);
    if (!inb(gx, gy) || !ok(tiles[I(gx, gy)])) return null;
    if (sx === gx && sy === gy) return [];
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const s = I(sx, sy), goal = I(gx, gy);
    const hk = roadOnly ? 1 : 0.55;
    const hfn = (u) => (Math.abs((u % W) - gx) + Math.abs(((u / W) | 0) - gy)) * hk;
    const heap = new Heap();
    g[s] = 0; heap.push(hfn(s), s);
    while (heap.size) {
      const u = heap.pop();
      if (u === goal) break;
      if (closed[u]) continue;
      closed[u] = 1;
      const x = u % W, y = (u / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!inb(nx, ny)) continue;
        const v = I(nx, ny);
        if (closed[v] || !ok(tiles[v])) continue;
        const ng = g[u] + (roadOnly ? 1 : COST[tiles[v]]);
        if (ng < g[v]) { g[v] = ng; came[v] = u; heap.push(ng + hfn(v), v); }
      }
    }
    if (came[goal] < 0) return null;
    const out = [];
    for (let u = goal; u !== s; u = came[u]) out.push({ x: u % W, y: (u / W) | 0 });
    return out.reverse();
  }

  // ---- Journeys: a list of steps (walk / tube / bus) run one after another ----
  function runJourney(steps, final) {
    path = []; held.length = 0;
    journey = { steps, i: -1, final: final || null };
    if (!me.moving) nextJourneyStep();
  }
  function nextJourneyStep() {
    if (!journey) return;
    journey.i++;
    const s = journey.steps[journey.i];
    if (!s) { const f = journey.final; journey = null; finishJourney(f); return; }
    if (s.t === 'walk') {
      if (me.x === s.x && me.y === s.y) { nextJourneyStep(); return; }
      const p = astar(me.x, me.y, s.x, s.y);
      if (!p) { journey = null; flashHover("Can't walk there"); return; }
      path = p;
    } else if (s.t === 'tube') {
      startTrain(s.route, () => { const d = s.route.to.ent; placeAt(d.ex, d.ey); updateCamera(0, true); nextJourneyStep(); });
    } else if (s.t === 'bus') {
      startBusRide(s.a, s.b, () => nextJourneyStep());
    }
  }
  function finishJourney(f) {
    if (!f) { const ti = I(me.x, me.y); if (stopAt[ti]) showPrompt((touchDevice() ? 'TAP' : 'SPACE') + ': CATCH A BUS (' + busNumsAt(ti).join(', ') + ')'); return; }
    arriveAt(f, true);
  }

  // Arrived at an entity's entrance. auto = we came here on purpose (click/menu)
  function arriveAt(e, auto) {
    popHeart();
    me.dir = 'up';
    if (!her.moving) her.dir = 'up';
    if (e.kind === 'landmark' && auto) openDialog(e);
    else showEntityPrompt(e);
  }

  // Put both characters on a tile (start, after the tube, after the bus)
  function placeAt(x, y) {
    me.x = me.fx = x; me.y = me.fy = y; me.p = 1; me.moving = false; me.dir = 'down';
    const opts = [[-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [1, 1], [0, 2]];
    let spot = [x, y];
    for (const [dx, dy] of opts) if (isWalk(x + dx, y + dy)) { spot = [x + dx, y + dy]; break; }
    her.x = her.fx = spot[0]; her.y = her.fy = spot[1]; her.p = 1; her.moving = false; her.dir = 'down';
    path = [];
  }

  /* ===================================================================
     SECTION: 9. Transport: tube network, bus 29, traffic
     =================================================================== */
  // ---- Real-life minutes for a walk (uses the real distance, not tiles) ----
  let geoLat = null, geoLng = null;
  function buildGeoCache() {
    geoLat = new Float32Array(N); geoLng = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const g = unproject(x + 0.5, y + 0.5); geoLat[I(x, y)] = g.lat; geoLng[I(x, y)] = g.lng; }
  }
  function pathKm(sx, sy, p) {
    let km = 0, pi = I(sx, sy);
    for (const q of p) {
      const qi = I(q.x, q.y);
      km += Math.hypot((geoLat[qi] - geoLat[pi]) * KY, (geoLng[qi] - geoLng[pi]) * KX);
      pi = qi;
    }
    return km / 1.2;   // grid paths zig-zag; real streets let you cut corners
  }
  const walkMinutes = (sx, sy, p) => pathKm(sx, sy, p) / 4.8 * 60;

  // ---- Tube graph: nodes are "station|line", changing lines costs extra ----
  const ADJ = {};
  const LINE_COLOR = {};
  function buildTubeGraph() {
    const add = (a, b, cost) => { (ADJ[a] = ADJ[a] || []).push({ to: b, cost }); };
    LINES.forEach((L) => {
      LINE_COLOR[L.name] = L.color;
      for (let k = 0; k < L.seq.length - 1; k++) {
        const a = L.seq[k] + '|' + L.name, b = L.seq[k + 1] + '|' + L.name;
        add(a, b, 1); add(b, a, 1);
      }
    });
    STATIONS.forEach((s) => s.lines.forEach((a) => s.lines.forEach((b) => { if (a !== b) add(s.id + '|' + a, s.id + '|' + b, 2.5); })));
  }
  function tubeRoute(fromId, toId) {
    if (fromId === toId) return null;
    const from = STN_BY[fromId], to = STN_BY[toId];
    if (!from || !to || !from.lines.length || !to.lines.length) return null;
    const dist = {}, prev = {};
    const heap = new Heap();
    from.lines.forEach((l) => { const k = fromId + '|' + l; dist[k] = 0; heap.push(0, k); });
    let end = null;
    while (heap.size) {
      const u = heap.pop();
      if (u.split('|')[0] === toId) { end = u; break; }
      (ADJ[u] || []).forEach((e) => {
        const nd = dist[u] + e.cost;
        if (dist[e.to] === undefined || nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; heap.push(nd, e.to); }
      });
    }
    if (!end) return null;
    const keys = [];
    for (let k = end; k; k = prev[k]) keys.unshift(k);
    const legs = [];
    let cur = null;
    keys.forEach((k) => {
      const [sid, line] = k.split('|');
      if (!cur || cur.line !== line) {
        cur = { line, color: LINE_COLOR[line], from: STN_BY[sid], to: STN_BY[sid], stops: 0 };
        legs.push(cur);
      } else { cur.to = STN_BY[sid]; cur.stops++; }
    });
    const real = legs.filter((l) => l.stops > 0);
    return { from, to, legs: real, stops: real.reduce((a, l) => a + l.stops, 0), changes: real.length - 1 };
  }
  const tubeMinutes = (r) => 3 + r.stops * 2 + r.changes * 5;
  function describeTube(r) {
    return r.legs.map((l, k) => (k ? 'change at ' + l.from.name + ', ' : '') + l.line + ' ' + l.stops + ' stop' + (l.stops > 1 ? 's' : '')).join(' · ');
  }

  // ---- Bus routes: each follows the main roads between its stops ----
  const ROUTES = [];       // { num, color, path: [tiles], stops: [stop objects] }
  const STOPS = [];        // every stop of every route: { name, lat, lng, idx (into its route path), x, y, r, k }
  const TILE_STOPS = new Map();   // tile index -> list of STOPS indices standing there
  let ROUTE = [];          // the 29's path (debug)
  function buildBusRoutes() {
    const snap = (lat, lng) => {
      const p = project(lat, lng);
      let best = null, bd = Infinity;
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
        const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
        if (get(x, y) !== T.ROAD) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { x, y }; }
      }
      return best;
    };
    BUS_ROUTES.forEach((def) => {
      const R = { num: def.num, color: def.color, path: [], stops: [], r: ROUTES.length };
      let prev = null;
      def.stops.forEach((st) => {
        const q = snap(st.lat, st.lng);
        if (!q) { console.warn('Bus ' + def.num + ' stop off-road: ' + st.name); return; }
        if (!prev) R.path.push(q);
        else {
          const seg = astar(prev.x, prev.y, q.x, q.y, true);
          if (!seg) { console.warn('Bus ' + def.num + ' route broken before ' + st.name); return; }
          R.path = R.path.concat(seg);
        }
        const stop = { name: st.name, lat: st.lat, lng: st.lng, idx: R.path.length - 1, x: q.x, y: q.y, r: R.r, k: R.stops.length };
        R.stops.push(stop);
        STOPS.push(stop);
        const ti = I(q.x, q.y);
        if (!TILE_STOPS.has(ti)) TILE_STOPS.set(ti, []);
        TILE_STOPS.get(ti).push(STOPS.length - 1);
        stopAt[ti] = 1;
        prev = q;
      });
      ROUTES.push(R);
    });
    ROUTE = ROUTES[0] ? ROUTES[0].path : [];
  }
  const busNumsAt = (ti) => Array.from(new Set((TILE_STOPS.get(ti) || []).map((k) => ROUTES[STOPS[k].r].num)));
  const stopNameAt = (ti) => { const l = TILE_STOPS.get(ti); return l && l.length ? STOPS[l[0]].name : ''; };
  // Draw the stop poles (baked into the world canvas), with every route number that stops there
  function paintBusStops() {
    const g = world.getContext('2d');
    TILE_STOPS.forEach((list, ti) => {
      const sx = ti % W, sy = (ti / W) | 0;
      let ox = 13, oy = 2;
      if (get(sx, sy - 1) !== T.ROAD) { ox = 12; oy = 1; }
      else if (get(sx, sy + 1) !== T.ROAD) { ox = 12; oy = 12; }
      else if (get(sx - 1, sy) !== T.ROAD) { ox = 1; oy = 6; }
      const x = sx * TILE + ox, y = sy * TILE + oy;
      const label = busNumsAt(ti).join(' ');
      const w = tinyWidth(label) + 4;
      g.fillStyle = '#2b2b33'; g.fillRect(x, y - 6, 1, 10);
      g.fillStyle = PAL.ink; g.fillRect(x - 4, y - 14, w + 2, 9);
      g.fillStyle = '#d42a2a'; g.fillRect(x - 3, y - 13, w, 7);
      drawTiny(g, label, x - 1, y - 12, '#ffffff');
    });
  }

  // ---- Traffic: black cabs, and red buses driving their routes ----
  const vehicles = [];
  let ROAD_TILES = [];
  function vehPos(v) {
    const n = v.path.length;
    const t = clamp(v.t, 0, n - 1);
    const k = Math.floor(t), f = t - k;
    const a = v.path[k], b = v.path[Math.min(n - 1, k + 1)];
    const d = dirFrom(a.x, a.y, b.x, b.y);
    if (d) v.dir = d;
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), dir: v.dir || 'right' };
  }
  function newCabPath(v) {
    const start = v.path.length ? v.path[v.path.length - 1] : pick(ROAD_TILES, Math.random());
    for (let tries = 0; tries < 6; tries++) {
      const goal = pick(ROAD_TILES, Math.random());
      const d = Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y);
      if (d < 15 || d > 80) continue;
      const p = astar(start.x, start.y, goal.x, goal.y, true);
      if (p && p.length > 4) { v.path = [start].concat(p); v.t = 0; return; }
    }
    v.path = [start, start]; v.t = 0;
  }
  function initTraffic() {
    ROAD_TILES = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tiles[I(x, y)] === T.ROAD) ROAD_TILES.push({ x, y });
    if (!ROAD_TILES.length) return;
    for (let k = 0; k < 12; k++) { const v = { kind: 'cab', path: [], t: 0, speed: 6 + Math.random() * 2 }; newCabPath(v); v.t = Math.random() * (v.path.length - 1); vehicles.push(v); }
    for (let k = 0; k < 2; k++) { const v = { kind: 'bus', path: [], t: 0, speed: 4.5 }; newCabPath(v); vehicles.push(v); }
    ROUTES.forEach((R) => {
      if (R.path.length < 10) return;
      const count = R.num === '29' ? 2 : 1;
      for (let k = 0; k < count; k++) {
        vehicles.push({ kind: 'bus_' + R.num, ambient: true, path: R.path.slice(), t: (k + Math.random() * 0.5) * R.path.length / count, speed: 5, stops: R.stops.map((st) => st.idx), wait: 0 });
      }
    });
  }
  function updateTraffic(dt) {
    for (let k = vehicles.length - 1; k >= 0; k--) {
      const v = vehicles[k];
      if (ride && v === ride.bus) continue;
      if (v.wait > 0) { v.wait -= dt; continue; }
      const before = v.t;
      v.t += v.speed * dt;
      if (v.stops) {   // pause at bus stops
        for (const s of v.stops) if (before < s && v.t >= s) { v.t = s; v.wait = 0.9; break; }
      }
      if (v.t >= v.path.length - 1) {
        if (v.leaving) { vehicles.splice(k, 1); continue; }
        if (v.ambient) { v.path = v.path.slice().reverse(); v.stops = v.stops.map((s) => v.path.length - 1 - s); v.t = 0; v.wait = 1.5; }
        else newCabPath(v);
      }
    }
  }

  // ---- Riding a bus (a and b are STOPS indices on the same route) ----
  let ride = null;   // { bus, board, alight, stops, phase, timer, onDone }
  function startBusRide(a, b, onDone) {
    const RT = ROUTES[STOPS[a].r], ROUTE = RT.path, RSTOPS = RT.stops;
    const ia = STOPS[a].idx, ib = STOPS[b].idx;
    const pre = 12, post = 18;
    let seq, board, alight, stopIdx;
    if (ib > ia) {
      const s = Math.max(0, ia - pre), e = Math.min(ROUTE.length - 1, ib + post);
      seq = ROUTE.slice(s, e + 1); board = ia - s; alight = ib - s;
      stopIdx = RSTOPS.filter((st) => st.idx > ia && st.idx < ib).map((st) => st.idx - s);
    } else {
      const s = Math.min(ROUTE.length - 1, ia + pre), e = Math.max(0, ib - post);
      seq = ROUTE.slice(e, s + 1).reverse(); board = s - ia; alight = s - ib;
      stopIdx = RSTOPS.filter((st) => st.idx < ia && st.idx > ib).map((st) => s - st.idx);
    }
    const bus = { kind: 'bus_' + RT.num, path: seq, t: 0, speed: 0 };
    vehicles.push(bus);
    ride = { bus, board, alight, stops: stopIdx, phase: 'arrive', timer: 0, onDone, to: STOPS[b], num: RT.num, wait: 0 };
    hidePrompt();
  }
  function updateRide(dt) {
    if (!ride) return;
    const R = ride, bus = R.bus;
    const drive = (target, maxSpeed) => {
      const dist = target - bus.t;
      const sp = maxSpeed * clamp(dist / 4 + 0.25, 0.25, 1);
      bus.t = Math.min(target, bus.t + sp * dt);
      return bus.t >= target - 0.001;
    };
    switch (R.phase) {
      case 'arrive':
        if (drive(R.board, CFG.busSpeed || 6)) { bus.t = R.board; R.phase = 'board'; R.timer = 0.7; sfx('ding'); }
        break;
      case 'board':
        R.timer -= dt;
        if (R.timer < 0.35) hidden = true;
        if (R.timer <= 0) { R.phase = 'ride'; flashHover('On the ' + R.num + ' to ' + R.to.name); }
        break;
      case 'ride': {
        if (R.wait > 0) { R.wait -= dt; break; }
        const nextStop = R.stops.find((s) => s > bus.t + 0.01);
        const target = nextStop !== undefined && nextStop < R.alight ? nextStop : R.alight;
        if (drive(target, CFG.busSpeed || 6)) {
          bus.t = target;
          if (target === R.alight) { R.phase = 'alight'; R.timer = 0.5; }
          else R.wait = REDUCED ? 0.05 : 0.3;
        }
        break;
      }
      case 'alight':
        R.timer -= dt;
        if (R.timer <= 0) {
          const q = bus.path[R.alight];
          placeAt(q.x, q.y);
          hidden = false;
          bus.leaving = true; bus.speed = CFG.busSpeed || 6;
          const cb = R.onDone;
          ride = null;
          popHeart();
          cb();
        }
        break;
    }
  }

  function drawVehicle(g, v, cx, cy) {
    const p = vehPos(v);
    const spr = VEH[v.kind];
    const w = spr.width, h = spr.height;
    const x = Math.round(p.x * TILE + 8 - cx), y = Math.round(p.y * TILE + 8 - cy);
    g.save();
    g.translate(x, y);
    if (p.dir === 'left') g.scale(-1, 1);
    else if (p.dir === 'down') g.rotate(Math.PI / 2);
    else if (p.dir === 'up') g.rotate(-Math.PI / 2);
    g.fillStyle = 'rgba(20,10,30,0.3)'; g.fillRect(-w / 2 + 1, -h / 2 + 2, w, h);
    g.drawImage(spr, -w / 2, -h / 2);
    g.restore();
    if (ride && v === ride.bus && hidden) drawHeart(g, x - 3, y - 18 + (REDUCED ? 0 : Math.round(Math.sin(time * 5) * 2)), '#ff5d8f', '#ffffff');
  }

  // ---- Trip planner: walk vs tube vs bus 29 ----
  // Real-world positions. The map is stretched and buildings get nudged, so for
  // "which station is closest?" we use the real coordinates, not tile counts.
  const geoOfTile = (x, y) => ({ lat: geoLat[I(x, y)], lng: geoLng[I(x, y)] });
  const geoOf = (e) => (e.lat !== undefined ? { lat: e.lat, lng: e.lng } : geoOfTile(e.ex, e.ey));
  const geoKm = (a, b) => Math.hypot((a.lat - b.lat) * KY, (a.lng - b.lng) * KX);
  // walking minutes between two real points (streets add ~30% over a straight line)
  const accessMinutes = (a, b) => geoKm(a, b) * 1.3 / 4.8 * 60;
  function nearestStations(pt, n) {
    return STATIONS.filter((s) => s.ent && !s.ent.skip && s.lines.length)
      .map((s) => ({ s, d: geoKm(s, pt) }))
      .sort((a, b) => a.d - b.d).slice(0, n).map((o) => o.s);
  }
  // nearest stops of one route (returns STOPS indices)
  function nearestStops(RT, pt, n) {
    return RT.stops.map((st) => ({ k: STOPS.indexOf(st), d: geoKm(st, pt) })).sort((a, b) => a.d - b.d).slice(0, n).map((o) => o.k);
  }
  function planTrip(target) {
    const gx = target.ex, gy = target.ey;
    const walk = astar(me.x, me.y, gx, gy);
    if (!walk) return null;
    const plan = { target, walkMin: walkMinutes(me.x, me.y, walk), tube: null, bus: null };
    // Where we are and where we're going, in the real world. If we're standing at a
    // place's entrance, use that place's real coordinates.
    const hereEnt = entEntr[I(me.x, me.y)] ? ENT[entEntr[I(me.x, me.y)] - 1] : null;
    const here = hereEnt ? geoOf(hereEnt) : geoOfTile(me.x, me.y);
    const there = geoOf(target);
    // Tube: try the 5 nearest stations (by real distance) at each end
    const toSt = {}, fromSt = {};
    nearestStations(here, 5).forEach((s) => { if (astar(me.x, me.y, s.ent.ex, s.ent.ey)) toSt[s.id] = accessMinutes(here, s); });
    nearestStations(there, 5).forEach((s) => { if (astar(s.ent.ex, s.ent.ey, gx, gy)) fromSt[s.id] = accessMinutes(s, there); });
    Object.keys(toSt).forEach((o) => Object.keys(fromSt).forEach((d) => {
      const r = tubeRoute(o, d);
      if (!r) return;
      const mins = toSt[o] + tubeMinutes(r) + fromSt[d];
      if (!plan.tube || mins < plan.tube.mins) plan.tube = { route: r, mins };
    }));
    // Buses: for every route, try its 2 nearest stops at each end
    ROUTES.forEach((RT) => {
      if (RT.stops.length < 2) return;
      nearestStops(RT, here, 2).forEach((a) => nearestStops(RT, there, 2).forEach((b) => {
        if (a === b) return;
        const n = Math.abs(STOPS[a].k - STOPS[b].k);
        const mins = accessMinutes(here, STOPS[a]) + 4 + n * 2.5 + accessMinutes(STOPS[b], there);
        if (plan.bus && mins >= plan.bus.mins) return;
        if (!astar(me.x, me.y, STOPS[a].x, STOPS[a].y) || !astar(STOPS[b].x, STOPS[b].y, gx, gy)) return;
        plan.bus = { a, b, mins, stops: n, route: RT };
      }));
    });
    return plan;
  }

  // Click on a place: walk there, or ask how to get there if it's far
  function goTo(target) {
    if (!me.moving && me.x === target.ex && me.y === target.ey) { arriveAt(target, true); return; }
    const plan = planTrip(target);
    if (!plan) { flashHover("Can't get there"); return; }
    const far = plan.walkMin > (CFG.travelMenuMinutes || 12);
    const useful = (o) => o && o.mins < plan.walkMin;
    if (!far || (!useful(plan.tube) && !useful(plan.bus))) { runJourney([{ t: 'walk', x: target.ex, y: target.ey }], target); return; }
    const mm = (m) => 'about ' + Math.max(1, Math.round(m)) + ' min';
    const items = [];
    const best = Math.min(plan.walkMin, plan.tube ? plan.tube.mins : Infinity, plan.bus ? plan.bus.mins : Infinity);
    items.push({ label: 'WALK · ' + mm(plan.walkMin), sub: 'Stroll there together on foot', best: best === plan.walkMin,
      action: () => runJourney([{ t: 'walk', x: target.ex, y: target.ey }], target) });
    if (plan.tube) {
      const r = plan.tube.route;
      items.push({ label: 'TUBE · ' + mm(plan.tube.mins), chips: r.legs.map((l) => l.color), best: best === plan.tube.mins,
        sub: 'Walk to ' + r.from.name + ' · ' + describeTube(r) + ' · get off at ' + r.to.name,
        action: () => runJourney([{ t: 'walk', x: r.from.ent.ex, y: r.from.ent.ey }, { t: 'tube', route: r }, { t: 'walk', x: target.ex, y: target.ey }], target) });
    } else items.push({ label: 'TUBE', sub: 'No useful tube route from here', disabled: true });
    if (plan.bus) {
      const b = plan.bus;
      items.push({ label: 'BUS ' + b.route.num + ' · ' + mm(b.mins), chips: [b.route.color], best: best === b.mins,
        sub: 'Board at ' + STOPS[b.a].name + ' · ' + b.stops + ' stop' + (b.stops > 1 ? 's' : '') + ' · get off at ' + STOPS[b.b].name,
        action: () => runJourney([{ t: 'walk', x: STOPS[b.a].x, y: STOPS[b.a].y }, { t: 'bus', a: b.a, b: b.b }, { t: 'walk', x: target.ex, y: target.ey }], target) });
    } else items.push({ label: 'BUS', sub: 'No bus goes near there', disabled: true });
    openMenu('HOW SHALL WE GO TO ' + target.name.toUpperCase() + '?', items);
  }

  /* ===================================================================
     SECTION: 10. Camera & drawing each frame
     =================================================================== */
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const view = { w: 320, h: 180, scale: 3 };
  const cam = { x: 0, y: 0 };
  let time = 0;
  let hoverEnt = null, hoverText = '';
  let hearts = [];
  let nightF = 0;
  let nightForced = CFG.timeOverride || (HASH.indexOf('night') >= 0 ? 'night' : HASH.indexOf('day') >= 0 ? 'day' : null);
  const PAL_TAG = { gold: '#ffd166', teal: '#4fd1c5', pink: '#ff7aa2' };

  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const m = ZOOMS[settings.zoom].m;   // zoom setting: how close the camera is
    view.scale = Math.max(1, Math.round(Math.min(vw / (360 / m), vh / (220 / m))));
    view.w = Math.ceil(vw / view.scale);
    view.h = Math.ceil(vh / view.scale);
    canvas.width = view.w; canvas.height = view.h;
    canvas.style.width = view.w * view.scale + 'px';
    canvas.style.height = view.h * view.scale + 'px';
    ctx.imageSmoothingEnabled = false;
  }

  const actorPx = (a) => ({ x: lerp(a.fx, a.x, a.p) * TILE, y: lerp(a.fy, a.y, a.p) * TILE });

  function camTarget() {
    let a = actorPx(me);
    if (ride && (hidden || ride.phase === 'ride')) { const p = vehPos(ride.bus); a = { x: p.x * TILE, y: p.y * TILE }; }
    const tx = a.x + 8 - view.w / 2;
    let ty = a.y + 8 - view.h / 2;
    if (!$('dialog').classList.contains('hidden')) ty += view.h * 0.2;
    return { x: clamp(tx, 0, Math.max(0, WORLD_W - view.w)), y: clamp(ty, 0, Math.max(0, WORLD_H - view.h)) };
  }
  function updateCamera(dt, snap) {
    const t = camTarget();
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
  }

  function drawActor(g, a, frames, cx, cy) {
    const p = actorPx(a);
    const x = Math.round(p.x - cx), y = Math.round(p.y - cy) - 3;
    g.fillStyle = 'rgba(20,10,30,0.28)';
    g.fillRect(x + 4, y + 15, 8, 2); g.fillRect(x + 3, y + 16, 10, 1);
    let f = 0;
    if (a.moving && a.p < 0.5) f = a.parity ? 1 : 2;
    const bob = (a.moving && f) ? -1 : 0;
    g.drawImage(frames[a.dir][f], x, y + bob);
  }

  const entTop = (e) => (e.ey - e.sh) * TILE;

  function draw() {
    const g = ctx, vw = view.w, vh = view.h;
    const cx = Math.round(cam.x), cy = Math.round(cam.y);
    g.fillStyle = '#2b2233'; g.fillRect(0, 0, vw, vh);
    const sw = Math.min(vw, WORLD_W - cx), sh = Math.min(vh, WORLD_H - cy);
    g.drawImage(world, cx, cy, sw, sh, 0, 0, sw, sh);

    // animated water sparkles
    const tx0 = Math.floor(cx / TILE), ty0 = Math.floor(cy / TILE);
    const tx1 = Math.min(W - 1, tx0 + Math.ceil(vw / TILE) + 1), ty1 = Math.min(H - 1, ty0 + Math.ceil(vh / TILE) + 1);
    const wt = time * (REDUCED ? 0.15 : 1);
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const t = tiles[I(x, y)];
      if (t !== T.WATER && t !== T.CANAL) continue;
      const ph = Math.sin(wt * 2.2 + hash2(x, y, 11) * 6.28);
      if (ph > 0.55) {
        const sx = (Math.floor(hash2(x, y, 12) * 10 + wt * 3) % 12) + 2;
        g.fillStyle = t === T.WATER ? PAL.waterL : PAL.canalL;
        g.fillRect(x * TILE - cx + sx, y * TILE - cy + 4 + Math.floor(hash2(x, y, 13) * 8), 3, 1);
      }
    }

    // buildings, vehicles and characters, sorted by their bottom edge
    const ents = [];
    ENT.forEach((e) => {
      if (e.skip) return;
      const x = e.fx * TILE - cx, y = entTop(e) - cy;
      if (x > vw || y > vh || x + e.w * TILE < 0 || y + e.sh * TILE < -20) return;
      ents.push({ y: e.ey * TILE, draw: () => g.drawImage(e.canvas, x, y) });
    });
    vehicles.forEach((v) => {
      const p = vehPos(v);
      const x = p.x * TILE - cx, y = p.y * TILE - cy;
      if (x < -30 || y < -30 || x > vw + 30 || y > vh + 30) return;
      ents.push({ y: p.y * TILE + 12, draw: () => drawVehicle(g, v, cx, cy) });
    });
    if (!hidden) {
      // After she collects all the love, she leads and I follow
      const leadF = herLeads() ? charHer : charMe, followF = herLeads() ? charMe : charHer;
      ents.push({ y: actorPx(her).y + 16.1, draw: () => drawActor(g, her, followF, cx, cy) });
      ents.push({ y: actorPx(me).y + 16.2, draw: () => drawActor(g, me, leadF, cx, cy) });
    }
    ents.sort((a, b) => a.y - b.y).forEach((e) => e.draw());

    // night: tint everything blue, then light the windows and lamps
    if (nightF > 0.01) {
      g.fillStyle = `rgba(14,20,64,${(0.62 * nightF).toFixed(3)})`;
      g.fillRect(0, 0, vw, vh);
      if (nightF > 0.35) {
        g.globalAlpha = clamp((nightF - 0.35) / 0.4, 0, 1);
        for (let k = 0; k < mapWindows.length; k++) {
          const w = mapWindows[k], x = w[0] - cx, y = w[1] - cy;
          if (x < -14 || y < -10 || x > vw || y > vh) continue;
          g.fillStyle = 'rgba(255,200,90,0.25)'; g.fillRect(x - 1, y - 1, w[2] + 2, w[3] + 2);
          g.fillStyle = PAL.lit; g.fillRect(x, y, w[2], w[3]);
        }
        for (let k = 0; k < mapLamps.length; k++) {
          const l = mapLamps[k], x = l[0] - cx, y = l[1] - cy;
          if (x < -12 || y < -12 || x > vw + 12 || y > vh + 12) continue;
          g.fillStyle = 'rgba(255,220,140,0.12)'; g.fillRect(x - 6, y - 4, 13, 14);
          g.fillStyle = 'rgba(255,220,140,0.18)'; g.fillRect(x - 3, y - 2, 7, 9);
          g.fillStyle = '#fff1b0'; g.fillRect(x - 1, y - 1, 3, 2);
        }
        ENT.forEach((e) => {
          if (e.skip) return;
          const ox = e.fx * TILE - cx, oy = entTop(e) - cy;
          if (ox > vw || oy > vh || ox + e.w * TILE < 0 || oy + e.sh * TILE < 0) return;
          e.lights.forEach((w) => {
            g.fillStyle = 'rgba(255,200,90,0.25)'; g.fillRect(ox + w[0] - 1, oy + w[1] - 1, w[2] + 2, w[3] + 2);
            g.fillStyle = w[4] || PAL.lit; g.fillRect(ox + w[0], oy + w[1], w[2], w[3]);
          });
        });
        // headlights
        vehicles.forEach((v) => {
          const p = vehPos(v), x = Math.round(p.x * TILE + 8 - cx), y = Math.round(p.y * TILE + 8 - cy);
          if (x < -20 || y < -20 || x > vw + 20 || y > vh + 20) return;
          const [dx, dy] = DIRS[p.dir] || [1, 0];
          g.fillStyle = 'rgba(255,240,190,0.22)'; g.fillRect(x + dx * 10 - 4, y + dy * 10 - 4, 9, 9);
        });
        let p = actorPx(me);
        if (hidden && ride) { const q = vehPos(ride.bus); p = { x: q.x * TILE, y: q.y * TILE }; }
        const grd = g.createRadialGradient(p.x - cx + 8, p.y - cy + 8, 4, p.x - cx + 8, p.y - cy + 8, 46);
        grd.addColorStop(0, 'rgba(255,220,160,0.28)'); grd.addColorStop(1, 'rgba(255,220,160,0)');
        g.globalCompositeOperation = 'lighter'; g.fillStyle = grd; g.fillRect(p.x - cx - 40, p.y - cy - 40, 96, 96);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
      }
    }

    // icon markers above landmarks (bobbing; turns pink with a heart once visited)
    LM.forEach((lm) => {
      const mx = lm.fx * TILE + (lm.w * TILE) / 2 - cx, my = entTop(lm) - cy;
      if (mx < -12 || mx > vw + 12 || my < -24 || my > vh + 24) return;
      const bob = REDUCED ? 0 : Math.round(Math.sin(time * 3 + lm.li) * 1.5);
      const x = Math.round(mx - 6), y = my - 17 + bob;
      const seen = visited.has(lm.id);
      const fill = seen ? '#ff8fb0' : lm.lastYear ? PAL_TAG.teal : PAL_TAG.gold;
      drawBubble(g, lm.sprite, x, y, fill);
      g.fillStyle = PAL.ink; g.fillRect(x + 5, y + 13, 3, 1); g.fillRect(x + 6, y + 14, 1, 1);
      if (seen) drawHeart(g, x + 9, y - 3, '#ff3d7a', '#ffffff');
    });

    if (hoverEnt && !hoverEnt.skip) {
      g.globalAlpha = 0.6 + Math.sin(time * 8) * 0.3;
      g.strokeStyle = '#fff6e0'; g.lineWidth = 1;
      g.strokeRect(hoverEnt.fx * TILE - cx - 0.5, entTop(hoverEnt) - cy - 0.5, hoverEnt.w * TILE + 1, hoverEnt.sh * TILE + 1);
      g.globalAlpha = 1;
    }

    hearts.forEach((h) => {
      const k = h.t / h.life;
      g.globalAlpha = 1 - k * k;
      drawHeart(g, Math.round(h.x - cx - 3 + (h.dx || 0) * k), Math.round(h.y - cy - k * 16), '#ff5d8f', '#ffffff');
      g.globalAlpha = 1;
    });
  }

  function popHeart() {
    const a = actorPx(me), b = actorPx(her);
    hearts.push({ x: (a.x + b.x) / 2 + 8, y: Math.min(a.y, b.y) - 4, t: 0, life: 1.4, dx: (Math.random() - 0.5) * 12 });
  }

  /* ===================================================================
     SECTION: 11. Minimap & full screen map
     =================================================================== */
  const MINI = {
    [T.BLOCK]: '#d4c6b4', [T.BUILDING]: '#d4c6b4', [T.GRASS]: '#7cc05a', [T.PATH]: '#e3cf9a', [T.ROAD]: '#fffaf0',
    [T.MINOR]: '#ece3d0', [T.WATER]: '#5aa2e6', [T.CANAL]: '#4a9fc0', [T.TOWPATH]: '#d8c294', [T.RAIL]: '#7b6f68',
    [T.TREE]: '#4c9a3c', [T.HEDGE]: '#3f7a35', [T.PLAZA]: '#e8e0d0', [T.STATION]: '#8aa0b0', [T.GARDEN]: '#a6d46e',
    [T.LANDMARK]: '#c9a98f', [T.PITCH]: '#8fd06a'
  };
  let miniBase = null;
  const mini = $('minimap'), mctx = mini.getContext('2d');

  function buildMiniBase() {
    miniBase = document.createElement('canvas');
    miniBase.width = W; miniBase.height = H;
    const g = miniBase.getContext('2d');
    const img = g.createImageData(W, H);
    for (let i = 0; i < N; i++) {
      const c = parseInt((MINI[tiles[i]] || '#000000').slice(1), 16);
      img.data[i * 4] = c >> 16; img.data[i * 4 + 1] = (c >> 8) & 255; img.data[i * 4 + 2] = c & 255; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    ROUTES.forEach((RT) => { g.fillStyle = RT.color; RT.path.forEach((q) => g.fillRect(q.x, q.y, 1, 1)); });   // bus routes
    mini.width = W; mini.height = H;
  }

  const lmColor = (lm) => (visited.has(lm.id) ? '#ff5d8f' : lm.lastYear ? PAL_TAG.teal : PAL_TAG.gold);

  function drawMinimap() {
    const g = mctx;
    g.drawImage(miniBase, 0, 0);
    g.strokeStyle = 'rgba(43,34,51,0.8)'; g.lineWidth = 1;
    g.strokeRect(Math.round(cam.x / TILE) + 0.5, Math.round(cam.y / TILE) + 0.5, Math.round(view.w / TILE), Math.round(view.h / TILE));
    LM.forEach((lm) => {
      g.fillStyle = PAL.ink; g.fillRect(lm.ex - 2, lm.ey - 3, 5, 5);
      g.fillStyle = lmColor(lm); g.fillRect(lm.ex - 1, lm.ey - 2, 3, 3);
    });
    const p = hidden && ride ? vehPos(ride.bus) : me;
    if (Math.floor(time * 3) % 2 === 0) {
      g.fillStyle = '#ffffff'; g.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5);
      g.fillStyle = '#e8364f'; g.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
    }
  }

  const BIG = 4;
  const bigCanvas = $('bigmap-canvas'), bctx = bigCanvas.getContext('2d');
  let bigHover = null;

  function openBigMap() {
    if (blockingExcept('bigmap')) return;
    $('bigmap').classList.remove('hidden');
    bigCanvas.width = W * BIG; bigCanvas.height = H * BIG;
    const fit = Math.min((window.innerWidth - 40) / bigCanvas.width, (window.innerHeight - 110) / bigCanvas.height);
    const s = fit >= 1 ? Math.floor(fit * 2) / 2 : fit;
    bigCanvas.style.width = Math.floor(bigCanvas.width * s) + 'px';
    bigCanvas.style.height = Math.floor(bigCanvas.height * s) + 'px';
    bigHover = null;
    $('bigmap-label').textContent = 'Click a place (or a tube station) to go there';
  }
  function closeBigMap() { $('bigmap').classList.add('hidden'); }

  const bigPos = (e) => ({ x: e.ex * BIG + 2, y: (e.ey - e.h / 2) * BIG });

  function drawBigMap() {
    const g = bctx;
    g.imageSmoothingEnabled = false;
    g.drawImage(miniBase, 0, 0, W * BIG, H * BIG);
    g.font = '8px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    (CFG.areaLabels || []).forEach((l) => {
      const p = project(l.lat, l.lng);
      g.fillStyle = 'rgba(43,34,51,0.55)'; g.fillText(l.name, clamp(p.x * BIG, 60, W * BIG - 60), clamp(p.y * BIG, 10, H * BIG - 10));
    });
    STOPS.forEach((st) => { g.fillStyle = PAL.ink; g.fillRect(st.x * BIG - 2, st.y * BIG - 2, 7, 7); g.fillStyle = ROUTES[st.r].color; g.fillRect(st.x * BIG - 1, st.y * BIG - 1, 5, 5); });
    STATIONS.forEach((s) => {
      const e = s.ent; if (!e || e.skip || e.kind === 'landmark') return;
      const p = bigPos(e);
      g.fillStyle = PAL.ink; g.fillRect(p.x - 4, p.y - 4, 9, 9);
      g.fillStyle = '#ffffff'; g.fillRect(p.x - 3, p.y - 3, 7, 7);
      g.fillStyle = LINE_COLOR[s.lines[0]] || '#1c3f94'; g.fillRect(p.x - 3, p.y - 1, 7, 3);
    });
    LM.forEach((lm) => {
      const p = bigPos(lm);
      drawBubble(g, lm.sprite, p.x - 6, p.y - 6, lmColor(lm));
    });
    const hl = bigHover;
    if (hl) {
      const p = bigPos(hl);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(p.x - 9, p.y - 9, 18, 18);
      g.font = '8px ' + FONT;
      const tw = g.measureText(hl.name).width + 10;
      const lx = clamp(p.x, tw / 2 + 2, W * BIG - tw / 2 - 2), ly = Math.max(10, p.y - 20);
      g.fillStyle = PAL.ink; g.fillRect(lx - tw / 2, ly - 7, tw, 14);
      g.fillStyle = '#fff6e0'; g.fillText(hl.name, lx, ly + 1);
    }
    const mp = hidden && ride ? vehPos(ride.bus) : me;
    if (Math.floor(time * 3) % 2 === 0) {
      const x = Math.round(mp.x * BIG), y = Math.round(mp.y * BIG);
      g.fillStyle = '#ffffff'; g.fillRect(x - 5, y - 5, 11, 11);
      g.fillStyle = '#e8364f'; g.fillRect(x - 3, y - 3, 7, 7);
    }
    // legend: London buses are all red, then tube + places
    g.font = '8px ' + FONT;
    const ly = H * BIG - 14;
    const busLabel = 'BUS ' + ROUTES.map((RT) => RT.num).join(' ');
    const bw = g.measureText(busLabel).width;
    g.fillStyle = 'rgba(255,250,240,0.92)'; g.fillRect(6, ly - 8, bw + 150, 16);
    g.textAlign = 'left';
    g.fillStyle = '#d42a2a'; g.fillRect(12, ly - 3, 6, 6);
    g.fillStyle = PAL.ink; g.fillText(busLabel, 22, ly + 1);
    const lx = 22 + bw + 14;
    g.fillStyle = '#1c3f94'; g.fillRect(lx, ly - 3, 6, 6); g.fillStyle = PAL.ink; g.fillText('TUBE', lx + 9, ly + 1);
    g.fillStyle = PAL_TAG.gold; g.fillRect(lx + 52, ly - 3, 6, 6); g.fillStyle = PAL.ink; g.fillText('PLACES', lx + 61, ly + 1);
  }

  function bigMapPick(ev) {
    const rc = bigCanvas.getBoundingClientRect();
    const x = (ev.clientX - rc.left) / rc.width * bigCanvas.width, y = (ev.clientY - rc.top) / rc.height * bigCanvas.height;
    let best = null, bd = 16 * 16;
    const consider = (e, bonus) => { if (!e || e.skip) return; const p = bigPos(e); const d = (p.x - x) ** 2 + (p.y - y) ** 2 - bonus; if (d < bd) { bd = d; best = e; } };
    LM.forEach((l) => consider(l, 30));
    STATIONS.forEach((s) => { if (s.ent.kind !== 'landmark') consider(s.ent, 0); });
    return best;
  }

  /* ===================================================================
     SECTION: 12. Dialog, menus, train ride
     =================================================================== */
  const visited = new Set((store.get('htae-visited') || []).filter((id) => LM.some((l) => l.id === id)));
  let dialog = null;
  let endingShown = !!store.get('htae-ending-seen');
  // once the goal is achieved (and the letter has been read) she leads the walk
  const herLeads = () => endingShown && visited.size >= LM.length;

  function saveVisited() { store.set('htae-visited', Array.from(visited)); }

  function touchDevice() { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  function showPrompt(html) { $('prompt').innerHTML = html; $('prompt').classList.remove('hidden'); }
  function hidePrompt() { $('prompt').classList.add('hidden'); }
  function showEntityPrompt(e) {
    const key = touchDevice() ? 'TAP' : 'SPACE';
    if (e.kind === 'landmark') {
      let s = key + ': ' + escapeHtml(e.name.toUpperCase());
      if (e.stn) s += '<br>T: TAKE THE TUBE';
      showPrompt(s);
    } else if (e.kind === 'station') showPrompt(key + ': TAKE THE TUBE FROM ' + escapeHtml(e.stn.name.toUpperCase()));
    else showPrompt(escapeHtml(e.name.toUpperCase()));
  }

  function openDialog(lm) {
    hidePrompt();
    path = []; journey = null;
    const firstTime = !visited.has(lm.id);
    visited.add(lm.id); saveVisited(); updateCounter();
    // the heart of the game: collecting the love at each place
    const chip = $('dlg-love');
    chip.innerHTML = '<i class="px-heart"></i>' + (firstTime ? 'LOVE FOUND ' : 'LOVE ') + visited.size + '/' + LM.length;
    chip.className = 'love-chip' + (firstTime ? ' new' : '');
    sfx(firstTime ? 'heart' : 'open');
    if (firstTime) { popHeart(); setTimeout(popHeart, 200); setTimeout(popHeart, 400); flashHover('You found the love at ' + lm.name + '! (' + visited.size + ' of ' + LM.length + ')'); }
    $('dlg-name').textContent = lm.name;
    const ic = $('dlg-icon').getContext('2d');
    ic.clearRect(0, 0, 13, 13); drawBubble(ic, lm.sprite, 0, 0, lm.lastYear ? PAL_TAG.teal : PAL_TAG.gold);
    const tag = $('dlg-tag');
    tag.textContent = (lm.tag || '').toUpperCase();
    tag.className = 'tag ' + (lm.tag || '').toLowerCase().replace(/\s+/g, '-');
    tag.classList.toggle('hidden', !lm.tag);
    $('dlg-tube').classList.toggle('hidden', !lm.stn);
    $('dialog').classList.remove('hidden');
    dialog = { lm, page: 0 };
    showPage();
  }
  function showPage() {
    const d = dialog, text = String(d.lm.notes[d.page]);
    d.full = text; d.typed = 0;
    $('dlg-page').textContent = d.lm.notes.length > 1 ? (d.page + 1) + '/' + d.lm.notes.length : '';
    $('dlg-next').style.visibility = 'hidden';
    clearInterval(d.timer);
    if (REDUCED) d.typed = text.length;
    const tick = () => {
      d.typed = Math.min(text.length, d.typed + 1);
      $('dlg-text').textContent = text.slice(0, d.typed);
      if (d.typed >= text.length) { clearInterval(d.timer); $('dlg-next').style.visibility = 'visible'; }
    };
    tick();
    if (d.typed < text.length) d.timer = setInterval(tick, 28);
  }
  function advanceDialog() {
    const d = dialog; if (!d) return;
    if (d.typed < d.full.length) {
      clearInterval(d.timer); d.typed = d.full.length;
      $('dlg-text').textContent = d.full; $('dlg-next').style.visibility = 'visible';
      return;
    }
    sfx('blip');
    if (d.page < d.lm.notes.length - 1) { d.page++; showPage(); return; }
    closeDialog();
  }
  function closeDialog() {
    if (!dialog) return;
    clearInterval(dialog.timer);
    const lm = dialog.lm;
    dialog = null;
    $('dialog').classList.add('hidden');
    if (visited.size >= LM.length && !endingShown) setTimeout(showEnding, 400);
    else if (entEntr[I(me.x, me.y)] === lm.i + 1) showEntityPrompt(lm);
  }

  // ---- Generic menu (travel choice, tube destinations, bus stops) ----
  let menuItems = [], menuSel = 0;
  function openMenu(title, items) {
    hidePrompt();
    menuItems = items;
    $('menu-title').textContent = title;
    const list = $('menu-list'); list.innerHTML = '';
    items.forEach((it, k) => {
      const b = document.createElement('button');
      b.disabled = !!it.disabled;
      const chips = (it.chips || []).map((c) => '<i class="chip" style="background:' + c + '"></i>').join('');
      b.innerHTML = chips + escapeHtml(it.label) + (it.best ? ' ★' : '') + (it.sub ? '<span class="sub">' + escapeHtml(it.sub) + '</span>' : '');
      b.onclick = () => { sfx('blip'); closeMenu(); if (it.action) it.action(); };
      b.onmouseenter = () => { if (!it.disabled) { menuSel = k; markMenuSel(); } };
      list.appendChild(b);
    });
    menuSel = Math.max(0, items.findIndex((it) => it.best && !it.disabled));
    if (items[menuSel] && items[menuSel].disabled) menuSel = Math.max(0, items.findIndex((it) => !it.disabled));
    markMenuSel();
    $('menu').classList.remove('hidden');
  }
  function markMenuSel() {
    Array.from($('menu-list').children).forEach((b, k) => b.classList.toggle('sel', k === menuSel));
    const b = $('menu-list').children[menuSel]; if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
  }
  function moveMenu(d) {
    const n = menuItems.length; if (!n) return;
    for (let k = 0; k < n; k++) { menuSel = (menuSel + d + n) % n; if (!menuItems[menuSel].disabled) break; }
    markMenuSel();
  }
  function closeMenu() { $('menu').classList.add('hidden'); }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Tube menu: pick any station on the network
  function openTubeMenu(fromStn) {
    if (!fromStn) {
      const e = entEntr[I(me.x, me.y)];
      const ent = dialog ? dialog.lm : (e ? ENT[e - 1] : null);
      fromStn = ent && ent.stn;
    }
    if (!fromStn) return;
    if (dialog) { clearInterval(dialog.timer); dialog = null; $('dialog').classList.add('hidden'); }
    const items = STATIONS.filter((s) => s !== fromStn && s.lines.length && s.ent && !s.ent.skip)
      .map((s) => ({ s, r: tubeRoute(fromStn.id, s.id) })).filter((o) => o.r)
      .sort((a, b) => a.s.name.localeCompare(b.s.name))
      .map(({ s, r }) => ({
        label: s.name + (s.ent.kind === 'landmark' ? ' ♥' : ''), chips: s.lines.map((l) => LINE_COLOR[l]),
        sub: describeTube(r) + ' · about ' + tubeMinutes(r) + ' min',
        action: () => runJourney([{ t: 'tube', route: r }], s.ent)
      }));
    openMenu('TUBE FROM ' + fromStn.name.toUpperCase(), items);
  }

  // Bus menu: every route that stops here, and every stop you can ride to
  function openBusMenu(ti) {
    const items = [];
    (TILE_STOPS.get(ti) || []).forEach((a) => {
      const from = STOPS[a], RT = ROUTES[from.r];
      RT.stops.forEach((to) => {
        if (to === from) return;
        const n = Math.abs(to.k - from.k);
        const endName = to.k > from.k ? RT.stops[RT.stops.length - 1].name : RT.stops[0].name;
        items.push({
          label: RT.num + ' to ' + to.name, chips: [RT.color],
          sub: 'towards ' + endName + ' · ' + n + ' stop' + (n > 1 ? 's' : ''),
          action: () => runJourney([{ t: 'bus', a, b: STOPS.indexOf(to) }], null)
        });
      });
    });
    if (items.length) openMenu('BUSES FROM ' + stopNameAt(ti).toUpperCase(), items);
  }

  // ---- Train ride transition: one train per line, with changes in between ----
  const trainCv = $('train'), tctx = trainCv.getContext('2d');
  let train = null;
  function startTrain(route, onDone) {
    const segs = [];
    route.legs.forEach((leg, k) => {
      if (k > 0) segs.push({ type: 'change', at: leg.from, leg, dur: REDUCED ? 0.5 : 1.3 });
      segs.push({ type: 'leg', leg, dur: REDUCED ? 0.7 : 1.7 + 0.25 * Math.min(leg.stops, 8) });
    });
    const total = segs.reduce((a, s) => a + s.dur, 0);
    train = { segs, t: 0, total, onDone };
    sfx('train');
    trainCv.width = 240; trainCv.height = 135;
    trainCv.classList.remove('hidden');
    hidePrompt();
  }
  function drawTrain(dt) {
    const g = tctx, Wt = 240, Ht = 135;
    train.t += dt;
    let acc = 0, seg = train.segs[train.segs.length - 1], local = 1;
    for (const s of train.segs) { if (train.t < acc + s.dur) { seg = s; local = (train.t - acc) / s.dur; break; } acc += s.dur; }
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#14101e'; g.fillRect(0, 0, Wt, Ht);
    g.font = '8px ' + FONT; g.textAlign = 'center';
    if (seg.type === 'leg') {
      const leg = seg.leg;
      g.fillStyle = '#2a2236'; g.fillRect(0, 30, Wt, 70);
      g.fillStyle = '#3a3048'; g.fillRect(0, 30, Wt, 3); g.fillRect(0, 97, Wt, 3);
      const off = (train.t * (REDUCED ? 60 : 260)) % 40;
      for (let x = -off; x < Wt; x += 40) { g.fillStyle = '#ffd66b'; g.fillRect(Math.round(x), 38, 6, 2); g.fillStyle = 'rgba(255,214,107,0.15)'; g.fillRect(Math.round(x) - 3, 35, 12, 8); }
      g.fillStyle = '#5b4535'; for (let x = -(off * 1.5) % 8; x < Wt; x += 8) g.fillRect(Math.round(x), 92, 4, 3);
      g.fillStyle = '#c7cbd3'; g.fillRect(0, 91, Wt, 1);
      const k = local;
      const ease = k < 0.35 ? 1 - Math.pow(1 - k / 0.35, 3) : k < 0.65 ? 1 : 1 + Math.pow((k - 0.65) / 0.35, 3);
      const tx = Math.round(-200 + ease * 220);
      const shake = (k > 0.35 && k < 0.65) ? 0 : (Math.floor(train.t * 20) % 2);
      for (let c = 0; c < 3; c++) {
        const x = tx + c * 64, y = 58 + shake;
        g.fillStyle = PAL.ink; g.fillRect(x - 1, y - 1, 62, 34);
        g.fillStyle = '#e9e5dc'; g.fillRect(x, y, 60, 32);
        g.fillStyle = leg.color; g.fillRect(x, y + 22, 60, 5);
        g.fillStyle = '#1f3f8f'; g.fillRect(x, y + 27, 60, 3);
        for (let w = 0; w < 4; w++) { g.fillStyle = '#36475e'; g.fillRect(x + 4 + w * 14, y + 5, 10, 11); g.fillStyle = '#ffd66b'; g.fillRect(x + 4 + w * 14, y + 5, 10, 2); }
        if (c === 2) { g.fillStyle = '#ffd66b'; g.fillRect(x + 58, y + 18, 2, 3); }
        g.fillStyle = '#222'; g.fillRect(x + 8, y + 31, 6, 3); g.fillRect(x + 46, y + 31, 6, 3);
      }
      const fx = tx + 128 + 4 + 14, fy = 58 + shake + 5;
      g.save(); g.beginPath(); g.rect(fx, fy, 24, 11); g.clip();
      g.drawImage((herLeads() ? charHer : charMe).right[0], fx - 2, fy + 1);
      g.drawImage((herLeads() ? charMe : charHer).right[0], fx + 10, fy + 1);
      g.restore();
      g.fillStyle = leg.color === '#1a1a1a' ? '#3a3a44' : leg.color; g.fillRect(Wt / 2 - 64, 7, 128, 13);
      g.fillStyle = leg.color === '#ffd329' || leg.color === '#a0a5a9' ? PAL.ink : '#ffffff';
      g.fillText(leg.line.toUpperCase(), Wt / 2, 17);
      g.fillStyle = '#fff4e0'; g.fillText(leg.stops + ' STOP' + (leg.stops > 1 ? 'S' : '') + ' TO', Wt / 2, 112);
      g.fillStyle = PAL_TAG.gold; g.fillText(leg.to.name.toUpperCase().slice(0, 28), Wt / 2, 124);
    } else {
      // changing lines: a platform with us walking across
      g.fillStyle = '#d9d2c2'; g.fillRect(0, 70, Wt, 40);
      g.fillStyle = '#b8b0a0'; for (let x = 0; x < Wt; x += 16) g.fillRect(x, 70, 1, 40);
      g.fillStyle = '#ffd329'; g.fillRect(0, 70, Wt, 2);
      g.fillStyle = '#e9e5dc'; g.fillRect(0, 30, Wt, 38);
      g.fillStyle = seg.leg.color; g.fillRect(20, 40, 60, 10);
      const wx = Math.round(-20 + local * 260);
      const f = Math.floor(train.t * 8) % 2 ? 1 : 2;
      g.drawImage(charHer.right[f], wx - 18, 82);
      g.drawImage(charMe.right[f], wx, 82);
      g.fillStyle = '#fff4e0'; g.fillText('CHANGE AT', Wt / 2, 14);
      g.fillStyle = PAL_TAG.gold; g.fillText(seg.at.name.toUpperCase().slice(0, 28), Wt / 2, 26);
      g.fillStyle = '#fff4e0'; g.fillText('FOR THE ' + seg.leg.line.toUpperCase(), Wt / 2, 124);
    }
    const kk = train.t / train.total;
    const fade = kk < 0.06 ? 1 - kk / 0.06 : kk > 0.94 ? (kk - 0.94) / 0.06 : 0;
    if (fade > 0) { g.fillStyle = `rgba(0,0,0,${clamp(fade, 0, 1)})`; g.fillRect(0, 0, Wt, Ht); }
    if (train.t >= train.total) {
      const cb = train.onDone; train = null;
      trainCv.classList.add('hidden');
      cb();
    }
  }

  /* ===================================================================
     SECTION: 13. Title screen, HUD, clocks, day/night, audio, ending
     =================================================================== */
  let started = false;
  let gameBegun = false;   // true once we've been placed on the map (so the main menu can resume)

  // Back to the title screen; pressing CONTINUE carries on from the same spot
  function goToMainMenu() {
    if (dialog) { clearInterval(dialog.timer); dialog = null; $('dialog').classList.add('hidden'); }
    ['menu', 'bigmap', 'settings'].forEach((id) => $(id).classList.add('hidden'));
    path = []; journey = null; held.length = 0;
    started = false;
    $('hud').classList.add('hidden'); mini.classList.add('hidden'); hidePrompt();
    $('title').classList.remove('hidden');
    $('btn-start').textContent = 'CONTINUE';
    $('btn-reset').classList.toggle('hidden', visited.size === 0);
  }
  // ---- Background music (files in the music/ folder, set up in config.js) ----
  //   opening: plays as soon as the game opens
  //   shuffle: random order after that, while exploring
  //   ending:  loops on the letter screen once all the love is collected
  const audio = new Audio();
  let audioOk = true;
  const MUSIC = CFG.music || {};
  const norm = (t) => (!t ? null : typeof t === 'string' ? { file: t, title: t.replace(/^.*\//, '').replace(/\.[^.]+$/, '') } : t);
  const OPENING = norm(MUSIC.opening);
  const ENDING = norm(MUSIC.ending);
  const SHUFFLE = (MUSIC.shuffle || []).map(norm).filter(Boolean);
  let current = null, history = [], failures = 0, musicStarted = false, endingMode = false, awaitingGesture = false;

  // "Shuffle bag": every song plays once (in random order) before any song repeats,
  // and a new round never starts with the song we just heard.
  let bag = [];
  const sameSong = (a, b) => !!a && !!b && a.file === b.file;
  function shuffleNext() {
    const pool = SHUFFLE.length ? SHUFFLE : [OPENING].filter(Boolean);
    if (pool.length <= 1) return pool[0] || null;
    if (!bag.length) {
      bag = pool.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      const recent = [current, history[history.length - 1]];
      const k = bag.findIndex((t) => !recent.some((r) => sameSong(r, t)));
      if (k > 0) [bag[0], bag[k]] = [bag[k], bag[0]];
    }
    let t = bag.shift();
    if (sameSong(t, current) && bag.length) { bag.push(t); t = bag.shift(); }
    return t;
  }
  // Browsers only allow sound after the first click/tap/key press, so if the
  // opening song is blocked we start it on her first interaction.
  function tryPlay() {
    const pr = audio.play();
    if (pr && pr.catch) pr.catch((e) => { if (e && e.name === 'NotAllowedError') awaitingGesture = true; });
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => {
    if (awaitingGesture && settings.music) { awaitingGesture = false; tryPlay(); }
  }, true));

  function playSong(t, loop, fromHistory, keepFade) {
    if (!t) return;
    musicStarted = true;
    if (!keepFade) { clearInterval(fadeTimer); fadeMul = 1; }
    if (!fromHistory && current && current !== t) { history.push(current); if (history.length > 30) history.shift(); }
    current = t;
    audio.loop = !!loop;
    if (t.start) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = t.start; } catch (e) { /* ignore */ } }, { once: true });
    audio.src = encodeURI(t.file);
    applySound();
    if (settings.music) tryPlay();
    updateNowPlaying();
  }
  audio.addEventListener('ended', () => { if (!endingMode) playSong(shuffleNext()); });
  audio.addEventListener('playing', () => { failures = 0; audioOk = true; updateNowPlaying(); });
  audio.addEventListener('error', () => {
    // a file is missing or can't be played: quietly move on to another song
    failures++;
    if (failures < SHUFFLE.length + 2) playSong(shuffleNext());
    else { audioOk = false; updateNowPlaying(); }
  });
  function startMusic() { if (!musicStarted) playSong(OPENING || shuffleNext()); }
  // Volume fades (fadeMul multiplies the volume chosen in Settings)
  let fadeMul = 1, fadeTimer = null;
  function fadeTo(target, ms, done) {
    clearInterval(fadeTimer);
    const from = fadeMul, t0 = performance.now();
    fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      fadeMul = from + (target - from) * k;
      applyVolume();
      if (k >= 1) { clearInterval(fadeTimer); if (done) done(); }
    }, 50);
  }
  // The ending song: the current song fades out, then the ending song slowly fades in and loops
  function playEndingSong() {
    if (!ENDING) return;
    if (endingMode && current === ENDING) { audio.loop = true; fadeTo(1, 1500); return; }
    endingMode = true;
    const start = () => { fadeMul = 0; playSong(ENDING, true, false, true); fadeTo(1, REDUCED ? 500 : 6000); };
    if (musicStarted && !audio.paused && settings.music) fadeTo(0, 1500, start); else start();
  }
  // After the letter: let the ending song finish naturally, then the shuffle takes over
  function letEndingSongFinish() {
    if (!endingMode) return;
    endingMode = false;
    audio.loop = false;   // the 'ended' event will pick the next shuffle song
  }
  function nextSong() { failures = 0; audioOk = true; endingMode = false; playSong(shuffleNext()); }
  function prevSong() { failures = 0; audioOk = true; endingMode = false; if (history.length) playSong(history.pop(), false, true); else if (current) playSong(current, false, true); }
  function updateNowPlaying() {
    const el = $('now-playing'); if (!el) return;
    el.textContent = !audioOk ? 'No music found' : current ? current.title : (OPENING ? OPENING.title : '-');
  }
  function applyVolume() { audio.volume = clamp(settings.musicVol / 100 * fadeMul, 0, 1); }
  function applySound() {
    applyVolume();
    audio.muted = !settings.music;
    if (musicStarted && settings.music && audioOk && audio.paused && audio.src) tryPlay();
  }

  function updateCounter() {
    $('counter').innerHTML = '<i class="px-heart"></i>' + visited.size + '/' + LM.length;
    $('btn-letter').classList.toggle('hidden', !(endingShown && visited.size >= LM.length));
  }

  const fmtLon = new Intl.DateTimeFormat('en-GB', { timeZone: CFG.places.london.timeZone, hour: '2-digit', minute: '2-digit' });
  const fmtKL = new Intl.DateTimeFormat('en-GB', { timeZone: CFG.places.kl.timeZone, hour: '2-digit', minute: '2-digit' });
  function updateClocks() {
    const now = new Date();
    $('t-lon').textContent = fmtLon.format(now);
    $('t-kl').textContent = fmtKL.format(now);
  }
  function sunElevation(date, lat, lng) {
    const d = date.getTime() / 86400000 - 10957.5;
    const g = (357.529 + 0.98560028 * d) * D2R;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    const e = (23.439 - 0.00000036 * d) * D2R;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const ha = (gmst * 15 + lng) * D2R - ra;
    return Math.asin(Math.sin(lat * D2R) * Math.sin(dec) + Math.cos(lat * D2R) * Math.cos(dec) * Math.cos(ha)) / D2R;
  }
  function updateNight() {
    if (nightForced === 'night') { nightF = 1; return; }
    if (nightForced === 'day') { nightF = 0; return; }
    const el = sunElevation(new Date(), CFG.places.london.lat, CFG.places.london.lng);
    nightF = clamp(-el / 8, 0, 1);
  }

  function setupTitle() {
    $('title-song').textContent = CFG.songTitle || 'Here, There and Everywhere';
    $('title-sub').textContent = CFG.subtitle || '';
    $('btn-reset').classList.toggle('hidden', visited.size === 0);
  }

  function drawScene(cv, mode) {
    const g = cv.getContext('2d');
    const Wc = 200, Hc = 70;
    if (cv.width !== Wc) { cv.width = Wc; cv.height = Hc; }
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, Wc, Hc);
    for (let k = 0; k < 40; k++) {
      if (mode === 'title') break;   // no stars on the daytime-brown title screen
      const tw = REDUCED ? 1 : (Math.sin(time * 2 + k) > 0.3 ? 1 : 0.4);
      g.fillStyle = `rgba(255,244,224,${0.35 + 0.5 * tw * hash2(k, 0, 4)})`;
      g.fillRect(Math.floor(hash2(k, 1, 4) * Wc), Math.floor(hash2(k, 2, 4) * 40), 1, 1);
    }
    const warm = mode === 'title';   // light brown title screen, dark brown ending
    g.fillStyle = warm ? '#9c6e45' : '#5a3a22'; g.fillRect(0, 54, Wc, 16);
    g.fillStyle = warm ? '#b5845a' : '#7a5232'; g.fillRect(0, 54, Wc, 2);
    if (mode === 'title') {
      g.fillStyle = '#a77a50';
      // London: terraces and the BT Tower; KL: twin towers
      [[4, 36, 10, 18], [16, 30, 8, 24], [26, 40, 12, 14], [40, 26, 6, 28], [41, 18, 4, 8], [42, 12, 2, 6]].forEach((b) => g.fillRect(b[0], b[1], b[2], b[3]));
      [[150, 30, 8, 24], [160, 20, 6, 34], [168, 20, 6, 34], [176, 34, 14, 20], [161, 14, 4, 6], [169, 14, 4, 6], [162, 8, 2, 6], [170, 8, 2, 6], [166, 30, 2, 2]].forEach((b) => g.fillRect(b[0], b[1], b[2], b[3]));
      g.drawImage(charMe.right[0], 52, 38);
      g.drawImage(charHer.left[0], 132, 38);
      drawTiny(g, 'LONDON', 46, 60, '#fff4e0'); drawTiny(g, 'KL', 136, 60, '#fff4e0');
      for (let x = 72; x < 130; x += 4) { if (Math.floor((x + time * 12) / 4) % 3) { g.fillStyle = '#7a5232'; g.fillRect(x, 50, 2, 1); } }
      const hx = 100 + (REDUCED ? 0 : Math.sin(time * 1.2) * 24);
      drawHeart(g, Math.round(hx - 3), 36 + (REDUCED ? 0 : Math.round(Math.sin(time * 3) * 2)), '#ff5d8f', PAL.ink);
    } else {
      g.drawImage(charMe.right[0], 84, 38);
      g.drawImage(charHer.left[0], 100, 38);
      for (let k = 0; k < 6; k++) {
        const t2 = (time * 0.5 + k / 6) % 1;
        g.globalAlpha = 1 - t2;
        drawHeart(g, Math.round(98 + Math.sin(k * 2 + time) * 30 * t2), Math.round(36 - t2 * 34), '#ff5d8f', PAL.ink);
        g.globalAlpha = 1;
      }
    }
  }

  function startGame() {
    if (started) return;
    started = true;
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    mini.classList.remove('hidden');
    updateCounter(); updateClocks();
    try { if (!musicStarted) startMusic(); else applySound(); } catch (e) { audioOk = false; }
    if (!gameBegun) {   // first time: start outside the new house
      gameBegun = true;
      const lm0 = LM.find((l) => l.id === 'home-new') || LM[0];
      placeAt(lm0.ex, lm0.ey);
      showEntityPrompt(lm0);
    }
    updateCamera(0, true);
    drawMinimap();
  }

  let letterTimer = null;
  const LETTER_START_DELAY = 3500;   // ms: wait for the screen to fade in before typing
  const LETTER_CHAR_MS = 85;         // ms per letter (bigger = slower typing)
  const LETTER_PARA_PAUSE = 1100;    // ms pause between paragraphs
  function showEnding() {
    endingShown = true; store.set('htae-ending-seen', true);
    playEndingSong();
    updateCounter();
    const scr = $('ending');
    scr.classList.remove('show');
    scr.classList.remove('hidden');
    void scr.offsetWidth;            // let the browser register opacity 0 before fading in
    scr.classList.add('show');
    const box = $('letter'); box.innerHTML = '';
    const paras = (Array.isArray(CFG.finalLetter) ? CFG.finalLetter : String(CFG.finalLetter || '').split(/\n\s*\n/)).map(String);
    const ps = paras.map(() => { const p = document.createElement('p'); box.appendChild(p); return p; });
    let pi = 0, ci = 0;
    clearTimeout(letterTimer);
    // "Keep exploring" only works once the whole letter is on screen
    // (once she has read it all the first time, re-reading never locks the button)
    const keep = $('btn-keep');
    keep.disabled = !store.get('htae-letter-read');
    const done = () => { keep.disabled = false; store.set('htae-letter-read', true); };
    const finish = () => { clearTimeout(letterTimer); paras.forEach((t, k) => (ps[k].textContent = t)); pi = paras.length; done(); };
    box.onclick = finish;
    if (REDUCED) { finish(); return; }
    const tick = () => {
      if (pi >= paras.length) { done(); return; }
      ci++;
      ps[pi].textContent = paras[pi].slice(0, ci);
      box.scrollTop = box.scrollHeight;
      if (ci >= paras[pi].length) { pi++; ci = 0; if (pi >= paras.length) { done(); return; } letterTimer = setTimeout(tick, LETTER_PARA_PAUSE); }
      else letterTimer = setTimeout(tick, LETTER_CHAR_MS);
    };
    letterTimer = setTimeout(tick, LETTER_START_DELAY);
  }
  // Keep exploring: the ending song plays on to its end, then the shuffle carries on
  function hideEnding() {
    if ($('btn-keep').disabled) return;   // the letter hasn't finished yet
    clearTimeout(letterTimer); $('ending').classList.remove('show'); $('ending').classList.add('hidden'); letEndingSongFinish();
    if (started) { popHeart(); flashHover('Now you lead the way, ' + (CFG.herName || '') + '. I\'ll follow you!'); }
  }

  /* -------------------------------------------------------------------
     How to play: a little animated picture book (pages live in config.js)
     ------------------------------------------------------------------- */
  const DEFAULT_HOWTO = [
    { art: 'mission', title: 'Your mission', text: 'Collect the love at all {total} places to understand my London.' },
    { art: 'walk', title: 'Walk with me', text: 'Arrow keys / WASD, or click where you want to go.' },
    { art: 'letter', title: 'The last surprise', text: 'Find them all to open a letter.' }
  ];
  const howto = { page: 0, typed: 0, timer: null, t0: 0 };
  const howtoPages = () => (CFG.instructions && CFG.instructions.length ? CFG.instructions : DEFAULT_HOWTO);
  const fillText = (t) => String(t || '').replace(/\{total\}/g, LM.length).replace(/\{her\}/g, CFG.herName || 'you').replace(/\{me\}/g, CFG.myName || 'me');

  function openHowto() {
    hidePrompt();
    $('howto').classList.remove('hidden');
    const cv = $('howto-canvas'); cv.width = 200; cv.height = 80;
    const dots = $('howto-dots'); dots.innerHTML = '';
    howtoPages().forEach((_, k) => { const d = document.createElement('i'); d.onclick = () => howtoGo(k); dots.appendChild(d); });
    howtoGo(0);
  }
  function closeHowto() { clearInterval(howto.timer); $('howto').classList.add('hidden'); }
  function howtoNext() {
    const pages = howtoPages(), pg = fillText(pages[howto.page].text);
    if (howto.typed < pg.length) { howto.typed = pg.length; $('howto-text').textContent = pg; return; }   // finish typing first
    sfx('blip');
    if (howto.page < pages.length - 1) howtoGo(howto.page + 1);
    else { closeHowto(); if (!started && !$('btn-start').disabled) startGame(); }
  }
  function howtoGo(k) {
    const pages = howtoPages();
    if (k < 0 || k >= pages.length) return;
    howto.page = k; howto.t0 = time;
    const pg = pages[k], text = fillText(pg.text);
    $('howto-step').textContent = 'PAGE ' + (k + 1) + ' OF ' + pages.length;
    $('howto-title').textContent = fillText(pg.title);
    Array.from($('howto-dots').children).forEach((d, j) => d.classList.toggle('on', j === k));
    $('howto-back').disabled = k === 0;
    $('howto-next').textContent = k === pages.length - 1 ? (started ? 'BACK TO LONDON' : "LET'S GO!") : 'NEXT >';
    clearInterval(howto.timer);
    howto.typed = REDUCED ? text.length : 0;
    $('howto-text').textContent = text.slice(0, howto.typed);
    if (!REDUCED) howto.timer = setInterval(() => {
      howto.typed++;
      $('howto-text').textContent = text.slice(0, howto.typed);
      if (howto.typed >= text.length) clearInterval(howto.timer);
    }, 22);
  }

  // One small animated scene per page
  function drawHowtoArt() {
    const cv = $('howto-canvas'), g = cv.getContext('2d');
    if (!charMe) return;
    const Wc = 200, Hc = 80, t = time - howto.t0, slow = REDUCED ? 0 : 1;
    const art = (howtoPages()[howto.page] || {}).art || 'mission';
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#f3dcb6'; g.fillRect(0, 0, Wc, Hc);
    g.fillStyle = '#e8c99a'; g.fillRect(0, 62, Wc, 18);
    g.fillStyle = '#d4ad7c'; g.fillRect(0, 62, Wc, 2);
    const bob = (k) => Math.round(Math.sin(time * 3 + k) * 1.5 * slow);
    const house = (x, w, h, roof) => { g.fillStyle = PAL.ink; g.fillRect(x - 1, 61 - h, w + 2, h + 1); g.fillStyle = '#efe2c8'; g.fillRect(x, 62 - h, w, h - 1); g.fillStyle = roof; g.fillRect(x, 62 - h, w, 5); g.fillStyle = PAL.glass; g.fillRect(x + 3, 62 - h + 8, 3, 3); g.fillRect(x + w - 6, 62 - h + 8, 3, 3); };

    if (art === 'mission') {
      // places with bubbles; hearts fly up into a big pulsing heart counter
      const spots = [[18, 'home', '#c4553e'], [52, 'campus', '#6b7d8f'], [140, 'restaurant', '#8f5b3e'], [172, 'cinema', '#a8434c']];
      spots.forEach(([x, type, roof], k) => { house(x, 20, 24 + (k % 2) * 6, roof); drawBubble(g, type, x + 3, 18 - (k % 2) * 6 + bob(k), k === 1 ? '#ff8fb0' : PAL_TAG.gold); });
      for (let k = 0; k < 4; k++) {
        const ph = ((t * 0.45 * slow) + k / 4) % 1;
        const sx = spots[k][0] + 9, sy = 20;
        drawHeart(g, Math.round(lerp(sx, 97, ph)), Math.round(lerp(sy, 30, ph) - Math.sin(ph * Math.PI) * 14), '#ff5d8f', '#ffffff');
      }
      const s = 1 + Math.round((Math.sin(time * 4) + 1) * 0.5 * slow);
      for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 7; xx++) if (HEART[yy][xx] === 'x') { g.fillStyle = PAL.ink; g.fillRect(100 - 7 * (s + 1) / 2 + xx * (s + 1) - 1, 22 + yy * (s + 1) - 1, s + 3, s + 3); }
      for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 7; xx++) if (HEART[yy][xx] === 'x') { g.fillStyle = '#ff5d8f'; g.fillRect(100 - 7 * (s + 1) / 2 + xx * (s + 1), 22 + yy * (s + 1), s + 1, s + 1); }
      drawTinyCentered(g, '0 OF ' + LM.length, 100, 46, '#5a3a22');
      g.drawImage(charMe.right[0], 80, 46); g.drawImage(charHer.left[0], 104, 46);
    } else if (art === 'walk') {
      // the two of us walking across, plus key caps
      const x = ((t * 30 * slow) % 240) - 30;
      const f = Math.floor(time * 6) % 2 ? 1 : 2;
      g.drawImage(charHer.right[slow ? f : 0], Math.round(x - 16), 46);
      g.drawImage(charMe.right[slow ? (f === 1 ? 2 : 1) : 0], Math.round(x), 46);
      const key = (kx, ky, label, on) => { g.fillStyle = PAL.ink; g.fillRect(kx - 1, ky - 1, 15, 14); g.fillStyle = on ? '#ffd166' : '#fff8ea'; g.fillRect(kx, ky, 13, 12); g.fillStyle = '#d9c6a3'; g.fillRect(kx, ky + 10, 13, 2); drawTinyCentered(g, label, kx + 6.5, ky + 3, PAL.ink); };
      const pulse = Math.floor(time * 2) % 2 === 0;
      key(36, 8, 'W', false); key(21, 23, 'A', false); key(36, 23, 'S', false); key(51, 23, 'D', pulse);
      key(146, 8, '^', false); key(131, 23, '<', false); key(146, 23, 'V', false); key(161, 23, '>', pulse);
      drawTinyCentered(g, 'OR', 100, 20, '#a5703f');
      drawTinyCentered(g, 'TAP TO GO', 100, 28, '#a5703f');
    } else if (art === 'places') {
      const items = [[40, 'campus', PAL_TAG.gold, 'NEW'], [100, 'home', PAL_TAG.teal, 'LAST YEAR'], [160, 'restaurant', '#ff8fb0', 'FOUND']];
      items.forEach(([x, type, fill, label], k) => {
        const y = 22 + bob(k);
        // draw the bubble at 2x so it's easy to read
        const tmp = document.createElement('canvas'); tmp.width = 13; tmp.height = 13;
        drawBubble(tmp.getContext('2d'), type, 0, 0, fill);
        g.drawImage(tmp, x - 13, y - 13, 26, 26);
        if (k === 2) drawHeart(g, x + 8, y - 17, '#ff3d7a', '#ffffff');
        drawTinyCentered(g, label, x, 50, '#5a3a22');
      });
      drawTinyCentered(g, 'SPACE OR TAP TO READ', 100, 68, '#7a5232');
    } else if (art === 'travel') {
      // a tube train in a tunnel and the 29 on the road
      g.fillStyle = '#4a3a52'; g.fillRect(0, 6, Wc, 26);
      g.fillStyle = '#5c4a66'; g.fillRect(0, 6, Wc, 2); g.fillRect(0, 30, Wc, 2);
      const tx = Math.round(((t * 60 * slow) % 320) - 120);
      for (let c = 0; c < 3; c++) {
        const x = tx + c * 34;
        g.fillStyle = PAL.ink; g.fillRect(x - 1, 11, 33, 17);
        g.fillStyle = '#e9e5dc'; g.fillRect(x, 12, 31, 15);
        g.fillStyle = '#1c3f94'; g.fillRect(x, 22, 31, 3);
        g.fillStyle = PAL.glass; g.fillRect(x + 3, 14, 6, 5); g.fillRect(x + 12, 14, 6, 5); g.fillRect(x + 21, 14, 6, 5);
      }
      g.fillStyle = '#5a5c66'; g.fillRect(0, 50, Wc, 12);
      for (let x = 0; x < Wc; x += 12) { g.fillStyle = '#d9d4c4'; g.fillRect(x + 2, 55, 6, 1); }
      const bx = Math.round(Wc - ((t * 25 * slow) % 260));
      g.save(); g.translate(bx, 56); g.scale(-1, 1); g.drawImage(VEH.bus29, -12, -5); g.restore();
      drawTinyCentered(g, 'TUBE', 18, 36, '#5a3a22'); drawTinyCentered(g, 'BUS 29', 22, 66, '#5a3a22');
      drawTinyCentered(g, 'WALK', 178, 66, '#5a3a22');
      g.drawImage(charMe.down[0], 160, 34); g.drawImage(charHer.down[0], 176, 34);
    } else if (art === 'map') {
      if (miniBase) { g.fillStyle = PAL.ink; g.fillRect(19, 5, 72, 60); g.drawImage(miniBase, 20, 6, 70, 58); }
      if (Math.floor(time * 3) % 2 === 0) { g.fillStyle = '#e8364f'; g.fillRect(20 + Math.round(me.x / W * 70) - 1 || 52, 6 + Math.round(me.y / H * 58) - 1 || 30, 3, 3); }
      const key = (kx, ky, label) => { g.fillStyle = PAL.ink; g.fillRect(kx - 1, ky - 1, 15, 14); g.fillStyle = '#ffd166'; g.fillRect(kx, ky, 13, 12); drawTinyCentered(g, label, kx + 6.5, ky + 3, PAL.ink); };
      key(104, 10, 'M'); drawTiny(g, 'FULL MAP', 122, 13, '#5a3a22');
      drawTiny(g, 'LONDON', 104, 34, '#5a3a22'); drawTiny(g, 'KL', 160, 34, '#5a3a22');
      const now = new Date();
      drawTiny(g, fmtLon.format(now), 104, 42, '#a5703f'); drawTiny(g, fmtKL.format(now), 160, 42, '#a5703f');
      // a tiny window that lights up and dims, day and night
      const lit = Math.sin(time * 1.5) > 0;
      g.fillStyle = lit ? '#2a2f55' : '#9fd0ff'; g.fillRect(104, 50, 70, 10);
      g.fillStyle = lit ? '#ffd66b' : PAL.glass; for (let k = 0; k < 6; k++) g.fillRect(107 + k * 11, 53, 5, 4);
    } else {
      // the letter with a heart seal
      const s = Math.sin(time * 2) * slow;
      g.fillStyle = PAL.ink; g.fillRect(69, 13, 62, 42);
      g.fillStyle = '#fff8ea'; g.fillRect(70, 14, 60, 40);
      g.fillStyle = '#e8d6b4';
      for (let k = 0; k < 20; k++) { g.fillRect(70 + k * 1.5, 14 + k, 3, 1); g.fillRect(127 - k * 1.5, 14 + k, 3, 1); }
      drawHeart(g, 97, 30 + Math.round(s), '#e8365f', PAL.ink);
      for (let k = 0; k < 5; k++) {
        const ph = ((time * 0.35 * slow) + k / 5) % 1;
        g.globalAlpha = 1 - ph;
        drawHeart(g, Math.round(100 + Math.sin(k * 2.3 + time) * 40 * ph) - 3, Math.round(30 - ph * 28), '#ff8fb0', '#ffffff');
        g.globalAlpha = 1;
      }
      g.drawImage(charMe.right[0], 52, 46); g.drawImage(charHer.left[0], 132, 46);
    }
  }

  /* -------------------------------------------------------------------
     Wardrobe screen (title screen > OUTFITS)
     ------------------------------------------------------------------- */
  const wdCards = () => Array.from(document.querySelectorAll('.wardrobe-card'));
  function openWardrobe() {
    $('wardrobe').classList.remove('hidden');
    wdCards().forEach((card) => {
      const who = card.dataset.who;
      card.querySelector('.wd-name').textContent = (who === 'me' ? CFG.myName : CFG.herName) || who;
      const cv = card.querySelector('.wd-preview'); cv.width = 96; cv.height = 44;
    });
    refreshWardrobe();
  }
  function closeWardrobe() { $('wardrobe').classList.add('hidden'); applyOutfits(); }
  function refreshWardrobe() {
    wdCards().forEach((card) => {
      const who = card.dataset.who;
      card.querySelector('.wd-outfit').textContent = outfitList(who)[wardrobe[who].o].name || 'Outfit';
      const a = wardrobe[who].a;
      card.querySelector('.wd-acc').textContent = a === 'none' ? 'Nothing' : a.replace(/\b\w/g, (m) => m.toUpperCase());
      card.querySelector('.wd-charm').textContent = wardrobe[who].charm ? 'Monchhichi' : 'None';
    });
  }
  function changeWardrobe(who, k, d) {
    const w = wardrobe[who];
    if (k === 'charm') {
      w.charm = !w.charm;
    } else if (k === 'outfit') {
      const list = outfitList(who);
      w.o = (w.o + d + list.length) % list.length;
      w.a = list[w.o].acc || 'none';   // each outfit comes with its matching accessory
    } else {
      const list = ACC_LIST[who];
      w.a = list[(list.indexOf(w.a) + d + list.length) % list.length];
    }
    applyOutfits(); refreshWardrobe(); sfx('blip');
  }
  function drawWardrobe() {
    wdCards().forEach((card) => {
      const who = card.dataset.who, frames = who === 'me' ? charMe : charHer;
      const cv = card.querySelector('.wd-preview'), g = cv.getContext('2d');
      if (!frames) return;
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#f3dcb6'; g.fillRect(0, 0, 96, 44);
      g.fillStyle = '#e8c99a'; g.fillRect(0, 36, 96, 8);
      g.fillStyle = '#d4ad7c'; g.fillRect(0, 36, 96, 1);
      const f = REDUCED ? 0 : (Math.floor(time * 5) % 2 ? 1 : 2);
      const turn = ['down', 'left', 'up', 'right'][Math.floor(time / 1.5) % 4];
      const poses = [['down', 0], [turn, f], ['up', 0]];
      poses.forEach(([dir, fr], k) => {
        const x = 4 + k * 30, y = 4;
        g.fillStyle = 'rgba(90,58,34,0.25)'; g.fillRect(x + 8, y + 31, 16, 3);
        g.drawImage(frames[dir][fr], x, y, 32, 32);
      });
    });
  }

  /* ===================================================================
     SECTION: 14. Input
     =================================================================== */
  const isOpen = (id) => !$(id).classList.contains('hidden');
  function blocking() { return !started || !!dialog || !!train || !!ride || isOpen('menu') || isOpen('bigmap') || isOpen('ending') || isOpen('howto') || isOpen('settings'); }
  function blockingExcept(which) {
    if (!started || dialog || train || ride || isOpen('menu') || isOpen('ending') || isOpen('howto') || isOpen('settings')) return true;
    return which !== 'bigmap' && isOpen('bigmap');
  }

  const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };

  function interact() {
    if (me.moving) return;
    const i = I(me.x, me.y);
    const e = entEntr[i];
    if (e) {
      const ent = ENT[e - 1];
      if (ent.kind === 'landmark') { openDialog(ent); return; }
      if (ent.kind === 'station') { openTubeMenu(ent.stn); return; }
    }
    if (stopAt[i]) { openBusMenu(i); return; }
    const [dx, dy] = DIRS[me.dir];
    const f = inb(me.x + dx, me.y + dy) ? entAt[I(me.x + dx, me.y + dy)] : 0;
    if (f) {
      const ent = ENT[f - 1];
      if (ent.kind === 'landmark') openDialog(ent);
      else if (ent.kind === 'station') openTubeMenu(ent.stn);
      else flashHover(ent.name);
    }
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (isOpen('settings')) { if (k === 'Escape' || k === 'Enter') closeSettings(); return; }
    if (isOpen('wardrobe')) { if (k === 'Escape' || k === 'Enter') closeWardrobe(); return; }
    if (isOpen('howto')) {
      if (k === 'ArrowRight' || k === 'd' || k === 'Enter' || k === ' ') { e.preventDefault(); howtoNext(); }
      else if (k === 'ArrowLeft' || k === 'a') { e.preventDefault(); howtoGo(howto.page - 1); }
      else if (k === 'Escape') closeHowto();
      return;
    }
    if (!started) { if ((k === 'Enter' || k === ' ') && !$('btn-start').disabled) { e.preventDefault(); startGame(); } return; }
    if (isOpen('ending')) { if (k === 'Escape') hideEnding(); return; }
    if (train || ride) return;
    if (isOpen('menu')) {
      if (k === 'Escape') closeMenu();
      else if (k === 'ArrowDown' || k === 's') moveMenu(1);
      else if (k === 'ArrowUp' || k === 'w') moveMenu(-1);
      else if (k === 'Enter' || k === ' ') { const b = $('menu-list').children[menuSel]; if (b && !b.disabled) b.click(); }
      e.preventDefault();
      return;
    }
    if (isOpen('bigmap')) { if (k === 'm' || k === 'M' || k === 'Escape') closeBigMap(); return; }
    if (dialog) {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); advanceDialog(); }
      else if (k === 'Escape') closeDialog();
      else if ((k === 't' || k === 'T') && dialog.lm.stn) openTubeMenu(dialog.lm.stn);
      return;
    }
    if (KEYMAP[k]) {
      e.preventDefault();
      const d = KEYMAP[k];
      path = []; journey = null;
      const idx = held.indexOf(d); if (idx >= 0) held.splice(idx, 1);
      held.push(d);
      return;
    }
    if (k === ' ' || k === 'Enter') { e.preventDefault(); interact(); }
    else if (k === 'm' || k === 'M') openBigMap();
    else if (k === 't' || k === 'T') openTubeMenu();
    else if (k === 'n' || k === 'N') { nightForced = nightF > 0.5 ? 'day' : 'night'; updateNight(); }
  });
  window.addEventListener('keyup', (e) => {
    const d = KEYMAP[e.key]; if (!d) return;
    const idx = held.indexOf(d); if (idx >= 0) held.splice(idx, 1);
  });
  window.addEventListener('blur', () => { held.length = 0; });

  // Which building (entity) is under a world pixel — the one in front wins
  function entityAtPx(wx, wy) {
    let best = null;
    for (let k = ENT.length - 1; k >= 0; k--) {
      const e = ENT[k];
      if (e.skip) continue;
      const top = entTop(e) - (e.kind === 'landmark' ? 18 : 0);
      if (wx >= e.fx * TILE && wx < (e.fx + e.w) * TILE && wy >= top && wy < (e.ey + 1) * TILE) {
        if (!best || e.ey > best.ey) best = e;
      }
    }
    return best;
  }
  function eventToWorld(ev) {
    const rc = canvas.getBoundingClientRect();
    return { x: (ev.clientX - rc.left) / view.scale + Math.round(cam.x), y: (ev.clientY - rc.top) / view.scale + Math.round(cam.y) };
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!started) return;
    if (dialog) { advanceDialog(); return; }
    if (blocking()) return;
    const w = eventToWorld(ev);
    const e = entityAtPx(w.x, w.y);
    held.length = 0;
    if (e) {
      if (!me.moving && me.x === e.ex && me.y === e.ey) { interact(); return; }
      goTo(e); return;
    }
    const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
    if (inb(tx, ty) && stopAt[I(tx, ty)] && !me.moving && me.x === tx && me.y === ty) { openBusMenu(I(tx, ty)); return; }
    if (isWalk(tx, ty)) runJourney([{ t: 'walk', x: tx, y: ty }], null);
    else flashHover("Can't walk there");
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!started || ev.pointerType === 'touch') return;
    const w = eventToWorld(ev);
    hoverEnt = entityAtPx(w.x, w.y);
    hoverText = '';
    if (hoverEnt) {
      hoverText = hoverEnt.name;
      if (hoverEnt.stn) hoverText += ' · ' + hoverEnt.stn.lines.join(', ');
      if (hoverEnt.kind === 'landmark' && visited.has(hoverEnt.id)) hoverText += ' ✓';
    } else {
      const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
      if (inb(tx, ty) && stopAt[I(tx, ty)]) hoverText = 'Bus stop: ' + stopNameAt(I(tx, ty)) + ' (' + busNumsAt(I(tx, ty)).join(', ') + ')';
      else if (inb(tx, ty) && abbey[I(tx, ty)]) hoverText = 'Abbey Road crossing';
    }
    canvas.classList.toggle('pointer', !!hoverText);
  });
  canvas.addEventListener('pointerleave', () => { hoverEnt = null; hoverText = ''; });

  let hoverFlash = null;
  function flashHover(text) { hoverFlash = { text, until: performance.now() + 2200 }; }

  $('dialog').addEventListener('click', (e) => { if (e.target.id === 'dlg-tube') return; advanceDialog(); });
  $('dlg-tube').addEventListener('click', (e) => { e.stopPropagation(); if (dialog && dialog.lm.stn) openTubeMenu(dialog.lm.stn); });
  $('menu-cancel').addEventListener('click', closeMenu);
  $('menu').addEventListener('click', (e) => { if (e.target.id === 'menu') closeMenu(); });
  $('btn-map').addEventListener('click', () => (isOpen('bigmap') ? closeBigMap() : openBigMap()));
  mini.addEventListener('click', openBigMap);
  $('bigmap-close').addEventListener('click', closeBigMap);
  $('bigmap').addEventListener('click', (e) => { if (e.target.id === 'bigmap') closeBigMap(); });
  bigCanvas.addEventListener('pointermove', (ev) => {
    bigHover = bigMapPick(ev);
    $('bigmap-label').textContent = bigHover ? bigHover.name + (bigHover.kind === 'landmark' && visited.has(bigHover.id) ? '  (visited)' : '') : 'Click a place (or a tube station) to go there';
  });
  bigCanvas.addEventListener('click', (ev) => {
    const e = bigMapPick(ev);
    if (!e) return;
    closeBigMap();
    goTo(e);
  });
  // ---- Settings panel ----
  function openSettings() {
    $('settings').classList.remove('hidden');
    $('set-menu').classList.toggle('hidden', !started);
    syncSettingsUI(); updateNowPlaying();
    sfx('open');
  }
  function closeSettings() { $('settings').classList.add('hidden'); saveSettings(); sfx('close'); }
  function syncSettingsUI() {
    $('zoom-val').textContent = ZOOMS[settings.zoom].name;
    $('zoom-out').disabled = settings.zoom === 0;
    $('zoom-in').disabled = settings.zoom === ZOOMS.length - 1;
    [['music', 'musicVol'], ['sfx', 'sfxVol']].forEach(([k, v]) => {
      const t = $(k + '-toggle');
      t.textContent = settings[k] ? 'ON' : 'OFF';
      t.classList.toggle('off', !settings[k]);
      $(k + '-vol').value = settings[v];
      $(k + '-vol').disabled = !settings[k];
      $(k + '-vol-val').textContent = settings[v];
    });
  }
  const zoomBy = (d) => { settings.zoom = clamp(settings.zoom + d, 0, ZOOMS.length - 1); saveSettings(); resize(); if (started) updateCamera(0, true); syncSettingsUI(); sfx('blip'); };
  $('zoom-in').addEventListener('click', () => zoomBy(1));
  $('zoom-out').addEventListener('click', () => zoomBy(-1));
  $('music-toggle').addEventListener('click', () => { settings.music = !settings.music; applySound(); saveSettings(); syncSettingsUI(); sfx('blip'); });
  $('sfx-toggle').addEventListener('click', () => { settings.sfx = !settings.sfx; saveSettings(); syncSettingsUI(); sfx('blip'); });
  $('music-vol').addEventListener('input', (e) => { settings.musicVol = +e.target.value; applySound(); syncSettingsUI(); });
  $('sfx-vol').addEventListener('input', (e) => { settings.sfxVol = +e.target.value; syncSettingsUI(); });
  $('sfx-vol').addEventListener('change', () => { saveSettings(); sfx('blip'); });
  $('music-vol').addEventListener('change', saveSettings);
  $('track-prev').addEventListener('click', () => { prevSong(); sfx('blip'); });
  $('track-next').addEventListener('click', () => { nextSong(); sfx('blip'); });
  $('set-help').addEventListener('click', () => { closeSettings(); openHowto(); });
  $('set-close').addEventListener('click', closeSettings);
  $('set-menu').addEventListener('click', () => { saveSettings(); sfx('close'); goToMainMenu(); });
  $('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
  $('btn-settings').addEventListener('click', () => { if (!blocking()) openSettings(); });
  $('btn-settings-title').addEventListener('click', openSettings);
  $('btn-letter').addEventListener('click', showEnding);
  $('btn-keep').addEventListener('click', hideEnding);
  $('btn-start').addEventListener('click', startGame);
  $('btn-howto').addEventListener('click', () => openHowto());
  $('btn-wardrobe').addEventListener('click', openWardrobe);
  $('wd-done').addEventListener('click', closeWardrobe);
  $('wd-random').addEventListener('click', () => {
    ['me', 'her'].forEach((who) => {
      const list = outfitList(who);
      wardrobe[who].o = Math.floor(Math.random() * list.length);
      wardrobe[who].a = Math.random() < 0.5 ? (list[wardrobe[who].o].acc || 'none') : pick(ACC_LIST[who], Math.random());
    });
    applyOutfits(); refreshWardrobe();
  });
  document.querySelectorAll('.wd-prev, .wd-next').forEach((b) => b.addEventListener('click', () => {
    changeWardrobe(b.closest('.wardrobe-card').dataset.who, b.dataset.k, b.classList.contains('wd-next') ? 1 : -1);
  }));
  $('howto-next').addEventListener('click', howtoNext);
  $('howto-back').addEventListener('click', () => howtoGo(howto.page - 1));
  $('howto-skip').addEventListener('click', closeHowto);
  $('btn-reset').addEventListener('click', () => {
    visited.clear(); saveVisited(); endingShown = false; store.set('htae-ending-seen', false);
    store.set('htae-letter-read', false);
    $('btn-reset').classList.add('hidden');
  });
  window.addEventListener('resize', () => { resize(); if (isOpen('bigmap')) openBigMap(); });

  /* ===================================================================
     SECTION: 15. Boot
     =================================================================== */
  let last = performance.now();
  let miniTimer = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; time += dt;

    if (!started) drawScene($('title-canvas'), 'title');
    if (isOpen('ending')) drawScene($('ending-canvas'), 'ending');
    if (isOpen('howto')) drawHowtoArt();
    if (isOpen('wardrobe')) drawWardrobe();

    if (started) {
      updateMovement(dt);
      updateTraffic(dt);
      updateRide(dt);
      updateCamera(dt);
      hearts.forEach((h) => (h.t += dt));
      hearts = hearts.filter((h) => h.t < h.life);
      draw();
      miniTimer += dt;
      if (miniTimer > 0.1) { miniTimer = 0; drawMinimap(); }
      if (isOpen('bigmap')) drawBigMap();
      if (train) drawTrain(dt);
      let hv = '';
      if (hoverFlash && now < hoverFlash.until) hv = hoverFlash.text;
      else hv = hoverText;
      if ($('hud-hover').textContent !== hv) $('hud-hover').textContent = hv;
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    resize();
    generateMap();
    placeEntities();
    ensureReachable();
    makeBuildings();
    buildTubeGraph();
    buildBusRoutes();
    paintWorld();
    paintBusStops();
    buildMiniBase();
    buildGeoCache();
    PLACED().forEach(buildEntitySprite);
    buildVehicles();
    initTraffic();
    applyOutfits();
    updateNight();
    setInterval(updateNight, 30000);
    setInterval(() => { if (started) updateClocks(); }, 1000);
    setupTitle();
    const btn = $('btn-start');
    btn.disabled = false; btn.textContent = visited.size ? 'CONTINUE' : 'START';
    // a few things exposed for debugging in the browser console
    window.HTAE = {
      LM, ENT, STATIONS, STOPS, ROUTE, project, unproject, tiles, T, me, her, visited, cam, astar, tubeRoute, planTrip, goTo,
      startGame, advanceDialog, closeDialog, openBigMap, showEnding, runJourney,
      state: () => ({ started, dialog: dialog && dialog.lm.id, train: !!train, ride: ride && ride.phase, journey: !!journey, path: path.length, x: me.x, y: me.y, hx: her.x, hy: her.y, menu: isOpen('menu') && $('menu-title').textContent }),
      menuItems: () => menuItems.map((m) => m.label + ' | ' + (m.sub || '')), pickMenu: (k) => { const b = $('menu-list').children[k]; if (b) b.click(); }
    };
    requestAnimationFrame(frame);
    startMusic();   // the opening song plays right away (or on the first click if the browser blocks it)
    if (HASH.indexOf('play') >= 0) startGame();
    if (HASH.indexOf('map') >= 0) setTimeout(openBigMap, 50);
  }

  const fontReady = (document.fonts && document.fonts.load)
    ? Promise.race([document.fonts.load('16px "PixelFont"'), new Promise((r) => setTimeout(r, 2000))]).catch(() => {})
    : Promise.resolve();
  fontReady.then(() => setTimeout(boot, 0));
})();
