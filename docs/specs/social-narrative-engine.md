# MEMEX-SIM — Social Narrative & Crowd Reaction Engine

**Status:** `[REF]` — dokument przekazania wymagań i decyzji projektowych  
**Data:** 2026-11-06  
**Przeznaczenie:** kontekst dla nowego silnika symulacji MEMEX-SIM i pracy z Codexem  
**Źródło:** uzgodnienia i przykłady z rozmowy o postach X, memecoinach, konkurencji narracji oraz reakcjach rynku  
**Stan wdrożenia:** ten dokument opisuje **koncepcję**, nie potwierdza implementacji. W poprzedniej rozmowie przygotowano propozycję PR „Social Event Foundation”, ale nie ma tutaj potwierdzenia jego wykonania ani merge'a.

> **Główna teza:** w MEMEX-SIM posty nie mają być ozdobą wykresów. Są zdarzeniami w symulowanym świecie, które mogą uruchamiać narracje, prowokować tworzenie kilku tokenów, zmieniać zainteresowanie tłumu i — **wyłącznie poprzez handel** — wpływać na wolumen, cenę, bonding curve oraz prawdopodobieństwo migracji. Dobry post nie gwarantuje wzrostu. Wynik ma być emergentny, a nie z góry zapisany.

---

## 1. Co dokładnie chcemy osiągnąć

MEMEX-SIM ma być symulatorem **rynku memecoinów napędzanego narracją**, nie tylko generatorem świec. Użytkownik powinien uczyć się:

1. Rozpoznawać, które posty i motywy mogą zainteresować traderów.
2. Rozpoznawać autorów i wyciągać wnioski o ich historycznym wpływie, wiarygodności oraz zachowaniu ich odbiorców.
3. Oceniać timing: kto jako pierwszy wypuścił token powiązany z wydarzeniem, kiedy do narracji dołączają następni traderzy i kiedy zainteresowanie wygasa.
4. Rozumieć, że **jedno wydarzenie może prowadzić do kilku konkurujących tokenów**.
5. Widzieć różnice między natychmiastowym viralem, opóźnionym odkryciem („slow cooker”), pustym hype'em, fałszywym newsem, drugą falą oraz wygasaniem narracji.
6. Obserwować realne mechanizmy wewnętrznego rynku: napływ kupna, realizację zysków, sprzedaż w panice, zmiany płynności, starcie o migrację i zachowanie po migracji.
7. Podejmować decyzje w warunkach niepewności. Nie ma gwarantowanego „dobrego” tokena tylko dlatego, że post wygląda mocno.

**Niezmiennik:** wzrost/spadek cen ma wynikać z przepływu zleceń i mechaniki rynku, nie z ustawienia `price *= 3` po publikacji posta ani z odtwarzania z góry zadanej ścieżki świec.

---

## 2. Co uzgodniono, a co pozostaje propozycją

### Ustalone założenia kierunkowe

- Na start **nie potrzeba prawdziwego API X**. Symulujemy posty, autorów, media, reposty i cytaty lokalnie.
- **Fikcyjni autorzy są podstawą świata MEMEX**. Można dodać okazjonalnie znane postacie, np. Elon Musk, Donald Trump lub konto instytucji publicznej — ale zawsze jako **wyraźnie symulowane** publikacje, nie jako prawdziwe, potwierdzone wypowiedzi.
- Użytkownik ma **sam odkrywać reputację profili** po czasie na rynku. Nie wyświetlamy mu od startu sekretnego parametru „ten autor zawsze powoduje pump”.
- Nie tworzymy ręcznie tysięcy statycznych tweetów. Potrzebny jest **generator kompozycyjny**: autorzy + spójne tematy + warianty tekstów + obrazy + zdarzenia.
- Jeden **post źródłowy** może mieć wiele **postów pochodnych**, a każdy z nich może inspirować jeden lub kilka tokenów.
- **Jeden temat/narracja** może przez pewien czas wpływać na wiele tokenów jednocześnie, także tych powstałych później.
- Post może wywołać natychmiastowy ruch, opóźniony ruch, drugi impuls albo **zero istotnej reakcji**.
- Ważne są także **retweety/reposty/quote-posty**, które ponownie rozpowszechniają stary temat.
- Migracja jest zarówno mechanicznym etapem tokena, jak i **punktem zainteresowania traderów**; po migracji możliwy jest dump, kontynuacja albo nowa fala.
- Efekty narracji nie powinny obchodzić normalnych reguł handlu, ryzyka, ekonomii tokena i lifecycle.

### Propozycje, których jeszcze nie zweryfikowano

- Startowa biblioteka **około 10 fikcyjnych autorów, 12 rodzin wydarzeń, 60 wariantów tekstu, 30 obrazów** — to **rozmiar MVP**, nie wymóg empiryczny.
- Poszczególne parametry narracji, np. `virality`, `complexity`, `discoveryDelay`, `trust`, `attentionDecay`, `rediscoveryChance`, `audienceReach` — to projektowane zmienne, a nie skalibrowane wielkości.
- Liczby tokenów po jednym poście, ich czasy launchu, zasięgi i prawdopodobieństwa reakcji — do eksperymentów i późniejszej kalibracji.
- Konkretny podział zainteresowania między 5 tokenów, pokazywany wcześniej w rozmowie, był **ilustracją**, nie danymi historycznymi.
- Wcześniej zaproponowano etapowe PR-y; dla **budowy nowego silnika** ważniejsza jest integracja kontraktów od początku niż ślepe przeniesienie starego planu PR 1 → PR 2 → PR 3.

---

## 3. Obserwowane wzorce rynku — przypadki do odtwarzania

Nie chcemy na sztywno przypisywać tokenowi skryptu „pump and dump”. Poniżej są **obserwowalne klasy wyników**, które powinny naturalnie występować przy odpowiednich warunkach rynku i zachowaniach tłumu.

### 3.1. `FAST_VIRAL` — natychmiastowe zainteresowanie

- Silny, łatwy do zrozumienia post lub obraz.
- W krótkim oknie pojawiają się powiązane tokeny.
- Wczesny napływ kupujących, szybki wzrost aktywności.
- Jeden token może zgarnąć większość kapitału, pozostałe dostają krótki pump i zanikają.
- Wynik nie jest gwarantowany: może nie wystarczyć płynności, może przyjść wczesny sell, temat może się nie przyjąć.

### 3.2. `FAST_MIGRATE_THEN_DUMP` — szybka migracja i zrzut

- Narracja wywołuje bardzo mocny impuls zakupowy.
- Token może dotrzeć do migracji w **kilka–kilkanaście sekund** (użytkownik opisywał nawet około 10 świec przy krótkim TF).
- Następuje silna realizacja zysków natychmiast po migracji.
- Migracja jest częściowo **celem traderów**; po jego osiągnięciu część popytu znika.
- Trzeba to modelować przez przepływ kupujących/sprzedających, a nie automatyczny dump „bo migration”.

### 3.3. `FAILED_MIGRATION` — prawie migracja, potem śmierć

- Dobry post, bardzo mocny start lub stopniowy wzrost.
- Token zbliża się do progu migracji, lecz nie spełnia wymogów lub traci napływ kapitału.
- Sprzedaż prowadzi do spadku w okolice podłogi / wygaśnięcia aktywności.
- **Dobry news nie oznacza, że token musi przeżyć.**

### 3.4. `SLOW_COOKER` — opóźnione odkrywanie narracji

To osobna, bardzo ważna obserwacja użytkownika:

1. Pojawia się **dobry, ale nieoczywisty** news: długi tekst, trudniejszy do zinterpretowania kontekst lub materiał wymagający przeczytania.
2. Na początku prawie nikt nie reaguje, albo reakcja jest słaba.
3. Token zaczyna powoli zyskiwać tempo: niewielkie impulsy, korekty, kolejne próby.
4. Może dojść do silnej wyprzedaży, nawet w okolice bardzo niskiej aktywności.
5. Później następuje ponowne zainteresowanie: odkrycie przez kolejnych traderów, komentarz znanego autora, repost lub samonapędzające się momentum.
6. Token podejmuje drugą próbę wzrostu, czasem migracji.
7. Po migracji może nastąpić kolejny boom albo dump.

**Ważna różnica:** dobry news z zerową reakcją przez cały czas to **nie to samo** co slow cooker. System musi umieć wygenerować obie sytuacje.

### 3.5. `SECOND_WAVE` — repost i odnowienie zainteresowania

- Pierwotny post tworzy pewną narrację, token zyskuje, później słabnie.
- Po czasie bardziej rozpoznawalny autor **repostuje lub cytuje** ten sam post.
- Stara narracja staje się ponownie widoczna dla części tłumu.
- Powiązane, nadal istniejące tokeny mogą dostać kolejny impuls popytowy; może też powstać nowy konkurent.
- Siła reakcji zależy od jakości repostu, zasięgu, zmęczenia tematem i stanu tokenów.

### 3.6. `FAKE_HYPE` — fałszywa lub błędnie zinterpretowana wiadomość

- Fake, podszywanie się, przerobiony obraz, plotka lub post źle zrozumiany przez odbiorców.
- Początkowy popyt może być nawet silny.
- Z opóźnieniem pojawiają się sceptycy, korekty informacji, wyjaśnienia, sprzedaż.
- Nie zakładamy z góry, że fake zawsze od razu zostanie wykryty albo zawsze kończy się dumpem.

### 3.7. `LOW_RESPONSE` — dobry post, brak zainteresowania

- Autor lub treść teoretycznie ma potencjał.
- Zdarzenie trafia na „martwy” rynek, ma słabą dystrybucję, przegrywa konkurencję uwagi lub zostaje zignorowane.
- Nic wielkiego się nie dzieje. **To konieczne dla realizmu.**

### 3.8. `NARRATIVE_FORK` — jedna narracja, nowa fraza i nowy token

- Post pochodny jest **nie tylko repostem**: wnosi nowe słowo, cytat, żart albo interpretację.
- Ta fraza staje się osobnym kandydatem na nazwę i ticker tokena.
- Narracja pozostaje powiązana z rodzicem, ale tokeny nie muszą reagować identycznie.

---

## 4. Konkretny przykład z rozmowy: CASE-001

Użytkownik udostępnił cztery zrzuty ekranu pokazujące **dwa powiązane posty i dwa tokeny**, będące częścią tego samego memowego kontekstu.

- Około **16:05**: pierwszy post z obrazem banknotów, tekst „GENNY THE DOLLAR BILLS ARE A MEME??” — **źródło**.
- Około **16:07**: drugi post, odnoszący się do wcześniejszego kontekstu, z własną rozpoznawalną frazą („ITS PARANOIA NOT PARANOLA ...”) — **pochodna / fork narracji**.
- Drugi token jest powiązany z **drugim postem**, a nie bezpośrednio z pierwszym.
- Na udostępnionych wykresach były różne dynamiczne przebiegi; wcześniej szacowano szczyty market cap w okolicach **48 tys. USD i 58 tys. USD**, ale sam obraz nie potwierdza pełnej przyczynowości, dokładnych cen ani całej historii rynku.

**Model referencyjny:**

```text
Narrative N-001
  └─ Post P-001 (obraz + tekst, ~16:05)
       ├─ Token T-001 (motyw oryginału)
       └─ Post P-002 (nowa fraza / interpretacja, ~16:07)
            └─ Token T-002 (motyw postu pochodnego)

N-001 może napędzać oba tokeny,
ale P-002 może dodatkowo wzmacniać T-002.
```

Nie wolno zakładać, że jeden post = jeden token ani że dwa posty = dwie niezależne narracje.

---

## 5. Logiczny model świata

### 5.1. Autorzy (`SocialAuthor`)

Autorzy powinni mieć rozpoznawalny charakter, np.:

- konto tworzące memy i obrazki,
- konto analizujące trendy,
- wpływowy degen / influencer,
- konto newsowe,
- sceptyk demaskujący fake'i,
- mały anonimowy profil publikujący dziwne treści,
- bot/noise account,
- duża fikcyjna osobistość z szerokim zasięgiem,
- opcjonalnie wyraźnie symulowana prawdziwa osoba/instytucja.

**Co opisuje autora:** identyfikator, nazwa, handle, awatar, typ tematów, styl tekstu, wielkość i segmenty odbiorców, bazowa wiarygodność, częstotliwość publikacji, charakter reakcji odbiorców, możliwość repostu i quote-postu.

**Reputacja jest rozpoznawana przez użytkownika**, nie gwarantuje wyników. Może się zmieniać w czasie: autor „trafny” w jednym reżimie rynku może zostać zignorowany w innym. Pozostawiamy przestrzeń na błędną ocenę użytkownika.

### 5.2. Narracja (`Narrative`)

To **wspólny temat**, który może przetrwać wiele postów i wiele tokenów.

- Stabilny `narrativeId`.
- Motyw(y), słowa kluczowe, media, kontekst i pochodzenie.
- Relacje parent/child: nowa fraza może tworzyć **sub-narrację / fork**.
- Czas startu i ostatniej aktywności.
- Dynamika zainteresowania, zmęczenie, szansa ponownego odkrycia.
- Lista powiązanych postów i tokenów.
- Stan jest aktualizowany zdarzeniami, nie przechowywany wyłącznie w UI.

### 5.3. Post (`SocialPost`)

Konkretny komunikat użytkownika sieci społecznościowej:

- `postId`, `authorId`, `narrativeId`, czas symulacji.
- Typ: `ORIGINAL`, `REPLY`, `REPOST`, `QUOTE`, `CORRECTION`.
- Treść, tematy, opcjonalne obrazy, link do oryginału.
- Rozróżnienie treści **źródłowej** i komentarza do źródła.
- Jawna etykieta „simulated”, szczególnie przy nazwiskach prawdziwych ludzi.
- Reakcje i zasięg nie są liczbami losowanymi niezależnie od reszty świata: powinny być wynikiem modelu dystrybucji uwagi.

### 5.4. Wydarzenie (`SocialEvent`)

Wydarzenie to fakt w **symulowanym świecie**: post opublikowany, repost, odkrycie, sprostowanie, viral, wzmianka influencera, zmiana sentymentu. Nie każde wydarzenie musi tworzyć widoczny post; nie każdy post musi mieć wpływ na rynek.

### 5.5. Link narracja–token (`TokenNarrativeLink`)

Potrzebny jawny związek:

- który token jest połączony z jaką narracją,
- który konkretny post był **inspiracją launchu**,
- czy token jest oryginałem, klonem, naśladowcą, fork'iem frazy,
- kiedy powstał względem posta,
- jak silny jest związek tematyczny,
- czy dany post wzmacnia także starsze tokeny.

Związek narracyjny i mechaniczny wpływ na flow to różne pola — samo przypięcie tweeta do tokena nie jest źródłem popytu.

---

## 6. Proponowane kontrakty danych (szkic, nie obowiązkowe API)

Poniższe typy to **punkt wyjścia**. Nazwy i podział odpowiedzialności trzeba dostosować do architektury nowego silnika.

```ts
type SimTimeMs = number;
type NarrativeId = string;
type SocialPostId = string;
type SocialEventId = string;
type SocialAuthorId = string;
type TokenId = string;

type PostKind =
  | 'ORIGINAL'
  | 'REPLY'
  | 'REPOST'
  | 'QUOTE'
  | 'CORRECTION';

type SocialEventKind =
  | 'POST_PUBLISHED'
  | 'POST_REPOSTED'
  | 'POST_QUOTED'
  | 'NARRATIVE_DISCOVERED'
  | 'NARRATIVE_REDISCOVERED'
  | 'MISINFORMATION_CHALLENGED';

interface SocialAuthor {
  id: SocialAuthorId;
  handle: string;
  displayName: string;
  avatarAssetId?: string;
  fictional: boolean;
  topics: string[];
  styleId: string;
  audienceProfileId: string;
  baselineCredibility: number; // parametr ukryty przed graczem
  postingCadenceId: string;
}

interface SocialPost {
  id: SocialPostId;
  narrativeId: NarrativeId;
  authorId: SocialAuthorId;
  createdAtSimMs: SimTimeMs;
  kind: PostKind;
  parentPostId?: SocialPostId;
  body: string;
  mediaAssetIds: string[];
  topicTags: string[];
  simulated: true;
}

interface SocialEvent {
  id: SocialEventId;
  narrativeId: NarrativeId;
  occurredAtSimMs: SimTimeMs;
  kind: SocialEventKind;
  postId?: SocialPostId;
  parentEventId?: SocialEventId;
}

interface TokenNarrativeLink {
  tokenId: TokenId;
  narrativeId: NarrativeId;
  sourcePostId?: SocialPostId;
  relation: 'ORIGINAL' | 'COPYCAT' | 'FORK' | 'RELATED';
  createdAtSimMs: SimTimeMs;
  relevance: number; // 0..1, do kalibracji
}

interface NarrativeRuntimeState {
  narrativeId: NarrativeId;
  awarenessByAudience: Record<string, number>;
  engagementByAudience: Record<string, number>;
  fatigueByAudience: Record<string, number>;
  lastActivitySimMs: SimTimeMs;
}

interface SocialPressure {
  tokenId: TokenId;
  simTimeMs: SimTimeMs;
  ttlSimMs: number;
  audienceSegment: string;
  expectedNewParticipants: number;
  buyIntent: number;    // znormalizowany sygnał, nie zlecenie
  sellIntent: number;   // znormalizowany sygnał, nie zlecenie
  sourceEventId: SocialEventId;
}
```

**Ważna granica odpowiedzialności:** `SocialPressure` nie jest zmianą ceny. Moduł zachowań traderów musi zamienić go w **konkretne wejścia/wyjścia uczestników**, zgodne z aktualnym modelem płynności, fee, slippage i execution. Schemat można uprościć, ale nie wolno zgubić tej separacji.

### Przykładowa definicja scenariusza (dane, nie wynik rynku)

```json
{
  "scenarioId": "viral-picture-001",
  "family": "ODD_IMAGE",
  "authorArchetypes": ["meme_creator", "high_reach"],
  "topics": ["duck", "yellow", "animal"],
  "textVariants": ["🐤", "What is this thing?", "Why is everyone posting this duck?"],
  "mediaTags": ["yellow-duck"],
  "distribution": {
    "initialReachClass": "high",
    "interpretationDelayClass": "short"
  },
  "launchReaction": {
    "canSpawnMultipleTokens": true,
    "canSpawnNoTokens": true
  }
}
```

Nie zapisujemy `winnerTokenId`, `targetMcap`, `pumpPercentage`, `migrationGuaranteed` ani przebiegu świec w katalogu scenariuszy.

---

## 7. Architektura nowego silnika — ważne od pierwszego dnia

```text
Scenario Catalog + Authors + Media
                │
                ▼
        Social Event Scheduler  ── (czas symulacji, seed, cooldown)
                │
                ▼
          Narrative Graph
    (root posts / replies / forks / reposts)
                │
                ▼
     Awareness & Crowd Reaction
 (segmenty odbiorców, opóźnienia, FOMO,
  sceptycyzm, realizacja zysków, zmęczenie)
                │
           ┌────┴────┐
           ▼         ▼
   Token Launches   Existing Tokens
           │         │
           └────┬────┘
                ▼
       Token Attention Allocation
    (konkurencja o ograniczony kapitał)
                │
                ▼
          Actor / Trade Engine
     (BUY/SELL, rozmiar, timing, latency)
                │
                ▼
        Market / Curve / Execution
        (price, volume, migration)
                │
                ▼
         Market Feedback Events
 (momentum, dump, migracja, utrata zainteresowania)
                │
                └────→ z powrotem do Crowd Reaction

UI / Pulse / TokenPage odczytuje snapshoty i posty.
UI nie tworzy ani nie rozstrzyga zdarzeń rynkowych.
```

### Zasada wpływu

- Zdarzenie X → dociera do **konkretnej publiczności**, z opóźnieniem i ograniczonym zasięgiem.
- Część odbiorców ignoruje temat; część widzi, lecz nie handluje; część kupuje, część już posiada tokeny i sprzedaje.
- Sygnał narracji może zwiększać **napływ traderów**, zmieniać proporcję buy/sell, średni rozmiar zlecenia, częstość dużych zleceń i skłonność do realizacji zysków.
- Przy wielu tokenach popyt **nie może być duplikowany bez końca**. Ta sama grupa traderów nie ma nieskończonego budżetu na wszystkie kopie tematu.
- Rzeczywisty wynik liczy **silnik rynku**. Zdarzenie nie wstrzykuje bezpośrednio market cap ani świec.
- Feedback z ceny/flow może wzmocnić lub osłabić uwagę, ale powinien mieć limity, żeby uniknąć niekontrolowanej dodatniej pętli.

### Uwaga techniczna dla nowego silnika

Nowy core powinien **już teraz** udostępniać interfejsy integracyjne, nawet jeśli Social Engine powstanie później:

```ts
interface SimulationHooks {
  onSocialEvent(event: SocialEvent): void;
  onTokenLaunched(tokenId: TokenId, at: SimTimeMs): void;
  onTradeExecuted(tokenId: TokenId, trade: unknown): void;
  onTokenLifecycleChanged(tokenId: TokenId, phase: string, at: SimTimeMs): void;
}
```

To szkic kontraktu, nie sugestia dosłownego użycia `unknown` w produkcji. Warto oprzeć integrację o kolejkę zdarzeń, immutable event IDs i jawny czas symulacji. **Nie łączyć logiki postów bezpośrednio z komponentami React/Zustand UI.**

---

## 8. Jak ma działać konkurencja wielu tokenów o jedną narrację

### Podstawowe reguły

1. Narracja może w ogóle **nie wygenerować tokena**.
2. Jeden post może zainspirować **kilka launchy** w krótkim oknie czasowym.
3. Post pochodny może wygenerować dalszego konkurenta w tej samej narracji.
4. Pierwszy token często ma przewagę czasu, ale **nie zawsze wygrywa**.
5. Przewagę może przejąć późniejszy token (lepsza nazwa, obraz, timing, płynność, pierwsze zakupy, wiarygodność deva, mniej sprzedaży, wpływ odbiorców drugiego posta).
6. Użytkownik może zobaczyć, że jeden token przechodzi do Final Stretch i migruje, a konkurenci tracą zainteresowanie.
7. Alternatywnie żaden nie migruje albo dwa niezależnie osiągają sukces.
8. Po kolejnej publikacji budżet uwagi może przesunąć się **między istniejącymi tokenami** lub uruchomić nowy launch.

### Rozdział uwagi i kapitału

Warto rozdzielić:

- **Narrative awareness** — ile osób w świecie symulacji w ogóle zna temat.
- **Tradable attention** — jaka część tych osób szuka z nim związanej okazji.
- **Capital/flow budget** — ile zleceń mogą rzeczywiście wygenerować uczestnicy.
- **Allocation** — które tokeny przyciągają te zlecenia.

Przykładowe czynniki alokacji: czas launchu, siła powiązania z postem, obecny impet, aktywność transakcyjna, koszty wejścia, rozproszenie zainteresowania, aktualna płynność, doświadczenie i preferencje traderów.

**Nie narzucać** reguły „pierwszy token zawsze migruje”. Taki wynik może być częsty przy określonych parametrach, ale musi być falsyfikowalny.

---

## 9. Model zachowania tłumu (`Crowd Reaction Engine`)

Sugerowane **role/segmenty**, nie koniecznie osobna pełna instancja AI dla każdego portfela:

- **Fast snipers:** szybko reagują na nowe tickery/launch, szybko też realizują zyski.
- **Narrative hunters:** szukają zgodności tokena z postem, a nie tylko ruchu ceny.
- **Momentum traders:** dołączają po wzroście obrotów/wykresu, czasem spóźnieni.
- **Late retail / FOMO:** wchodzą po szerszej dystrybucji informacji.
- **Skeptics:** ignorują lub sprzedają po wykryciu niezgodności i fake'ów.
- **Profit takers:** realizują zyski przed migracją i po niej.
- **Longer-horizon believers:** pozwalają istnieć powolnym trendom / drugiej fali.
- **Developers/insiders:** ich zachowania wpływają na wiarygodność i ryzyko rug / dump.

Do każdego segmentu można przypisać opóźnienie zobaczenia informacji, próg wiarygodności, reakcję na FOMO, tolerancję strat, budżet transakcyjny, chęć trzymania i powód wyjścia.

**W pierwszej wersji wystarczą zagregowane kohorty** generujące rzeczywiste syntetyczne trade'y. Duża liczba agentów nie jest celem samym w sobie; ważna jest wiarygodność transakcji i stabilność obliczeniowa.

### Kluczowe mechanizmy

- **Attention propagation:** od publikacji do konkretnych grup odbiorców; łatwy obraz często rozchodzi się szybciej niż długi tekst, ale bez sztywnej gwarancji.
- **Discovery delay:** część publiczności reaguje po kilkudziesięciu sekundach/minutach; warunek konieczny dla slow cookera.
- **Social proof:** powstające tokeny, liczba transakcji i widoczny wzrost mogą przyciągać kolejnych kupujących.
- **Exhaustion and profit taking:** wcześniejsi kupujący sprzedają, brak nowych kupujących osłabia ruch.
- **Narrative fatigue:** powtarzane posty mogą dawać coraz mniejszą reakcję.
- **Reawakening:** repost, nowy kontekst lub powrót trendu może odwrócić zmęczenie, ale nie zawsze.
- **Skepticism/fact checking:** fake może być początkowo kupowany i później zakwestionowany.
- **Regime sensitivity:** ten sam post przy różnym tempie rynku, porze, dostępnej płynności i konkurencji daje inny wynik.

**Długa treść nie może automatycznie oznaczać slow cookera** — to tylko jedna z cech, która może zwiększać opóźnienie interpretacji. Inne zmienne mogą go przyspieszyć lub całkowicie wygasić.

---

## 10. Migracja jako zdarzenie rynkowe i społeczne

W poprzedniej rozmowie szczególnie podkreślono, że migracja jest **wyznacznikiem celu** dla części traderów memecoinowych.

Nowy silnik musi jednocześnie obsłużyć:

- **Pre-migration chase:** część uczestników kupuje z nadzieją, że token osiągnie próg migracji.
- **Near-miss:** popyt znika tuż przed progiem; sprzedaż cofa progres.
- **Migration celebration / discovery:** migracja staje się nowym sygnałem, przyciąga nowych uczestników.
- **Sell the event:** ta sama migracja uruchamia realizację zysków i gwałtowny spadek.
- **Post-migration continuation:** dzięki nowym kupującym lub kolejnemu postowi trend może trwać.

**Reguły przejścia fazy wynikają z rzeczywistego mechanizmu krzywej i warunków rynku.** Social Engine może wpłynąć na zlecenia, które przybliżają migrację, ale nie może jej „przestawić flagą”, jeśli token nie spełnia wymagań.

---

## 11. Slow cooker i ponowne ożywienie wygasłych tokenów

Nowy silnik **musi rozróżnić**:

- token aktywny,
- token słaby / bez widocznych transakcji,
- token **uśpiony**, który nadal istnieje i może przyjąć nowy napływ kupujących,
- token rzeczywiście martwy/rugged/terminalny, który nie powinien magicznie wracać do życia tylko dlatego, że pojawił się repost.

Dla uśpionych tokenów można użyć taniej symulacji i **reaktywacji po wydarzeniu**; brak trade'ów nie oznacza automatycznie niemożności odrodzenia narracji.

Należy ustalić politykę retencji/eviction: silnik nie może usunąć tokena z pamięci w taki sposób, że planowana druga fala narracji stanie się technicznie niemożliwa. Jednocześnie nie trzeba trzymać tysięcy pełnych instancji — wystarczą odpowiednie snapshoty, event index i lazy wake, zależnie od projektu.

---

## 12. Biblioteka treści i różnorodność bez tysięcy ręcznych tweetów

### Proponowany katalog startowy

```text
social/
  data/
    authors.json              # profile i styl
    narrative-families.json   # rodziny tematów
    event-scenarios.json      # scenariusze zdarzeń
    text-templates.json       # warianty wypowiedzi
    media-catalog.json        # asset ID, tagi, licencje
  engine/
    socialScheduler.ts
    narrativeGraph.ts
    contentComposer.ts
    socialState.ts
    attentionAllocator.ts
    crowdReaction.ts
  types/
    social.ts
  tests/
    socialFoundation.test.ts
    narrativeBehavior.test.ts

public/social-assets/
  ...
```

To **przykładowy podział**, nie nakaz zachowania nazw. W szczególności przy istniejącej architekturze nie tworzyć dwóch konkurencyjnych store'ów tego samego feedu.

### Zasady kompozycji

1. Autor ma określone tematy i styl — nie dobieramy mu kompletnie przypadkowej treści.
2. Obraz ma tagi semantyczne, przypisanie do tematu i pochodzenie/licencję.
3. Nazwa i ticker tokena powinny wynikać z **konkretnego motywu** (obraz, fraza, żart), nie z niepowiązanego losowego słownika.
4. Warianty tekstów to **szablony warunkowe lub fragmenty**, nie ślepe miksowanie słów.
5. Wydarzenia mają relacje czasowe: repost nie może pojawić się przed oryginałem; sprostowanie po wiadomości; fork po pojawieniu się nowej frazy.
6. Różni autorzy mają inną dynamikę publikacji.
7. Nie wszystko jest memem o zwierzętach: polityka, technologia, dziwne internetowe newsy, slang, pomyłki, memiczne interpretacje cytatów, obrazki, krótkie reakcje.
8. W symulacji musi istnieć **zwykły szum** bez tokenów i bez dużych konsekwencji.

### Antypowtarzalność

- Cooldown nie tylko per tekst, lecz także per **rodzina narracji, autor, motyw wizualny i gotowa kombinacja**.
- Pamięć ostatnio emitowanych tematów, autorów, obrazów i złożonych postów.
- Deterministyczne wybory z seeda; dobór nie może przypadkowo zależeć od kolejności renderowania UI.
- Odmienność wynika również z **kontekstu** (inny autor, inny timing, inna seria reakcji), nie wyłącznie z zamiany jednego słowa.
- Możliwość tworzenia nowych wariantów przez edycję plików danych bez przepisywania silnika.
- Ograniczenie rozmiaru historii w pamięci i polityka resetu między sesjami/replayem.
- Mierzenie **semantycznej powtarzalności**, a nie tylko unikalności identyfikatorów.

**Rozmiar MVP:** ok. 10 autorów, 12 rodzin zdarzeń, 60 wariantów tekstów i 30 zgodnych tematycznie obrazów. Te ilości służą uruchomieniu mechanizmu i ocenie jakości; dopiero wyniki testów pokażą, czy katalog jest wystarczający.

### Treści osób prawdziwych

- W fikcyjnych scenariuszach prawdziwe postacie mogą wystąpić jako **jawnie symulowane** profile/zdarzenia.
- Nie przedstawiać wygenerowanych wypowiedzi jako autentycznych.
- Stosować ostrożność przy znakach graficznych, wizerunkach, obrazach i prawach autorskich; przechowywać informację o pochodzeniu i licencji assetów.
- **Nie są wymagane** prawdziwe tweety ani pobieranie cudzych materiałów, aby uzyskać realistyczną mechanikę.

---

## 13. Czasy, RNG, deterministyka, Replay

Dla nowego silnika istotne od początku:

- **Jeden autorytatywny zegar symulacji**. Emisja postów, dotarcie do odbiorców, launch, orders, candle timestamps i cooldowny muszą używać tego samego `simNowMs`.
- Nie mieszać `Date.now()` do logiki zdarzeń; wall-clock może służyć tylko jako input do adaptera zegara, logów lub UI, według jednoznacznej polityki.
- Generator powinien używać **seedowanych strumieni RNG**. Rozdzielenie streamów dla treści, launchy, crowd reaction i rynku ograniczy zmianę całego przebiegu po dodaniu jednego obrazka do katalogu.
- Zapisać seed, wersję katalogu, wersję modelu i event log, aby można było **reprodukować scenariusz**.
- Chronologiczna kolejka zdarzeń oraz stabilny tie-breaker dla zdarzeń o tej samej godzinie.
- Idempotentne przetwarzanie eventów (`eventId`) i brak podwójnego naliczania reakcji po rerenderze, ponownej subskrypcji lub replay.
- Zmienny `dt` nie może jakościowo zmieniać rozkładu prawdopodobieństw i liczby postów/trade'ów przy tej samej długości symulacji; testować małe i duże kroki symulacji.
- **Zdarzenia i efekty są przyczynowo uporządkowane** — nie ma „przecieku z przyszłości”: reakcja rynku nie może pojawić się przed publikacją, a użytkownik nie widzi informacji, które nie zostały jeszcze ujawnione.
- UI otrzymuje gotowy snapshot/feed. UI nie decyduje o losach wydarzeń ani nie jest źródłem zegara.

---

## 14. Czego NIE robić

- Nie symulować ceny przez „poście +X%”.
- Nie wpisywać w JSON „token A wygrywa, B przegrywa”.
- Nie zakładać, że silny autor daje pewny sukces.
- Nie uruchamiać pompy po każdym dobrym newsie.
- Nie robić z `attention` nieograniczonego mnożnika niezależnego od budżetu tłumu, płynności, presji podaży i rynku.
- Nie traktować repostu jako zupełnie niezależnego wydarzenia bez rodzica.
- Nie przypisywać wszystkich pokrewnych postów do jednego tokena.
- Nie likwidować tokena w sposób uniemożliwiający realistyczną drugą falę, ale też nie wskrzeszać terminalnego rug pulla magicznym boostem.
- Nie produkować 1000 podobnie brzmiących tekstów jako głównej metody „różnorodności”.
- Nie łączyć generatora narracji z komponentem `TweetHoverCard` czy innym React UI jako źródłem reguł biznesowych.
- Nie uruchamiać modelu językowego online przy każdym ticku; generator ma działać offline i przewidywalnie.
- Nie udawać, że parametry viralowości są skalibrowane, kiedy bazują wyłącznie na hipotezach.

---

## 15. Kalibracja i niepewność

Ważne rozróżnienie:

**Bazowy market model:** rozkłady trade'ów, wolumenu, zachowanie bonding curve, migracje, dynamika sesji — może korzystać z rzeczywistych danych rynkowych i dotychczasowych pomiarów.

**Social / narrative model:** opóźnienia reakcji na post, konwersja wyświetleń na zainteresowanie i transakcje, rozkład konkurencji między kopiami, efekt repostu, prawdopodobieństwo late discovery — **nie zostały w rozmowie skalibrowane liczbowo**. Obserwacje użytkownika stanowią przypadki jakościowe, nie pełny dataset.

Proponowany proces:

1. Zdefiniować testowe jakościowe przypadki i oczekiwane rozkłady zachowań, nie pojedyncze docelowe wykresy.
2. Wymodelować zależności (wysoki zasięg często daje większą reakcję; długi tekst może opóźniać odkrycie; repost może odnowić temat).
3. Uruchamiać setki seedów i porównywać **rozkłady rezultatów**, a nie jeden ładny screenshot.
4. Stopniowo pozyskiwać przykłady realnych sekwencji social → launch → flow → migration, gdy są dostępne.
5. Kalibrować parametry w granicach danych; gdzie danych brak, jasno oznaczać zakres jako hipotetyczny.

Nie trzeba zbierać dziesiątek screenshotów, by rozpocząć implementację, lecz bez danych nie należy obiecywać wiernego odtworzenia wpływu konkretnych prawdziwych influencerów.

---

## 16. Metryki jakości i testy akceptacyjne

### Fundament treści

- Ten sam seed + ta sama wersja katalogu + te same eventy wejściowe → ten sam wynik.
- Wygenerowanie 1000 wydarzeń bez uszkodzonych referencji, nieistniejących obrazów, repostów bez oryginału, postów z przyszłości.
- Temat, tekst, autor i obraz są semantycznie spójne.
- Generator wykazuje istotną różnorodność tematów i kolejności, a nie tylko unikalne ID.
- Cooldowny i antypowtarzalność działają, ale nie blokują uzasadnionych powrotów narracji.

### Zdarzenia i graph

- `1 root post → N tokenów` jest możliwe, ale nie automatyczne.
- `1 root post → 1 derivative post → drugi token` zachowuje linki parent-child.
- Repost oryginału może wpływać na kilka istniejących tokenów **bez dopisywania fikcyjnych postów źródłowych do każdego tokena**.
- W jednym czasie mogą istnieć konkurujące narracje i kilka autorów.

### Rynek

- A/B z tym samym seedem: social ON vs social OFF — różnice wynikają z wygenerowanego flow, a nie z bezpośredniej korekty ceny.
- Wolumen, liczba transakcji, buys/sells, rozmiary zleceń i price są wzajemnie zgodne.
- Po mocnym poście możliwe są co najmniej: brak większej reakcji, szybki pump/dump, near-migration fail i continuation.
- Slow cooker potrafi powstać przez opóźnione odkrycie i ponowne zainteresowanie, bez zaprogramowania świec.
- Druga fala może podbić aktywność istniejącego uśpionego, ale nadal aktywnego w sensie lifecycle tokena.
- Nie ma gwarantowanych migracji, nawet po wiralowym poście.
- Migracja nadal spełnia warunki curve, wieku, płynności i innych reguł nowego silnika.
- Przy 5 podobnych tokenach ten sam budżet traderów nie jest mnożony pięciokrotnie bez przyczyny.
- Dynamiczna intensywność nie wywołuje nieograniczonych dodatnich pętli ani niefizycznych skoków.

### Deterministyka i performance

- Testy headless; bez zależności od Pulse i TokenPage.
- Testy stałego wyniku i stabilnych statystyk przy różnych długościach kroku czasu.
- Testy wielu aktywnych narracji, wygaszania, usypiania i reaktywacji.
- Bounded history, cleanup, eviction i brak przecieków pamięci.
- Snapshot/replay odtwarza to samo połączenie postów, launchy, transakcji i migracji.

**Minimalne telemetry:** `eventId`, `narrativeId`, `postId`, `sourcePostId`, `tokenId`, `simTimeMs`, `audienceReach`, `discoveredAt`, `attention`, `tradeCount`, `volume`, `buySell`, `bondingCurveProgress`, `migration`, `narrativePhase`.

---

## 17. Proponowana kolejność wdrażania PRZY BUDOWIE NOWEGO SILNIKA

To jest **rekomendacja architektoniczna**, a nie zobowiązanie do konkretnej liczby PR-ów.

### Faza 0 — kontrakty i granice systemu (od razu)

- Jeden zegar symulacji.
- Seeded RNG i event queue.
- IDs i relacje `narrative / post / token / author`.
- Interfejs do przyjęcia zewnętrznej presji na uczestników rynku.
- Lifecycle pozwalający odróżnić „uśpiony” od „terminalnie martwy”.
- Market engine pozostaje autonomiczny i używa trade'ów do zmiany ceny.

**Cel:** nowego silnika nie trzeba później rozpruwać, by dodać social.

### Faza 1 — Social Event Foundation

- Katalog 10 autorów, kilkanaście rodzin wydarzeń, szablony tekstu i katalog mediów.
- Spójne, deterministyczne składanie postów.
- Graph rodzic–pochodna, reposty i narracje.
- Cooldown i ograniczanie powtórek.
- Testy headless na 1000 wydarzeń.
- **Bez wpływu na flow i cenę**.

### Faza 2 — Event-to-token

- Powstawanie tokenów inspirowanych root postami i postami pochodnymi.
- `TokenNarrativeLink`, nazwy/tickery/obrazy zgodne z tematem.
- Klaster 0–N tokenów, konkurencja, okno czasowe launchu.
- Pulse pokazuje **źródłowy** post i prawidłowe przypisanie.

### Faza 3 — Crowd Reaction (MVP)

- Zasięg, opóźnienia, segmenty traderów.
- Ograniczony budżet uwagi i kapitału, alokacja między konkurentami.
- Sygnalizacja do actor/trade engine; transakcje faktycznie przesuwają curve i cenę.
- ON/OFF przez feature flagę do A/B z bazowym market modelem.

### Faza 4 — druga fala i slow cooker

- Repost, quote, rediscovery, opóźnione odkrycie.
- Wygaszanie i ponowne uruchamianie uśpionych tokenów.
- Fake/verification i fatigue.
- Emergentna migracja, sell-the-event, post-migration momentum.

### Faza 5 — szlif i kalibracja

- Porównanie rozkładów i realnych przypadków.
- Zwiększenie różnorodności biblioteki treści oraz autorów.
- Telemetria diagnostyczna i opcjonalny Replay dla twórcy symulatora.
- Dopiero wtedy rozbudowany UI dla newsów, źródeł i relacji narracyjnych.

---

## 18. Stan starego MEMEX-SIM — kontekst integracyjny, nie wymaganie dla nowej architektury

W trakcie rozmowy sprawdzono kod dawnego `main` repo `lotoos0/memex-sim`. Wtedy istniały m.in.:

- `src/tokens/registry.ts` — właściciel uruchomionych instancji tokenów, spawn/ticki i routing wydarzeń.
- `src/tokens/tokenSim.ts` — silnik per token, zmienna `attention`, model flow i lifecycle.
- `src/tokens/marketModel.ts` — `stepMarket`, w tym `attention`, `buyBias`, `externalFlow`.
- `src/tokens/registryNarrative.ts` — relay dla launchów, dużych transakcji, migracji/rug.
- `src/narrative/tokenNarrative.ts`, `authorCatalog.ts`, `newsTemplateEngine.ts` — teksty i autorzy.
- `src/store/postStore.ts` — posty per token.
- `src/components/pulse/TokenCard.tsx` i `src/components/news/TweetHoverCard` — widok/hover postu przy tokenie.

**W tamtym stanie główny przepływ był jednostronny:** `TokenSim → event → wygenerowany post → UI`. Brakowało nadrzędnej narracji i sterowania aktywnością tłumu przez wydarzenia X.

To są **wskazówki, co można ponownie wykorzystać**, nie propozycja kopiowania starego kodu 1:1. W nowym silniku trzeba zweryfikować bieżący stan repo i zdecydować, co wyrzucić, a co przenieść.

---

## 19. Minimalne demo, które udowodni sens projektu

**Przykład: viralowy obraz z fikcyjnego X.**

1. Seedowana sesja publikuje root post z obrazkiem, autora i tematem.
2. Po różnych opóźnieniach startują 3 tokeny (albo 0, zależnie od seeda i parametrów).
3. Traderzy dzielą uwagę między kandydatów; jeden może zdobyć przewagę przez momentum.
4. Na wykresach **widać transakcje** odpowiadające impulsowi i późniejszej realizacji zysków.
5. Po spadku aktywności kolejny fikcyjny autor robi repost.
6. Jeden token dostaje drugą falę, pozostałe niekoniecznie.
7. Jeden wariant może migrować i dumpnąć, inny zbliżyć się do migracji i zgasnąć, jeszcze inny pozostać niezauważony.
8. Replay odtwarza identyczną historię; tryb bez social pokazuje bazową dynamikę rynku.

**Definicja sukcesu:** podczas obserwacji użytkownik potrafi powiedzieć *„ten token ruszył, bo ludzie zaczęli reagować na post / repost i napłynęły zakupy”*, a nie *„wykres losowo zrobił pump, a system dorobił do niego tekst”*.

---

## 20. Pytania otwarte na etap projektowania (nie blokują Fazy 0)

- Jaka ma być średnia liczba istotnych narracji na godzinę wobec zwykłego szumu?
- Ile czasu trwa symulowana sesja i jaka jest relacja czasu gry do rzeczywistego?
- Jak duży ma być budżet kapitałowy syntetycznych traderów? Czy pulę agentów trzeba współdzielić między tokenami?
- Czy tempo powstawania tokenów pozostaje bazowym procesem rynkowym + osobnymi klastrami social, czy ma być od podstaw zależne od wydarzeń?
- Jak rozdzielić „token jest martwy ekonomicznie” od „token jest tylko niewidoczny/uśpiony”? Czy istnieje dopuszczalny mechanizm reaktywacji?
- Jak wykrywać, kiedy narracja została już wyczerpana, a kiedy nawiązywanie do niej to sensowny nowy post?
- Jak eksponować źródło posta i jego wiarygodność użytkownikowi bez ujawniania ukrytych zmiennych symulacji?
- Jaką telemetrię i zestaw referencyjnych scenariuszy zebrać do późniejszej kalibracji?

---

## 21. Krótka instrukcja dla Codexa / twórcy nowego silnika

> Traktuj **Social Narrative & Crowd Reaction** jako **pierwszoplanowy wymóg architektoniczny nowego MEMEX-SIM**, nawet jeśli implementacja treści i autorów przyjdzie po bazowym engine.
>
> Zaprojektuj core z jednym zegarem, seedem, kolejką zdarzeń, połączeniem `narrative → posts → tokens`, mechanizmem presji na uczestników oraz realnymi transakcjami napędzającymi bonding curve i cenę.
>
> Najważniejsze przypadki: kilka tokenów na jeden post, post pochodny jako osobny motyw, slow cooker, brak reakcji, fast viral/migration, dump po migracji i druga fala po re-poście. Reputacja fikcyjnych autorów ma być możliwa do nauczenia przez obserwację, ale nic nie gwarantować. Nie skryptuj zwycięskich tokenów i nie wprowadzaj ceny „z ręki”.
>
> Zanim piszesz kod, porównaj wymagania z nową architekturą, wskaż brakujące kontrakty, zaproponuj najmniejszy vertical slice i testy A/B. Dokument opisuje intencję i hipotezy — liczby do kalibracji nie są jeszcze ustalone.

**Priorytet:** realistyczna przyczynowość `wydarzenie → percepcja → zachowanie traderów → zlecenia → cena`, nie ilość tweetów ani kosmetyka ikonki X.
