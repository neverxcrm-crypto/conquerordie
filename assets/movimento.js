/*
  ============================================================
  movimento.js — scroll suave (GSAP ScrollSmoother) + animações
  ============================================================

  O QUE FAZ:
  1. Liga o ScrollSmoother no site inteiro. O layout (theme.liquid)
     envolve <main> + footer em #smooth-wrapper > #smooth-content;
     o smoother desliza esse conteúdo com transform enquanto o
     scroll nativo continua existindo por baixo (window.scrollY,
     eventos de scroll, IntersectionObserver e revelar.js seguem
     funcionando sem adaptação).
  2. Efeitos declarativos do ScrollSmoother (effects: true):
     data-speed="0.9" / data-lag="0.2" em qualquer elemento.
  3. Parallax em [data-parallax] via ScrollTrigger (funciona com ou
     sem o smoother).
  4. [data-smooth-sticky]: substitui position: sticky, que não
     funciona dentro de conteúdo transformado, por um pin do
     ScrollTrigger (ex.: resumo da página do carrinho).
  5. Trava: body.bloquear (carrinho e menu mobile abertos) pausa o
     smoother.
  6. Âncoras (#id) rolam suave, descontando a header fixa.

  QUEM FICA FORA DO WRAPPER (e por quê):
  Tudo que é position: fixed — header, cart drawer, alertas. Dentro
  de um elemento com transform, fixed passa a ser relativo a ele e
  "rolaria junto".

  QUANDO NÃO LIGA (scroll nativo):
  - prefers-reduced-motion.
  - Editor de temas do Shopify (Shopify.designMode): o editor rola o
    iframe até a section selecionada e isso não combina com
    conteúdo transformado.
  - GSAP/ScrollSmoother indisponíveis — o site segue 100% funcional.

  API PÚBLICA:
  window.CODMotion = { smoother, scrollTo(target), stop(), start() }
*/
(function () {
  'use strict';

  var root = document.documentElement;
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var ScrollSmoother = window.ScrollSmoother;

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var designMode = !!(window.Shopify && window.Shopify.designMode);
  var wrapper = document.getElementById('smooth-wrapper');
  var content = document.getElementById('smooth-content');

  function headerHeight() {
    return parseFloat(getComputedStyle(root).getPropertyValue('--header-height')) || 68;
  }

  if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  /* ---------------------------------------------------------
     ScrollSmoother
  --------------------------------------------------------- */
  var smoother = null;
  if (!reduced && !designMode && gsap && ScrollTrigger && ScrollSmoother && wrapper && content) {
    gsap.registerPlugin(ScrollSmoother);
    // Antes de criar: o scroll-behavior: smooth nativo brigaria com o
    // smoother (ver normalizar.css).
    root.classList.add('has-smooth-scroll');
    smoother = ScrollSmoother.create({
      wrapper: wrapper,
      content: content,
      smooth: 1.1,            // segundos para "alcançar" a posição real
      smoothTouch: 0.1,       // toque: suavização leve, sem parecer atrasado
      effects: true,          // habilita data-speed / data-lag
      ignoreMobileResize: true
    });
  }

  /* ---------------------------------------------------------
     Trava: body.bloquear => smoother pausado.
     Quem adiciona a classe (carrinho.js, nav.liquid) não precisa
     saber que o smoother existe.
  --------------------------------------------------------- */
  if (smoother) {
    var syncLock = function () {
      var locked = document.body.classList.contains('bloquear');
      if (smoother.paused() !== locked) smoother.paused(locked);
    };
    new MutationObserver(syncLock).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    syncLock();
  }

  /* ---------------------------------------------------------
     Âncoras internas com offset da header fixa.
  --------------------------------------------------------- */
  function scrollToTarget(target) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    if (smoother) {
      smoother.scrollTo(el, true, 'top ' + (headerHeight() + 12) + 'px');
    } else if (el.scrollIntoView) {
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  if (smoother) {
    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href*="#"]');
      if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      var url;
      try { url = new URL(link.href, window.location.href); } catch (e) { return; }
      if (url.pathname !== window.location.pathname || !url.hash || url.hash === '#') return;
      var target;
      try { target = document.querySelector(decodeURIComponent(url.hash)); } catch (e) { return; }
      if (!target) return;
      event.preventDefault();
      scrollToTarget(target);
      if (history.pushState) history.pushState(null, '', url.hash);
    });

    // Chegou numa URL com #hash: o salto nativo aconteceu antes do
    // smoother existir, então reposiciona.
    if (window.location.hash) {
      window.addEventListener('load', function () {
        try { scrollToTarget(decodeURIComponent(window.location.hash)); } catch (e) {}
      });
    }
  }

  if (!gsap || !ScrollTrigger) {
    window.CODMotion = { smoother: null, scrollTo: scrollToTarget, stop: function () {}, start: function () {} };
    return;
  }

  /* ---------------------------------------------------------
     Parallax em [data-parallax]
     data-parallax="0.12" controla a intensidade (padrão 0.1).
     O wrapper precisa de overflow: hidden (regra global em base.css).
  --------------------------------------------------------- */
  function initParallax(scope) {
    if (reduced) return;
    scope.querySelectorAll('[data-parallax]').forEach(function (wrap) {
      if (wrap.__codParallax) return;
      // [data-parallax-target] deixa o <img> livre para outro transform
      // (ex.: zoom no hover) sem os dois brigarem pela mesma propriedade.
      var media = wrap.querySelector('[data-parallax-target]') || wrap.querySelector('img, svg, video, .placeholder-svg');
      if (!media) return;
      var amount = parseFloat(wrap.getAttribute('data-parallax')) || 0.1;
      var shift = amount * 100;
      gsap.set(media, { scale: 1 + amount * 2, transformOrigin: '50% 50%', willChange: 'transform' });
      wrap.__codParallax = gsap.fromTo(
        media,
        { yPercent: -shift / 2 },
        {
          yPercent: shift / 2,
          ease: 'none',
          scrollTrigger: { trigger: wrap, start: 'top bottom', end: 'bottom top', scrub: true }
        }
      );
    });
  }

  function killParallax(scope) {
    scope.querySelectorAll('[data-parallax]').forEach(function (wrap) {
      if (!wrap.__codParallax) return;
      if (wrap.__codParallax.scrollTrigger) wrap.__codParallax.scrollTrigger.kill();
      wrap.__codParallax.kill();
      wrap.__codParallax = null;
    });
  }

  /* ---------------------------------------------------------
     [data-smooth-sticky] — sticky que sobrevive ao smoother.
     data-smooth-sticky="1001" = largura mínima (px) para fixar;
     abaixo disso o elemento fica no fluxo normal.
  --------------------------------------------------------- */
  var stickyMedia = gsap.matchMedia();
  function initSticky(scope) {
    if (!smoother) return; // sem smoother, o position: sticky do CSS já funciona
    scope.querySelectorAll('[data-smooth-sticky]').forEach(function (el) {
      if (el.__codSticky) return;
      el.__codSticky = true;
      var min = parseInt(el.getAttribute('data-smooth-sticky'), 10) || 0;
      stickyMedia.add('(min-width: ' + min + 'px)', function () {
        var offset = function () { return headerHeight() + 24; };
        ScrollTrigger.create({
          trigger: el,
          pin: el,
          pinSpacing: false,
          start: function () { return 'top ' + offset() + 'px'; },
          endTrigger: el.parentElement,
          end: function () { return 'bottom ' + (offset() + el.offsetHeight) + 'px'; },
          invalidateOnRefresh: true
        });
      });
    });
  }

  initParallax(document);
  initSticky(document);

  /* Imagens lazy e fontes mudam a altura da página: recalcula os
     gatilhos (e a altura rolável do smoother). */
  var refreshTimer = null;
  function queueRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(function () { ScrollTrigger.refresh(); }, 150);
  }
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
  document.addEventListener('load', function (event) {
    if (event.target && event.target.tagName === 'IMG') queueRefresh();
  }, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueRefresh);

  /* Theme editor: sections recriadas precisam de novos gatilhos. */
  document.addEventListener('shopify:section:unload', function (event) { killParallax(event.target); });
  document.addEventListener('shopify:section:load', function (event) {
    initParallax(event.target);
    initSticky(event.target);
    queueRefresh();
  });

  window.CODMotion = {
    smoother: smoother,
    scrollTo: scrollToTarget,
    stop: function () { if (smoother) smoother.paused(true); },
    start: function () { if (smoother) smoother.paused(false); }
  };
})();
