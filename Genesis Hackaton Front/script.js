"use strict";

(() => {
  // Общие настройки движения и функции для работы с локальным DOM.
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(pointer: fine) and (hover: hover)");
  const desktopNavigation = matchMedia("(min-width: 1024px)");
  const EASE_EXPO = "cubic-bezier(.16, 1, .3, 1)";
  const UI_DURATION = 360;
  const numberFormat = new Intl.NumberFormat("ru-RU");
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const select = (selector, scope = document) => scope.querySelector(selector);
  const selectAll = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const announce = (message) => {
    select("[data-live-message]").textContent = message;
  };

  root.classList.add("js");

  // Одна отложенная перерисовка обслуживает пакет событий указателя или прокрутки.
  function paintOnce(callback) {
    let frame = 0;

    return () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        callback();
      });
    };
  }

  function observeVisibility(element, update) {
    if (!("IntersectionObserver" in window)) {
      update(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      update(entry.isIntersecting);
    });
    observer.observe(element);
  }

  function patchIcon(button, id) {
    select("use", button).setAttribute("href", "#" + id);
  }

  // CSS-анимации и счётчик шторки стартуют только при первом открытии.
  (() => {
    const loader = select(".loader");
    const value = select("[data-loader-count]", loader);
    const progress = select("[data-loader-progress]", loader);
    let alreadySeen = false;

    try {
      alreadySeen = sessionStorage.getItem("audit-lab-seen") === "1";
      sessionStorage.setItem("audit-lab-seen", "1");
    } catch {
      // Для file:// хранилище зависит от браузера. Старт остаётся доступным.
    }

    let frame = 0;
    let fallback = 0;
    let leaving = false;

    const reveal = (animate) => {
      if (leaving) return;
      leaving = true;
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      if (!animate) {
        loader.hidden = true;
        return;
      }

      value.textContent = "100%";
      progress.style.setProperty("--load-progress", "1");
      loader.classList.add("is-leaving");
      root.classList.add("hero-ready");
      setTimeout(() => { loader.hidden = true; }, 550);
    };

    if (reduced.matches || alreadySeen || location.hash) {
      loader.hidden = true;
      return;
    }

    loader.hidden = false;
    const start = performance.now();
    const duration = 880;
    const render = (now) => {
      const time = clamp((now - start) / duration);
      const portion = 1 - (1 - time) ** 2.5;
      value.textContent = Math.round(portion * 100) + "%";
      progress.style.setProperty("--load-progress", String(portion));

      if (time < 1) frame = requestAnimationFrame(render);
      else reveal(true);
    };

    // Фокус с клавиатуры сразу убирает декоративный слой.
    document.addEventListener("focusin", () => reveal(false), { once: true });
    reduced.addEventListener("change", () => {
      if (reduced.matches) reveal(false);
    });
    fallback = setTimeout(() => reveal(!reduced.matches), 1000);
    frame = requestAnimationFrame(render);
  })();

  // Меню использует модальный top layer браузера и возвращает фокус триггеру.
  (() => {
    const menu = select("#mobile-menu");
    const trigger = select("[data-open-menu]");
    const close = select("[data-close-menu]");
    let selectedAnchor = null;

    trigger.addEventListener("click", () => {
      selectedAnchor = null;
      if (menu.open) return;
      menu.showModal();
      trigger.setAttribute("aria-expanded", "true");
      patchIcon(trigger, "i-close");
    });

    close.addEventListener("click", () => menu.close());

    menu.addEventListener("click", (event) => {
      const anchor = event.target.closest(".mobile-links a");
      if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selectedAnchor = anchor.hash;
      menu.close();
    });

    menu.addEventListener("close", () => {
      trigger.setAttribute("aria-expanded", "false");
      patchIcon(trigger, "i-menu");
      if (!selectedAnchor) {
        if (trigger.offsetWidth) trigger.focus({ preventScroll: true });
        return;
      }

      const selector = selectedAnchor;
      selectedAnchor = null;
      const section = select(selector);
      if (location.hash !== selector) location.hash = selector;
      else section.scrollIntoView();

      const title = select("h2", section);
      title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    });

    desktopNavigation.addEventListener("change", () => {
      if (desktopNavigation.matches && menu.open) menu.close();
    });
  })();

  // Удалённые секции появляются один раз. Без поддержки observer всё видно.
  (() => {
    if (!("IntersectionObserver" in window)) return;

    const elements = selectAll("[data-reveal]");
    const counts = selectAll("[data-count]");
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -28px 0px",
      threshold: .08
    });

    function start() {
      if (reduced.matches) {
        root.classList.remove("can-reveal");
        return;
      }

      root.classList.add("can-reveal");
      elements.forEach((element) => {
        if (!element.classList.contains("is-in")) revealObserver.observe(element);
      });

      counts.forEach((element) => {
        if (!element.dataset.counted) countObserver.observe(element);
      });
    }

    const countObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (!isIntersecting) return;
        countObserver.unobserve(target);
        target.dataset.counted = "true";
        const end = Number(target.dataset.count);

        animateValue(0, end, 650, (value) => {
          target.textContent = numberFormat.format(value);
        });
      });
    }, { threshold: .32 });

    // Содержимое, в которое перешли с клавиатуры, всегда открывается сразу.
    document.addEventListener("focusin", (event) => {
      const item = event.target.closest("[data-reveal]");
      if (item) item.classList.add("is-in");
    });

    start();
    reduced.addEventListener("change", start);
  })();

  // Счётчик приводится к финальному значению сразу при смене системных настроек.
  function animateValue(from, to, milliseconds, render) {
    if (from === to || reduced.matches) {
      render(to);
      return () => {};
    }

    let animationFrame;
    const start = performance.now();

    const step = (now) => {
      const portion = reduced.matches ? 1 : clamp((now - start) / milliseconds);
      const eased = 1 - (1 - portion) ** 3;
      render(Math.round(from + (to - from) * eased));
      if (portion < 1) animationFrame = requestAnimationFrame(step);
    };

    animationFrame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrame);
  }

  // Одно чтение scroll-позиции обновляет шапку, hero, таймлайн и кольцо.
  (() => {
    const header = select(".site-header");
    const hero = select(".hero");
    const figure = select("[data-parallax]");
    const timeline = select("[data-timeline]");
    const rail = select("[data-timeline-progress]");
    const ring = select("[data-scroll-ring]");

    const render = () => {
      const y = window.scrollY;
      const height = window.innerHeight;
      const capacity = root.scrollHeight - height;
      const railBox = timeline.getBoundingClientRect();

      header.classList.toggle("is-scrolled", y > 12);
      ring.style.setProperty("--ring-offset", String(1 - clamp(capacity ? y / capacity : 0)));

      if (reduced.matches) {
        rail.style.setProperty("--timeline-progress", "1");
        figure.style.removeProperty("--parallax-y");
        return;
      }

      const portion = clamp((height * .76 - railBox.top) / (height * .49 + railBox.height * .4));
      rail.style.setProperty("--timeline-progress", String(portion));

      if (finePointer.matches && y <= hero.offsetHeight) {
        figure.style.setProperty("--parallax-y", Math.min(y * .075, 34) + "px");
      }
    };

    const queue = paintOnce(render);
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue, { passive: true });
    reduced.addEventListener("change", queue);
    finePointer.addEventListener("change", () => {
      figure.style.removeProperty("--parallax-y");
      queue();
    });
    render();
  })();

  // Лента имеет один семантический список. Клон нужен только для бесшовности.
  (() => {
    const formats = select(".formats");
    const list = select("[data-marquee-source]");
    const toggle = select("[data-marquee-toggle]");
    const duplicate = list.cloneNode(true);

    duplicate.setAttribute("aria-hidden", "true");
    duplicate.removeAttribute("data-marquee-source");
    duplicate.inert = true;
    list.after(duplicate);

    function applyPreference() {
      duplicate.hidden = reduced.matches;
      formats.classList.toggle("has-motion", !reduced.matches);
    }

    toggle.addEventListener("click", () => {
      const paused = formats.classList.toggle("is-paused");
      toggle.setAttribute("aria-pressed", String(paused));
      toggle.setAttribute("aria-label", paused ? "Запустить ленту форматов" : "Приостановить ленту форматов");
      patchIcon(toggle, paused ? "i-play" : "i-pause");
    });

    observeVisibility(formats, (visible) => {
      formats.classList.toggle("is-visible", visible);
    });
    reduced.addEventListener("change", applyPreference);
    applyPreference();
  })();

  // Canvas получает ограниченный DPR. Цикл живёт только в видимом hero.
  (() => {
    const canvas = select(".hero-particles");
    const context = canvas.getContext("2d");
    if (!context) return;

    let visible = false;
    let job = 0;
    let width = 0;
    let height = 0;
    let particles = [];

    function measure() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (!width || !height) return;

      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = width > 850 ? 38 : 17;
      particles = Array.from({ length: count }, (_, index) => ({
        x: (index * .618033 + .15) % 1,
        y: (index * .414213 + .04) % 1,
        size: index % 6 ? .85 : 1.55,
        speed: 3 + index % 5,
        phase: index * .8
      }));
    }

    function draw(now) {
      const seconds = now / 1000;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#d0b8ff";

      particles.forEach((particle) => {
        const x = particle.x * width + Math.sin(seconds * .35 + particle.phase) * 11;
        const y = ((particle.y * height - seconds * particle.speed) % height + height) % height;
        context.globalAlpha = .24 + .2 * Math.sin(seconds * .75 + particle.phase);
        context.beginPath();
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();
      });

      job = requestAnimationFrame(draw);
    }

    function sync() {
      const running = visible && !document.hidden && !reduced.matches;
      if (running && !job) {
        measure();
        job = requestAnimationFrame(draw);
      } else if (!running && job) {
        cancelAnimationFrame(job);
        job = 0;
        context.clearRect(0, 0, width, height);
      }
    }

    addEventListener("resize", paintOnce(() => {
      if (job) measure();
    }), { passive: true });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    observeVisibility(canvas, (inView) => {
      visible = inView;
      sync();
    });
  })();

  // Курсор плавно догоняет указатель. Мышь за пределами hero остаётся нативной.
  (() => {
    const hero = select(".hero");
    const layer = select(".cursor-layer");
    const dot = select(".cursor-dot", layer);
    const ring = select(".cursor-ring", layer);
    let pointer = null;
    let currentX = 0;
    let currentY = 0;
    let scale = 1;
    let job = 0;

    const canUse = () => finePointer.matches && !reduced.matches;
    const render = () => {
      job = 0;
      if (!pointer) return;

      currentX += (pointer.x - currentX) * .27;
      currentY += (pointer.y - currentY) * .27;
      scale += ((pointer.interactive ? 1.65 : 1) - scale) * .26;

      dot.style.transform = "translate3d(" + pointer.x + "px," + pointer.y + "px,0)";
      ring.style.transform = "translate3d(" + currentX + "px," + currentY + "px,0) scale(" + scale + ")";
      const delta = Math.abs(pointer.x - currentX) + Math.abs(pointer.y - currentY);
      if (delta > .35 || Math.abs(scale - (pointer.interactive ? 1.65 : 1)) > .02) {
        job = requestAnimationFrame(render);
      }
    };

    const hide = () => {
      pointer = null;
      cancelAnimationFrame(job);
      job = 0;
      layer.classList.remove("is-visible");
      hero.classList.remove("is-cursor-active");
      layer.hidden = true;
    };

    hero.addEventListener("pointermove", (event) => {
      if (!canUse() || event.pointerType !== "mouse") return;

      if (!pointer) {
        currentX = event.clientX;
        currentY = event.clientY;
        scale = 1;
        layer.hidden = false;
        layer.classList.add("is-visible");
        hero.classList.add("is-cursor-active");
      }

      pointer = {
        x: event.clientX,
        y: event.clientY,
        interactive: Boolean(event.target.closest("a, button"))
      };
      if (!job) job = requestAnimationFrame(render);
    }, { passive: true });

    hero.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    document.addEventListener("focusin", (event) => {
      if (event.target.matches(":focus-visible")) hide();
    });
    document.addEventListener("scroll", hide, { passive: true });
    finePointer.addEventListener("change", hide);
    reduced.addEventListener("change", hide);
  })();

  // Магнитный сдвиг CTA и карточки используют исходный прямоугольник.
  (() => {
    const magnetic = selectAll("[data-magnetic]");
    const tilted = selectAll("[data-tilt]");

    function connect(element, update, reset) {
      let bounds = null;
      let point = null;
      const render = paintOnce(() => {
        if (!bounds || !point) return;
        const x = clamp((point.x - bounds.left) / bounds.width);
        const y = clamp((point.y - bounds.top) / bounds.height);
        update(x, y);
      });

      function end() {
        bounds = null;
        point = null;
        reset();
      }

      element.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "mouse" || reduced.matches || !finePointer.matches) return;
        bounds = element.getBoundingClientRect();
      }, { passive: true });

      element.addEventListener("pointermove", (event) => {
        if (!bounds) return;
        point = { x: event.clientX, y: event.clientY };
        render();
      }, { passive: true });

      element.addEventListener("pointerleave", end);
      element.addEventListener("pointercancel", end);
      addEventListener("resize", end, { passive: true });
      addEventListener("scroll", end, { passive: true });
      reduced.addEventListener("change", end);
      finePointer.addEventListener("change", end);
    }

    magnetic.forEach((button) => {
      connect(button, (x, y) => {
        button.style.setProperty("--magnet-x", ((x - .5) * 17).toFixed(1) + "px");
        button.style.setProperty("--magnet-y", ((y - .5) * 11).toFixed(1) + "px");
      }, () => {
        button.style.removeProperty("--magnet-x");
        button.style.removeProperty("--magnet-y");
      });
    });

    tilted.forEach((card) => {
      connect(card, (x, y) => {
        card.classList.add("is-tilting");
        card.style.setProperty("--tilt-x", ((.5 - y) * 8).toFixed(1) + "deg");
        card.style.setProperty("--tilt-y", ((x - .5) * 8).toFixed(1) + "deg");
        card.style.setProperty("--spot-x", (x * 100).toFixed(1) + "%");
        card.style.setProperty("--spot-y", (y * 100).toFixed(1) + "%");
      }, () => {
        card.classList.remove("is-tilting");
        ["--tilt-x", "--tilt-y", "--spot-x", "--spot-y"].forEach((property) => {
          card.style.removeProperty(property);
        });
      });
    });
  })();

  // Короткие следы клика не задерживают модифицированные ссылки и клавиатуру.
  (() => {
    const burst = select(".burst-layer");
    const palette = ["#bda6ff", "#82ddff", "#ff9dbd"];
    let navigationPending = false;

    function disposableParticle(parent, className, properties, lifetime) {
      const particle = document.createElement("span");
      particle.className = className;
      particle.setAttribute("aria-hidden", "true");
      Object.entries(properties).forEach(([key, value]) => {
        particle.style.setProperty(key, value);
      });
      parent.append(particle);
      particle.addEventListener("animationend", () => particle.remove(), { once: true });
      setTimeout(() => particle.remove(), lifetime);
    }

    document.addEventListener("click", (event) => {
      if (reduced.matches || event.defaultPrevented) return;
      const control = event.target.closest(".button, .tab-button, .billing-switch button, .plain-control");
      if (!control || control.disabled) return;

      const box = control.getBoundingClientRect();
      const physical = event.detail > 0;
      const x = physical ? event.clientX : box.left + box.width / 2;
      const y = physical ? event.clientY : box.top + box.height / 2;
      disposableParticle(control, "ripple", {
        "--ripple-x": (x - box.left) + "px",
        "--ripple-y": (y - box.top) + "px",
        "--ripple-scale": String(Math.hypot(box.width, box.height) * 2.1)
      }, 500);

      if (!control.matches("[data-burst]") || !physical) return;

      for (let index = 0; index < 9; index += 1) {
        const angle = index * .698;
        const radius = 20 + (index % 4) * 9;
        disposableParticle(burst, "burst-particle", {
          "--burst-x": x + "px",
          "--burst-y": y + "px",
          "--burst-dx": Math.cos(angle) * radius + "px",
          "--burst-dy": Math.sin(angle) * radius + "px",
          "--burst-turn": (index * 33 - 90) + "deg",
          "--particle-color": palette[index % palette.length]
        }, 600);
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      if (navigationPending) return;
      navigationPending = true;
      setTimeout(() => { location.assign(control.href); }, 145);
    });
  })();

  // Вкладки поддерживают Home/End, а высота меняется по измерению панелей.
  (() => {
    const tablist = select(".demo-tabs");
    const tabs = selectAll('[role="tab"]', tablist);
    const viewport = select("[data-tab-panels]");
    const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
    const typing = select("[data-typing]", viewport);
    let active = 0;
    let boxAnimation;
    let panelAnimation;
    let typingAnimation;

    function cancelAnimations() {
      boxAnimation?.cancel();
      panelAnimation?.cancel();
      typingAnimation?.cancel();
    }

    function typeCommand() {
      const steps = typing.textContent.length;
      typingAnimation = typing.animate([
        { clipPath: "inset(0 100% 0 0)" },
        { clipPath: "inset(0 0% 0 0)" }
      ], { duration: 720, easing: "steps(" + steps + ", end)" });
    }

    function activate(index, moveFocus) {
      if (moveFocus) tabs[index].focus();
      if (index === active) return;
      const oldHeight = viewport.getBoundingClientRect().height;
      const direction = index > active ? 1 : -1;
      cancelAnimations();
      active = index;

      tabs.forEach((tab, position) => {
        const selected = position === active;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        panels[position].hidden = !selected;
      });

      const panel = panels[index];
      if (reduced.matches || !viewport.animate) return;

      const height = viewport.getBoundingClientRect().height;
      const options = { duration: UI_DURATION, easing: EASE_EXPO };
      boxAnimation = viewport.animate([
        { height: oldHeight + "px" },
        { height: height + "px" }
      ], options);
      panelAnimation = panel.animate([
        { opacity: .28, transform: "translateX(" + direction * 13 + "px)" },
        { opacity: 1, transform: "translateX(0)" }
      ], options);

      if (panel.contains(typing)) typeCommand();
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(index, false));
    });

    tablist.addEventListener("keydown", (event) => {
      const count = tabs.length;
      const positions = {
        ArrowLeft: (active + count - 1) % count,
        ArrowRight: (active + 1) % count,
        Home: 0,
        End: count - 1
      };
      if (!Object.hasOwn(positions, event.key)) return;
      event.preventDefault();
      activate(positions[event.key], true);
    });

    reduced.addEventListener("change", () => {
      if (reduced.matches) cancelAnimations();
    });
  })();

  // Копирование поддерживает локальный файл и ручное выделение.
  (() => {
    const button = select("[data-copy]");
    let timer = 0;

    function fallbackCopy(code) {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      }
    }

    button.addEventListener("click", async () => {
      const code = document.getElementById(button.dataset.copy);
      let copied = false;

      try {
        await navigator.clipboard.writeText(code.textContent);
        copied = true;
      } catch {
        copied = fallbackCopy(code);
      }

      if (!copied) {
        announce("JSON выделен. Скопируйте его сочетанием клавиш.");
        return;
      }

      announce("JSON скопирован.");
      patchIcon(button, "i-check");
      clearTimeout(timer);
      timer = setTimeout(() => patchIcon(button, "i-copy"), 1300);
    });
  })();

  // Карусель поддерживает нативный touch-scroll и инерцию мыши.
  (() => {
    const carousel = select("[data-carousel]");
    const track = select("[data-story-track]", carousel);
    const slides = selectAll(".story-card", track);
    const indicators = selectAll("[data-story-index]", carousel);
    const play = select("[data-story-play]", carousel);
    const live = select("[data-carousel-announcement]", carousel);
    let current = 0;
    let visible = false;
    let hovering = false;
    let paused = false;
    let autoTimer = 0;
    let drag = null;

    function offsetFor(index) {
      const first = slides[0].getBoundingClientRect();
      const selected = slides[index].getBoundingClientRect();
      return selected.left - first.left;
    }

    function nearest(offset) {
      return slides.reduce((closest, _, index) => {
        const delta = Math.abs(offsetFor(index) - offset);
        const best = Math.abs(offsetFor(closest) - offset);
        return delta < best ? index : closest;
      }, 0);
    }

    function display(index) {
      current = index;
      indicators.forEach((button, position) => {
        if (position === current) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      });
    }

    function go(index, manual = true) {
      const next = (index + slides.length) % slides.length;
      const from = current;
      display(next);
      track.scrollTo({
        left: offsetFor(next),
        behavior: reduced.matches || Math.abs(next - from) > 1 ? "instant" : "smooth"
      });

      if (manual) live.textContent = "Сценарий " + (next + 1) + " из " + slides.length;
      schedule();
    }

    function schedule() {
      clearTimeout(autoTimer);
      if (!visible || paused || hovering || drag || reduced.matches || document.hidden ||
          carousel.contains(document.activeElement)) return;

      autoTimer = setTimeout(() => {
        go(current + 1, false);
      }, 7400);
    }

    select("[data-story-prev]", carousel).addEventListener("click", () => go(current - 1));
    select("[data-story-next]", carousel).addEventListener("click", () => go(current + 1));
    indicators.forEach((button, index) => {
      button.addEventListener("click", () => go(index));
    });

    play.addEventListener("click", () => {
      paused = !paused;
      play.setAttribute("aria-pressed", String(paused));
      play.setAttribute("aria-label", paused ? "Возобновить смену сценариев" : "Приостановить смену сценариев");
      patchIcon(play, paused ? "i-play" : "i-pause");
      schedule();
    });

    track.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        go(current + (event.key === "ArrowRight" ? 1 : -1));
      }
    });

    track.addEventListener("scroll", paintOnce(() => {
      if (!drag?.captured) display(nearest(track.scrollLeft));
    }), { passive: true });

    track.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag = {
        id: event.pointerId,
        start: event.clientX,
        offset: track.scrollLeft,
        lastX: event.clientX,
        time: performance.now(),
        velocity: 0,
        captured: false
      };
      schedule();
    });

    track.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const distance = event.clientX - drag.start;
      if (!drag.captured && Math.abs(distance) < 6) return;

      if (!drag.captured) {
        drag.captured = true;
        track.setPointerCapture(event.pointerId);
        track.classList.add("is-dragging");
        getSelection()?.removeAllRanges();
      }

      const now = performance.now();
      const frameVelocity = (event.clientX - drag.lastX) / Math.max(8, now - drag.time);
      drag.velocity = drag.velocity * .54 + frameVelocity * .46;
      drag.lastX = event.clientX;
      drag.time = now;
      track.scrollLeft = drag.offset - distance;
    });

    function finish(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const captured = drag.captured;
      const recent = performance.now() - drag.time < 110;
      const momentum = recent && !reduced.matches ? clamp(drag.velocity * 150, -350, 350) : 0;
      const target = nearest(track.scrollLeft - momentum);

      drag = null;
      track.classList.remove("is-dragging");
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      if (captured) go(target);
      else schedule();
    }

    track.addEventListener("pointerup", finish);
    track.addEventListener("pointercancel", finish);
    track.addEventListener("lostpointercapture", finish);
    track.addEventListener("pointerleave", (event) => {
      if (!drag?.captured) finish(event);
    });

    carousel.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      hovering = true;
      schedule();
    });

    carousel.addEventListener("pointerleave", () => {
      hovering = false;
      schedule();
    });

    carousel.addEventListener("focusin", schedule);
    carousel.addEventListener("focusout", () => queueMicrotask(schedule));
    document.addEventListener("visibilitychange", schedule);
    reduced.addEventListener("change", schedule);
    observeVisibility(carousel, (inView) => {
      visible = inView;
      schedule();
    });
  })();

  // Состояние периода разделяют карточки и диалог подробностей.
  (() => {
    const switches = selectAll("[data-billing]");
    const prices = selectAll("[data-price]").map((element) => ({
      element,
      shown: Number(element.dataset.month),
      cancel: null
    }));
    const units = selectAll("[data-price-period]");
    const dialog = select("#plan-dialog");
    const heading = select("#plan-dialog-title");
    const description = select("#plan-dialog-description");
    const priceHint = select("[data-modal-price]");
    const labels = { month: "мес.", year: "год" };
    const plans = {
      team: {
        name: "Команда",
        price: prices[1],
        copy: "Пример плана для общего разбора эпизодов и сравнения траекторий."
      },
      lab: {
        name: "Лаборатория",
        price: prices[2],
        copy: "Пример плана для собственных конфигураций и подключения оценщика."
      }
    };
    let period = "month";
    let opener = null;

    switches.forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.billing;
        if (period === next) return;
        period = next;

        switches.forEach((item) => {
          item.setAttribute("aria-pressed", String(item.dataset.billing === period));
        });
        units.forEach((item) => {
          item.textContent = "/ " + labels[period];
        });

        prices.forEach((price) => {
          price.cancel?.();
          const target = Number(price.element.dataset[period]);
          price.cancel = animateValue(price.shown, target, 440, (value) => {
            price.element.textContent = numberFormat.format(value);
            price.shown = value;
          });
        });

        select("[data-billing-announcement]").textContent =
          period === "year" ? "Показаны годовые цены примеров." : "Показаны месячные цены примеров.";
      });
    });

    selectAll("[data-plan]").forEach((button) => {
      button.addEventListener("click", () => {
        const plan = plans[button.dataset.plan];
        opener = button;
        heading.textContent = plan.name;
        description.textContent = plan.copy;
        priceHint.textContent = numberFormat.format(plan.price.element.dataset[period]) +
          " ₸ / " + labels[period] + " · демонстрационная цена";
        if (!dialog.open) dialog.showModal();
      });
    });

    select("[data-close-plan]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      opener?.focus({ preventScroll: true });
    });
  })();

  // FAQ меряет фактическую высоту и переживает повторное нажатие во время перехода.
  (() => {
    selectAll(".faq-item").forEach((item) => {
      const summary = select("summary", item);
      const answer = select(".faq-answer", item);
      let expanded = item.open;
      let finalize = 0;

      function settle() {
        item.open = expanded;
        answer.style.removeProperty("max-height");
      }

      summary.addEventListener("click", (event) => {
        event.preventDefault();
        clearTimeout(finalize);

        const start = item.open ? answer.getBoundingClientRect().height : 0;
        expanded = !expanded;
        item.classList.toggle("is-open", expanded);

        if (reduced.matches) {
          settle();
          return;
        }

        item.open = true;
        answer.style.maxHeight = start + "px";
        answer.getBoundingClientRect();
        answer.style.maxHeight = (expanded ? answer.scrollHeight : 0) + "px";
        finalize = setTimeout(settle, UI_DURATION + 30);
      });

      item.classList.toggle("is-open", expanded);
      reduced.addEventListener("change", () => {
        if (!reduced.matches) return;
        clearTimeout(finalize);
        settle();
      });
    });
  })();
})();

