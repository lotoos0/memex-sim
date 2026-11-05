# Senior Engineering Style v2.0

Condensed English version: [AGENTS.md](../AGENTS.md) § Engineering style. On conflict, AGENTS.md wins.

Pragmatic · Human-Centric · Battle-Tested · Production-Minded

## Filozofia główna
Pisz i modyfikuj kod tak, jak robiłby to doświadczony inżynier odpowiedzialny za jego utrzymanie w rzeczywistym środowisku produkcyjnym.
Priorytetem nie jest elegancja, liczba abstrakcji ani demonstrowanie znajomości wzorców projektowych. Priorytetem jest poprawność, czytelność, przewidywalność, prostota utrzymania i świadome zarządzanie ryzykiem.
Kod powinien odzwierciedlać rzeczywiste potrzeby projektu, istniejące konwencje i udokumentowane ograniczenia.
Nie symuluj ludzkich doświadczeń, błędów ani historii projektu. Naturalny styl inżynierski wynika z decyzji, nie ze sztucznego dodawania niedoskonałości.

## 1. Komentarze — Why, Not What
Komentarze wyjaśniają kontekst, motywację, ograniczenia i decyzje, których nie da się łatwo odczytać z implementacji.
- Nie komentuj oczywistych instrukcji, warunków, pętli ani przypisań.
- Nie dodawaj komentarzy tylko po to, by kod wyglądał na udokumentowany.
- Dokumentuj nieoczywiste kompromisy, ograniczenia systemów zewnętrznych i istotne decyzje.
- Komentarze dotyczące historycznych błędów muszą bazować na rzeczywistych informacjach.
- Jeżeli kod wymaga wielu komentarzy wyjaśniających jego działanie, rozważ uproszczenie implementacji.
- Zachowuj komentarze wymagane przez publiczne API, kontrakty i konwencje projektu.
Zasada: Dobry komentarz powinien odpowiadać na pytanie, które mógłby zadać doświadczony programista podczas code review.

## 2. Szczerość techniczna i dług techniczny
Nie ukrywaj ograniczeń pod dodatkowymi abstrakcjami i nie przedstawiaj częściowego rozwiązania jako kompletnego.
Stosuj znaczniki wyłącznie wtedy, gdy są uzasadnione:
- TODO: — konkretna, planowana praca.
- FIXME: — potwierdzony błąd lub wada wymagająca naprawy.
- HACK: — świadome obejście rzeczywistego ograniczenia.
Każdy taki komentarz powinien jasno wskazywać problem. Gdy to możliwe, dodaj odniesienie do issue albo warunek usunięcia obejścia.
Nie wymyślaj długu technicznego. Nie pozostawiaj znanego krytycznego błędu wyłącznie z komentarzem FIXME.
Zasada: Dług techniczny jest świadomą decyzją z określonym kosztem, a nie usprawiedliwieniem niedbałości.

## 3. Architektura — Minimal Sufficient Design
Wybieraj najprostszą architekturę, która poprawnie rozwiązuje obecny problem i pozwala na rozsądny rozwój.
- Preferuj rozwiązania zgodne z istniejącą architekturą.
- Nie wprowadzaj nowych warstw, interfejsów, klas ani frameworków bez konkretnego uzasadnienia.
- Nie twórz abstrakcji dla hipotetycznych wymagań.
- Usuwaj rzeczywistą duplikację, lecz nie kosztem czytelności.
- Wprowadzaj wzorce projektowe wtedy, gdy rozwiązują zidentyfikowany problem.
- Preferuj standardowe możliwości języka i bibliotek zamiast własnych implementacji bez uzasadnienia.
- Nie wykonuj dużego refaktoringu podczas drobnej zmiany bez wyraźnej potrzeby.
Zasada: Każda abstrakcja musi uzasadnić koszt swojego istnienia.

## 4. Funkcje i kontrola przepływu
Funkcje powinny mieć jasno określoną odpowiedzialność, czytelny przepływ i przewidywalne zachowanie.
- Preferuj guard clauses, gdy zmniejszają zagnieżdżenie.
- Unikaj zbędnych else, niepotrzebnych flag stanu i wielopoziomowych warunków.
- Dziel funkcje wtedy, gdy oddzielenie odpowiedzialności rzeczywiście poprawia czytelność.
- Nie dziel kodu mechanicznie według liczby linii.
- Unikaj funkcji pomocniczych, które jedynie przekazują argumenty bez dodawania wartości.
- Utrzymuj skutki uboczne w miejscach łatwych do zidentyfikowania.
- Obsługuj błędy na właściwym poziomie zamiast ukrywać je lub przechwytywać wszędzie.
Zasada: Czytelny przepływ jest ważniejszy niż sztucznie krótka funkcja.

## 5. Nazewnictwo — Precision Over Verbosity
Nazwy powinny być jednoznaczne w swoim kontekście, bez niepotrzebnej rozwlekłości.
- Używaj terminologii domenowej projektu.
- Preferuj zwięzłe nazwy oddające odpowiedzialność.
- Dopuszczaj standardowe skróty, takie jak req, res, ctx, err, config, jeśli pasują do konwencji języka.
- Nie skracaj nazw kosztem zrozumienia.
- Unikaj nazw ogólnych typu manager, processor, handler bez jasnego zakresu odpowiedzialności.
- Nie zmieniaj istniejącego nazewnictwa wyłącznie dla własnych preferencji.
Zasada: Nazwa powinna ograniczać potrzebę dodatkowych komentarzy.

## 6. Production Mindset — Real-World Reliability
Kod powinien uwzględniać realne warunki działania systemu.
Rozważaj, gdy ma to zastosowanie:
- timeouty, błędy sieciowe i niedostępność usług;
- retry, backoff, idempotencję i duplikację żądań;
- niepoprawne dane wejściowe oraz granice zaufania;
- współbieżność, race conditions i spójność stanu;
- zużycie zasobów oraz wycieki pamięci;
- kompatybilność wsteczną;
- bezpieczeństwo danych, sekretów i uprawnień;
- logowanie, metryki i możliwość diagnozowania awarii.
Nie implementuj wszystkich zabezpieczeń automatycznie. Dobieraj je do rzeczywistego ryzyka i charakteru systemu.
Zasada: Defensive programming chroni przed uzasadnionymi zagrożeniami, a nie wszystkimi wyobrażalnymi scenariuszami.

## 7. Evidence-Based Engineering
Nie przedstawiaj przypuszczeń jako faktów.
- Nie wymyślaj benchmarków, wyników testów ani historii awarii.
- Nie deklaruj poprawy wydajności bez odpowiednich pomiarów.
- Przy zmianach wydajnościowych określ metodę pomiaru i istotne warunki środowiskowe.
- Oddzielaj obserwacje od hipotez.
- Jeśli nie masz możliwości zweryfikowania zachowania, powiedz to wprost.
- Nie optymalizuj przed ustaleniem rzeczywistego problemu, chyba że istnieje wyraźne ograniczenie projektowe.
Zasada: Engineering decisions require evidence proportional to their risk.

## 8. Minimal Diff & Respect Existing Code
Przed modyfikacją zrozum zastany kod, jego zależności i konwencje.
- Zmieniaj tylko to, co jest niezbędne do realizacji zadania.
- Nie przepisuj działających komponentów bez uzasadnienia.
- Nie dodawaj nowych zależności, jeśli istniejące narzędzia wystarczą.
- Nie usuwaj kompatybilności ani obsługi przypadków brzegowych bez świadomej decyzji.
- Rozróżniaj zmianę zachowania od refaktoringu.
- Preferuj małe, możliwe do przetestowania i odwrócenia zmiany.
Zasada: Najbezpieczniejsza zmiana często polega na modyfikacji mniejszej ilości kodu, nie większej.

## 9. Testing & Verification
Kod nie jest ukończony tylko dlatego, że wygląda poprawnie.
- Testuj zachowanie, a nie szczegóły implementacji.
- Uwzględniaj istotne przypadki brzegowe i ścieżki błędów.
- Wykorzystuj istniejące testy i narzędzia projektu.
- Nie twórz testów, które zawsze przechodzą bez realnej weryfikacji.
- Uruchamiaj dostępne kontrole adekwatne do zmiany.
- Nie deklaruj uruchomienia testów, których faktycznie nie wykonano.
- W przypadku zmiany kontraktu, API lub migracji uwzględnij konsekwencje dla istniejących użytkowników.
Zasada: Confidence comes from verification, not from the appearance of correctness.

## 10. Engineering Judgment — Think Before Coding
Przed wdrożeniem oceń problem i kontekst.
1. Co dokładnie trzeba rozwiązać?
2. Jak zachowuje się obecna implementacja?
3. Czy prostsza zmiana wystarczy?
4. Jakie zachowanie może zostać przypadkowo uszkodzone?
5. Jak zweryfikować wynik?
6. Czy koszt dodatkowej złożoności jest uzasadniony?
Nie traktuj tych pytań jak obowiązkowego raportu. Używaj ich do podejmowania decyzji.
Jeżeli istniejący kod spełnia wymagania, nie zmieniaj go tylko po to, by wyglądał lepiej.
Jeżeli polecenie prowadzi do niebezpiecznej lub nadmiernie skomplikowanej implementacji, wskaż problem i zaproponuj prostsze rozwiązanie.
Zasada: Senior engineer knows when not to write code.

## Sposób pracy agenta
Podczas implementacji:
1. Najpierw sprawdź istotny kontekst projektu.
2. Wybierz rozwiązanie o najmniejszej uzasadnionej złożoności.
3. Wprowadź spójną, ograniczoną zmianę.
4. Zweryfikuj działanie dostępnymi narzędziami.
5. Podsumuj krótko: co zmieniono, co sprawdzono i jakie ryzyka pozostają.
Dla prostych zadań działaj bez rozbudowanego planowania. Dla zmian złożonych lub ryzykownych przedstaw zwięzły plan przed implementacją.
Nie generuj długich wyjaśnień oczywistości, sztucznych komentarzy, niepotrzebnych dokumentów ani dodatkowych plików bez uzasadnienia.

## Ostateczna reguła
Write code for the next engineer who will maintain it — not for the reviewer you want to impress.
Dobry kod nie musi wyglądać na skomplikowany. Musi być poprawny, zrozumiały, utrzymywalny i adekwatny do problemu.
