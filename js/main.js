/**
 * «Гаранин | ИТ-сервисы» — лендинг: интерактив на чистом JavaScript.
 * Без библиотек, сборки и CDN.
 *
 * Модули файла:
 *   1. initBackground  — 3D-сцена на <canvas> в зафиксированном слое фона;
 *   2. initReveal      — появление карточек при скролле (IntersectionObserver);
 *   3. initSmoothScroll— плавные якорные переходы + перенос фокуса;
 *   4. initApproachSpy — подсветка активного шага блока «Как мы работаем»;
 *   5. initHeaderState — тень шапки после прокрутки.
 */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* ----------------------------------------------------------------------
       1. Слой фона: неоновая 3D-сетка (network) в стиле Cyberpunk 2077.
       Свечение — аддитивное смешивание и готовые спрайты, вспышки, потоки
       данных по связям, редкий глитч и сканирующая полоса. Фигура растянута
       на 80 % экрана по обеим осям и опущена ниже шапки.
       Фон зафиксирован (position: fixed в CSS) и не участвует в скролле.
       ---------------------------------------------------------------------- */
    function initBackground() {
        var canvas = document.getElementById('bg-canvas');
        if (!canvas || typeof canvas.getContext !== 'function') {
            return;
        }

        var ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        var NODE_COUNT = 40;           // количество узлов сети
        var CLOUD_RADIUS = 330;        // радиус облака в мировых координатах
        var LINK_DISTANCE = 215;       // максимальная длина связи между узлами
        var FOCAL_LENGTH = 430;        // «фокусное расстояние» перспективы
        var ROTATION_SPEED = 0.00016;  // радиан за миллисекунду
        var FIGURE_SCREEN_SHARE = 0.8; // фигура занимает 80 % экрана по каждой стороне
        var HEADER_GAP = 24;           // добавка к высоте шапки при опускании фигуры
        var COLOR_CYCLE_MS = 7000;     // период перелива цвета узла
        var FLASH_CHANCE = 0.02;       // шанс вспышки за кадр
        var FLASH_LIFE = 900;          // длительность вспышки, мс
        var STREAM_COUNT = 4;          // «потоки данных» по связям
        var TARGET_FPS = 40;           // ограничитель частоты отрисовки фона
        var MAX_DPR = 1.5;             // ограничение плотности пикселей: меньше площадь заливки
        var GLITCH_EVERY = 9000;       // период глитча, мс
        var GLITCH_LIFE = 150;         // длительность глитча, мс
        var MAX_LINKS = 900;           // предохранитель по числу связей в кадре
        var SPARK_LIFE = 620;          // жизнь искры от удара луча, мс
        var RECOIL_IMPULSE = 10;       // импульс узла при попадании луча, px

        // Неоновая палитра: циан, маджента, электрик-жёлтый, фиолет
        var NEON = [
            { glow: '0, 229, 255', core: '198, 250, 255' },
            { glow: '255, 43, 214', core: '255, 214, 247' },
            { glow: '247, 231, 51', core: '255, 251, 199' },
            { glow: '122, 92, 255', core: '224, 214, 255' }
        ];

        var nodes = [];
        var links = [];
        var flashes = [];
        var sparks = [];
        var streams = [];
        var sprites = [];
        var width = 0;
        var height = 0;
        var headerOffset = 0;
        var angle = 0;
        var frameDelta = 16;
        var rafId = null;
        var lastDraw = 0;
        var lastGlitch = -Infinity;
        var glitchOffset = 0;
        var supportsPath2D = typeof window.Path2D === 'function';

        function neonGlow(colorIndex) {
            return NEON[colorIndex % NEON.length].glow;
        }

        // Свечение рисуем готовым спрайтом: дешевле, чем shadowBlur на каждый узел
        function buildSprites() {
            sprites = NEON.map(function (color) {
                var size = 96;
                var sprite = document.createElement('canvas');
                sprite.width = size;
                sprite.height = size;
                var spriteCtx = sprite.getContext('2d');
                var gradient = spriteCtx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
                gradient.addColorStop(0, 'rgba(' + color.glow + ', 0.95)');
                gradient.addColorStop(0.22, 'rgba(' + color.glow + ', 0.48)');
                gradient.addColorStop(0.55, 'rgba(' + color.glow + ', 0.14)');
                gradient.addColorStop(1, 'rgba(' + color.glow + ', 0)');
                spriteCtx.fillStyle = gradient;
                spriteCtx.fillRect(0, 0, size, size);
                return sprite;
            });
        }

        function createNodes() {
            nodes = [];
            // Равномерное распределение направлений (золотое сечение) и три оболочки
            // по радиусу: при небольшом числе узлов фигура выглядит собранной,
            // а не набором случайных клочьев.
            var golden = Math.PI * (3 - Math.sqrt(5));
            var shells = [0.55, 0.78, 1];
            for (var i = 0; i < NODE_COUNT; i++) {
                var u = 1 - (2 * i + 1) / NODE_COUNT; // −1..1 равномерно по высоте
                var ring = Math.sqrt(Math.max(0, 1 - u * u));
                var theta = golden * i;
                var radius = CLOUD_RADIUS * shells[i % shells.length];
                nodes.push({
                    x: radius * ring * Math.cos(theta),
                    y: radius * u,
                    z: radius * ring * Math.sin(theta),
                    size: 1.2 + Math.random() * 2,
                    phase: Math.random() * Math.PI * 2,
                    color: Math.floor(Math.random() * NEON.length),
                    blink: 0.0009 + Math.random() * 0.0016
                });
            }
        }

        function createStreams() {
            streams = [];
            for (var i = 0; i < STREAM_COUNT; i++) {
                // Поток бежит по случайной связи, если связи есть
                var link = links.length ? links[Math.floor(Math.random() * links.length)] : [0, 0];
                streams.push({
                    from: link[0],
                    to: link[1],
                    t: Math.random(),
                    speed: 0.0009 + Math.random() * 0.0016,
                    color: Math.floor(Math.random() * NEON.length)
                });
            }
        }

        // Топология сети постоянна: связь существует, если узлы близки в мировых
        // координатах. Так растяжение фигуры не превращает её в сплошную сетку.
        function buildLinks() {
            links = [];
            var limit = LINK_DISTANCE * LINK_DISTANCE;
            for (var i = 0; i < nodes.length; i++) {
                for (var j = i + 1; j < nodes.length; j++) {
                    var dx = nodes[i].x - nodes[j].x;
                    var dy = nodes[i].y - nodes[j].y;
                    var dz = nodes[i].z - nodes[j].z;
                    if (dx * dx + dy * dy + dz * dz <= limit) {
                        links.push([i, j]);
                    }
                }
            }
        }

        function headerHeight() {
            var header = document.querySelector('header');
            return header ? header.offsetHeight : 72;
        }

        function resize() {
            var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
            width = canvas.clientWidth || window.innerWidth;
            height = canvas.clientHeight || window.innerHeight;
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            headerOffset = headerHeight() + HEADER_GAP;
        }

        // Вращение вокруг оси Y и перспективная проекция узла в единичном масштабе.
        // Возвращает смещения относительно центра сцены — масштаб применяется в draw().
        function project(node, cos, sin) {
            var x = node.x * cos - node.z * sin;
            var z = node.x * sin + node.z * cos;
            var depth = z + CLOUD_RADIUS * 1.7; // сдвиг камеры: все точки перед ней
            var k = FOCAL_LENGTH / (FOCAL_LENGTH + depth + node.y * 0.25);
            return {
                dx: x * k,
                dy: node.y * k,
                size: Math.max(0.6, node.size * k),
                depth: depth,
                alpha: Math.min(1, Math.max(0.12, 1.25 - depth / (CLOUD_RADIUS * 2.6)))
            };
        }

        // Связи одним проходом по неоновым путям (по цвету и яркости), затем
        // каждая группа обводится дважды: яркое ядро + широкое гало.
        // Набор связей постоянный (см. buildLinks) — считается только затухание
        // по экранной длине, чтобы растянутая связь не светилась ярче короткой.
        function drawLinks(projected, linkSpan) {
            var halo = [];
            var core = [];
            var colorIndex;
            var bucket;
            var i;
            var a;
            var b;

            if (supportsPath2D) {
                for (colorIndex = 0; colorIndex < NEON.length; colorIndex++) {
                    halo.push([new window.Path2D(), new window.Path2D(), new window.Path2D()]);
                    core.push([new window.Path2D(), new window.Path2D(), new window.Path2D()]);
                }
            }

            var drawn = 0;
            for (i = 0; i < links.length && drawn < MAX_LINKS; i++) {
                a = projected[links[i][0]];
                b = projected[links[i][1]];
                if (!a || !b) {
                    continue;
                }
                var dx = a.x - b.x;
                var dy = a.y - b.y;
                var distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > linkSpan) {
                    continue;
                }
                drawn++;
                var strength = (1 - distance / linkSpan) * a.alpha * b.alpha;
                if (strength <= 0.02) {
                    continue;
                }
                bucket = strength > 0.5 ? 2 : (strength > 0.22 ? 1 : 0);
                colorIndex = a.color;
                if (supportsPath2D) {
                    core[colorIndex][bucket].moveTo(a.x, a.y);
                    core[colorIndex][bucket].lineTo(b.x, b.y);
                    halo[colorIndex][bucket].moveTo(a.x, a.y);
                    halo[colorIndex][bucket].lineTo(b.x, b.y);
                } else {
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = 'rgba(' + neonGlow(colorIndex) + ', ' + (strength * 0.5).toFixed(3) + ')';
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }

            if (!supportsPath2D) {
                return;
            }

            var alphas = [0.12, 0.26, 0.44];
            for (colorIndex = 0; colorIndex < NEON.length; colorIndex++) {
                for (bucket = 0; bucket < 3; bucket++) {
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = 'rgba(' + neonGlow(colorIndex) + ', ' + alphas[bucket].toFixed(2) + ')';
                    ctx.stroke(core[colorIndex][bucket]);
                    ctx.lineWidth = 3.2;
                    ctx.strokeStyle = 'rgba(' + neonGlow(colorIndex) + ', ' + (alphas[bucket] * 0.32).toFixed(3) + ')';
                    ctx.stroke(halo[colorIndex][bucket]);
                }
            }
        }

        // Удар луча в точку связи: узел получает импульс (пружинит обратно),
        // из точки вылетают искры с инерцией и затуханием.
        function spawnImpact(nodeIndex, colorIndex, time, screenX, screenY) {
            var node = nodes[nodeIndex];
            if (node) {
                var pushAngle = Math.random() * Math.PI * 2;
                node.recoilX = (node.recoilX || 0) + Math.cos(pushAngle) * RECOIL_IMPULSE;
                node.recoilY = (node.recoilY || 0) + Math.sin(pushAngle) * RECOIL_IMPULSE;
            }
            if (reduceMotion.matches) {
                return;
            }
            for (var i = 0; i < 3; i++) {
                var angle = Math.random() * Math.PI * 2;
                var speed = 0.05 + Math.random() * 0.13; // px за мс
                sparks.push({
                    x: screenX,
                    y: screenY,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    start: time,
                    color: i === 0 ? colorIndex : Math.floor(Math.random() * NEON.length)
                });
            }
        }

        function drawSparks(time) {
            for (var i = sparks.length - 1; i >= 0; i--) {
                var spark = sparks[i];
                var life = (time - spark.start) / SPARK_LIFE;
                if (life >= 1) {
                    sparks.splice(i, 1);
                    continue;
                }

                // Инерция с затуханием: искра отлетает и мягко тормозит
                spark.x += spark.vx * frameDelta;
                spark.y += spark.vy * frameDelta;
                spark.vx *= 0.94;
                spark.vy *= 0.94;

                var fade = 1 - life;
                var size = 10 + 18 * fade;
                ctx.globalAlpha = 0.85 * fade;
                ctx.drawImage(sprites[spark.color], spark.x - size / 2, spark.y - size / 2, size, size);
                ctx.globalAlpha = 1;

                ctx.fillStyle = 'rgba(' + NEON[spark.color].core + ', ' + (0.85 * fade).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(spark.x, spark.y, 1.1 + 1.9 * fade, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        function drawStreams(projected, time) {
            for (var i = 0; i < streams.length; i++) {
                var stream = streams[i];
                if (!reduceMotion.matches) {
                    stream.t += stream.speed * frameDelta;
                    if (stream.t > 1) {
                        // Луч дошёл до точки связи — импульс и искры
                        var hit = projected[stream.to];
                        if (hit) {
                            spawnImpact(stream.to, stream.color, time, hit.x, hit.y);
                        }
                        var nextLink = links.length ? links[Math.floor(Math.random() * links.length)] : [0, 0];
                        stream.t = 0;
                        stream.from = nextLink[0];
                        stream.to = nextLink[1];
                        stream.color = Math.floor(Math.random() * NEON.length);
                    }
                }

                var from = projected[stream.from];
                var to = projected[stream.to];
                if (!from || !to) {
                    continue;
                }

                var headT = stream.t;
                var tailT = Math.max(0, headT - 0.18);
                var headX = from.x + (to.x - from.x) * headT;
                var headY = from.y + (to.y - from.y) * headT;
                var tailX = from.x + (to.x - from.x) * tailT;
                var tailY = from.y + (to.y - from.y) * tailT;

                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(' + NEON[stream.color].core + ', 0.85)';
                ctx.beginPath();
                ctx.moveTo(tailX, tailY);
                ctx.lineTo(headX, headY);
                ctx.stroke();

                var size = 20 + from.size * 5;
                ctx.globalAlpha = 0.7;
                ctx.drawImage(sprites[stream.color], headX - size / 2, headY - size / 2, size, size);
                ctx.globalAlpha = 1;
            }
        }

        function drawFlashes(projected, time) {
            if (!reduceMotion.matches && Math.random() < FLASH_CHANCE) {
                flashes.push({
                    index: Math.floor(Math.random() * NODE_COUNT),
                    start: time,
                    color: Math.floor(Math.random() * NEON.length)
                });
            }

            for (var i = flashes.length - 1; i >= 0; i--) {
                var flash = flashes[i];
                var target = projected[flash.index];
                var progress = Math.min(1, (time - flash.start) / FLASH_LIFE);
                if (!target) {
                    flashes.splice(i, 1);
                    continue;
                }

                var fade = 1 - progress;
                ctx.lineWidth = 2.4 * fade + 0.4;
                ctx.strokeStyle = 'rgba(' + neonGlow(flash.color) + ', ' + (0.6 * fade * fade).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(target.x, target.y, 6 + progress * 96, 0, Math.PI * 2);
                ctx.stroke();

                var burst = 30 + progress * 150;
                ctx.globalAlpha = 0.6 * fade;
                ctx.drawImage(sprites[flash.color], target.x - burst / 2, target.y - burst / 2, burst, burst);
                ctx.globalAlpha = 1;

                if (progress >= 1) {
                    flashes.splice(i, 1);
                }
            }

            // Короткая засветка всего кадра в момент вспышки
            var wash = 0;
            for (i = 0; i < flashes.length; i++) {
                var phase = (time - flashes[i].start) / FLASH_LIFE;
                if (phase >= 0 && phase < 0.35) {
                    wash = Math.max(wash, 1 - phase / 0.35);
                }
            }
            if (wash > 0) {
                ctx.fillStyle = 'rgba(0, 229, 255, ' + (0.03 * wash).toFixed(3) + ')';
                ctx.fillRect(0, 0, width, height);
            }
        }

        function drawNodes(projected) {
            for (var i = 0; i < projected.length; i++) {
                var point = projected[i];
                var glow = 18 + point.size * 12 + point.pulse * 14;

                ctx.globalAlpha = Math.min(1, point.alpha * (0.5 + point.pulse * 0.6));
                ctx.drawImage(sprites[point.color], point.x - glow / 2, point.y - glow / 2, glow, glow);
                ctx.globalAlpha = 1;

                ctx.fillStyle = 'rgba(' + NEON[point.color].core + ', ' +
                    Math.min(1, point.alpha * (0.55 + point.pulse * 0.45)).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(point.x, point.y, point.size * (0.7 + point.pulse * 0.5), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Сканирующая полоса + редкие глитч-штрихи: характерный «CRT»-слой
        function drawScanAndGlitch(time) {
            var sweepY = ((time * 0.05) % (height + 240)) - 120;
            var sweep = ctx.createLinearGradient(0, sweepY - 70, 0, sweepY + 70);
            sweep.addColorStop(0, 'rgba(0, 229, 255, 0)');
            sweep.addColorStop(0.5, 'rgba(0, 229, 255, 0.04)');
            sweep.addColorStop(1, 'rgba(0, 229, 255, 0)');
            ctx.fillStyle = sweep;
            ctx.fillRect(0, sweepY - 70, width, 140);

            if (!glitchOffset) {
                return;
            }

            for (var i = 0; i < 5; i++) {
                ctx.fillStyle = 'rgba(' + neonGlow(i) + ', 0.18)';
                ctx.fillRect(
                    Math.random() * width * 0.7,
                    Math.random() * height,
                    40 + Math.random() * width * 0.3,
                    1.5 + Math.random() * 2
                );
            }
        }

        function draw(time) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, width, height);

            var halfHeight = FIGURE_SCREEN_SHARE * 0.5 * height;
            var centerX = width * 0.5;
            // Фигура опущена ниже шапки: сдвиг чуть больше её высоты
            var centerY = height * 0.46 + headerOffset;
            centerY = Math.min(centerY, height - halfHeight + 32);
            var bobbing = Math.sin(time * 0.0004) * 12;
            var cos = Math.cos(angle);
            var sin = Math.sin(angle);
            var raw = [];
            var minX = Infinity;
            var maxX = -Infinity;
            var minY = Infinity;
            var maxY = -Infinity;
            var projected = [];
            var i;
            var j;

            // 1. Измеряем фактическую проекцию облака в текущей фазе вращения.
            for (i = 0; i < nodes.length; i++) {
                raw.push(project(nodes[i], cos, sin));
                minX = Math.min(minX, raw[i].dx);
                maxX = Math.max(maxX, raw[i].dx);
                minY = Math.min(minY, raw[i].dy);
                maxY = Math.max(maxY, raw[i].dy);
            }

            // 2. Масштаб: фигура занимает FIGURE_SCREEN_SHARE (80 %) И по ширине, И по высоте
            //    экрана — растяжение неоднородное, по каждой оси своё.
            var extentX = Math.max((maxX - minX) / 2, 1);
            var extentY = Math.max((maxY - minY) / 2, 1);
            var scaleX = (FIGURE_SCREEN_SHARE * 0.5 * width) / extentX;
            var scaleY = (FIGURE_SCREEN_SHARE * 0.5 * height) / extentY;
            // Порог только для затухания связи на экране: сама топология постоянна
            var linkSpan = LINK_DISTANCE * (scaleX + scaleY) / 2;

            // 3. Координаты на экране: цвет переливается, узлы пульсируют, при глитче — сдвиг,
            //    после удара луча — упругая отдача узла.
            for (i = 0; i < raw.length; i++) {
                j = glitchOffset && i % 3 === 0 ? glitchOffset * (i % 2 ? 1 : -0.7) : 0;
                if (nodes[i].recoilX || nodes[i].recoilY) {
                    nodes[i].recoilX *= 0.9;
                    nodes[i].recoilY *= 0.9;
                    if (Math.abs(nodes[i].recoilX) < 0.05) {
                        nodes[i].recoilX = 0;
                    }
                    if (Math.abs(nodes[i].recoilY) < 0.05) {
                        nodes[i].recoilY = 0;
                    }
                }
                projected.push({
                    x: centerX + raw[i].dx * scaleX + j + (nodes[i].recoilX || 0),
                    y: centerY + raw[i].dy * scaleY + bobbing + (nodes[i].recoilY || 0),
                    size: raw[i].size,
                    alpha: raw[i].alpha,
                    color: (nodes[i].color + Math.floor((time + nodes[i].phase * 3000) / COLOR_CYCLE_MS)) % NEON.length,
                    pulse: 0.55 + 0.45 * Math.sin(time * nodes[i].blink + nodes[i].phase)
                });
            }

            // 4. Неоновая отрисовка: аддитивное смешивание даёт свечение и переливы.
            ctx.globalCompositeOperation = 'lighter';
            drawLinks(projected, linkSpan);
            drawStreams(projected, time);
            drawSparks(time);
            drawFlashes(projected, time);
            drawNodes(projected);
            drawScanAndGlitch(time);
            ctx.globalCompositeOperation = 'source-over';
        }

        function updateGlitch(time) {
            if (time - lastGlitch > GLITCH_EVERY) {
                lastGlitch = time;
                glitchOffset = 6 + Math.random() * 14;
            } else if (glitchOffset && time - lastGlitch > GLITCH_LIFE) {
                glitchOffset = 0;
            }
        }

        // Ограничитель частоты: фон рисуется не чаще TARGET_FPS кадров в секунду,
        // лишние кадры requestAnimationFrame пропускаются.
        function loop(time) {
            var sinceDraw = time - lastDraw;
            if (sinceDraw >= 1000 / TARGET_FPS) {
                frameDelta = lastDraw ? Math.min(sinceDraw, 80) : 16;
                lastDraw = time;
                angle += ROTATION_SPEED * frameDelta;
                updateGlitch(time);
                draw(time);
            }
            rafId = window.requestAnimationFrame(loop);
        }

        function start() {
            if (rafId !== null || reduceMotion.matches) {
                return;
            }
            lastDraw = 0;
            rafId = window.requestAnimationFrame(loop);
        }

        function stop() {
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
                rafId = null;
            }
        }

        function renderOnce() {
            stop();
            glitchOffset = 0;
            draw(0);
        }

        function handleResize() {
            resize();
            if (reduceMotion.matches || document.hidden) {
                renderOnce();
            }
        }

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(handleResize, 150);
        });

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                stop();
            } else {
                start();
            }
        });

        // Реакция на смену настройки «уменьшить движение» на лету
        var onMotionPreferenceChange = function () {
            if (reduceMotion.matches) {
                renderOnce();
            } else {
                start();
            }
        };
        if (typeof reduceMotion.addEventListener === 'function') {
            reduceMotion.addEventListener('change', onMotionPreferenceChange);
        } else if (typeof reduceMotion.addListener === 'function') {
            reduceMotion.addListener(onMotionPreferenceChange);
        }

        buildSprites();
        createNodes();
        buildLinks();
        createStreams();
        resize();
        if (reduceMotion.matches) {
            renderOnce();
        } else {
            start();
        }
    }

    /* ----------------------------------------------------------------------
       2. Появление карточек при скролле
       ---------------------------------------------------------------------- */
    function initReveal() {
        var items = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
        if (!items.length) {
            return;
        }

        function show(item) {
            item.classList.add('is-visible');
        }

        function showAll() {
            items.forEach(show);
        }

        if (!('IntersectionObserver' in window) || reduceMotion.matches) {
            showAll();
            return;
        }

        var viewportHeight = window.innerHeight || document.documentElement.clientHeight;

        // То, что уже попало в кадр, показываем сразу — не зависим от первой доставки observer
        items.forEach(function (item) {
            var rect = item.getBoundingClientRect();
            if (rect.top < viewportHeight * 0.92 && rect.bottom > 0) {
                show(item);
            }
        });

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) {
                    return;
                }
                show(entry.target);
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

        items.forEach(function (item) {
            if (!item.classList.contains('is-visible')) {
                observer.observe(item);
            }
        });

        // Страховка: если observer так и не сработал, контент не должен остаться невидимым
        window.setTimeout(function () {
            if (!document.querySelectorAll('.reveal.is-visible').length) {
                showAll();
                observer.disconnect();
            }
        }, 3000);
    }

    /* ----------------------------------------------------------------------
       3. Плавные якорные переходы с переносом фокуса
       ---------------------------------------------------------------------- */
    function initSmoothScroll() {
        document.addEventListener('click', function (event) {
            var link = event.target.closest ? event.target.closest('a[href^="#"]') : null;
            if (!link) {
                return;
            }
            var hash = link.getAttribute('href');
            if (!hash || hash === '#') {
                return;
            }

            var target = document.getElementById(hash.slice(1));
            if (!target) {
                return;
            }

            event.preventDefault();
            var instant = reduceMotion.matches;
            target.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });

            // Фокус на целевой секции — важно для клавиатуры и скринридеров
            var focusTarget = function () {
                if (!target.hasAttribute('tabindex')) {
                    target.setAttribute('tabindex', '-1');
                }
                target.focus({ preventScroll: true });
            };
            if (instant) {
                focusTarget();
            } else {
                window.setTimeout(focusTarget, 420);
            }

            if (window.history && typeof window.history.replaceState === 'function') {
                window.history.replaceState(null, '', hash);
            }
        });
    }

    /* ----------------------------------------------------------------------
       4. Блок «Как мы работаем»: подсветка шага, ближайшего к центру экрана
       ---------------------------------------------------------------------- */
    function initApproachSpy() {
        var steps = Array.prototype.slice.call(document.querySelectorAll('.approach-step'));
        if (!steps.length) {
            return;
        }

        var scheduled = false;
        var activeStep = null;

        function update() {
            scheduled = false;
            var viewportCenter = window.innerHeight * 0.5;
            var best = null;
            var bestDistance = Infinity;

            steps.forEach(function (step) {
                var rect = step.getBoundingClientRect();
                var distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = step;
                }
            });

            if (best !== activeStep) {
                steps.forEach(function (step) {
                    step.classList.toggle('is-active', step === best);
                });
                activeStep = best;
            }
        }

        function schedule() {
            if (scheduled) {
                return;
            }
            scheduled = true;
            window.requestAnimationFrame(update);
        }

        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        update();
    }

    /* ----------------------------------------------------------------------
       5. Тень шапки после начала прокрутки
       ---------------------------------------------------------------------- */
    function initHeaderState() {
        var header = document.querySelector('header');
        if (!header) {
            return;
        }

        var scheduled = false;

        function update() {
            scheduled = false;
            header.classList.toggle('is-scrolled', window.scrollY > 8);
        }

        window.addEventListener('scroll', function () {
            if (scheduled) {
                return;
            }
            scheduled = true;
            window.requestAnimationFrame(update);
        }, { passive: true });

        update();
    }


    function init() {
        // Модули изолированы: сбой интерактива не должен скрывать контент страницы
        [initBackground, initReveal, initSmoothScroll, initApproachSpy, initHeaderState]
            .forEach(function (module) {
                try {
                    module();
                } catch (error) {
                    if (window.console && typeof window.console.warn === 'function') {
                        window.console.warn('Модуль не запустился:', module.name, error);
                    }
                }
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
