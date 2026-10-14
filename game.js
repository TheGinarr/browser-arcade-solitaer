/* ============================================================
   SOLITÄR (Klondike) · game.js
   ------------------------------------------------------------
   So funktioniert dieses Spiel
   1. Datenmodell: Jede der 52 Karten ist nur eine Zahl (id 0–51):
      Farbe = Math.floor(id / 13) (0 Pik, 1 Herz, 2 Karo, 3 Kreuz),
      Rang  = id % 13 + 1 (1 = Ass … 13 = König). Der Spielzustand `z`
      besteht aus Listen solcher Zahlen:
        spalten[7]     die Tableau-Spalten (unterste Karte zuerst)
        verdeckt[7]    wie viele Karten am ANFANG jeder Spalte noch
                       verdeckt sind (verdeckte liegen immer unten)
        fundamente[4]  die vier Ablagestapel (Ass → König, eine Farbe)
        talon          der Nachziehstapel (letzte Karte = oberste)
        ablage         die aufgedeckten Talon-Karten (letzte = oberste)
   2. Reine Regel-Logik (Anlegen, Ziehen, Zug anwenden/umkehren,
      Auto-Abschluss-Plan, Spielstand prüfen) steckt in Funktionen ohne
      DOM und ohne Speicher. Man kann sie in Node testen.
   3. LERNKERN 1 · Pointer Events: Drag & Drop für Maus UND Touch mit
      EINEM Codepfad (pointerdown / pointermove / pointerup +
      setPointerCapture). Dazu die Klick-Bedienung (wählen, Ziel
      antippen, Doppelklick = Ablage).
   4. LERNKERN 2 · Zug-Verlauf mit Umkehrfunktion: Jeder Zug ist ein
      kleines Objekt. `zugAnwenden` führt ihn aus, `zugUmkehren` macht
      ihn exakt rückgängig. Alle Züge liegen auf einem Stapel
      (`verlauf`): Rückgängig = letzten Zug holen und umkehren.
   5. Rendering: 52 absolut positionierte <div>-Karten, die Position
      steckt in CSS-Variablen (--x, --y). Ändert sich eine Variable,
      gleitet die Karte dank CSS-Transition von selbst an die neue Stelle.
   6. Speicher: Spielstand (inkl. kompletten Zugverlauf, Zeit, Modus)
      nach jedem Zug; Topliste pro Modus ("solitaer-1", "solitaer-3").
   Hinweis: Nicht jedes Klondike-Blatt ist lösbar. Das ist bei diesem
   Spiel normal; das Spiel garantiert keine Lösbarkeit.
   ============================================================ */

import { lade, speichere, entferne, spielZuruecksetzen, topliste } from "./assets/storage.js";
import { bewegungReduziert, toplisteAnzeigen, gameOverDialog } from "./assets/ui.js";

/* ------------------------------------------------------------
   Konstanten
   ------------------------------------------------------------ */

const SPIEL = "solitaer"; // Speicherbereich für Spielstand + Einstellungen
const MODI = [1, 3]; // erlaubte Zieh-Modi (Karten pro Ziehen)
const MAX_SEKUNDEN = 5999; // 99:59 – mehr kann "mm:ss" nicht zeigen
const DOPPELTIPP_MS = 380; // max. Abstand zweier Tipps für "Doppelklick"
const ZIEH_SCHWELLE_PX = 6; // ab so vielen Pixeln Bewegung wird aus Tippen ein Ziehen
const UNTERWEGS_MS = 380; // so lange liegt eine gleitende Karte über den anderen
const KASKADE_ABSTAND_MS = 70; // Sieg: alle 70 ms startet die nächste Karte

const toplisteKey = (modus) => `${SPIEL}-${modus}`;

/* Layout in "Kartenbreiten" (kw). Eine Karte ist 1 kw breit und 1,4 kw hoch.
   CSS rechnet daraus Pixel (--kw ist Kartenbreite in px), siehe spiel.css. */
export const SPALTEN_ABSTAND = 1.1; // Abstand von Spaltenmitte zu Spaltenmitte
export const BREITE = 6 * SPALTEN_ABSTAND + 1; // Gesamtbreite des Tischs
export const KARTE_H = 1.4; // Kartenhöhe
export const ZEILE2_Y = 1.6; // Oberkante der Tableau-Spalten
export const STUFE_ZU = 0.13; // vertikaler Versatz verdeckter Karten
export const STUFE_OFFEN = 0.34; // vertikaler Versatz offener Karten
export const FAECHER_X = 0.3; // Versatz der aufgefächerten Ablage-Karten
const MIN_HOEHE = 5.2; // Mindesthöhe des Tischs (wächst bei langen Spalten)

const FARBEN = ["♠", "♥", "♦", "♣"];
const FARBNAMEN = ["Pik", "Herz", "Karo", "Kreuz"];
const RANGTEXT = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RANGNAMEN = ["Ass", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Bube", "Dame", "König"];

/* ============================================================
   TEIL 1 · Reine Regel-Logik (kein DOM, kein Speicher)
   ============================================================ */

/** Farbe einer Karte: 0 Pik, 1 Herz, 2 Karo, 3 Kreuz. */
export const farbeVon = (id) => Math.floor(id / 13);
/** Rang einer Karte: 1 (Ass) bis 13 (König). */
export const rangVon = (id) => (id % 13) + 1;
/** Herz und Karo sind rot, Pik und Kreuz schwarz. */
export const istRot = (id) => {
  const f = farbeVon(id);
  return f === 1 || f === 2;
};
/** Lesbarer Name für Bildschirmleser, z. B. "Herz 7". */
export const kartenName = (id) => `${FARBNAMEN[farbeVon(id)]} ${RANGNAMEN[rangVon(id) - 1]}`;

/** Sekunden als "mm:ss". */
export function zeitText(sekunden) {
  const s = Math.max(0, Math.floor(sekunden));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Mischt ein Deck mit Fisher-Yates: Von hinten nach vorn wird jede Position
 * mit einer zufälligen früheren (oder derselben) getauscht. Das ergibt jede
 * Reihenfolge mit gleicher Wahrscheinlichkeit. `zufall` ist austauschbar,
 * damit Tests ein festes Blatt erzeugen können.
 */
export function neuesBlatt(modus, zufall = Math.random) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // Spalte s bekommt s+1 Karten; davon sind s verdeckt, die oberste liegt offen.
  const spalten = [];
  let pos = 0;
  for (let s = 0; s < 7; s++) {
    spalten.push(deck.slice(pos, pos + s + 1));
    pos += s + 1;
  }
  return {
    modus,
    spalten,
    verdeckt: [0, 1, 2, 3, 4, 5, 6],
    fundamente: [[], [], [], []],
    talon: deck.slice(pos), // die restlichen 24 Karten
    ablage: [],
  };
}

/** Tiefe Kopie eines Zustands (für Simulationen und Tests). */
export function klon(z) {
  return {
    modus: z.modus,
    spalten: z.spalten.map((s) => s.slice()),
    verdeckt: z.verdeckt.slice(),
    fundamente: z.fundamente.map((s) => s.slice()),
    talon: z.talon.slice(),
    ablage: z.ablage.slice(),
  };
}

/**
 * Ein "Ort" beschreibt einen Stapel: { art: "spalte"|"fundament"|"ablage", i }.
 * Diese Funktion liefert die zugehörige Liste (oder undefined bei Unsinn).
 */
export function stapelVon(z, ort) {
  if (ort.art === "spalte") return z.spalten[ort.i];
  if (ort.art === "fundament") return z.fundamente[ort.i];
  if (ort.art === "ablage") return z.ablage;
  return undefined;
}

/**
 * Darf Karte `id` auf diese Tableau-Spalte? Leere Spalte: nur ein König.
 * Sonst: andere Farbe (rot/schwarz) und genau ein Rang kleiner als die oberste Karte.
 */
export function passtAufSpalte(id, spalte) {
  if (spalte.length === 0) return rangVon(id) === 13;
  const oben = spalte[spalte.length - 1];
  return istRot(id) !== istRot(oben) && rangVon(id) === rangVon(oben) - 1;
}

/**
 * Darf Karte `id` auf diesen Ablagestapel? Leer: nur ein Ass.
 * Sonst: gleiche Farbe und genau ein Rang höher als die oberste Karte.
 */
export function passtAufFundament(id, fundament) {
  if (fundament.length === 0) return rangVon(id) === 1;
  const oben = fundament[fundament.length - 1];
  return farbeVon(id) === farbeVon(oben) && rangVon(id) === rangVon(oben) + 1;
}

/**
 * Ab welchem Index lässt sich Spalte `c` als Teilstapel ziehen? Ein Teilstapel
 * ist gültig, wenn alle Karten offen sind und jede auf ihre Vorgängerin
 * passt (absteigend, Farbe wechselt). Wir gehen von der obersten Karte
 * nach unten, solange die Regel hält. Leere Spalte: -1.
 */
export function ziehbarAb(z, c) {
  const sp = z.spalten[c];
  if (sp.length === 0) return -1;
  let start = sp.length - 1;
  while (start - 1 >= z.verdeckt[c] && passtAufSpalte(sp[start], [sp[start - 1]])) start--;
  return start;
}

/** Darf man die obersten `n` Karten dieses Ortes überhaupt aufnehmen? */
export function darfGezogenWerden(z, von, n) {
  if (!Number.isInteger(n) || n < 1) return false;
  if (von.art === "spalte") {
    const sp = z.spalten[von.i];
    if (!sp || sp.length === 0) return false;
    return sp.length - n >= ziehbarAb(z, von.i);
  }
  if (von.art === "ablage" || von.art === "fundament") {
    const st = stapelVon(z, von);
    return !!st && st.length > 0 && n === 1; // Ablage/Fundament: immer nur die oberste Karte
  }
  return false;
}

/**
 * Prüft einen Zug "n Karten von A nach B" und liefert das Zug-Objekt
 * oder null, wenn er regelwidrig (oder sinnlos) ist.
 * `aufgedeckt` merkt sich, ob dabei eine verdeckte Karte umgedreht wurde –
 * genau diese Information braucht die Umkehrfunktion später.
 */
export function zugErmitteln(z, von, n, nach) {
  if (!von || !nach) return null;
  if (nach.art !== "spalte" && nach.art !== "fundament") return null; // auf die Ablage legt man nichts
  if (von.art === nach.art && von.i === nach.i) return null; // auf sich selbst
  if (von.art === "fundament" && nach.art === "fundament") return null;
  if (!darfGezogenWerden(z, von, n)) return null;
  const quelle = stapelVon(z, von);
  const erste = quelle[quelle.length - n];
  if (nach.art === "fundament") {
    if (n !== 1 || !passtAufFundament(erste, z.fundamente[nach.i])) return null;
  } else {
    const ziel = z.spalten[nach.i];
    if (!ziel || !passtAufSpalte(erste, ziel)) return null;
    // Sinnlos: eine ganze, mit König beginnende Spalte in eine leere Spalte schieben.
    if (ziel.length === 0 && von.art === "spalte" && quelle.length === n) return null;
  }
  const rest = quelle.length - n;
  const aufgedeckt = von.art === "spalte" && rest > 0 && z.verdeckt[von.i] === rest;
  return {
    typ: "bewegen",
    von: { art: von.art, i: von.i },
    nach: { art: nach.art, i: nach.i },
    n,
    aufgedeckt,
  };
}

/** Alle Orte (Spalten/Fundamente), auf die dieser Teilstapel regelgerecht passt. */
export function moeglicheZiele(z, von, n) {
  const ziele = [];
  for (let c = 0; c < 7; c++)
    if (zugErmitteln(z, von, n, { art: "spalte", i: c })) ziele.push({ art: "spalte", i: c });
  for (let f = 0; f < 4; f++)
    if (zugErmitteln(z, von, n, { art: "fundament", i: f })) ziele.push({ art: "fundament", i: f });
  return ziele;
}

/** Doppelklick: der erste Ablagestapel, auf den die oberste Karte passt (sonst null). */
export function autoZiel(z, von) {
  if (von.art === "fundament") return null;
  for (let f = 0; f < 4; f++) {
    const zug = zugErmitteln(z, von, 1, { art: "fundament", i: f });
    if (zug) return zug;
  }
  return null;
}

/** Was passiert beim Klick auf den Talon? Ziehen, Durchlauf neu starten oder nichts. */
export function talonZug(z) {
  if (z.talon.length > 0) return { typ: "ziehen", n: Math.min(z.modus, z.talon.length) };
  if (z.ablage.length > 0) return { typ: "recyceln", n: z.ablage.length };
  return null;
}

/** Gewonnen, wenn alle 52 Karten auf den Ablagestapeln liegen. */
export function gewonnen(z) {
  return z.fundamente.reduce((summe, f) => summe + f.length, 0) === 52;
}

/* ------------------------------------------------------------
   LERNKERN 2 · Zug anwenden und exakt umkehren
   Es gibt drei Zugtypen:
     "ziehen"    n Karten vom Talon auf die Ablage
     "recyceln"  die ganze Ablage wird (ohne Mischen) wieder zum Talon
     "bewegen"   n Karten von einem Ort zu einem anderen
   Beide Funktionen VERÄNDERN den Zustand direkt (kein Kopieren), weil das
   schnell ist. Sie sind exakte Gegenstücke: zugUmkehren(zugAnwenden(x)) = x.
   ------------------------------------------------------------ */

export function zugAnwenden(z, zug) {
  if (zug.typ === "ziehen") {
    // pop() nimmt die oberste Talon-Karte, push() legt sie oben auf die Ablage.
    for (let k = 0; k < zug.n; k++) z.ablage.push(z.talon.pop());
  } else if (zug.typ === "recyceln") {
    // Die Ablage wird "umgedreht": oberste Ablage-Karte wandert zuerst auf den Talon,
    // also liegt am Ende die ZUERST gezogene Karte wieder obenauf. Reihenfolge bleibt erhalten.
    while (z.ablage.length) z.talon.push(z.ablage.pop());
  } else if (zug.typ === "bewegen") {
    const quelle = stapelVon(z, zug.von);
    const teil = quelle.splice(quelle.length - zug.n, zug.n); // Teilstapel herausschneiden
    if (zug.aufgedeckt) z.verdeckt[zug.von.i]--; // darunter liegende Karte aufdecken
    stapelVon(z, zug.nach).push(...teil);
  }
}

export function zugUmkehren(z, zug) {
  if (zug.typ === "ziehen") {
    if (z.ablage.length < zug.n) throw new Error("Verlauf passt nicht zum Zustand");
    for (let k = 0; k < zug.n; k++) z.talon.push(z.ablage.pop());
  } else if (zug.typ === "recyceln") {
    if (z.ablage.length !== 0 || z.talon.length < zug.n)
      throw new Error("Verlauf passt nicht zum Zustand");
    for (let k = 0; k < zug.n; k++) z.ablage.push(z.talon.pop());
  } else if (zug.typ === "bewegen") {
    const ziel = stapelVon(z, zug.nach);
    if (!ziel || ziel.length < zug.n) throw new Error("Verlauf passt nicht zum Zustand");
    const teil = ziel.splice(ziel.length - zug.n, zug.n);
    if (zug.aufgedeckt) z.verdeckt[zug.von.i]++; // Karte wieder verdecken
    stapelVon(z, zug.von).push(...teil);
  } else {
    throw new Error("Unbekannter Zugtyp");
  }
}

/* ------------------------------------------------------------
   Auto-Abschluss
   Wir SIMULIEREN auf einer Kopie, ob sich das Spiel allein durch
   "Karte auf den Ablagestapel" (und Talon weiterdrehen) beenden lässt.
   Nur wenn das klappt, liefert die Funktion den Plan (Liste von Zügen);
   dann blendet das Spiel den Knopf ein. So kann der Knopf nie ins Leere laufen.
   ------------------------------------------------------------ */
export function autoAbschlussPlan(z) {
  if (z.verdeckt.some((v) => v > 0)) return null; // erst wenn alles aufgedeckt ist
  const k = klon(z);
  const plan = [];
  let leerlauf = 0; // Talon-Züge ohne Fortschritt
  while (!gewonnen(k)) {
    let zug = null;
    const quellen = [{ art: "ablage", i: 0 }];
    for (let c = 0; c < 7; c++) quellen.push({ art: "spalte", i: c });
    for (const q of quellen) {
      const st = stapelVon(k, q);
      if (st.length === 0) continue;
      zug = autoZiel(k, q);
      if (zug) break;
    }
    if (zug) {
      leerlauf = 0;
    } else {
      zug = talonZug(k);
      if (!zug || ++leerlauf > 60) return null; // nichts mehr zu tun / Endlosschleife
    }
    zugAnwenden(k, zug);
    plan.push(zug);
  }
  return plan;
}

/* ------------------------------------------------------------
   Layout: wo steht welche Karte? (Einheiten: Kartenbreiten)
   ------------------------------------------------------------ */
export function lageBerechnen(z) {
  const karten = new Array(52);
  let unten = ZEILE2_Y + KARTE_H;
  z.talon.forEach((id, k) => {
    karten[id] = { x: 0, y: 0, z: 1 + k, offen: false, art: "talon", i: 0, pos: k };
  });
  // Ablage: bei 3 Karten werden die obersten drei aufgefächert, der Rest liegt darunter.
  const faecher = z.modus === 3 ? 3 : 1;
  const start = Math.max(0, z.ablage.length - faecher);
  z.ablage.forEach((id, k) => {
    karten[id] = {
      x: SPALTEN_ABSTAND + Math.max(0, k - start) * FAECHER_X,
      y: 0,
      z: 1 + k,
      offen: true,
      art: "ablage",
      i: 0,
      pos: k,
    };
  });
  z.fundamente.forEach((f, i) => {
    f.forEach((id, k) => {
      karten[id] = {
        x: (3 + i) * SPALTEN_ABSTAND,
        y: 0,
        z: 1 + k,
        offen: true,
        art: "fundament",
        i,
        pos: k,
      };
    });
  });
  z.spalten.forEach((sp, c) => {
    let y = ZEILE2_Y;
    sp.forEach((id, k) => {
      const offen = k >= z.verdeckt[c];
      karten[id] = { x: c * SPALTEN_ABSTAND, y, z: 1 + k, offen, art: "spalte", i: c, pos: k };
      unten = Math.max(unten, y + KARTE_H);
      y += offen ? STUFE_OFFEN : STUFE_ZU;
    });
  });
  return { karten, hoehe: unten };
}

/** Menge aller Karten-IDs, die man gerade anfassen darf (für den Mauszeiger/touch-action). */
export function ziehbareKarten(z) {
  const menge = new Set();
  for (let c = 0; c < 7; c++) {
    const sp = z.spalten[c];
    if (sp.length) for (let p = ziehbarAb(z, c); p < sp.length; p++) menge.add(sp[p]);
  }
  if (z.ablage.length) menge.add(z.ablage[z.ablage.length - 1]);
  for (const f of z.fundamente) if (f.length) menge.add(f[f.length - 1]);
  return menge;
}

/* ------------------------------------------------------------
   Spielstand prüfen
   localStorage kann veraltet oder von Hand verändert sein. Bevor wir
   einen geladenen Stand benutzen, prüfen wir ihn streng – sonst
   startet lieber ein neues Spiel, als dass das Spiel kaputtgeht.
   ------------------------------------------------------------ */

const istGanzzahl = (x) => Number.isInteger(x);
const istOrt = (o) =>
  !!o &&
  ((o.art === "spalte" && istGanzzahl(o.i) && o.i >= 0 && o.i < 7) ||
    (o.art === "fundament" && istGanzzahl(o.i) && o.i >= 0 && o.i < 4) ||
    (o.art === "ablage" && o.i === 0));

/** Sind alle 52 Karten genau einmal da und die Struktur in sich stimmig? */
export function istStimmig(z) {
  if (!z || !MODI.includes(z.modus)) return false;
  const liste = (a, laenge) => Array.isArray(a) && a.length === laenge && a.every(Array.isArray);
  if (!liste(z.spalten, 7) || !liste(z.fundamente, 4)) return false;
  if (!Array.isArray(z.verdeckt) || z.verdeckt.length !== 7) return false;
  if (!Array.isArray(z.talon) || !Array.isArray(z.ablage)) return false;
  for (let c = 0; c < 7; c++) {
    const v = z.verdeckt[c];
    if (!istGanzzahl(v) || v < 0 || v > Math.max(0, z.spalten[c].length - 1)) return false;
  }
  for (const f of z.fundamente) {
    if (
      !f.every(
        (id, k) =>
          istGanzzahl(id) &&
          id >= 0 &&
          id < 52 &&
          rangVon(id) === k + 1 &&
          farbeVon(id) === farbeVon(f[0]),
      )
    )
      return false;
  }
  const gesehen = new Set();
  const alle = [...z.spalten.flat(), ...z.fundamente.flat(), ...z.talon, ...z.ablage];
  for (const id of alle) {
    if (!istGanzzahl(id) || id < 0 || id > 51 || gesehen.has(id)) return false;
    gesehen.add(id);
  }
  return gesehen.size === 52;
}

function istZug(zug) {
  if (!zug || !istGanzzahl(zug.n) || zug.n < 1 || zug.n > 24) return false;
  if (zug.typ === "ziehen" || zug.typ === "recyceln") return true;
  return (
    zug.typ === "bewegen" &&
    istOrt(zug.von) &&
    istOrt(zug.nach) &&
    zug.nach.art !== "ablage" &&
    typeof zug.aufgedeckt === "boolean" &&
    (!zug.aufgedeckt || zug.von.art === "spalte")
  );
}

/**
 * Prüft einen geladenen Spielstand. Liefert { z, verlauf, zeitMs, gestartet }
 * oder null. Zusätzlich wird der Verlauf probeweise komplett zurückgespielt –
 * geht dabei irgendetwas schief, ist der Stand beschädigt.
 */
export function spielstandPruefen(s) {
  try {
    if (!s || s.v !== 1 || !s.z || !Array.isArray(s.verlauf) || s.verlauf.length > 5000)
      return null;
    const z = {
      modus: s.modus,
      spalten: s.z.spalten,
      verdeckt: s.z.verdeckt,
      fundamente: s.z.fundamente,
      talon: s.z.talon,
      ablage: s.z.ablage,
    };
    if (!istStimmig(z) || !s.verlauf.every(istZug)) return null;
    if (typeof s.zeitMs !== "number" || !Number.isFinite(s.zeitMs) || s.zeitMs < 0) return null;
    const probe = klon(z);
    for (let i = s.verlauf.length - 1; i >= 0; i--) {
      zugUmkehren(probe, s.verlauf[i]);
      if (!istStimmig(probe)) return null;
    }
    return {
      z: klon(z),
      verlauf: s.verlauf,
      zeitMs: Math.min(s.zeitMs, MAX_SEKUNDEN * 1000),
      gestartet: !!s.gestartet,
    };
  } catch {
    return null;
  }
}

/* ============================================================
   TEIL 2 · Zustand der Seite, Aufbau und Rendering
   ============================================================ */

let z = null; // aktueller Spielzustand (siehe Kopfkommentar)
let verlauf = []; // Stapel aller Züge (LERNKERN 2)
let zeitMs = 0; // bereits gespielte Zeit (ohne die laufende Messung)
let laufStart = null; // performance.now() beim Start der laufenden Messung, sonst null
let gestartet = false; // wurde schon ein Zug gemacht? (dann läuft die Uhr)
let beendet = false; // Spiel gewonnen
let sperre = false; // true während Auto-Abschluss (Eingaben ignorieren)
let partieNr = 0; // zählt neue Spiele hoch; laufende Animationen erkennen so, dass sie veraltet sind
let auswahl = null; // Klick-Bedienung: { art, i, pos, ids, n } oder null
let eingabe = null; // laufender Zeigervorgang (Maus/Finger), siehe TEIL 3
let letzterTipp = null; // { id, zeit } für die Doppelklick-Erkennung
let aktLage = []; // zuletzt berechnete Positionen aller Karten (lageBerechnen)
let vorigeLage = []; // die Lage davor, um "bewegte" Karten zu erkennen
let tischHoehe = MIN_HOEHE; // aktuelle Tischhöhe in kw (wächst nur innerhalb eines Spiels)
let kaskade = null; // laufende Sieg-Animation oder null
const el = { karten: [], faecher: {} };
const unterwegsTimer = [];

/** Setzt die Position (in Kartenbreiten) über zwei CSS-Variablen. */
function posSetzen(element, x, y) {
  element.style.setProperty("--x", x.toFixed(3));
  element.style.setProperty("--y", y.toFixed(3));
}

/**
 * Baut die 52 Karten-Elemente EINMAL auf. Danach werden sie nur noch verschoben
 * und umgedreht – nie neu erzeugt. Dadurch kann CSS jede Bewegung weich animieren.
 * Es kommt bewusst kein innerHTML zum Einsatz, nur createElement + textContent.
 */
function elementeBauen() {
  const neu = (tag, klasse, text) => {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // Platzhalter (leere Felder): Talon, Ablage, 4 Fundamente, 7 Spalten
  const fach = (art, i, x, y, bezeichnung) => {
    const f = neu("div", "fach");
    f.dataset.art = art;
    f.dataset.i = String(i);
    f.setAttribute("aria-label", bezeichnung);
    posSetzen(f, x, y);
    el.tisch.append(f);
    el.faecher[`${art}:${i}`] = f;
  };
  fach("talon", 0, 0, 0, "Nachziehstapel");
  fach("ablage", 0, SPALTEN_ABSTAND, 0, "Ablage");
  for (let f = 0; f < 4; f++)
    fach("fundament", f, (3 + f) * SPALTEN_ABSTAND, 0, `Ablagestapel ${f + 1}`);
  for (let c = 0; c < 7; c++) fach("spalte", c, c * SPALTEN_ABSTAND, ZEILE2_Y, `Spalte ${c + 1}`);

  for (let id = 0; id < 52; id++) {
    const karte = neu("div", "spielkarte");
    karte.dataset.id = String(id);
    karte.setAttribute("role", "img");
    const dreher = neu("div", "dreher"); // dreht sich beim Aufdecken um 180°
    const rueck = neu("div", "seite rueck");
    const vorn = neu("div", istRot(id) ? "seite vorn rot" : "seite vorn");
    // U+FE0E erzwingt die Text-Darstellung der Symbole (statt bunter Emoji)
    const symbol = FARBEN[farbeVon(id)] + "︎";
    const ecke = neu("div", "ecke");
    ecke.append(neu("span", "rang", RANGTEXT[rangVon(id) - 1]), neu("span", "sym", symbol));
    const mitte = neu("div", rangVon(id) > 10 ? "mitte bild" : "mitte");
    if (rangVon(id) > 10) mitte.append(neu("span", "buchstabe", RANGTEXT[rangVon(id) - 1]));
    mitte.append(neu("span", "gross", symbol));
    vorn.append(ecke, mitte);
    dreher.append(rueck, vorn);
    karte.append(dreher);
    el.tisch.append(karte);
    el.karten[id] = karte;
  }
}

/**
 * Überträgt den Zustand `z` auf die Karten-Elemente. Es wird nichts neu gebaut:
 * wir setzen nur --x/--y, die Klassen "offen"/"ziehbar" und den z-index.
 * CSS erledigt die Bewegung (transition auf transform).
 *   opt.alle         alle Karten gelten als "unterwegs"
 *   opt.ids          diese Karten gelten als "unterwegs" (z. B. zurückgleitende Karten)
 *   opt.verzoegerung (id) → ms: gestaffelter Start (Austeilen)
 */
function zeichnen(opt = {}) {
  const { karten, hoehe } = lageBerechnen(z);
  aktLage = karten;
  tischHoehe = Math.max(tischHoehe, hoehe + 0.2, MIN_HOEHE);
  el.tisch.style.setProperty("--hoehe", tischHoehe.toFixed(3));
  const ziehbar = ziehbareKarten(z);

  for (let id = 0; id < 52; id++) {
    const k = karten[id],
      e = el.karten[id],
      alt = vorigeLage[id];
    const bewegt =
      opt.alle || (opt.ids && opt.ids.includes(id)) || (alt && (alt.x !== k.x || alt.y !== k.y));
    e.classList.remove("zieht");
    e.classList.toggle("offen", k.offen);
    e.classList.toggle("ziehbar", ziehbar.has(id));
    e.dataset.art = k.art;
    e.dataset.i = String(k.i);
    e.dataset.pos = String(k.pos);
    e.dataset.z = String(k.z);
    e.setAttribute("aria-label", k.offen ? kartenName(id) : "Verdeckte Karte");
    posSetzen(e, k.x, k.y);
    clearTimeout(unterwegsTimer[id]);
    if (bewegt) {
      // Eine gleitende Karte soll über den anderen schweben; danach sinkt sie auf ihre Ebene.
      e.classList.add("unterwegs");
      e.style.zIndex = String(100 + k.z);
      unterwegsTimer[id] = setTimeout(() => {
        e.classList.remove("unterwegs");
        e.style.zIndex = e.dataset.z;
      }, UNTERWEGS_MS);
    } else if (!e.classList.contains("unterwegs")) {
      e.style.zIndex = String(k.z);
    }
    const verz = opt.verzoegerung ? `${opt.verzoegerung(id)}ms` : "";
    e.style.transitionDelay = verz;
    e.firstChild.style.transitionDelay = verz;
  }
  if (opt.verzoegerung) {
    setTimeout(() => {
      for (const e of el.karten) {
        e.style.transitionDelay = "";
        e.firstChild.style.transitionDelay = "";
      }
    }, 1600);
  }
  vorigeLage = karten;
  auswahlAnzeigen();
}

/** Austeil-Animation: alle Karten liegen auf dem Talon und gleiten nacheinander an ihren Platz. */
function austeilen() {
  vorigeLage = [];
  if (bewegungReduziert()) {
    zeichnen();
    return;
  }
  for (const e of el.karten) {
    e.classList.add("zieht");
    e.classList.remove("offen");
    posSetzen(e, 0, 0);
  }
  void el.tisch.offsetWidth; // Layout erzwingen: der Sprung zum Talon ist jetzt "fest"
  // Reihenfolge wie am echten Tisch: Reihe für Reihe, von links nach rechts
  const reihenfolge = new Map();
  let n = 0;
  for (let reihe = 0; reihe < 7; reihe++)
    for (let c = reihe; c < 7; c++) reihenfolge.set(z.spalten[c][reihe], n++);
  zeichnen({
    alle: true,
    verzoegerung: (id) => (reihenfolge.has(id) ? reihenfolge.get(id) * 30 : 0),
  });
}

/** Markiert die Klick-Auswahl (cyanfarbener Rahmen) und die möglichen Ziele. */
function auswahlAnzeigen() {
  for (const e of el.karten) e.classList.remove("gewaehlt");
  zielLoeschen();
  if (!auswahl) return;
  for (const id of auswahl.ids) el.karten[id].classList.add("gewaehlt");
  zielMarkieren(moeglicheZiele(z, { art: auswahl.art, i: auswahl.i }, auswahl.n));
}

function zielMarkieren(orte) {
  zielLoeschen();
  for (const o of orte) {
    el.faecher[`${o.art}:${o.i}`].classList.add("ziel");
    const st = stapelVon(z, o);
    if (st.length) el.karten[st[st.length - 1]].classList.add("ziel-karte");
  }
}

function zielLoeschen() {
  for (const f of Object.values(el.faecher)) f.classList.remove("ziel");
  for (const e of el.karten) e.classList.remove("ziel-karte");
}

/** Kurzes Schütteln als Rückmeldung für "geht nicht". */
function schuetteln(ids) {
  for (const id of ids) {
    const e = el.karten[id];
    e.classList.remove("schuettel");
    void e.offsetWidth; // Animation neu starten
    e.classList.add("schuettel");
    setTimeout(() => e.classList.remove("schuettel"), 480);
  }
}

/* ------------------------------------------------------------
   Uhr: läuft ab dem ersten Zug, pausiert bei verborgenem Tab
   ------------------------------------------------------------ */
const zeitJetzt = () => zeitMs + (laufStart !== null ? performance.now() - laufStart : 0);
function uhrStarten() {
  if (laufStart === null && gestartet && !beendet && !document.hidden)
    laufStart = performance.now();
}
function uhrPausieren() {
  if (laufStart !== null) {
    zeitMs += performance.now() - laufStart;
    laufStart = null;
  }
}
const sekunden = () => Math.min(MAX_SEKUNDEN, Math.floor(zeitJetzt() / 1000));

/* ------------------------------------------------------------
   HUD, Knöpfe, Topliste
   ------------------------------------------------------------ */
function hudZeichnen() {
  el.hudZeit.textContent = zeitText(sekunden());
  el.hudZuege.textContent = String(verlauf.length);
  const bestliste = topliste(toplisteKey(z.modus));
  el.hudBest.textContent = bestliste.length ? zeitText(bestliste[0].punkte) : "--:--";
}

function knoepfeAktualisieren() {
  el.undo.disabled = verlauf.length === 0 || sperre || beendet;
  el.auto.hidden = beendet || sperre || !autoAbschlussPlan(z);
}

function toplisteAktualisieren() {
  el.toplisteTitel.textContent = `Lokale Top 3 · ${z.modus === 1 ? "1 Karte" : "3 Karten"}`;
  toplisteAnzeigen(el.topliste, toplisteKey(z.modus), zeitText);
}

function modusKnoepfeAktualisieren() {
  for (const k of document.querySelectorAll(".stufen-leiste [data-modus]")) {
    k.setAttribute("aria-pressed", String(Number(k.dataset.modus) === z.modus));
  }
}

const ansage = (text) => {
  el.status.textContent = text;
};

/** Speichert Spielstand inkl. komplettem Verlauf (nur über storage.js). */
function speichern() {
  if (beendet) return;
  speichere(SPIEL, "spielstand", {
    v: 1,
    modus: z.modus,
    z: {
      spalten: z.spalten,
      verdeckt: z.verdeckt,
      fundamente: z.fundamente,
      talon: z.talon,
      ablage: z.ablage,
    },
    verlauf,
    zeitMs: Math.round(zeitJetzt()),
    gestartet,
  });
}

/** Eine kleine Ja/Nein-Rückfrage als <dialog> (Promise<boolean>). Nur feste Texte, kein innerHTML mit Werten. */
function frage(text, jaText) {
  return new Promise((fertig) => {
    document.getElementById("frage-dialog")?.remove();
    const d = document.createElement("dialog");
    d.className = "spiel-dialog";
    d.id = "frage-dialog";
    const h = document.createElement("h2");
    h.textContent = "Sicher?";
    const p = document.createElement("p");
    p.textContent = text;
    const aktionen = document.createElement("div");
    aktionen.className = "aktionen";
    const ja = document.createElement("button");
    ja.className = "knopf primaer";
    ja.textContent = jaText;
    const nein = document.createElement("button");
    nein.className = "knopf";
    nein.textContent = "Abbrechen";
    ja.addEventListener("click", () => d.close("ja"));
    nein.addEventListener("click", () => d.close("nein"));
    d.addEventListener("close", () => {
      const antwort = d.returnValue === "ja";
      d.remove();
      fertig(antwort);
    });
    aktionen.append(ja, nein);
    d.append(h, p, aktionen);
    document.body.append(d);
    d.showModal();
    nein.focus();
  });
}

/* ============================================================
   TEIL 3 · Züge ausführen, Rückgängig, Auto-Abschluss, Sieg
   ============================================================ */

/**
 * EINE Stelle, an der jeder Zug passiert (egal ob Drag, Klick, Doppelklick,
 * Talon oder Auto-Abschluss): anwenden → auf den Verlauf-Stapel legen →
 * speichern → neu zeichnen → Sieg prüfen.
 */
function zugAusfuehren(zug) {
  zugAnwenden(z, zug);
  verlauf.push(zug);
  auswahl = null;
  letzterTipp = null;
  if (!gestartet) {
    gestartet = true;
    uhrStarten();
  }
  speichern();
  zeichnen();
  hudZeichnen();
  knoepfeAktualisieren();
  if (gewonnen(z)) sieg();
}

/** Rückgängig: oberster Zug vom Stapel holen und umkehren – bis zum Spielstart möglich. */
function rueckgaengig() {
  if (sperre || beendet || eingabe?.ziehen || verlauf.length === 0) return;
  const zug = verlauf.pop();
  zugUmkehren(z, zug);
  auswahl = null;
  letzterTipp = null;
  speichern();
  zeichnen();
  hudZeichnen();
  knoepfeAktualisieren();
  ansage(`Zug rückgängig gemacht. ${verlauf.length} Züge im Verlauf.`);
}

const warte = (ms) => new Promise((ok) => setTimeout(ok, bewegungReduziert() ? 0 : ms));

/** Auto-Abschluss: spielt den vorab berechneten Plan Zug für Zug mit kleiner Pause ab. */
async function autoAbschluss() {
  if (sperre || beendet) return;
  const plan = autoAbschlussPlan(z);
  if (!plan) return;
  const meine = partieNr;
  sperre = true;
  auswahl = null;
  knoepfeAktualisieren();
  for (const schritt of plan) {
    if (meine !== partieNr) return; // inzwischen neues Spiel: abbrechen
    zugAusfuehren(schritt);
    await warte(schritt.typ === "bewegen" ? 110 : 25);
  }
  if (meine === partieNr) {
    sperre = false;
    knoepfeAktualisieren();
  }
}

/** Sieg: Uhr stoppen, Spielstand löschen, Kaskade, dann der gemeinsame Dialog. */
async function sieg() {
  beendet = true;
  uhrPausieren();
  entferne(SPIEL, "spielstand");
  knoepfeAktualisieren();
  hudZeichnen();
  ansage("Gewonnen! Alle 52 Karten liegen auf den Ablagestapeln.");
  const meine = partieNr;
  const modus = z.modus;
  const sek = Math.max(1, sekunden());
  await kaskadeStarten();
  if (meine !== partieNr) return; // in der Zwischenzeit neues Spiel gestartet
  const dialog = gameOverDialog({
    spiel: toplisteKey(modus),
    titel: "GEWONNEN!",
    punkte: sek,
    punkteText: zeitText(sek),
    richtung: "runter", // weniger Sekunden = besser
    format: zeitText,
    neustart: () => neuesSpiel(),
  });
  // Dialog ohne "Nochmal" geschlossen (z. B. Esc): Karten zurück auf die Ablagen.
  // Esc löst "cancel" aus; der Dialog entfernt sich dann selbst, daher hören wir auf beides.
  let kaskadeAktiv = true;
  const aufraeumen = () => {
    if (meine !== partieNr || !beendet || !kaskadeAktiv) return;
    kaskadeAktiv = false;
    kaskadeStop();
    zeichnen({ alle: true });
    toplisteAktualisieren();
    hudZeichnen();
  };
  dialog.addEventListener("close", aufraeumen);
  dialog.addEventListener("cancel", aufraeumen);
}

/**
 * Siegeskaskade: Die Karten (Könige zuerst) hüpfen nacheinander los. Pro Bild
 * (requestAnimationFrame) gilt einfache Physik: Geschwindigkeit += Schwerkraft * dt,
 * Position += Geschwindigkeit * dt, am Boden wird die vertikale Geschwindigkeit
 * gedämpft umgekehrt (Aufprall). Verlässt die Karte seitlich den Tisch, ist sie fertig.
 * Das Promise wird erfüllt, sobald alle losgeflogen sind (oder per Klick übersprungen).
 */
function kaskadeStarten() {
  return new Promise((fertig) => {
    if (bewegungReduziert()) {
      setTimeout(fertig, 500);
      return;
    }
    kaskadeStop();
    el.tisch.classList.add("kaskade");
    const reihenfolge = [];
    for (let rang = 12; rang >= 0; rang--) {
      for (let f = 0; f < 4; f++) {
        const id = z.fundamente[f][rang];
        if (id !== undefined) reihenfolge.push(id);
      }
    }
    const flug = [];
    const k = { rahmen: 0, fertig, uebersprungen: false };
    kaskade = k;
    const t0 = performance.now();
    let letzte = t0;
    let gestartetAnz = 0;
    const SCHWERKRAFT = 24; // in Kartenbreiten pro Sekunde²
    const boden = () => tischHoehe - KARTE_H;

    function bild(jetzt) {
      if (kaskade !== k) return;
      const dt = Math.min(0.05, (jetzt - letzte) / 1000);
      letzte = jetzt;
      const soll = Math.min(reihenfolge.length, Math.floor((jetzt - t0) / KASKADE_ABSTAND_MS) + 1);
      while (gestartetAnz < soll) {
        const id = reihenfolge[gestartetAnz];
        const l = aktLage[id];
        const e = el.karten[id];
        e.classList.add("zieht");
        e.classList.remove("ziehbar");
        e.style.zIndex = String(400 + gestartetAnz);
        flug.push({
          id,
          x: l.x,
          y: l.y,
          vx: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 3.5),
          vy: -(1 + Math.random() * 4),
          aus: false,
        });
        gestartetAnz++;
      }
      for (const f of flug) {
        if (f.aus) continue;
        f.vy += SCHWERKRAFT * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.y > boden()) {
          f.y = boden();
          f.vy = -f.vy * 0.72;
        }
        posSetzen(el.karten[f.id], f.x, f.y);
        if (f.x < -1.6 || f.x > BREITE + 0.6) f.aus = true;
      }
      if (gestartetAnz >= reihenfolge.length && !k.uebersprungen && !k.dialog) {
        // alle gestartet: noch einen Moment zuschauen, dann den Dialog zeigen
        k.dialog = setTimeout(() => fertig(), 900);
      }
      if (gestartetAnz >= reihenfolge.length && flug.every((f) => f.aus)) {
        kaskadeStop();
        fertig();
        return;
      }
      k.rahmen = requestAnimationFrame(bild);
    }
    k.rahmen = requestAnimationFrame(bild);
  });
}

/** Beendet die Kaskade (Karten bleiben liegen; zeichnen() holt sie zurück). */
function kaskadeStop() {
  if (!kaskade) return;
  cancelAnimationFrame(kaskade.rahmen);
  clearTimeout(kaskade.dialog);
  const k = kaskade;
  kaskade = null;
  el.tisch.classList.remove("kaskade");
  k.fertig(); // Promise nie hängen lassen
}

/** Klick während der Kaskade: sofort zum Dialog. */
function kaskadeUeberspringen() {
  if (!kaskade || kaskade.uebersprungen) return;
  kaskade.uebersprungen = true;
  clearTimeout(kaskade.dialog);
  kaskade.fertig();
}

/* ============================================================
   TEIL 4 · Eingabe (LERNKERN 1: Pointer Events)
   ------------------------------------------------------------
   Früher brauchte man für Maus (mousedown/-move/-up) und Touch
   (touchstart/-move/-end) zwei getrennte Codepfade. Pointer Events
   vereinen beides: "pointerdown/-move/-up" feuern für Maus, Finger
   und Stift, mit denselben Feldern (clientX, clientY, pointerId).

   Wichtigster Trick: setPointerCapture(pointerId). Danach schickt der
   Browser ALLE weiteren Ereignisse dieses Zeigers an unseren Tisch –
   auch wenn der Finger/Zeiger schnell über andere Elemente oder aus
   dem Fenster wandert. Ohne Capture würde die gezogene Karte bei
   schneller Bewegung "verloren gehen".

   Ein Zeigervorgang hat zwei Ausgänge:
     - kaum bewegt (< 6 px)  → TIPPEN/KLICKEN  (tipp)
     - weiter bewegt          → ZIEHEN, beim Loslassen wird abgelegt
   ============================================================ */

/** Welche Karten würde man mit dieser Karte zusammen aufnehmen? */
function ziehGruppe(info) {
  if (info.art === "spalte") {
    if (info.pos < ziehbarAb(z, info.i)) return null;
    const ids = z.spalten[info.i].slice(info.pos);
    return { art: "spalte", i: info.i, pos: info.pos, ids, n: ids.length };
  }
  if (info.art === "ablage" || info.art === "fundament") {
    const st = stapelVon(z, info);
    if (info.pos !== st.length - 1) return null;
    return { art: info.art, i: info.i, pos: info.pos, ids: [st[info.pos]], n: 1 };
  }
  return null; // Talon-Karten kann man nicht ziehen
}

/** Aus dem angeklickten Element (Karte oder leeres Feld) wird eine Info mit Ort. */
function infoAus(ziel) {
  if (ziel.classList.contains("spielkarte")) {
    const id = Number(ziel.dataset.id);
    const l = aktLage[id];
    return { id, art: l.art, i: l.i, pos: l.pos };
  }
  return { id: null, art: ziel.dataset.art, i: Number(ziel.dataset.i), pos: -1 };
}

const kwPixel = () => el.karten[0].getBoundingClientRect().width;

function zeigerUnten(e) {
  if (sperre || eingabe) return;
  if (beendet) {
    kaskadeUeberspringen();
    return;
  }
  if (e.pointerType === "mouse" && e.button !== 0) return; // nur linke Maustaste
  const ziel = e.target.closest(".spielkarte, .fach");
  if (!ziel) return;
  const info = infoAus(ziel);
  const gruppe = info.id !== null ? ziehGruppe(info) : null;
  eingabe = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    info,
    gruppe,
    ziehen: false,
  };
  if (gruppe) {
    try {
      el.tisch.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger schon weg: egal */
    }
  }
}

function ziehenStarten() {
  const g = eingabe.gruppe;
  eingabe.ziehen = true;
  eingabe.kw = kwPixel();
  eingabe.basis = g.ids.map((id) => ({ x: aktLage[id].x, y: aktLage[id].y }));
  auswahl = null;
  for (const e of el.karten) e.classList.remove("gewaehlt");
  zielMarkieren(moeglicheZiele(z, { art: g.art, i: g.i }, g.n));
  g.ids.forEach((id, k) => {
    const e = el.karten[id];
    clearTimeout(unterwegsTimer[id]);
    e.classList.remove("unterwegs");
    e.classList.add("zieht"); // keine Transition: Karte klebt am Finger
    e.style.zIndex = String(500 + k);
    e.style.transitionDelay = "";
  });
}

function zeigerBewegt(e) {
  if (!eingabe || e.pointerId !== eingabe.pointerId) return;
  const dx = e.clientX - eingabe.startX,
    dy = e.clientY - eingabe.startY;
  if (!eingabe.ziehen) {
    if (!eingabe.gruppe || Math.hypot(dx, dy) < ZIEH_SCHWELLE_PX) return;
    ziehenStarten();
  }
  eingabe.gruppe.ids.forEach((id, k) => {
    posSetzen(
      el.karten[id],
      eingabe.basis[k].x + dx / eingabe.kw,
      eingabe.basis[k].y + dy / eingabe.kw,
    );
  });
  eingabe.zeiger = { x: e.clientX, y: e.clientY };
}

/**
 * Bestes gültiges Ziel für den Drop: Für jedes mögliche Ziel messen wir, wie stark
 * sich die gezogene oberste Karte mit der Zielfläche überlappt. Steht der Zeiger
 * direkt im Ziel, gewinnt es bevorzugt (+1). Unter 20 % Überlappung gilt es nicht.
 */
function besteZiel(ein) {
  const g = ein.gruppe;
  const ziele = moeglicheZiele(z, { art: g.art, i: g.i }, g.n);
  const r = el.tisch.getBoundingClientRect();
  const px = ein.zeiger ? (ein.zeiger.x - r.left) / ein.kw : -99;
  const py = ein.zeiger ? (ein.zeiger.y - r.top) / ein.kw : -99;
  const kx = ein.basis[0].x + (ein.zeiger.x - ein.startX) / ein.kw;
  const ky = ein.basis[0].y + (ein.zeiger.y - ein.startY) / ein.kw;
  let bester = null,
    besterWert = 0.2;
  for (const ziel of ziele) {
    let zx,
      zy,
      zh = KARTE_H;
    if (ziel.art === "fundament") {
      zx = (3 + ziel.i) * SPALTEN_ABSTAND;
      zy = 0;
    } else {
      zx = ziel.i * SPALTEN_ABSTAND;
      zy = ZEILE2_Y;
      const sp = z.spalten[ziel.i];
      if (sp.length) zh = Math.max(KARTE_H, aktLage[sp[sp.length - 1]].y + KARTE_H - ZEILE2_Y);
    }
    const breite = Math.max(0, Math.min(kx + 1, zx + 1) - Math.max(kx, zx));
    const hoehe = Math.max(0, Math.min(ky + KARTE_H, zy + zh) - Math.max(ky, zy));
    let wert = (breite * hoehe) / KARTE_H;
    if (px >= zx && px <= zx + 1 && py >= zy && py <= zy + zh) wert += 1;
    if (wert > besterWert) {
      besterWert = wert;
      bester = ziel;
    }
  }
  return bester;
}

function zeigerHoch(e) {
  if (!eingabe || e.pointerId !== eingabe.pointerId) return;
  const ein = eingabe;
  eingabe = null;
  if (!ein.ziehen) {
    tipp(ein.info);
    return;
  }
  zielLoeschen();
  const g = ein.gruppe;
  const ziel = ein.zeiger ? besteZiel(ein) : null;
  const zug = ziel ? zugErmitteln(z, { art: g.art, i: g.i }, g.n, ziel) : null;
  if (zug) zugAusfuehren(zug);
  else zeichnen({ ids: g.ids }); // ungültig: sanft zurückgleiten
}

function zeigerAbbruch(e) {
  if (!eingabe || e.pointerId !== eingabe.pointerId) return;
  const ein = eingabe;
  eingabe = null;
  if (ein.ziehen) {
    zielLoeschen();
    zeichnen({ ids: ein.gruppe.ids });
  }
}

/* ------------------------------------------------------------
   Klick-/Tipp-Bedienung
   1. Tipp: Karte oder Stapel wählen (Rahmen + Ziele leuchten)
   2. Tipp aufs Ziel: Zug ausführen
   Doppelklick/Doppeltipp: Karte direkt auf den passenden Ablagestapel
   ------------------------------------------------------------ */
function tipp(info) {
  const jetzt = performance.now();
  const doppelt =
    info.id !== null &&
    letzterTipp &&
    letzterTipp.id === info.id &&
    jetzt - letzterTipp.zeit < DOPPELTIPP_MS;
  letzterTipp = { id: info.id, zeit: jetzt };

  if (info.art === "talon") {
    auswahl = null;
    const zug = talonZug(z);
    if (zug) zugAusfuehren(zug);
    else {
      auswahlAnzeigen();
    }
    return;
  }

  // Doppelklick auf die oberste Karte eines Stapels: automatisch auf die Ablage
  if (doppelt && (info.art === "spalte" || info.art === "ablage")) {
    const st = stapelVon(z, info);
    if (info.pos === st.length - 1) {
      const zug = autoZiel(z, { art: info.art, i: info.i });
      if (zug) {
        zugAusfuehren(zug);
        return;
      }
      schuetteln([info.id]);
      return; // Auswahl bleibt stehen
    }
  }

  if (auswahl) {
    // Nochmal auf die gewählte Gruppe tippen = Auswahl aufheben
    if (
      info.art === auswahl.art &&
      info.i === auswahl.i &&
      info.pos >= auswahl.pos &&
      info.id !== null
    ) {
      auswahl = null;
      auswahlAnzeigen();
      return;
    }
    const nach =
      info.art === "spalte" || info.art === "fundament" ? { art: info.art, i: info.i } : null;
    const zug = nach ? zugErmitteln(z, { art: auswahl.art, i: auswahl.i }, auswahl.n, nach) : null;
    if (zug) {
      zugAusfuehren(zug);
      return;
    }
    const neu = info.id !== null ? ziehGruppe(info) : null;
    if (neu) {
      auswahl = neu;
      auswahlAnzeigen();
      return;
    }
    schuetteln(auswahl.ids);
    auswahl = null;
    auswahlAnzeigen();
    return;
  }

  const g = info.id !== null ? ziehGruppe(info) : null;
  if (g) {
    auswahl = g;
    auswahlAnzeigen();
  }
}

function eingabeEinrichten() {
  const t = el.tisch;
  t.addEventListener("pointerdown", zeigerUnten);
  t.addEventListener("pointermove", zeigerBewegt);
  t.addEventListener("pointerup", zeigerHoch);
  t.addEventListener("pointercancel", zeigerAbbruch);
  t.addEventListener("contextmenu", (e) => e.preventDefault()); // kein Menü bei langem Drücken
  t.addEventListener("dragstart", (e) => e.preventDefault());
  // Während der Siegeskaskade überspringt ein Klick irgendwo auf der Seite die Animation
  document.addEventListener("pointerdown", () => {
    if (beendet) kaskadeUeberspringen();
  });

  // Taste Z = Rückgängig (auch Strg+Z), solange kein Dialog offen ist
  document.addEventListener("keydown", (e) => {
    if (
      (e.key === "z" || e.key === "Z") &&
      !e.altKey &&
      !document.querySelector("dialog[open]") &&
      !(e.target instanceof HTMLInputElement)
    ) {
      e.preventDefault();
      rueckgaengig();
    }
  });
}

/* ============================================================
   TEIL 5 · Neues Spiel, Laden, Start
   ============================================================ */

function neuesSpiel(modus = z ? z.modus : 1) {
  partieNr++;
  kaskadeStop();
  sperre = false;
  beendet = false;
  z = neuesBlatt(modus);
  verlauf = [];
  zeitMs = 0;
  laufStart = null;
  gestartet = false;
  auswahl = null;
  eingabe = null;
  letzterTipp = null;
  tischHoehe = MIN_HOEHE;
  speichere(SPIEL, "modus", modus);
  speichern();
  modusKnoepfeAktualisieren();
  toplisteAktualisieren();
  hudZeichnen();
  knoepfeAktualisieren();
  austeilen();
  ansage(`Neues Spiel, ${modus === 1 ? "eine Karte" : "drei Karten"} pro Zug.`);
}

/** Hat der Spieler schon etwas erreicht, das ein neues Spiel wegwerfen würde? */
const hatFortschritt = () => verlauf.length > 0 && !beendet;

async function neuesSpielMitFrage() {
  if (
    hatFortschritt() &&
    !(await frage(
      "Das laufende Spiel geht verloren. Wirklich ein neues Spiel starten?",
      "Ja, neues Spiel",
    ))
  )
    return;
  neuesSpiel();
}

async function modusWaehlen(neu) {
  if (!MODI.includes(neu) || neu === z.modus) return;
  if (
    hatFortschritt() &&
    !(await frage(
      "Ein Moduswechsel startet ein neues Spiel. Das laufende Spiel geht verloren.",
      "Ja, wechseln",
    ))
  )
    return;
  neuesSpiel(neu);
}

async function zuruecksetzen() {
  if (
    !(await frage(
      "Beide Toplisten und der gespeicherte Spielstand werden gelöscht. Fortfahren?",
      "Ja, löschen",
    ))
  )
    return;
  for (const m of MODI) spielZuruecksetzen(toplisteKey(m));
  spielZuruecksetzen(SPIEL);
  neuesSpiel();
}

/** Lädt einen gespeicherten Stand (falls gültig) oder startet neu. */
function startLaden() {
  const gemerkt = lade(SPIEL, "modus", 1);
  const stand = spielstandPruefen(lade(SPIEL, "spielstand", null));
  if (!stand) {
    neuesSpiel(MODI.includes(gemerkt) ? gemerkt : 1);
    return;
  }
  z = stand.z;
  verlauf = stand.verlauf;
  zeitMs = stand.zeitMs;
  gestartet = stand.gestartet;
  beendet = false;
  sperre = false;
  speichere(SPIEL, "modus", z.modus);
  modusKnoepfeAktualisieren();
  toplisteAktualisieren();
  zeichnen();
  hudZeichnen();
  knoepfeAktualisieren();
  uhrStarten();
}

function init() {
  el.tisch = document.getElementById("tisch");
  el.hudZeit = document.getElementById("hud-zeit");
  el.hudZuege = document.getElementById("hud-zuege");
  el.hudBest = document.getElementById("hud-best");
  el.topliste = document.getElementById("topliste");
  el.toplisteTitel = document.getElementById("topliste-titel");
  el.status = document.getElementById("status");
  el.undo = document.getElementById("rueckgaengig");
  el.auto = document.getElementById("auto");

  elementeBauen();
  eingabeEinrichten();

  for (const k of document.querySelectorAll(".stufen-leiste [data-modus]")) {
    k.addEventListener("click", () => modusWaehlen(Number(k.dataset.modus)));
  }
  document.getElementById("neues-spiel").addEventListener("click", neuesSpielMitFrage);
  el.undo.addEventListener("click", rueckgaengig);
  el.auto.addEventListener("click", autoAbschluss);
  document.getElementById("reset").addEventListener("click", zuruecksetzen);

  // Uhr: pausiert, solange der Tab verborgen ist (Zeit wird dann auch gespeichert)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      uhrPausieren();
      speichern();
    } else uhrStarten();
  });
  window.addEventListener("pagehide", () => {
    uhrPausieren();
    speichern();
  });
  setInterval(() => {
    if (z) el.hudZeit.textContent = zeitText(sekunden());
  }, 250);

  startLaden();
}

// In Node (Tests) gibt es kein `document` – dort wollen wir nur die reinen
// Funktionen oben importieren und das Spiel NICHT starten.
if (typeof document !== "undefined") init();
