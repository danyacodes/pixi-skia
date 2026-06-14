# pixi-skia

Адаптер, который транслирует scene graph **Pixi.js** в команды рисования **Skia CanvasKit** через промежуточное представление (IR).  
Включает **side-by-side** сравнение рендеров, **векторный PDF-экспорт** через Skia PDF backend и **единую систему pointer-событий** для обоих канвасов.

---

## Возможности

| Функция | Описание |
|---------|----------|
| **Pixi → IR → Skia** | Конвертация PIXI.Container в IR-дерево, рендеринг через CanvasKit |
| **Side-by-side** | Два канваса рядом: Pixi (нативный) слева, Skia справа |
| **Генерация фигур** | Кнопка добавляет случайные прямоугольники, круги, ломаные, полигоны |
| **PDF-экспорт** | Векторный PDF через Skia PDF backend (графика — вектор, спрайты — bitmap) |
| **Pointer-события** | `pointerdown` / `pointerup` с hit-testing на обоих канвасах + курсор |

---

## Архитектура

```
PIXI.Container (scene graph)
       │
       ▼
 PixiToIRAdapter          ─── src/adapter/pixi-adapter.ts
       │
       ▼
   IR Tree                ─── src/ir/types.ts
   (IRContainer / IRSprite / IRGraphics)
       │
       ├──▶ SkiaRenderer  ─── src/renderer/skia-renderer.ts    → WebGL canvas
       └──▶ PDFExporter   ─── src/renderer/pdf-exporter.ts     → vector PDF
```

### Структура проекта

```
pixi-skia/
├── public/
│   ├── canvaskit.js          # CanvasKit WASM (npm или кастомная сборка)
│   └── canvaskit.wasm
├── scripts/
│   ├── build-canvaskit-pdf.sh  # Скрипт сборки CanvasKit с PDF
│   └── pdf_bindings.cpp        # C++ биндинги для PDF API
├── src/
│   ├── adapter/
│   │   └── pixi-adapter.ts     # PIXI → IR конвертер
│   ├── assets/
│   │   └── tree.png            # Тестовый спрайт
│   ├── events/
│   │   └── event-bridge.ts     # Pointer-события для обоих канвасов
│   ├── ir/
│   │   └── types.ts            # Типы IR (Container, Sprite, Graphics)
│   ├── renderer/
│   │   ├── skia-renderer.ts    # IR → CanvasKit WebGL
│   │   ├── pdf-exporter.ts     # IR → CanvasKit PDF
│   │   └── texture-cache.ts    # Кеш текстур (URL → SkImage)
│   ├── canvaskit-loader.ts     # Загрузчик: npm vs кастомная сборка
│   ├── canvaskit-pdf.ts        # Типы PDF API + runtime-детекция
│   └── main.ts                 # Точка входа, демо-сцена
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Быстрый старт

### Требования

- **Node.js** ≥ 18
- **npm** ≥ 9

### Установка

```bash
git clone <repo-url> pixi-skia
cd pixi-skia
npm install
```

### Запуск (dev-сервер)

```bash
npm run dev
```

Откройте URL из терминала (обычно `http://localhost:5173`).  
Вы увидите два канваса рядом — **Pixi.js** слева, **Skia CanvasKit** справа — с одной и той же сценой.

### Production-сборка

```bash
npm run build
npm run preview
```

---

## PDF-экспорт

### Как работает

Кнопка **«Экспорт в PDF»** делает снимок текущей сцены и рендерит его в PDF:

- **Graphics** (rect, circle, polygon, polyline) → **векторные** PDF-пути
- **Sprite** (tree.png и т.д.) → **встроенный bitmap**

### Необходима кастомная сборка CanvasKit

Стандартный `canvaskit-wasm` из npm **не включает** PDF backend.  
Нужна кастомная сборка Skia с `skia_enable_pdf=true` + наши C++ биндинги.

#### Предварительные требования (Linux / macOS / WSL)

- git, python3, curl
- ninja-build
- ~10 GB свободного места на диске

#### Сборка

```bash
chmod +x scripts/build-canvaskit-pdf.sh
./scripts/build-canvaskit-pdf.sh
```

Скрипт автоматически:

1. Устанавливает **depot_tools** и **Emscripten SDK**
2. Клонирует **Skia** и синхронизирует зависимости
3. Копирует `pdf_bindings.cpp` в `modules/canvaskit/` и патчит `BUILD.gn`
4. Конфигурирует GN с `skia_enable_pdf=true`, `skia_use_freetype=true`, `skia_use_harfbuzz=true`
5. Собирает через **ninja**
6. Копирует `canvaskit.js` и `canvaskit.wasm` в `public/`

#### Автодетекция

Загрузчик `canvaskit-loader.ts` определяет наличие кастомной сборки автоматически:

- Если `public/canvaskit.js` существует и имеет `Content-Type: javascript` → загружает через `<script>` тег (CJS/UMD совместимость)
- Иначе → использует npm-пакет `canvaskit-wasm` (Vite пре-бандлит CJS → ESM)

#### Без кастомной сборки

Кнопка PDF покажет alert с инструкциями и выведет диагностику в консоль браузера (список доступных `Make*` функций и классов в CanvasKit).

---

## Pointer-события

### EventBridge

Класс `EventBridge` обеспечивает единую систему pointer-событий для обоих канвасов:

```typescript
import { EventBridge, BRIDGE_EVENTS } from "./events/event-bridge";
import type { BridgePointerEvent } from "./events/event-bridge";

const bridge = new EventBridge(pixiCanvas, skiaCanvas, stage);

// Подписка на события
obj.on(BRIDGE_EVENTS.POINTER_DOWN, (e: BridgePointerEvent) => {
  console.log(`Click on ${e.target.constructor.name} via ${e.source}`);
});
```

### Как работает

1. DOM-события `pointerdown` / `pointerup` / `pointermove` слушаются на **обоих** `<canvas>`
2. Координаты конвертируются в canvas-space (с учётом CSS-масштабирования)
3. **Hit-testing** — обход scene graph в обратном порядке (topmost first), проверка `getBounds().contains(x, y)` у объектов с `eventMode = "static"`
4. Найденный `DisplayObject` получает событие `bridge:pointerdown` / `bridge:pointerup`
5. **Курсор** обновляется каждый кадр через `bridge.tick()`, что позволяет корректно реагировать на движущиеся объекты

### BridgePointerEvent

| Поле | Тип | Описание |
|------|-----|----------|
| `target` | `PIXI.DisplayObject` | Объект, по которому кликнули |
| `global` | `PIXI.Point` | Координаты в canvas-space |
| `originalEvent` | `PointerEvent` | Исходное DOM-событие |
| `source` | `"pixi" \| "skia"` | Какой канвас сгенерировал событие |

---

## Скрипты npm

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск Vite dev-сервера с HMR |
| `npm run build` | TypeScript проверка + production-сборка |
| `npm run preview` | Просмотр production-сборки |

---

## Стек технологий

| Технология | Версия | Назначение |
|-----------|--------|------------|
| [pixi.js-legacy](https://pixijs.com/) | ^7.2.4 | Scene graph + Canvas/WebGL рендер |
| [canvaskit-wasm](https://skia.org/docs/user/modules/canvaskit/) | ^0.41.1 | Skia рендер через WASM |
| [Vite](https://vite.dev/) | ^8.0 | Сборщик + dev-сервер |
| [TypeScript](https://www.typescriptlang.org/) | ~6.0 | Типизация |
