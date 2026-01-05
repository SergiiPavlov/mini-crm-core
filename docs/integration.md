# Integration (public forms + widgets)

Этот документ описывает **единый** способ интеграции виджетов Mini CRM на внешний сайт.
Начиная с PR2/PR3, источником правды для полей формы является **конфиг в БД** (`PublicForm.config`),
а `widget.js` рендерит форму **динамически** по `GET /public/forms/:slug/:formKey/config`.

## 0) Термины

- **projectSlug** — человекочитаемый идентификатор проекта (например `volunteers-odesa-dev`).
- **publicKey** — публичный ключ проекта (передаётся как заголовок `X-Project-Key`).
- **formKey** — одна из форм: `lead | donation | booking | feedback`.
- **Origin allowlist** — список доменов, с которых разрешены публичные запросы к `/public/forms/*`.

## 1) Получить slug и publicKey проекта

1) Логин:

```bash
POST /auth/login
```

2) Список проектов пользователя:

```bash
GET /projects
```

В ответе у проекта будут поля:

- `project.slug` → `projectSlug`
- `project.publicKey` → `publicKey`

## 2) Разрешить домен сайта (Origin allowlist)

Если у проекта включён allowlist, то:

- для `POST /public/forms/:slug/:formKey` **Origin обязателен** и должен быть в allowlist;
- для `GET .../config` обычно allowlist тоже применяется (чтобы не светить конфиг со сторонних доменов).

Добавить домен можно из админки (или через API):

```bash
POST /projects/current/allowed-origins
Content-Type: application/json

{ "origin": "https://your-site.example" }
```

Для локального теста обычно добавляют:

- `http://localhost:8080` (если вы отдаёте тестовую HTML через локальный сервер)

Важно: домен в allowlist должен совпадать **строго**. Например, `http://localhost:8080` и
`http://localhost:8080/` — это разные строки, и второй вариант будет отклонён.

Важно: `file://` **не подходит**, у браузера нет нормального `Origin`, и submit будет блокироваться.

## 3) Единый виджет (рекомендуемый способ)

Подключайте **один файл**: `/widget/widget.js`.

### Пример вставки

```html
<!-- Кнопка появится сразу после <script> -->
<script
  src="https://mini-crm-core.onrender.com/widget/widget.js"
  data-project-slug="volunteers-odesa-dev"
  data-project-key="PUBLIC_KEY_HERE"
  data-form="donation"
  data-button-text="Пожертвувати"
  data-title="Пожертвування"
></script>
```

### Атрибуты

- `data-project-slug` (required) — slug проекта.
- `data-project-key` (required) — publicKey проекта.
- `data-form` (required) — `lead | donation | booking | feedback`.
- `data-button-text` (optional) — текст кнопки (по умолчанию `Відкрити форму`).
- `data-title` (optional) — заголовок модалки (если не задан, берётся `title` из config).
- `data-api-base` (optional) — базовый URL API. Если не задан, берётся `origin` из `script.src`.
  Полезно, если вы раздаёте статический JS с CDN, а API у вас на другом домене.

### Поведение

1) Виджет делает запрос конфига:

```http
GET /public/forms/:slug/:formKey/config
X-Project-Key: <publicKey>
```

2) Если `isActive=false`, кнопка скрывается.
3) Если конфиг загрузился — кнопка становится активной, по клику открывается модалка.
4) Submit отправляется на:

```http
POST /public/forms/:slug/:formKey
X-Project-Key: <publicKey>
Content-Type: application/json
Origin: https://your-site.example
```

## 4) Legacy-скрипты (обратная совместимость)

Для старых интеграций остаются пути:

- `/widget/lead-form.js`
- `/widget/donation-form.js`
- `/widget/booking-form.js`
- `/widget/feedback-form.js`

Они должны оставаться совместимыми (тонкие обёртки вокруг нового `/widget/widget.js`).
Для новых интеграций используйте **только** `/widget/widget.js`.

## 5) Формат конфига (schema)

Endpoint:

```http
GET /public/forms/:slug/:formKey/config
X-Project-Key: <publicKey>
```

Ответ (пример):

```json
{
  "formKey": "donation",
  "title": "Пожертвування",
  "isActive": true,
  "configVersion": "1",
  "fields": [
    {"name":"name","type":"text","label":"Ім'я","max":100},
    {"name":"email","type":"email","label":"Email","max":255},
    {"name":"phone","type":"tel","label":"Телефон","max":30},
    {"name":"amount","type":"amount","label":"Сума","min":0.01,"max":1000000,"required":true},
    {"name":"message","type":"textarea","label":"Коментар","max":2000},
    {"name":"source","type":"text","label":"Джерело","max":100}
  ],
  "rules": {
    "requireOneOf": ["name","email","phone"]
  }
}
```

### Supported field types

- `text`, `email`, `tel`, `textarea`
- `number`, `amount` (рендерится как `input[type=number]`, step по умолчанию `0.01`)
- `select` (через `options: [{value,label}]`)
- `checkbox`

### Common field props

- `name` (required)
- `label` (optional)
- `required` (optional)
- `placeholder` (optional)
- `min`, `max` (optional; для number/amount)
- `pattern` (optional)

### Supported rules

- `rules.requireOneOf: string[]` — минимум одно из перечисленных полей должно быть заполнено.

## 6) Ошибки валидации на submit

Если payload не проходит серверную валидацию — вернётся `400`:

```json
{
  "error": "Invalid form payload",
  "details": [
    {"field": "amount", "message": "Required"}
  ]
}
```

Виджет маппит `details[]` на ошибки полей.

## 7) Локальный тест (быстрый)

1) Поднимите API (пример):

```bash
npm run dev
```

2) Отдайте тестовую HTML через локальный статик, например:

```bash
npx serve . -l 8080
```

3) Убедитесь, что в allowlist проекта добавлен `http://localhost:8080`.
4) Откройте страницу в браузере по `http://localhost:8080/...` и в DevTools → Network проверьте:

- `GET /public/forms/:slug/:formKey/config` → `200`
- `POST /public/forms/:slug/:formKey` без required → `400` с `details[]`
- `POST ...` валидный → `201`


## Local testing example

A ready-to-run example page is available at `docs/examples/widget-test.html`.

Run a static server on port 8080 so the browser `Origin` matches the allowlist:

```bash
npx serve docs/examples -l 8080
# open:
# http://localhost:8080/widget-test.html
```

Update `data-project-slug` and `data-project-key` in the HTML before testing.
