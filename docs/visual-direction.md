# C01 — Visual Direction & Design Governance

**Проект:** Reflect  
**Статус:** техническое направление и UI governance на основании аудита C01  
**Дата аудита:** 20 ноября 2026  
**Состояние репозитория:** `main` @ `6fee8bf` (после merge PR #24 и #25)  
**Scope:** frontend visual system, design tokens, UI consistency, responsive behavior, component governance  
**Out of scope:** backend/API, бизнес-логика, расчёты, data-fetching behavior, изменения продуктовой логики

---

## 1. Цель C01

C01 фиксирует единое визуальное направление Reflect и правила, по которым интерфейс должен развиваться дальше. Это не задача «перекрасить все страницы» и не новый редизайн с нуля.

Цель — убрать разрозненные визуальные решения, закрепить единый язык интерфейса и сделать дальнейшую миграцию экранов предсказуемой.

### Результат C01

1. Единое визуальное направление, принятое как стандарт продукта.
2. Понятные правила поверхностей, типографики, цвета, плотности, радиусов, состояний и адаптивности.
3. Единые требования к использованию существующих UI-компонентов.
4. Приоритетный backlog, основанный на C01 audit.
5. Прозрачный PR-план без смешения задач разных фаз Blueprint.
6. UI Definition of Done, применяемый к каждому последующему экрану и компоненту.

C01 — governance/documentation stage. В рамках этой задачи не следует массово переписывать все страницы.

---

## 2. Контекст и текущее состояние

### 2.1 Репозиторий на момент аудита

| Параметр | Состояние |
|---|---|
| Branch | `main` |
| Commit | `6fee8bf` |
| PR #24 — Overview | merged, `737ae9f` |
| PR #25 — Common UI States | merged, `6fee8bf` |
| Open PR | #18 — Access by clients in agency |
| CI | 4/4 checks green |

### 2.2 Проведённый аудит

Проверены frontend-исходники `artifacts/shift-market/src` (styles, components, pages), а также собранное приложение:

- 9 demo routes;
- 4 seller routes;
- landing/login;
- viewport widths: 375, 768, 1280, 1440 px;
- 56 measurements и 38 screenshots.

Backend, API и business logic не входили в аудит.

### 2.3 Существующая основа

В проекте уже присутствуют:

- design tokens (`styles/tokens.css`);
- базовые UI components;
- App Shell;
- Data Trust components;
- Overview redesign;
- Common UI States;
- Typecheck, translation validation, unit tests, Playwright e2e, build и API tests с PostgreSQL.

**Вывод:** база уже существует. Основной долг — непоследовательное применение системы на legacy screens, а не отсутствие дизайн-системы.

### 2.4 Документация

На момент аудита:

- `docs/design-tokens.md`;
- `docs/ui-components.md`;
- `docs/redesign/b04`, `b05`, `b06`, `b06-states`.

Blueprint v3 используется как внешний документ и ещё не лежит в репозитории. C01 рекомендует добавить его в `docs/` и назначить PR-номер единым идентификатором этапов, чтобы убрать расхождение нумерации.

---

## 3. Visual direction

### 3.1 Направление

Reflect — компактный аналитический SaaS-интерфейс. Визуальная система должна помогать пользователю быстро читать данные, сравнивать значения, замечать отклонения и переходить к решению.

В качестве референса исследован **Dub**: светлая editorial SaaS эстетика, почти белые поверхности, тонкие границы, нейтральная типографика и ограниченное использование одного акцента. Референс используется для принципов, а не для буквального копирования его цветов или компонентов.

### 3.2 Принципы

1. **Data-first.** Визуальная иерархия строится вокруг данных, выводов и действий, а не декоративных элементов.
2. **Quiet UI.** Интерфейс не должен конкурировать с аналитической информацией.
3. **Border-first.** Структура задаётся отступами и тонкими границами; тени — только там, где нужна реальная глубина.
4. **Consistent components.** Один компонент не должен иметь разные визуальные версии на разных страницах без явного варианта/variant.
5. **Semantic color.** Цвет имеет стабильное значение; не использовать цвет роста для источника данных или warning.
6. **Compact, not cramped.** Плотность аналитического продукта сохраняется, но текст, таблицы и интерактивные элементы должны оставаться читаемыми.
7. **Progressive disclosure.** Дополнительные пояснения, confidence и детали показываются по запросу, а не перегружают основной экран.
8. **Responsive by intent.** На мобильном контент перестраивается; пользователь не должен бороться с горизонтальным overflow всей страницы.

### 3.3 Визуальный характер

> **Открытое решение владельца (OD-1): светлая или тёмная основа.** Сейчас приложение тёмное: `--rf-color-bg: #0e1117`, карточки `--rf-color-surface-1: #13171f` (`styles/tokens.css`). Переход на светлую основу — это смена темы всего продукта, а не governance, и ни в один из PR 1–5 он не входит. До решения владельца принципы ниже (quiet UI, border-first, один акцент, семантический цвет) применяются к текущей тёмной теме; «белая поверхность» в П5 читается как «основная поверхность карточки» (`surface-1`).

- светлая основа (целевое направление, см. OD-1);
- нейтральные поверхности и контрастный текст;
- тонкие border;
- минимальные тени;
- умеренно скруглённые карточки и controls;
- один основной акцент;
- статусные цвета применяются только к статусам;
- отсутствие декоративных градиентов в рабочих аналитических блоках, если градиент не несёт смысловой функции.

Не переносить из Dub без отдельного решения: его точную палитру, feature-pill паттерны, маркетинговую hero-композицию, радиусы и display-font. Reflect остаётся аналитическим продуктом, а не landing page.

---

## 4. Design governance — визуальные правила

### П1. Цвета имеют семантические роли

- `accent` — активность, выбор, брендовый акцент.
- `warning` — предупреждение и риск, не CTA.
- `success` — подтверждённое успешное состояние, не источник данных и не положительная динамика по умолчанию.
- `danger` — ошибки и опасные действия.
- `info` — информационные сообщения.
- `neutral` — вторичные состояния, недоступность, нейтральные метки.

Нельзя использовать один цвет одновременно для action, warning, demo-state и confidence без ясного различения.

### П2. Данные не должны визуально вводить в заблуждение

- Нулевое изменение — нейтральное состояние: без стрелки роста/падения и без позитивного/негативного цвета.
- `null`, отсутствие данных и `0` визуально различаются.
- Цвет не должен подменять текстовое значение или объяснение.

### П3. Иерархия интерфейса

На аналитической странице:

1. Название страницы (H1).
2. Короткое пояснение, если нужно.
3. Главные KPI/summary.
4. Основной аналитический блок.
5. Таблица/детализация.
6. Дополнительные объяснения, допущения, источники и вторичные действия.

H1 — название раздела. Слоган/маркетинговая формулировка не заменяет название страницы.

### П4. Типографика

- Основной UI-шрифт — sans-serif, читаемый на разных размерах.
- Monospace — только технические значения: SKU, ID, код, source identifier, время синхронизации и аналогичная metadata.
- KPI — основной UI-шрифт с `tabular-nums`, если это помогает сравнению.
- Не использовать uppercase и letter-spacing как универсальный стиль для labels/statuses.
- Типографика должна использовать согласованную token scale; произвольные размеры в legacy CSS постепенно устраняются миграцией экранов.

### П5. Поверхности

- Canvas — базовая поверхность страницы.
- Cards — белая/основная поверхность с тонкой границей (в текущей тёмной теме — `surface-1`, см. OD-1).
- Muted/alt surface — для вторичных блоков и группировки.
- Не вкладывать карточку в карточку без функциональной причины.
- Градиенты не использовать как декоративную заливку аналитических панелей.
- Тени — для popover, menu, modal и других элементов, реально находящихся над интерфейсом.

### П6. Таблицы и responsive behavior

- Таблица должна сохранять доступ к ключевым данным и колонке решения.
- Вся страница не должна иметь горизонтального overflow.
- Если таблица шире контейнера, горизонтальная прокрутка ограничивается table wrapper и визуально обозначается.
- На ноутбучных разрешениях главная колонка (например, «Решение») должна оставаться видимой без скрытия ключевого результата.
- Вторичные данные можно сокращать, переносить в дополнительную строку, скрывать по breakpoint или перемещать колонку — но не скрывать смысловой вывод.
- На мобильных grid layouts перестраиваются, а не создают overflow.

### П7. Interaction & accessibility

- Интерактивная область не меньше 24×24 px для малых элементов (WCAG 2.5.8 AA target-size minimum).
- Визуальный размер и hit area могут отличаться: увеличить область клика без увеличения иконки.
- Фокус видим при keyboard navigation.
- Disabled, pending, error, success и empty states должны быть различимы.
- Ошибка поля имеет отдельный цвет и `aria-invalid`; обычная helper text не окрашивается как ошибка.
- Опасное действие — объясняющий `ConfirmDialog`, а не только удержание кнопки.
- Dialog должен поддерживать фокус, Escape и возврат фокуса.

### П8. Consistent components

- Один shared component — один визуальный контракт.
- Если нужен особый стиль, он оформляется явным variant/API, а не page-scoped CSS override.
- Новые screens/components используют канонические `--rf-*` tokens и shared UI components.
- Legacy styles постепенно мигрируют при работе над экраном; не запускать массовый refactor без отдельного PR.

### П9. Responsive breakpoints

Зафиксировать согласованный breakpoint contract и не добавлять локальные breakpoint values без обоснования.

На момент аудита используются договорные значения 760 / 1050 / 1500 px, а также дополнительные 900 / 640 / 420 px. C01 рекомендует постепенно убрать расхождения при миграции экранов, не переписывая все media queries сразу.

### П10. Empty & error states

- Empty state должен описывать отсутствие данных, а не ошибку инфраструктуры.
- Иконка выбирается по смыслу состояния, а не используется `CloudOff` для каждого пустого блока.
- Empty state нового канонического формата: title, explanation/help, optional action.
- Ошибка страницы и ошибка отдельного блока не должны автоматически смешиваться.
- Сохранение stale data при ошибке запроса — отдельное изменение логики, вне C01.

---

## 5. Existing tokens and target policy

### 5.1 Источник истины

Основной токен-слой — `styles/tokens.css` (`--rf-*`). Новые компоненты и новые стили должны опираться на него.

Аудит выявил в legacy `index.css`:

- 257 hex values (143 distinct);
- 30 `rgba()`;
- 132 font-size literals;
- 83 radius literals;
- 260 references to legacy `--app-*` vs 129 references to `--rf-*`;
- 23 rendered font sizes и 11 rendered radii на проверенных экранах.

Эти значения — зафиксированный долг, а не задача переписать файл целиком в C01.

### 5.2 Token policy

1. `--rf-*` — единственный стандарт для нового UI.
2. Не добавлять raw hex/rgb/rgba в screen styles, если цвет должен быть tokenized.
3. Не добавлять произвольные font sizes, radii, spacing values — использовать шкалы.
4. Legacy tokens/classes могут оставаться до миграции конкретного экрана.
5. Миграция tokens должна сопровождаться screenshot comparison.
6. Семантические роли (`warning`, `success`, `danger`, `info`) должны иметь достаточные surface/text/border variants для реальных use cases.

### 5.3 Known token issues to resolve

- `warning` и `accent` совпадают (`#e7b24f`) — требуется разделение.
- `border-strong` темнее `border`, хотя семантика названия предполагает более выраженную границу — исправить или переименовать.
- Семантические variants неполны: warning lacks `-surface`/`-text`; info lacks `-surface`/`-border`; danger lacks `-surface`.
- Chart palette hardcodes token values and overlaps semantic colors. Решение по графикам — в phase 5, не в C01.

---

## 6. Component policy

### 6.1 Канонические компоненты

Existing UI component library includes:

- `Button`;
- `IconButton`;
- `Card`;
- `TextField`;
- `Select`;
- `Badge`;
- `InlineNotice`;
- Data Trust components;
- common page states (skeleton, error, block error, missing value, refreshing notice).

### 6.2 Rules

- New UI must use the existing shared components when applicable.
- Do not use legacy `.btn`, `.card`, `.field` or raw controls for new implementation when a canonical component exists.
- Do not create local one-off versions of common interactions.
- Shared component variants must be explicit, typed and documented.
- Components must support relevant states: default, hover, focus-visible, active, disabled, pending, error, empty/loading as applicable.
- If a component is missing, propose it in a separate scoped task before creating local duplicates.

### 6.3 Migration approach

Audit showed current adoption gaps:

| Component | Existing usages in screens | Legacy usage |
|---|---:|---:|
| Button | 5 | `.btn` 48 |
| IconButton | 4 | — |
| Card | 0 | `.card` 66 |
| TextField / Select | 0 | `.field` 18; raw input 28; raw select 9 |
| Badge | 3 | `.status-tag` 7 |
| InlineNotice | 2 | legacy notice variants 13 |

Migration is screen-by-screen, not one global rewrite. Start with Settings because it is a concentrated legacy form and already has C01 findings.

---

## 7. Visual debt register

Priority definitions:

- **P0:** interface broken — none found.
- **P1:** significant issue in a primary workflow.
- **P2:** visible inconsistency / semantic problem.
- **P3:** polish, documentation, or migration debt.

| ID | Priority | Finding | Decision / action |
|---|---|---|---|
| C01-01 | P1 | External Media page overflows: 283 px at 375 viewport, 64 px at 768 | Table wrappers; effect grid single column ≤760 |
| C01-02 | P1 | Products/Advertising key columns clipped; Products seller overflow 32 px at 768 | Keep decision column visible at 1280+; revise column priority |
| C01-03 | P2 | Shared UI components not adopted | Migrate screen-by-screen, starting Settings |
| C01-04 | P2 | Legacy token literals | Convert with screen migration and visual review |
| C01-05 | P2 | Monospace used for KPI/labels/buttons | Mono only technical identifiers; KPI sans + tabular nums |
| C01-06 | P2 | Warning color equals accent | Owner decision, then semantic token split |
| C01-07 | P2 | Uppercase labels remain | Remove CSS uppercase and status label uppercase; update translations/tests |
| C01-08 | P2 | Overview page overrides shared component styles | Move good style to shared component or restore common appearance |
| C01-09 | P2 | Field helper text appears error-colored and too small | Separate helper and validation error styles |
| C01-10 | P2 | Settings has 5 primary buttons | One primary action per section/card; rest secondary |
| C01-11 | P2 | Touch targets 15×15 and 10×10 px | Increase hit area to ≥24×24 |
| C01-12 | P2 | Zero delta appears as green upward arrow | Neutral zero state |
| C01-13 | P2 | Chart colors hardcoded/order-dependent | Stable categorical palette separate from semantic status colors (Phase 5) |
| C01-14 | P2 | No shared Dialog/ConfirmDialog; HoldButton used 4 places | Shared Dialog and ConfirmDialog in Phase 4 |
| C01-15 | P3 | `border-strong` semantics inverted | Correct value or rename |
| C01-16 | P3 | “Your data” badge uses success color | Resolve with semantic color policy |
| C01-17 | P3 | Unused Tooltip/Toaster/shadcn theme mounted | Remove only after dependency check |
| C01-18 | P3 | Two single-select patterns | Unify in Phase 4 |
| C01-19 | P3 | 22/24 empty states legacy; CloudOff used universally | Migrate with each screen; use semantic icons |
| C01-20 | P3 | H1 slogans on 8/11 routes | Owner decision: page name H1; slogan becomes subtitle |
| C01-21 | P3 | Nested borders and gradients in Overview demo / Advertising | Simplify during screen migration |
| C01-22 | P3 | Breakpoints include undocumented 900/640/420 | Normalize during screen migration |
| C01-23 | P3 | Some request errors replace page and discard previous data | Separate logic task; outside C01 |
| C01-24 | P3 | Duplicate CSS rules in index.css | Remove when migrating affected selectors |
| C01-25 | P3 | Blueprint v3 absent from repository; phase numbering inconsistent | Add blueprint to docs; use PR IDs as canonical |

---

## 8. Implementation roadmap

The roadmap is risk-ordered and intentionally separates quick fixes from system-wide visual changes.

### PR 1 — Responsive layout and table visibility
**IDs:** C01-01, C01-02  
**Goal:** no page overflow; decision column visible on desktop.

Scope:
- External Media CSS, table wrappers, effect-grid responsive layout;
- Products and Advertising table layout/column priority;
- optional Products seller breakpoint adjustment.

Out of scope:
- data, sorting, calculations;
- shared table component rewrite;
- unrelated screens.

Acceptance:
- `scrollWidth - clientWidth === 0` for full page at 375, 768, 1280, 1440 on affected routes;
- decision column visible at 1280 and 1440;
- table overflow, if any, contained inside wrapper and has a discoverable scroll cue;
- e2e overflow checks for affected routes;
- before/after screenshots for affected routes at all four widths.

Risk: low; layout-only.

### PR 2 — Truthful states and small interaction fixes
**IDs:** C01-09, C01-10, C01-11, C01-12  
**Goal:** remove false visual signals and fix basic touch target size.

Scope:
- MetricCards zero delta;
- Settings field helper/error distinction;
- Hint and matrix target size;
- Settings button hierarchy.

Acceptance:
- zero change is neutral, no arrow;
- helper text is muted; validation error is clearly separate and uses proper semantics;
- hit area at least 24×24 at mobile;
- one primary action per Settings connection card/area;
- unit tests for zero/positive/negative/null delta;
- e2e or browser verification of target sizes;
- screenshots of Overview, Products, Settings.

Risk: low. If PR review considers scope too mixed, split KPI and form/accessibility changes.

### PR 3 — Typography and shared component consistency
**IDs:** C01-05, C01-07, C01-08  
**Goal:** remove monospace and uppercase from non-technical UI; eliminate Overview-only component appearance.

Scope:
- shared typography selectors, KPI, table headers and labels;
- transfer Overview overrides to shared components or restore shared styles;
- status labels/translations in all three languages;
- update e2e expectations.

Acceptance:
- monospace only for identifiers, code, source identifiers and timestamps;
- no uppercase styling in interface labels/statuses;
- affected font sizes use `--rf-text-*` scale;
- visual comparison at 375 and 1440 across routes, Overview at all four widths;
- translation and e2e checks green.

Risk: medium; shared styles can affect multiple screens.

### PR 4 — Semantic color correction
**IDs:** C01-06, C01-15, C01-16  
**Goal:** warning, accent, data source, border roles are distinct and consistent.

Prerequisite: owner decision on warning color and source badge tones.

Scope:
- semantic tokens;
- Data Trust badges;
- demo banner;
- contrast table in `design-tokens.md`.

Acceptance:
- warning ≠ accent;
- contrast ratio ≥4.5:1 for normal text on relevant surfaces;
- border-strong is semantically correct or renamed;
- “Your data” tone is not success/growth by default;
- screenshots of all pages using demo/source/assessment states;
- token and contrast review.

Risk: medium, visual impact across the app.

### PR 5 — Remove unused UI layer
**ID:** C01-17  
**Goal:** remove unused Tooltip, Toaster and shadcn theme only if not relied on indirectly.

Scope:
- `components/ui/tooltip.tsx`;
- `toast.tsx`, `toaster.tsx`;
- App mount points;
- theme tokens, only after dependency verification.

Acceptance:
- verified no usage/import dependency remains;
- build, typecheck and all tests pass;
- screenshot review confirms no visual changes.

Risk: low, conditional on dependency audit.

---

## 9. Blueprint phase mapping (canonical reference)

PR numbers should be the primary reference because the task, audit and Blueprint currently use conflicting phase names.

| PR | Actual merged work | C01 canonical label | Blueprint reference |
|---|---|---|---|
| #20 | Design Tokens | B01 | B01 / Phase 1 |
| #21 | UI Foundation | B02 | B02 / Phase 1 |
| #22 | App Shell | B03 | B03 / Phase 1 |
| #23 | Data Trust | B04 | B04 / Phase 1 |
| #24 | Overview | B05 | B07 / Phase 3 |
| #25 | Common UI States | B06 | Phase 6 |
| Next governance work | Visual Direction & Design Governance | C01 | Retroactive review; Blueprint Phase 2 originally planned earlier |

Do not rename already merged PRs to force a numbering scheme. Use this mapping in docs until Blueprint v3 is normalized.

---

## 10. Future Blueprint work (not part of immediate C01 PRs)

### Phase 4 — Interaction system
- shared `Dialog` and `ConfirmDialog`;
- replace four `HoldButton` usages;
- unify single-select/segmented/filter patterns (C01-14, C01-18).

### Phase 5 — Tables and charts
- define stable table column behavior, prioritization and overflow cue;
- define categorical chart palette independent from semantic colors;
- read chart colors from tokens rather than duplicate hardcoded values (C01-13);
- use PR1 table findings as inputs.

### Phase 7 — Navigation information architecture
- inventory routes, roles and common user scenarios;
- review grouping of nine work items;
- do not change navigation grouping during C01 without this inventory.

### Phase 8 — Screen migration
Migrate screen-by-screen to canonical components/tokens. Start with Settings, then prioritize by user impact and visual debt.

Each screen migration should address, where applicable:
- legacy `.btn`, `.card`, `.field`, raw input/select;
- legacy font/radius/color literals;
- empty states and icons;
- gradients and nested borders;
- breakpoint inconsistencies;
- duplicate CSS rules.

---

## 11. Deferred items and explicit boundaries

| Item | Status | Reason |
|---|---|---|
| C01-13 chart palette | Deferred to Phase 5 | Requires chart standard |
| C01-14 dialog | Deferred to Phase 4 | Interaction system |
| C01-18 single-select patterns | Deferred to Phase 4 | Interaction system |
| C01-20 H1 naming | Owner decision | Content/IA decision |
| C01-23 stale data retained after request error | Separate task | Changes request behavior and logic |
| Navigation grouping | Phase 7 | Requires route/user scenario inventory |
| Full legacy CSS migration | Phase 8 | Screen-by-screen; not global rewrite |

---

## 12. Risks, dependencies and review safeguards

### 12.1 PR policy

- Every change goes in its own branch from `main`; no direct pushes to `main`.
- One PR = one roadmap item (PR 1–5 above) or one screen migration; no mixing of Blueprint phases.
- Merge only with CI green (typecheck, translations, unit, e2e, build, API tests) and explicit owner approval.
- Owner decisions (OD-1 light/dark base, warning color and source tones for PR 4, C01-20 H1 semantics) are recorded in the PR before implementation starts.

### 12.2 Risks

- There is no automated visual-regression system. Screenshots must be captured and reviewed manually; no new visual testing dependency is introduced by C01.
- PR 3 and PR 4 affect shared styles and may create regressions on adjacent routes. Their visual review must include all routes at least at 375 and 1440; Overview at all four audited widths.
- Translation/e2e assertions will need updates for casing changes. Those updates should reflect intended UI copy, not mask unrelated regressions.
- PR #18 (“Access by clients in agency”) may conflict with Settings and translations. Rebase/resolve carefully; do not silently overwrite its work.
- PR 4 requires owner decision on warning color/source tones before implementation.
- C01-20 requires an owner decision on H1 semantics before screen migration.
- Audit counts are source-code counts and should not be presented as exact number of visible elements.

---

## 13. UI Definition of Done

A UI task is ready to merge only when all applicable items pass:

### Visual system
- [ ] Uses `--rf-*` tokens for new/changed styles.
- [ ] Uses approved typography scale and role.
- [ ] Color has semantic meaning; no status color reused as action without reason.
- [ ] Shared components are used; page-local duplicate is avoided.
- [ ] Borders/surfaces follow border-first policy; no decorative nested card or gradient without purpose.

### Responsive
- [ ] Verified at 375, 768, 1280 and 1440 px.
- [ ] Full page has no unintended horizontal overflow.
- [ ] Wide tables scroll within their wrapper, not the document.
- [ ] Key decision/action column remains visible or has an intentional, documented alternative.
- [ ] Layout changes are adaptive rather than merely shrinking desktop content.

### Interaction and accessibility
- [ ] Focus is visible.
- [ ] Keyboard interaction works.
- [ ] Hit areas meet 24×24 minimum where applicable.
- [ ] Buttons have correct hierarchy (one primary per area).
- [ ] Pending/disabled/error/success states are represented.
- [ ] Field helper text is not styled as validation error.
- [ ] Dialogs manage focus and Escape behavior.

### States and data clarity
- [ ] Empty state is not confused with service failure.
- [ ] `null`/missing data and numeric zero are distinct.
- [ ] Zero delta is neutral.
- [ ] Data source and freshness are clear where relevant.
- [ ] Error recovery is present and appropriate.

### Validation
- [ ] Typecheck and relevant unit tests pass.
- [ ] Translation validation passes.
- [ ] E2E checks pass.
- [ ] Build passes.
- [ ] Screenshots before/after are captured for affected and neighboring routes.
- [ ] No unrelated business logic/API changes.

---

## 14. C01 final acceptance criteria

C01 is accepted as governance work when:

- [ ] `docs/visual-direction.md` is created and contains the visual principles, rules and UI DoD.
- [ ] The visual reference (Dub) is documented as a source of principles, not copied literally.
- [ ] Existing token system is declared the source of truth (`--rf-*`).
- [ ] Component usage and migration policy are clear.
- [ ] Audit debt IDs C01-01…C01-25 are preserved and mapped to priorities.
- [ ] PR sequence and dependencies are documented.
- [ ] Blueprint v3 is stored in repo or a clear tracked issue/PR is created for adding it.
- [ ] PR-based implementation policy is explicit: branch from `main`, CI green, owner approval before merge.
- [ ] C01 documentation itself does not silently expand into frontend refactoring.

---

## 15. Suggested repository file layout

```text
docs/
├── visual-direction.md          # C01: visual governance and UI DoD
├── design-tokens.md            # token reference and contrast rules
├── ui-components.md            # shared component contracts
├── blueprint/
│   └── REFLECT_BLUEPRINT_v3.md # canonical Blueprint source
└── redesign/
    ├── b04/
    ├── b05/
    ├── b06/
    ├── b06-states/
    └── c01/
        └── audit.md            # evidence and findings
```

If the existing folder structure differs, adapt without moving unrelated documents.

---

## 16. C01 handoff

C01 should establish the rules and leave implementation work in discrete PRs. The recommended first implementation is **PR 1: Responsive layout and table visibility (C01-01, C01-02)** because it addresses a directly measurable usability problem with a low-risk CSS scope.

Next, complete PR 2 for truthful KPI and form states, then move to shared typography and semantic color. Screen migrations remain incremental.

**C01 does not authorize merging implementation PRs automatically.** Every PR is reviewed against scope, CI, screenshots, and the UI DoD before owner approval.
