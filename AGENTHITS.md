# Личная линия agentHits

Это не апстрим. Файл живёт только на `agentHits/dev` и не должен попадать
в PR в `lidge-jun/opencodex`.

## Обязательный журнал

Этот файл — обязательный журнал личной линии. Его ведут вместе с кодом, а не
потом.

Обнови таблицу «Что сейчас лежит где» в том же коммите, что:

- вливает ветку в `agentHits/dev`;
- открывает или меняет апстрим-PR;
- подтягивает `upstream/dev`;
- меняет статус фичи (себе / апстрим / готово / брошено).

Не оставляй таблицу устаревшей.

## Зачем три слоя

| Слой | Ветка | Роль |
| --- | --- | --- |
| Апстрим | `upstream/dev` | Официальная интеграция OpenCodex. Сюда идут PR. |
| Личная линия | `agentHits/dev` | То, что ты поднимаешь локально: свежий `dev` + твои принятые фичи. |
| Разработка | `agentHits/<тема>` или `feat/` / `fix/` | Одна задача — одна ветка. Сюда коммитишь, пока фича не готова. |

Git не позволяет назвать интеграцию просто `agentHits`: уже есть
`agentHits/antigravity`, а `agentHits` и `agentHits/...` не могут
существовать одновременно.

## Жёсткое правило

В апстрим никогда не открывай PR с головы `agentHits/dev`.
Туда идёт только чистая ветка, срезанная от `upstream/dev`, с одной темой.

Две разные цели — две разные ветки:

- хочу себе на машину → влить в `agentHits/dev`;
- хочу отдать апстриму → отдельный PR от `upstream/dev`.

Одна и та же работа может пройти оба пути, но не одной веткой.

## Как вести день за днём

### Поднять личную линию (то, с чего стартует прокси)

```bash
git checkout agentHits/dev
git fetch upstream
git merge --no-edit upstream/dev
git push origin agentHits/dev
```

Merge, не rebase: ветка запушена и с неё запущен OpenCodex.
Rebase здесь потребует force-push и сдвинет историю под ногами.

После смены кода перезапусти прокси, он читает этот checkout.

### Начать свою разработку

```bash
git checkout agentHits/dev
git checkout -b agentHits/короткое-имя
```

Если фича сразу для апстрима, срезай от `dev`, не от личной линии:

```bash
git fetch upstream
git checkout -b fix/короткое-имя upstream/dev
```

### Когда разработка удалась

Себе:

```bash
git checkout agentHits/dev
git merge --no-edit agentHits/короткое-имя
git push origin agentHits/dev
```

Апстриму — отдельным PR в `dev`. После мержа апстрима личная линия
подтянет это через `git merge upstream/dev`. Второй раз ту же ветку
в `agentHits/dev` не вливай.

### Что не смешивать

Открытый апстрим-PR держи на своей теме. Сейчас это
`agentHits/antigravity` → [PR #4560](https://github.com/lidge-jun/opencodex/pull/4560).
Не коммить туда посторонние фичи и не вливай туда `agentHits/dev`.

## Что сейчас лежит где

| Ветка | Зачем | В `agentHits/dev`? | Апстрим |
| --- | --- | --- | --- |
| `upstream/dev` | официальный код | база | да |
| `agentHits/dev` | локальный прокси | — | нет, не PR |
| `agentHits/antigravity` | GUI accounts + Cockpit Tools | да, база GUI `904db7036` | [PR #4560](https://github.com/lidge-jun/opencodex/pull/4560) |
| `agentHits/dev` accounts copy | Квоты на вкладке аккаунтов: Claude/Gemini только у Antigravity | да, на `agentHits/dev` | нет |
| `agentHits/antigravity+cockpitTools` | старый алиас GUI-SHA | да | нет |
| `fix/cca-gemini-structured-output` | Gemini CCA structured output | да, влито `11e343e5f` | ready [PR #4670](https://github.com/lidge-jun/opencodex/pull/4670) / [issue #4669](https://github.com/lidge-jun/opencodex/issues/4669) |

Когда вливаешь новую фичу в `agentHits/dev`, допиши строку в эту таблицу.
Когда апстрим принял PR — пометь и дальше тяни через `upstream/dev`.

## Как забрать готовый апстрим-фикс себе раньше мержа

CCA structured output уже влит в `agentHits/dev`. После мержа #4670 в `upstream/dev` обычный `git merge upstream/dev` это подхватит и дублировать merge этой ветки не нужно.

Шаблон для следующего такого фикса:

```bash
git checkout agentHits/dev
git merge --no-edit origin/fix/cca-gemini-structured-output
git push origin agentHits/dev
```

После мержа #4670 в `upstream/dev` обычный `git merge upstream/dev` это подхватит.
