# SKOK – kooperacyjny napad (etap 1)

Gra w przeglądarce dla 4–5 osób. Jedna osoba uruchamia serwer, reszta wchodzi przez link.

## Jak wygląda napad (etap 2)
1. **Ulica:** zaczynacie przy furgonetce przed bankiem, w biały dzień.
2. **Rozpoznanie bez masek:** wchodzicie jako klienci. Nikt was nie podejrzewa, dopóki nie wejdziecie za ladę albo na zaplecze – tam strażnik najpierw ostrzega, a za drugim razem wzywa policję.
3. **Maski (przytrzymaj G):** od tej chwili każdy, kto was zobaczy, zaczyna panikować:
   - **klienci** uciekają i dzwonią po policję, **kasjerzy** naciskają cichy alarm, **kierownik** dzwoni,
   - **strażnicy** po chwili sięgają po radio (nad głową „?” rośnie, potem „!” i „DZWONI!”),
   - **kamery** widzi ochrona w pokoju z monitorami.
4. **Zastraszanie (Q):** krzyk kładzie ludzi na ziemię (na ok. 40 s), strażnik po dwóch krzykach się poddaje. Leżących i poddanych można **związać (E)** – wtedy już nie wstaną. Każdy ma 4 opaski.
5. **Skarbiec:** po cichu – **karta kierownika** (biurko w jego biurze na zapleczu). Głośno – **wiertło** (ok. 70 s, zacina się, strażnicy je słyszą).
   Drzwi na zaplecze: kartą od razu albo wytrychem (Kasiarz 2× szybciej).
6. **Łup:** w skarbcu 6 palet pieniędzy, każda to jeden worek (40 000 $). Z workiem idziesz wolniej i nie biegasz. **B** – rzut worka do kolegi. Kasy na ladzie dają drobne.
7. **Furgonetka:** wnieś worek do **żółtej strefy** za furgonetką. Gdy wszyscy staną w strefie na 3 s – uciekacie.
8. **Alarm:** policja przyjeżdża po czasie zależnym od trudności (150 / 110 / 80 / 60 s). Kto nie zdąży – napad nieudany (zostaje połowa wyniesionego).

**Wypłata:** worki + kasy × mnożnik trudności, **×1.5 za cichy napad**, dzielone po równo do portfeli ekipy.

**Postacie:** Haker – szybko zapętla kamery; Akrobata – najszybszy; Kasiarz – zamki i wiertło 2× szybciej; Iluzjonista – krzyczy dalej, strażnik poddaje się od razu; Mięśniak – worek go nie spowalnia, rzuca dalej.

## Sterowanie
| Klawisz | Akcja |
|---|---|
| WASD | ruch |
| mysz | rozglądanie (kliknij w grę; albo trzymaj prawy przycisk) |
| Shift / C | bieg (głośno!) / skradanie |
| G (przytrzymaj) | załóż maskę |
| E (przytrzymaj) | akcja: kasa, karta, drzwi, skarbiec, pakowanie, worek, wiązanie |
| Q | zastraszanie – krzyk |
| B | rzuć worek |
| F / V | ping „tutaj” / „uwaga” |
| T | widok zza pleców / z góry |
| Esc | menu |

## W następnym etapie
Strzelanie (celowanie prawym, strzał lewym), policja szturmująca bank, śmierć do końca napadu, sklep z ulepszeniami za zarobione pieniądze.

## Uruchomienie (osoba, która hostuje)
1. Zainstaluj **Node.js** (wersja 18 lub nowsza): https://nodejs.org – wybierz „LTS”.
2. Rozpakuj folder gry, otwórz w nim terminal (Windows: w folderze kliknij pasek adresu, wpisz `cmd`, Enter).
3. Najprościej: kliknij dwa razy **START.bat** (Windows). Albo w terminalu w tym folderze wpisz `npm start`.
4. Przeglądarka otworzy `http://localhost:3000`.

Gra nie potrzebuje `npm install` – nie ma żadnych dodatkowych bibliotek do pobrania.

## Jak dołączają znajomi

**Ta sama sieć (np. jedno mieszkanie):** serwer po starcie wypisze adres w stylu `http://192.168.1.23:3000` – znajomi wpisują go w przeglądarce.

**Przez internet (polecane, darmowe): Cloudflare Tunnel**
1. Pobierz `cloudflared`: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Przy włączonej grze uruchom w drugim terminalu:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
3. Pojawi się adres `https://coś-tam.trycloudflare.com` – wyślij go znajomym (np. na Discordzie).
   Nie trzeba zakładać konta. Adres zmienia się przy każdym uruchomieniu.

Postęp ekip zapisuje się na komputerze hosta w `data/crews.json` – nie usuwaj tego pliku.

## Jak zacząć napad
1. Host: zakładka „Mam ekipę / zakładam” → nick, nazwa ekipy, hasło → „Załóż nową ekipę” (następnym razem „Zaloguj ekipę”).
2. Host podaje znajomym **kod pokoju** (kliknięcie w kod kopiuje gotowy link).
3. Znajomi: zakładka „Dołączam do pokoju” → nick + kod.
4. Każdy wybiera postać i klika „Gotowy”, host klika „Zaczynamy napad”.

## Wymagania
Komputer z w miarę nowoczesną kartą graficzną i przeglądarka Chrome, Edge lub Firefox.
Jeśli gra się tnie: Esc → wyłącz cienie, albo przejdź na widok izometryczny (T).

## Pliki
- `server/` – serwer (Node.js, bez zależności)
- `shared/` – logika ruchu i mapy, wspólna dla serwera i przeglądarki
- `public/` – gra w przeglądarce (three.js)
- `data/` – zapis ekip (tworzy się sam)

## Licencje zasobów
- three.js – licencja MIT (`public/vendor/three/LICENSE`).
- Modele `Soldier.glb` (gracze) i `Xbot.glb` (klienci, strażnicy) – z przykładów three.js (postacie i animacje z Adobe Mixamo). Modele tymczasowe, do podmiany.
- Tekstura marmuru i tło menu – grafiki dostarczone przez autorów gry.
