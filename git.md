# Git + GitHub Playbook (memex-sim)

## 1) Cel dokumentu
Ten dokument ustala jeden, spojny standard pracy z Git i GitHub dla repozytorium `memex-sim`.
Celem jest:
- szybkie i bezpieczne dostarczanie zmian,
- latwe code review,
- latwe odtwarzanie historii decyzji,
- minimalizacja konfliktow i regresji.

## 2) Zasady nadrzedne
1. `main` zawsze musi byc stabilny i gotowy do odpalenia.
2. Kazda zmiana idzie przez branch + PR (bez pushowania bezposrednio na `main`).
3. Commity robimy male, logiczne i opisowe.
4. Przed push: lokalny test/build + kontrola diffa.
5. Nigdy nie commitujemy sekretow (tokeny, hasla, klucze API).

## 3) Struktura branchy
Rekomendowany model: prosty trunk-based z krotko zyjacymi branchami.

### Branch glowny
- `main`: branch produkcyjny/stabilny.

### Branche robocze
- `feat/<obszar>-<krotki-opis>`
- `fix/<obszar>-<krotki-opis>`
- `chore/<obszar>-<krotki-opis>`
- `docs/<obszar>-<krotki-opis>`
- `refactor/<obszar>-<krotki-opis>`
- `tune/<obszar>-<krotki-opis>`

Przyklady:
- `feat/token-feed-narrative`
- `fix/chart-mcap-scaling`
- `tune/sim-early-momentum`

### Czas zycia brancha
- Branch powinien zyc krotko (idealnie 1-3 dni).
- Jesli branch rosnie za bardzo, podziel go na kilka PR.

## 4) Start pracy nad zadaniem
1. Zaktualizuj informacje o origin:
```bash
git fetch origin
```
2. Przelacz sie na `main` i zsynchronizuj:
```bash
git checkout main
git pull --rebase origin main
```
3. Stworz nowy branch:
```bash
git checkout -b feat/<obszar>-<opis>
```

## 5) Standard commitow
Format:
```text
<typ>(<scope>): <krotki opis>
```

Typy:
- `feat`: nowa funkcjonalnosc
- `fix`: naprawa bledu
- `chore`: prace techniczne/utrzymaniowe
- `docs`: dokumentacja
- `refactor`: zmiana struktury bez zmiany zachowania
- `test`: testy
- `tune`: tuning parametrów/symulacji

Przyklady:
- `feat(narrative): add token feed posts and author profiles`
- `fix(chart): prevent mcap axis flattening`
- `tune(sim): reduce early momentum for normal tokens`

## 6) Jak poprawnie stage'owac zmiany
Zasada: stage tylko to, co ma wejsc do konkretnego commita.

Polecane komendy:
```bash
git status
git add -p
git diff --staged
```

Wazne:
- Nie mieszaj w jednym commicie: refactor + bugfix + docs.
- Nie commituj plikow tymczasowych i lokalnych artefaktow.

## 7) Jak czesto commitowac
- Commituj po kazdej malej, zamknietej logicznie zmianie.
- Lepiej 5 malych commitow niz 1 duzy i nieczytelny.

## 8) Synchronizacja z remote podczas pracy
Jesli branch zyje dluzej niz kilka godzin, regularnie go odswiezaj:
```bash
git fetch origin
git rebase origin/main
```

Gdy wystapia konflikty:
1. Rozwiaz konflikt w plikach.
2. Sprawdz co zostalo staged.
3. Kontynuuj:
```bash
git rebase --continue
```

Jesli rebase poszedl zle:
```bash
git rebase --abort
```

## 9) Kontrola jakosci przed push
Minimalna checklista:
1. `git status` (czy staged jest to, co trzeba).
2. `git diff --staged` (czy commit zawiera tylko oczekiwane zmiany).
3. Build/test/lint lokalnie (zakres zalezy od zmiany).
4. Szybki smoke test reczny krytycznej sciezki.

Przyklad:
```bash
npm run build
npm run lint
```

## 10) Push i PR
Push brancha:
```bash
git push -u origin <twoj-branch>
```

PR powinien zawierac:
- Co i dlaczego zostalo zmienione.
- Zakres plikow/modulow.
- Ryzyko regresji.
- Instrukcje testowania (manual + automaty).
- Screeny/gify jesli UI.

## 11) Zasady review
Dla review najpierw sprawdzamy:
1. Poprawnosc funkcjonalna.
2. Ryzyko regresji.
3. Spojnosc architektury.
4. Testowalnosc i czytelna historia commitow.

Uwagi reviewerskie powinny byc konkretne i wykonywalne.

## 12) Merge policy
Preferowane:
- `Squash and merge` dla wielu drobnych commitow roboczych,
- `Rebase and merge` gdy commit history jest juz czysta i logiczna.

Unikaj klasycznego merge commit, jesli nie jest potrzebny.

## 13) Ochrona repo na GitHub (must-have)
Ustaw na `main`:
1. Require pull request before merging.
2. Require at least 1 approval.
3. Require status checks to pass.
4. Dismiss stale approvals when new commits are pushed.
5. Require conversation resolution before merge.
6. Restrict who can push to matching branches.
7. Optional: Require linear history.

## 14) Sekrety i bezpieczenstwo
- Nigdy nie commituj `.env` z prawdziwymi sekretami.
- Dodaj i utrzymuj `.gitignore`.
- Uzywaj `*.example` dla szablonow konfiguracji.
- Po przypadkowym wycieku: natychmiast rotacja sekretu (sam revert commita nie wystarczy).

## 15) Wersjonowanie i release
Rekomendacja: semver + tagi.

- `vMAJOR.MINOR.PATCH` (np. `v0.7.2`)
- Patch: bugfixy
- Minor: nowe kompatybilne funkcje
- Major: breaking changes

Przy release:
1. Upewnij sie, ze `main` jest zielony.
2. Dodaj changelog.
3. Otaguj commit release:
```bash
git tag v0.7.2
git push origin v0.7.2
```

## 16) Higiena historii
- Nie rewrite'uj publicznej historii bez potrzeby.
- `git push --force-with-lease` tylko na swoim branchu i swiadomie.
- Nigdy `--force` na branchach wspoldzielonych.

## 17) Sytuacje awaryjne (odzyskiwanie)
### Cofniecie ostatniego commita lokalnie (zachowaj zmiany w plikach)
```bash
git reset --soft HEAD~1
```

### Wycofanie commita, ktory jest juz na remote
```bash
git revert <sha>
```

### Odzyskanie "zgubionego" commita
```bash
git reflog
git checkout <sha>
```

### Przywrocenie konkretnego pliku z innego commita
```bash
git checkout <sha> -- path/to/file
```

## 18) Czego unikac
1. Duzych commitow "misc changes".
2. Pushowania kodu bez lokalnej walidacji.
3. Mieszania zmian funkcjonalnych i formatowania na raz.
4. Pracy tygodniami na jednym branchu bez integracji z `main`.
5. Commitowania zaleznosci lub build artefacts bez potrzeby.

## 19) Dobre praktyki dla tego repo
1. Osobny commit na tuning symulacji (`src/tokens/*`), osobny na UI.
2. Przy zmianach UI dodawaj screen/gif do PR.
3. Przy zmianach silnika dodawaj opis efektu i zakresu ryzyka.
4. Przy zmianach store/registry sprawdzaj regresje w token page + pulse.
5. Utrzymuj male PRy (preferowane do ~300-500 linii netto).

## 20) Szybki workflow (skrot)
```bash
# start
git fetch origin
git checkout main
git pull --rebase origin main
git checkout -b feat/<obszar>-<opis>

# praca
git add -p
git commit -m "feat(scope): opis"

# przed push
npm run build
npm run lint

# publish
git push -u origin feat/<obszar>-<opis>
```

## 21) Minimalna checklista PR (kopiuj-wklej)
- [ ] Zakres PR jest jednoznaczny i ograniczony.
- [ ] Commity sa logiczne i opisowe.
- [ ] Build/lint/test przeszly lokalnie.
- [ ] Dodano instrukcje testu manualnego.
- [ ] Dodano screeny (jesli UI).
- [ ] Brak sekretow i plikow tymczasowych.
- [ ] Ryzyko regresji opisane.

## 22) Rekomendowane aliasy (opcjonalnie)
```bash
git config --global alias.st "status -sb"
git config --global alias.lg "log --oneline --decorate --graph --all"
git config --global alias.unstage "restore --staged"
git config --global alias.last "log -1 HEAD --stat"
```
