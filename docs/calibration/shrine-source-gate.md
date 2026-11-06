# Bramka zgodności źródła: Shrine replay vs Real C

Data: 2026-11-06. Status: **INCONCLUSIVE**. Nie zmieniono Engine V2, Real C ani D1/D2.

Zakres: jedna godzina, 2026-10-15 12:00–13:00 UTC. Porównanie pliku Shrine
`https://replay.shrine.trade/pump/2026/10/15/12.jsonl.zst` z Real C (pumpdatafun,
shardy z `sim01/real-market/sources.json`).

## Decyzje zatwierdzone przed bramką

- Shrine jest jedynym darmowym kandydatem na D1/D2 (pełne dni UTC, okres zgodny z C). HF Slinky21 odrzucony (czerwiec–lipiec, 3,38% niespójnych `sol_amount`, 7,03% NULL, pięć przełomów reżimu, inne pokrycie launchy).
- Reguła D1/D2: pełny dzień UTC w indeksie Shrine, różny od C, nieprzylegający do C ani do siebie, ten sam dzień tygodnia co C (czwartek), D1 wcześniejszy. Wynik: **D1 = 2026-10-22, D2 = 2026-10-29**. C = 2026-10-15 bez zmian.
- Indeks Shrine z 2026-11-06: 1263 godziny, 50 pełnych dni UTC. Luki: 09-27 brak 15h, 10-03 brak 02–07h.
- Licencja Shrine: strona nie podaje licencji ani regulaminu (nieustalone).

## Transfer i pliki

- Pobrano 209 996 083 B (Shrine, ta godzina). Razem z próbką schematu i indeksem ok. 214 MB.
- Shardy Real C były już lokalne w `output/sim01-pr3/data/`, SHA256 zgodne z `sources.json`. Nie pobierano ich ponownie.
- Metadane shardów (`ts`): shard 0 1792022400–1792051662, shard 1 1792051662–1792081330, shard 2 1792081330–1792101612, shard 3 1792101612–1792108799. Godzina 12 UTC leży w całości w shardzie 1.
- Pliki robocze (katalog w `.gitignore`): `output/shrine-gate/raw/2026-10-15-12.jsonl.zst`, `output/shrine-gate/work/pump-lines.ndjson`, `gate.duckdb`, `protocol-counts.json`.
- Real C otwierany wyłącznie do odczytu.

## Metoda

- Populacja SIM-01: `venue='curve'`, SOL quote, bez transakcji `failed`.
- Okno wewnętrzne `ts` 1792065602–1792069198. Pliki godzinowe Shrine dzielą zdarzenia według czasu odbioru (80 linii z 11:59:59, opóźnienie do ok. 1,9 s), dlatego obcięto po 2 s z każdego końca.
- Klucz dopasowania: `slot`/`block`, `mint`, portfel, strona, kwoty. Real C nie ma sygnatur, a Shrine nie ma `idx`.
- Jednostki: Real C `sol_lamports` (1e9), `token_amount` (1e6); Shrine wartości dziesiętne.

## Wyniki

| Miara | Wynik |
|---|---|
| Real C, wiersze krzywej (SOL, okno) | 163 249 |
| Shrine, nogi krzywej (SOL, okno) | 169 713 (106 822 standard, 62 891 MAYHEM) |
| Real C z odpowiednikiem (słaby klucz) | 163 215 (99,98%) |
| Dokładna zgodność kwoty i tokenów | 159 231 (97,54% Real, 93,8% Shrine) |
| Transakcje jednonogowe, zgodne co do rezerw | 147 949 (100%) |
| Real C bez odpowiednika w Shrine | 34 kupna (0,021%) |
| PumpSwap (osobno) | 545 335 z 547 502 (99,60%) |

Real C zawiera MAYHEM: wszystkie 62 891 nóg MAYHEM z Shrine dopasowane.

### Semantyka (zweryfikowana)

- Real C, tokeny standardowe (`PUMPFUN`): zmiana `r1` między kolejnymi wierszami tego samego `mint` = ±`sol_lamports`, zmiana `r2` = ∓`token_amount` (95 109 z 95 109 par, 100%). `r1`/`r2` to rezerwy wirtualne po transakcji.
- **Nie dotyczy tokenów `PUMPFUN_MAYHEM`:** tam rezerwa SOL (`r1`) zmienia się także poza transakcjami (sekcja „Diagnoza 2026-11-06”), rezerwa tokenów (`r2`) dalej zgodna. Wcześniejsza wersja raportu zapisywała tę zgodność bez tego zastrzeżenia, co było błędem.
- Shrine `quoteAmount` = Real C `sol_lamports` (kwota bez opłat) w 147 949 transakcjach jednonogowych.
- Shrine `quoteInPool`/`tokensInPool` = Real C `r1`/`r2` z dokładnością do 1 jednostki (maks. różnica 6e-5 lamporta, zaokrąglenie float).

## Przyczyny rozbieżności

1. **Transakcje wielonogowe (ok. 9,4% wierszy Real C).**
   - Shrine ma `quoteInPool = tokensInPool = 0` w 10 674 z 11 282 dopasowanych nóg.
   - 12-nogowe sprzedaże (628 transakcji, liczba zgodna z Real C): w 3 969 nogach ta sama liczba tokenów, ale `quoteAmount` Shrine wielokrotnie mniejszy. Real C zgadza się ze wzorem stałego iloczynu w 3966 z 3966 sprawdzonych przypadków (mediana błędu 1,5e-8), Shrine w 1.
   - Dwunogowe: w 6 459 z 13 096 nóg (49,3%) Shrine ma drugą nogę z inną kwotą i tokenami, której nie ma w Real C (np. 0,3 SOL wobec 0,296296296, stosunek 1,0125). Hipoteza o znaczeniu tej nogi sprawdzona w sekcji „Diagnoza 2026-11-06”.
2. **Brakujące zdarzenia.** 34 kupna z Real C nie ma w Shrine, rozłożone w całej godzinie. Opóźnienie dłuższe niż 2 s mogłoby przenieść je do pliku 13:00 (nie pobrano), więc nie rozstrzygnięto.
3. **Kolejność.** Shrine nie ma `idx`. Kolejność pliku zgadza się z Real C w 89,6% grup `slot`/`mint` (zła w 2 326 z 22 405 grup, 6 131 wierszy). Potrzebna reguła odtwarzania kolejności.
4. **Duplikaty.** 141 sygnatur występuje w kilku wierszach (osobne zdarzenia, nie identyczne linie). W Real C duplikatów nie badano.
5. **Reprezentacja.** Shrine nie ma flagi `failed` (tylko udane transakcje). Failed wykluczono po stronie Real C.
6. **Niezgodne przejścia rezerw w Real C** (wstępnie 38 776 z 151 326 par jednowierszowych, 25,6%). Wyjaśnione w sekcji „Diagnoza 2026-11-06” poniżej: dotyczy wyłącznie tokenów MAYHEM i wyłącznie rezerwy SOL.

## Diagnoza 2026-11-06 (na już pobranych danych, bez nowych pobrań)

Dane: ta sama godzina Shrine, shardy Real C (lokalne, tylko odczyt), `events` Real C. D1/D2 i Engine V2 nietknięte.

### 1. Niezgodne przejścia rezerw w Real C

Testy:
- **Kolejność.** Tabela rezerw posortowana po (`slot`, `idx`, `seq`) w obrębie `mint`, z poprzednikami z całego dnia (nie tylko z godziny). Dodatkowo test bez założenia kolejności: stan przed każdym wierszem (`r1 ∓ kwota`, `r2 ± tokeny`) szukany jako stan po *dowolnego* wiersza tego samego `mint`.
- **Inne zdarzenia pomiędzy wierszami.** Sprawdzono: wiersze `failed` (nie mają rezerw), wiersze z inną walutą kwotowania dla tego samego `mint` (0 przypadków dla mintów z przerwami), tabelę `events` (`create`, `boost`, `boost_init`, `pool`, `migrate`, `complete`) oraz wszystkie linie Shrine dla tych mintów (m.in. `sweep`, `curveComplete`, `PUMPSWAP`).

Wyniki (okno wewnętrzne, 163 249 wierszy krzywej SOL, w tym 1 934 pierwsze wiersze danego `mint` bez poprzednika):
- Przerwy w łańcuchu: **38 742** (wstępne 38 776 liczyło tylko transakcje jednowierszowe i poprzednika z godziny).
- **Wszystkie 38 736 z 38 742 przerw to tokeny `PUMPFUN_MAYHEM`** (691 z 860 mintów MAYHEM w godzinie). Tokeny standardowe: 95 109 z 95 109 przejść zgodnych.
- **Rezerwa tokenów (`r2`) jest w tych wierszach zgodna dokładnie** (38 736 z 38 742). Zmienia się tylko rezerwa SOL (`r1`): skoki rzędu kilku SOL między wierszami przy transakcjach po 0,01–0,06 SOL. Znak skoku zależy od strony bieżącego wiersza (po stronie kupna dodatni w 99,8%, sprzedaży ujemny w 100%).
- Kolejność jest prawidłowa: przy poprawnej kolejności łańcuch tokenów jest zgodny w 100% wierszy MAYHEM z przerwą, więc przyczyną nie jest kolejność.
- Zdarzenia `boost`: 479 w oknie dla 30 mintów, żadne nie leży pomiędzy wierszami z przerwą. Nie wyjaśniają zjawiska.
- Shrine zgłasza w dopasowanych wierszach MAYHEM te same wartości `r1` co Real C (62 891 z 62 891), więc zjawisko jest w obu źródłach, nie jest błędem jednego dekodera.

Wniosek: w tokenach MAYHEM rezerwa SOL nie jest wyznaczona wyłącznie przez widoczne transakcje. **Mechanizm nie jest wyjaśniony.** Nie wiadomo, czy to cecha mechaniki Pump.fun (np. ruch rezerwy poza transakcją), czy sposób odczytu stanu przez oba źródła. Konsekwencja dla walidacji: tożsamość „Δ`r1` = ±kwota” i test stałego iloczynu `k` można stosować tylko do tokenów standardowych. Kohortę MAYHEM trzeba raportować osobno albo wyłączyć z testów mechaniki krzywej.

### 2. Transakcje dwunogowe (kupno 0,296296296 vs 0,3 SOL)

Populacja: 6 991 transakcji PUMPFUN, wszystkie z tym samym portfelem i stroną w obu nogach (4 252 kupna, 2 739 sprzedaży). W 6 627 noga 0 zgadza się z Real C.

Testowane hipotezy i wyniki:
- **Gross/net/fee (kupno).** Noga 1 ma kwotę równą nodze 0 pomnożonej przez 1,0125 w 83,3% kupna (do 1 lamporta: 3 250 z 4 252). Konkretnie: 0,296296296 × 1,0125 = 0,3 SOL (opłata 1,25% = `CURVE_FEE_BPS` 125). Noga 0 jest więc kwotą netto (po opłacie), noga 1 wartością brutto.
- **Czy noga 1 to wykonana transakcja?** Nie. Noga 0 zgadza się ze wzorem krzywej na rezerwach z Real C w 3 433 z 3 929 sprawdzonych kupna (tokeny ±2), noga 1 w 29. Rezerwy Real C zawierają tylko jeden ruch na transakcję.
- **Co zawiera noga 1?** Kwota brutto często jest okrągła (0,3; 2,0; 1,0; 0,1; 0,005; 0,0001 SOL, 2 152 z 4 252 okrągłe do 1e-4), a liczba tokenów to ułamek tokenów wykonanych: mediana 0,90, wiele wartości okrągłych (0,75; 0,92; 0,93; 0,9875; 0,999; w 1 817 przypadkach okrągła do 2 miejsc). Przy sprzedażach tokeny równe wykonanym (98,1%), a kwota ≤ wykonanej w 2 723 z 2 739, w 720 przypadkach równa 0.
- **Hipoteza robocza:** noga 1 to parametry instrukcji (maks. koszt brutto i minimalna liczba tokenów przy kupnie, minimalna kwota przy sprzedaży), czyli limit poślizgu zadany przez użytkownika, a nie wykonana transakcja. Jest zgodna ze wszystkimi powyższymi obserwacjami, ale **niezweryfikowana**: nie mam surowych danych instrukcji transakcji (RPC jest poza zakresem projektu).
- 12-nogowe sprzedaże: kwota w nodze Shrine jest ≤ kwocie Real C w ok. 99% różniących się nóg (kwantyl 0,99 stosunku 0,29), co jest zgodne z tą samą hipotezą, ale dotyczy tylko 3 969 z 7 536 nóg (reszta zgodna dokładnie), więc nie rozstrzyga.

Reguła robocza, która nie zgaduje: dla transakcji dwunogowych używać nogi, której wartości zgadzają się z krzywą na rezerwach, albo wykluczyć transakcje wielonogowe z kohorty głównej. Nie uznawać nogi 1 za osobną transakcję.

### 3. Odtwarzanie kolejności transakcji Shrine

Metoda: dla każdej grupy (`slot`, `mint`) z co najmniej 2 wierszami budowany graf „wiersz A poprzedza B, jeśli stan tokenów przed B = stan po A” (tolerancja 1 jednostka mikro-tokena). Grupa jest rozstrzygnięta tylko wtedy, gdy grafy tworzą jedną ścieżkę przez wszystkie wiersze (n−1 połączeń, każdy wiersz ma najwyżej jednego następcę i poprzednika) i nie zawiera transakcji wielonogowych ani wierszy z rezerwą 0. Pozostałych grup nie porządkowano.

Wyniki (okno wewnętrzne):

| Miara | Wynik |
|---|---|
| Grupy (`slot`, `mint`) z ≥2 wierszami | 26 011 (85 344 wiersze) |
| Zawierają transakcje wielonogowe lub rezerwę 0 (nierozstrzygalne) | 5 538 (29 495 wierszy, 34,6%) |
| Rozstrzygnięte jednoznacznie | 20 460 |
| Niejednoznaczne lub z przerwami | 13 |
| Rozstrzygnięte i porównane z Real C | 20 459, kolejność zgodna w 20 459 (100%) |
| Kolejność pliku Shrine w tych samych grupach | zgodna w 18 418 (90,0%) |

- Łańcuch rezerw tokenów odtwarza kolejność w obrębie `mint` bez błędu tam, gdzie jest jednoznaczny. Kolejność pliku jest gorsza.
- Nierozstrzygalne grupy zostają bez kolejności. Tam nie ma deterministycznej reguły i nie wolno jej zgadywać.
- **Kolejność globalna między mintami w obrębie `slot` nie jest odtwarzalna z rezerw** (rezerwy są per `mint`). Kolejność pliku zgadza się z `idx` Real C w 86,1% sąsiednich par (142 677 par, 122 861 zgodnych, 15 825 niezgodnych). Czas odbioru `localTimestamp` nie poprawia tego (122 867 zgodnych).
- Metoda działa na rezerwach tokenów, więc obejmuje także tokeny MAYHEM (rezerwa tokenów jest tam zgodna).

### Zastosowane testy i ograniczenia

- Wszystkie testy to zapytania DuckDB 2.0.0 na `output/shrine-gate/work/gate.duckdb` oraz tylko-do-odczytu na shardach Real C. Nie powstał nowy kod w repo.
- Jedna godzina, jedna doba. Wnioski o MAYHEM i o parametrach instrukcji mogą się zmienić na innych godzinach i po zmianach mechaniki.
- Brak surowych transakcji: hipotezy o nodze 1 i o skokach rezerwy SOL w MAYHEM nie zostały zweryfikowane na poziomie instrukcji.
- Brak pliku sąsiedniej godziny: 34 brakujące kupna z Real C nadal bez rozstrzygnięcia.
- Licencja Shrine nadal nieustalona.

## Werdykt: INCONCLUSIVE

- Zgodność jednonogowa, tokeny standardowe: **PASS** (147 949 wierszy, kwoty, tokeny i obie rezerwy; łańcuch rezerw 100%).
- Tokeny MAYHEM: rezerwa SOL niewyjaśniona, test krzywej nie stosuje się.
- Wielonogowe: noga 1 prawdopodobnie parametry instrukcji (niezweryfikowane); do czasu weryfikacji osobna kohorta lub wykluczenie.
- Kolejność: odtwarzalna per `mint` w 78,7% grup z ≥2 wierszami (20 460 z 26 011), reszta nierozstrzygalna; globalnie w obrębie `slot` nie.

Warunki przejścia do PASS (przed zamrożeniem D1/D2):

1. Zamrozić regułę dla transakcji wielonogowych: jedna noga zgodna z krzywą albo wykluczenie.
2. Zamrozić regułę kolejności: łańcuch rezerw tokenów tam, gdzie jednoznaczny, grupy nierozstrzygalne oznaczone, a nie porządkowane.
3. Zamrozić zasadę dla MAYHEM: osobna kohorta, bez testu krzywej SOL.
4. Powtórzyć na drugiej godzinie z innej części dnia 15.10 i z plikiem sąsiedniej godziny dla granicy.
5. Ustalić licencję Shrine.

## Jak odczytać jedną transakcję

Kupno w `slot` 457229768, `mint` `FnSScimW…` (Real C `idx` 881; Shrine sygnatura `3HySDs6n…`):

- Kwota bez opłat: `sol_lamports` 48 888 888 = 0,048888888 SOL; Shrine `quoteAmount` 0,048888888. Tokeny: `token_amount` 980 731 570 578 (÷1e6 = 980 731,570578); Shrine `tokenAmount` 980731,570578.
- Rezerwy przed: SOL 40,033675856, tokeny 804 073 053,927949.
- Rezerwy po: SOL 40,082564744, tokeny 803 092 322,357371 (Shrine: `quoteInPool`, `tokensInPool`).
- Kontrola: 40,033675856 + 0,048888888 = 40,082564744; 804 073 053,927949 − 980 731,570578 = 803 092 322,357371.
- k = 40,082564744 × 803 092 322,357371 ≈ 3,219 × 10¹⁰ = 32,19 mld, zgodne z `curveConstants.ts`.
- Zasada: kupno zwiększa `r1` o kwotę i zmniejsza `r2` o tokeny; sprzedaż odwrotnie.

## Rejestracja kryteriów końcowej walidacji (zapisana przed pobraniem nowych plików)

Status: kryteria zamrożone przed obejrzeniem jakichkolwiek danych z drugiej godziny. Wcześniej sprawdzono tylko rozmiary plików (nagłówki HTTP) i dane godziny 12:00 UTC, które już wcześniej analizowano. Nie dotyczy D1/D2, nie dotyczy Engine V2.

### Wybór drugiej godziny

Reguła niezależna od wyników: godzina najbardziej odległa w cyklu dobowym od 12:00 UTC, z wyłączeniem godzin brzegowych doby (00 i 23, bo granica doby Real C zmienia pokrycie: tokeny sprzed doby i launch po 23:30 poza populacją główną). Odległość 12 h to 00:00 (wykluczona), następnie 01:00 i 23:00 (po 11 h); remis rozstrzygnięty wcześniejszą godziną. **Wybrana godzina: 2026-10-15 01:00–02:00 UTC.** Leży w shardzie 0 Real C (lokalnym). Nie sprawdzałem żadnych wyników ani wolumenu tej godziny.

### Pliki potrzebne do granicy plików

Zdarzenie o czasie bloku w godzinie H może trafić do pliku H+1, jeśli dotrze po jej końcu (opóźnienie odbioru do ok. 2 s w godzinie 12:00). Dla okna [H, H+1) potrzebne są pliki H i H+1. Godzina 12:00 ma plik 12 lokalnie, potrzebny dodatkowo plik 13.

| Plik | Rozmiar (HTTP `Content-Length`) |
|---|---|
| `2026/10/15/01.jsonl.zst` | 266 272 064 B |
| `2026/10/15/02.jsonl.zst` | 282 639 966 B |
| `2026/10/15/13.jsonl.zst` | 244 039 984 B |
| Razem | 792 952 014 B (ok. 793 MB) |

### Definicje populacji

- **Tokeny STANDARD:** `mint`, dla którego w plikach Shrine danej godziny nie występuje żaden wiersz `PUMPFUN_MAYHEM`. Podział jest per `mint`, bo 174 mintów w godzinie 12:00 miało wiersze obu etykiet, a podpis podaży z tabeli `events` nie odróżnia MAYHEM (wszystkie zdarzenia `create` w obserwowanej próbce mają podaż 1e15).
- Real C: wiersze `venue='curve'`, SOL, nie `failed`, w oknie [H, H+1), tylko na mintach STANDARD (klasyfikacja z Shrine). Shrine: nogi `PUMPFUN` na tych samych mintach.
- **MAYHEM:** raportowany osobno, bez kryteriów PASS/FAIL i bez udziału w benchmarku STANDARD.
- Transakcje wielonogowe: osobna kohorta, nie liczą się do G2 i G3.

### Kryteria (każde liczone osobno dla obu godzin: 12:00 i 01:00 UTC)

| ID | Miara | PASS | FAIL | W przeciwnym razie |
|---|---|---|---|---|
| G1 | Real STANDARD bez odpowiednika w Shrine (pełne okno, pliki H i H+1, słaby klucz `slot`/`mint`/portfel/strona) | ≤ 0,05% | > 0,2% | INCONCLUSIVE |
| G1b | Shrine STANDARD (transakcje jednonogowe) bez odpowiednika w Real C | ≤ 0,05% | > 0,2% | INCONCLUSIVE |
| G2 | Transakcje jednonogowe: dokładna zgodność kwoty (lamporty) i tokenów (mikro-jednostki) | ≥ 99,9% | < 99% | INCONCLUSIVE |
| G3 | Zgodnych par z G2: rezerwy po transakcji `r1`, `r2` w granicach 1 jednostki | ≥ 99,9% | < 99% | INCONCLUSIVE |
| G4 | Real C STANDARD: przejścia rezerw w obrębie `mint` spełniają Δ`r1` = ±kwota i Δ`r2` = ∓tokeny (bez pierwszych wierszy) | ≥ 99,9% | < 99% | INCONCLUSIVE |
| G5 | Rozpoznawalność transakcji wielonogowych: Shrine `nlegs>1` ⇔ wiele wierszy Real C o tym samym (`slot`,`idx`), dla zgodnych transakcji | ≥ 99% zgodności | < 95% | INCONCLUSIVE |
| G5b | Udział wierszy Real C STANDARD w transakcjach wielonogowych (informacja, bo kohorta jest wykluczana z benchmarku) | ≤ 10% | > 25% | INCONCLUSIVE |
| G6 | Kolejność: grupy (`slot`,`mint`) z ≥2 wierszami bez transakcji wielonogowych, rozstrzygnięte jednoznacznie łańcuchem rezerw tokenów | rozstrzygnięte ≥ 99% grup i 0 błędnych względem Real C | jakikolwiek błąd w rozstrzygniętej grupie (> 0,01% grup) | INCONCLUSIVE |

Kolejność G6: kolejność wewnątrz `mint` w obrębie `slot`. Kolejność globalna między mintami nie jest wymagana do kalibracji STANDARD i nie jest kryterium.

### Werdykt

- **Dane:** PASS, jeśli wszystkie kryteria są PASS w obu godzinach. FAIL, jeśli którekolwiek kryterium jest FAIL w którejkolwiek godzinie. W pozostałych przypadkach INCONCLUSIVE.
- **Licencja:** nie jest mierzalna z danych. Strona Shrine nie podaje licencji ani regulaminu. Bez pisemnego warunku użycia werdykt końcowy to najwyżej „PASS technicznie, licencja nieustalona”, a nie bezwarunkowy PASS.
- Dwie godziny z jednej doby nie dowodzą stabilności na innych dniach (D1/D2). Werdykt dotyczy wyłącznie przydatności Shrine jako źródła o zbadanych własnościach, nie tego, że D1 i D2 będą kompletne.
