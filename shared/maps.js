// Mapy rysowane programowo (prostokątami), żeby łatwo je zmieniać.
//
// Legenda kafelków:
//  Podłogi:   .  marmur (hol – publiczny)    r  marmur za ladą (zakaz)    _  dywan biuro (zakaz)
//             :  korytarz zaplecza (zakaz)   v  skarbiec (zakaz)          ,  ulica    -  chodnik
//             Z  strefa furgonetki (tu wrzucamy worki / ucieczka)          S  start ekipy (chodnik)
//             g  szklane drzwi wejściowe     d  otwarte przejście        h  furtka za ladę (zakaz)
//  Bloki:     #  ściana   W  okno   H  sąsiedni budynek   X  barierka   O  kolumna
//             C  lada   R  kasa na ladzie (łup)   D  biurko   K  biurko z kartą kierownika
//             M  stanowisko ochrony (monitory)    $  pieniądze w skarbcu   b ławka  p roślina
//             Y  furgonetka   P  zaparkowane auto   l  latarnia
//  Dynamiczne: L  drzwi służbowe (zamknięte)   V  drzwi skarbca (zamknięte)

function paint(w, h, fill) {
  const g = Array.from({ length: h }, () => Array(w).fill(fill));
  const api = {
    rect(x0, z0, x1, z1, ch) { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g[z][x] = ch; return api; },
    set(x, z, ch) { g[z][x] = ch; return api; },
    rows() { return g.map((r) => r.join('')); },
  };
  return api;
}

function bankMap() {
  const m = paint(40, 32, 'H');
  // ulica i chodniki
  m.rect(0, 21, 39, 22, '-').rect(0, 23, 39, 29, ',').rect(0, 30, 39, 30, '-');
  m.rect(0, 21, 0, 30, 'X').rect(39, 21, 39, 30, 'X');
  // budynek banku
  m.rect(4, 0, 35, 20, '#');
  m.rect(5, 12, 34, 19, '.');                         // hol
  for (const x of [6, 7, 8, 9, 12, 13, 14, 15, 24, 25, 26, 27, 30, 31, 32, 33]) m.set(x, 20, 'W');
  m.set(19, 20, 'g').set(20, 20, 'g');               // wejście
  m.rect(7, 11, 34, 11, 'C').set(5, 11, '#').set(6, 11, 'h');
  for (const x of [10, 15, 24, 29]) m.set(x, 11, 'R');
  m.rect(5, 8, 34, 10, 'r');                          // za ladą
  m.rect(4, 7, 35, 7, '#').set(20, 7, 'L');           // drzwi służbowe
  m.rect(14, 5, 34, 6, ':');                          // korytarz
  m.rect(5, 1, 12, 6, '_').rect(13, 0, 13, 7, '#').set(13, 5, 'd'); // biuro kierownika
  m.set(8, 2, 'K').set(6, 5, 'D').set(11, 2, 'p');
  m.rect(13, 4, 35, 4, '#');
  m.rect(14, 1, 19, 3, ':').set(16, 4, 'd').rect(20, 0, 20, 4, '#');   // pokój ochrony
  m.set(15, 1, 'M').set(17, 1, 'M');
  m.rect(21, 1, 34, 3, 'v').set(27, 4, 'V');          // skarbiec
  for (const x of [22, 24, 26, 28, 30, 32]) m.set(x, 1, '$');
  // wystrój holu
  for (const [x, z] of [[9, 14], [9, 17], [30, 14], [30, 17]]) m.set(x, z, 'O');
  m.rect(14, 16, 15, 16, 'b').rect(24, 16, 25, 16, 'b');
  m.set(5, 19, 'p').set(34, 19, 'p').set(5, 12, 'p').set(34, 12, 'p');
  // furgonetka, strefa ucieczki, start
  m.rect(16, 24, 23, 25, 'Y').rect(13, 24, 15, 25, 'Z');
  m.rect(12, 22, 17, 22, 'S');
  // auta, latarnie
  m.rect(4, 27, 7, 28, 'P').rect(28, 27, 31, 28, 'P');
  for (const x of [3, 11, 28, 36]) m.set(x, 21, 'l');
  return m.rows();
}

export const MAPS = {
  bank: {
    id: 'bank',
    name: 'First National Bank',
    daytime: true,
    rows: bankMap(),
    roof: [4, 0, 35, 20],
    bagValue: 40000,
    registerValue: 2500,
    // Kamery: pozycja, kierunek patrzenia (radiany, 0 = +z), zasięg
    cameras: [
      { x: 5.6, z: 12.4, dir: Math.atan2(1, 1), range: 14 },
      { x: 34.4, z: 12.4, dir: Math.atan2(-1, 1), range: 14 },
      { x: 14.4, z: 5.2, dir: Math.PI / 2, range: 16 },
      { x: 33.6, z: 8.2, dir: Math.atan2(-1, 0.4), range: 14 },
    ],
    // Strażnicy: trasy patroli (środki kafelków); stały = stoi w miejscu
    guards: [
      { route: [[7, 13], [32, 13], [32, 18], [7, 18]] },
      { route: [[8, 9], [33, 9], [33, 5], [15, 5], [15, 9]] },
      { route: [[16, 2]], post: true, security: true }, // ochrona przy monitorach
    ],
    tellers: [[12, 9], [26, 9]],
    manager: [7, 3],
    civilians: 7,
    pedestrians: 3,
    lights: [
      { x: 10, z: 14.5, y: 2.9, color: '#ffe2b8', intensity: 6, distance: 9, kind: 'panel' },
      { x: 20, z: 14.5, y: 2.9, color: '#ffe2b8', intensity: 6, distance: 9, kind: 'panel' },
      { x: 30, z: 14.5, y: 2.9, color: '#ffe2b8', intensity: 6, distance: 9, kind: 'panel' },
      { x: 13, z: 9, y: 2.9, color: '#ffe2b8', intensity: 5, distance: 8, kind: 'panel' },
      { x: 27, z: 9, y: 2.9, color: '#ffe2b8', intensity: 5, distance: 8, kind: 'panel' },
      { x: 9, z: 3.5, y: 2.9, color: '#ffd6a0', intensity: 4, distance: 7, kind: 'panel' },
      { x: 17, z: 2, y: 2.9, color: '#d8e6ff', intensity: 3, distance: 6, kind: 'panel' },
      { x: 24, z: 5.5, y: 2.9, color: '#e6ecf5', intensity: 3, distance: 8, kind: 'panel' },
      { x: 27.5, z: 2, y: 2.9, color: '#e6f0ff', intensity: 5, distance: 9, kind: 'panel' },
    ],
  },
};
