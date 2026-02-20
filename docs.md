# memex-sim - handoff dla drugiego AI

Data aktualizacji: 2026-02-18

## 1) O czym jest projekt
memex-sim to symulator tradingu memecoinow w stylu DEX (inspiracja: Axiom).
Produkt ma miec 3 tryby danych:
- Sim (dziala teraz) - synthetic market, lifecycle tokenow, fake wallet
- Replay (planowany) - odtwarzanie nagranych tickow
- Live (opcjonalny) - podpiecie pod realne API/indexer

Glowny flow uzytkownika:
- Home/Pulse z kolumnami tokenow (New Pairs, Final Stretch, Migrated)
- Wejscie w token -> wykres + panel tradingowy
- Trading i PnL powinny byc wspolne dla Sim/Replay/Live

## 2) Co jest ustalone (kontrakty i decyzje)
Nie ruszac bez swiadomej migracji:
- `src/tokens/types.ts` (TokenMeta, TokenRuntime, TokenPhase)
- Lifecycle: `NEW -> FINAL -> MIGRATED`, plus `RUGGED` i cleanup
- Wallet start: 1 SOL, stale SOL/USD = 150 (uproseczenie UI)
- Architektura tickow:
  - engine tick: 200ms
  - feed publish do store: 1000ms
  - aktywny wykres: direct callback ~200ms

## 3) Aktualny stan implementacji (faktycznie w repo)
Zrobione:
- Routing i shell app:
  - `src/router.tsx` (`/` i `/token/:id`)
- Core token sim:
  - `src/tokens/generator.ts`
  - `src/tokens/tokenSim.ts`
  - `src/tokens/registry.ts`
- Store tokenow:
  - `src/store/tokenStore.ts`
- UI Pulse + Token page:
  - `src/pages/PulsePage.tsx`
  - `src/pages/TokenPage.tsx`
  - `src/components/pulse/*`
  - `src/components/chart/Chart.tsx`
- Tailwind v4 + theme:
  - `src/styles.css`

Czesciowo zrobione / niespojnie:
- Trading:
  - `src/store/tradingStore.ts` jest rozbudowany, ale nadal legacy-oriented (`symbol`-centric)
  - `src/components/token/TradeSidebar.tsx` to glownie UI stub (CTA nie wykonuje realnych zlecen)
  - `src/components/token/BottomTabs.tsx` to placeholder
- Wallet:
  - `src/store/walletStore.ts` istnieje (1 SOL), ale nie jest jeszcze spiety end-to-end z nowym token flow

Braki vs plan:
- brak `src/tokens/lifecycle.ts` jako osobnego modulu (logika siedzi w `tokenSim.ts`/`registry.ts`)
- brak provider abstraction (`src/providers/*` praktycznie nieuzyte)
- brak Replay/Live
- brak testow

## 4) Gdzie jestesmy na roadmapie
Praktycznie: koniec Slice 1 + poczatek Slice 2 i czesc Slice 3.
- Slice 1 (E2E Sim bez pelnego UI): w duzej mierze jest
- Slice 2 (wallet + trading): rozpoczete, ale niedokonczone
- Slice 3 (lifecycle + feed): core dziala, polish i modularizacja jeszcze nie

## 5) Najwazniejsze ryzyka techniczne
- Rozjazd architektoniczny miedzy nowym token-centric flow a starym trading store.
- Czesciowe duplikowanie odpowiedzialnosci lifecycle pomiedzy `tokenSim.ts` i `registry.ts`.
- Brak jasnego kontraktu providerow utrudni wejscie w Replay/Live.

## 6) Jak wspolpracowac z pierwszym AI (czyli ze mna)
Prosze komunikowac zmiany jako:
1. Cel zmiany (1-2 zdania)
2. Zakres plikow
3. Ryzyko regresji
4. Co przetestowano lokalnie

Feedback mile widziany szczegolnie dla:
- architektury multi-token trading
- granicy miedzy engine a store
- kolejnosci prac (co odblokowuje najwiecej)

## 7) Co robic dalej (priorytet)
1. Domknac Slice 2: podlaczyc `TradeSidebar` do realnych akcji buy/sell per token i wallet.
2. Ujednolicic trading store pod tokenId (odejsc od jednego `symbol`).
3. Wyciagnac lifecycle do `src/tokens/lifecycle.ts` (czysty kontrakt, mniejszy coupling).
4. Dookreslic i wdrozyc `MarketDataProvider` + `SimProvider` jako warstwe API.
5. Dodac minimalne testy logiki (token lifecycle + trading fills).

## 8) Pliki, o ktore prosic zamiast "caly projekt"
Jesli potrzebujesz kontekstu, popros najpierw o te pliki:
- `Plan.md`
- `package.json`
- `config/config.json`
- `src/tokens/types.ts`
- `src/tokens/generator.ts`
- `src/tokens/tokenSim.ts`
- `src/tokens/registry.ts`
- `src/store/tokenStore.ts`
- `src/store/walletStore.ts`
- `src/store/tradingStore.ts`
- `src/pages/PulsePage.tsx`
- `src/pages/TokenPage.tsx`
- `src/components/chart/Chart.tsx`
- `src/components/token/TradeSidebar.tsx`
- `src/components/token/BottomTabs.tsx`
- `src/router.tsx`
- `src/styles.css`

To zwykle wystarcza do sensownego feedbacku architektonicznego i planowania kolejnych krokow.

## 9) Instrukcje dla drugiego AI (personalizacja odpowiedzi ChatGPT)
Poni¿szy blok mozesz przekleic jako "custom instructions" dla ChatGPT pracujacego nad tym projektem.

### Rola i kontekst
- Dzialasz jako technical copilot dla projektu `memex-sim`.
- Priorytet: szybkie dostarczanie kolejnych slice'ow bez psucia kontraktow danych.
- Traktuj `src/tokens/types.ts` jako kontrakt zamrozony, chyba ze dostaniesz jawna decyzje o migracji.

### Styl odpowiedzi
- Odpowiadaj krotko, technicznie, bez marketingu i bez lania wody.
- Najpierw daj decyzje/rekomendacje, potem uzasadnienie (max kilka punktow).
- Gdy ryzyko jest wysokie, nazwij je wprost i zaproponuj bezpieczniejsza alternatywe.

### Domyslny format feedbacku
- `Diagnoza`: co jest nie tak / co blokuje progres.
- `Propozycja`: minimalny zestaw zmian.
- `Zmiany w plikach`: konkretne sciezki.
- `Ryzyko`: co moze sie wysypac po zmianie.
- `Test`: co odpalic lokalnie i jaki wynik jest oczekiwany.

### Zasady architektoniczne
- Preferuj podejscie token-centric (klucz `tokenId`) zamiast globalnego `symbol`.
- Nie dodawaj nowej warstwy abstrakcji, jesli nie odblokowuje Replay/Live.
- Oddzielaj:
  - engine/symulacje (logika czasu i ceny)
  - store (stan UI/trading)
  - komponenty (prezentacja)

### Zasady implementacyjne
- Najpierw male, pionowe kroki (vertical slice), nie duzy rewrite.
- Kazda zmiana ma konczyc sie dzialajacym stanem aplikacji.
- Przy refaktorze wskazuj "co usuwamy", "co zostaje", "co migrujemy".

### Kiedy zadac pytanie zamiast zgadywac
Zadaj pytanie, gdy brak decyzji produktowej dotyczy:
- modelu wallet/trading (np. czy wallet ma byc per token czy global)
- zachowania przy rug/migration (UX + edge cases)
- priorytetu: polish UI vs domkniecie trading core

### Definition of Done dla zadania
- Kod kompiluje sie (`npm run build`)
- Krytyczny flow dziala recznie w UI
- Brak zmian kontraktow bez notatki migracyjnej
- Krótki changelog: co zrobiono i czego swiadomie NIE zrobiono
