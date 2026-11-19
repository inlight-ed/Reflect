# Базовые UI-компоненты

Код: `artifacts/shift-market/src/components/ui/`, стили: `src/styles/ui.css` (классы `rf-*`, значения только из `styles/tokens.css`).

```tsx
import { Button, IconButton, TextField, Select, Badge, Card, InlineNotice, SkeletonText, SkeletonCard, SkeletonMetric } from '@/components/ui';
```

Компоненты зависят только от React, lucide-react и `cn` из `@/lib/utils`. Импортировать `@/components/common` или страницы из них нельзя, иначе появятся циклы.

| Компонент | Когда использовать | Главное |
|---|---|---|
| `Button` | любое действие | `variant`: `primary` (одно главное действие на экране), `secondary`, `tertiary` (тихое), `danger`. `size`: `md` (40 px) или `sm` (32 px). `pending` блокирует кнопку, показывает спиннер и `aria-busy`. По умолчанию `type="button"`. |
| `IconButton` | кнопка только с иконкой | `label` обязателен: это имя для скринридера и подсказка. Без него код не компилируется. |
| `TextField` | однострочный ввод | `label`, `description`, `error`. Связи `label`↔поле и `aria-describedby` на описание и ошибку проставляются сами, ошибка ставит `aria-invalid`. Остальные свойства — как у `<input>`. |
| `Select` | выбор из списка | Нативный `<select>` (на телефоне системный выбор). `options`, необязательный `placeholder` с пустым значением. |
| `Badge` | короткий статус | `tone`: `neutral`, `success`, `warning`, `danger`, `info`. Текст обязателен, цвет и точка декоративные. `description` — пояснение для скринридера и подсказки. |
| `Card` | поверхность для группы | `padding="default"` для содержимого, `"none"` для таблицы или списка во всю ширину. `as="section"`, если внутри свой заголовок. |
| `InlineNotice` | сообщение внутри страницы | `tone` со своей иконкой, `title`, одно `action`. Объявление: `danger` — `alert`, остальные — `status`. `announce="none"` для сообщений, которые есть с первой отрисовки. |
| `SkeletonText` / `SkeletonCard` / `SkeletonMetric` | пока данные грузятся | Скрыты от скринридера. Сам загружающийся блок помечается `aria-busy="true"`. |

## Соответствие старым классам

Старые классы остаются, пока экраны не переведены:

| Сейчас | Станет |
|---|---|
| `.btn`, `.btn.secondary`, `.btn.danger`, `.btn-small` | `Button` |
| `.top-action` | `IconButton` |
| `.field` + `<small>` | `TextField` / `Select` |
| `.status-tag.tag-*`, `.source-pill` | `Badge` (подписи решений и источников — в PR со статусами) |
| `.card` (без внутренних отступов) | `Card padding="none"` |
| `.card.card-pad` (отступ 20 px) | `Card` (по умолчанию `padding="default"`, отступ 24 px, на мобильном 16 px) |
| `.report-notice`, `.assumption-note`, `.advertising-note`, `.form-error` | `InlineNotice` |
| `.skeleton` в `LoadingState` | `Skeleton*` |

**Карточки при переносе.** У `Card` по умолчанию есть внутренний отступ, а у старой `.card` его нет. Поэтому `.card` без `.card-pad` переносится только как `Card padding="none"`, иначе карточка с таблицей или списком получит лишние поля. Даже при правильном варианте вид немного меняется: отступ 20 → 24 px, радиус 6 → 12 px, рамка `#252b35` → `border-strong`. Это плановое изменение, его сверяют скриншотами экрана.

Уже есть и не дублируются: `ProgressBar` и `HoldButton` в `components/motion.tsx`, подсказка `Hint` в `components/common.tsx`.
