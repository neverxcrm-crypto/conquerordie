/*
  ============================================================
  movimento.js — scroll suave (Lenis) + animacoes de scroll (GSAP)
  ============================================================

  O QUE FAZ:
  1. Liga o Lenis no documento inteiro: a roda do mouse/trackpad
     ganha inercia, e o scroll nativo continua existindo por baixo
     (window.scrollY, position: sticky, IntersectionObserver e o
     revelar.js seguem funcionando sem adaptacao).
  2. Sincroniza o Lenis com o ticker do GSAP e com o ScrollTrigger,
     para todas as animacoes lerem a MESMA posicao de scroll no
     mesmo frame — sem tremida entre parallax e scroll.
  3. Parallax leve em [data-parallax] (o filho <img> desliza dentro
     do wrapper, que corta o excesso).
  4. Pausa o Lenis sempre que body.bloquear existe (carrinho e menu
     mobile abertos) e respeita [data-lenis-prevent] em regioes que
     rolam sozinhas.
  5. Links ancora (#id) rolam suave e descontam a altura da header.

  POR QUE ASSIM:
  - Toque (celular/tablet) mantem o scroll nativo: o Lenis so
    suaviza a roda. Scroll de toque sintetico piora a sensacao e
    quebra o momentum do iOS.
  - prefers-reduced-motion: nada e ligado, o site fica 100% nativo.
  - Sem as libs (bloqueio de CDN, erro de rede), o arquivo sai sem
    fazer nada: o site continua funcional com scroll nativo.

  API PUBLICA:
  window.CODMotion = { lenis, scrollTo(target, opts), stop(), start() }
*/
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function headerOffset() {
    var value = getComputedStyle(root).getPropertyValue('--header-height');
    return -(parseFloat(value) || 68) - 12;
  }

  /* Sem movimento pedido ou sem Lenis: ancora nativa e fim. */
  if (reduced || typeof window.Lenis !== 'function') {
    window.CODMotion = {
      lenis: null,
      scrollTo: function (target) {
        var el = typeof target === 'string' ? document.querySelector(target) : target;
        if (el && el.scrollIntoView) el.scrollIntoView();
      },
      stop: function () {},
      start: function () {}
    };
    return;
  }

  var hasGsap = typeof window.gsap !== 'undefined';
  var hasScrollTrigger = hasGsap && typeof window.ScrollTrigger !== 'undefined';

  var lenis = new window.Lenis({
    // lerp (interpolação por frame) em vez de duração fixa: a rolagem
    // acompanha a roda continuamente e desacelera de forma orgânica,
    // sem a sensação de "atraso" de uma animação com tempo fechado.
    lerp: 0.085,
    smoothWheel: true,
    wheelMultiplier: 1,
    // Toque segue nativo — ver cabecalho.
    syncTouch: false,
    // Nao rouba o scroll de paineis que rolam sozinhos (carrinho,
    // menu mobile, busca, selects nativos).
    prevent: function (node) {
      return !!(node.closest && node.closest('[data-lenis-prevent], .cart-drawer__scroll, .header__mobile-body, dialog'));
    }
  });

  /* ---------------------------------------------------------
     Loop: GSAP dirige o Lenis quando existe; senao, rAF puro.
  --------------------------------------------------------- */
  if (hasGsap) {
    if (hasScrollTrigger) {
      window.gsap.registerPlugin(window.ScrollTrigger);
      lenis.on('scroll', window.ScrollTrigger.update);
    }
    window.gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    window.gsap.ticker.lagSmoothing(0);
  } else {
    var raf = function (time) {
      lenis.raf(time);
      window.requestAnimationFrame(raf);
    };
    window.requestAnimationFrame(raf);
  }

  /* ---------------------------------------------------------
     Travas de scroll: body.bloquear => Lenis parado.
     Quem adiciona a classe (carrinho.js, nav.liquid) nao precisa
     saber que o Lenis existe.
  --------------------------------------------------------- */
  function syncLock() {
    if (document.body.classList.contains('bloquear')) lenis.stop();
    else lenis.start();
  }
  new MutationObserver(syncLock).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncLock();

  /* ---------------------------------------------------------
     Ancoras internas com offset da header fixa.
  --------------------------------------------------------- */
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
    lenis.scrollTo(target, { offset: headerOffset() });
    if (history.pushState) history.pushState(null, '', url.hash);
  });

  /* ---------------------------------------------------------
     Parallax em [data-parallax]
     data-parallax="0.12" controla a intensidade (padrao 0.1).
     O wrapper precisa de overflow: hidden (regra global em base.css).
     O <img> e ampliado so o necessario para nunca mostrar borda.
  --------------------------------------------------------- */
  function initParallax(scope) {
    if (!hasScrollTrigger) return;
    scope.querySelectorAll('[data-parallax]').forEach(function (wrap) {
      if (wrap.__codParallax) return;
      // [data-parallax-target] deixa o <img> livre para outro transform
      // (ex.: zoom no hover) sem os dois brigarem pela mesma propriedade.
      var media = wrap.querySelector('[data-parallax-target]') || wrap.querySelector('img, svg, video, .placeholder-svg');
      if (!media) return;
      var amount = parseFloat(wrap.getAttribute('data-parallax')) || 0.1;
      var shift = amount * 100;
      window.gsap.set(media, { scale: 1 + amount * 2, transformOrigin: '50% 50%', willChange: 'transform' });
      wrap.__codParallax = window.gsap.fromTo(
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

  initParallax(document);
  root.classList.add('has-smooth-scroll');

  /* Imagens lazy mudam a altura da pagina: recalcula os gatilhos. */
  if (hasScrollTrigger) {
    window.addEventListener('load', function () { window.ScrollTrigger.refresh(); });
    document.addEventListener('load', function (event) {
      if (event.target && event.target.tagName === 'IMG') {
        clearTimeout(initParallax.__refresh);
        initParallax.__refresh = setTimeout(function () { window.ScrollTrigger.refresh(); }, 150);
      }
    }, true);
  }

  /* Theme editor: sections recriadas precisam de novos gatilhos. */
  document.addEventListener('shopify:section:unload', function (event) { killParallax(event.target); });
  document.addEventListener('shopify:section:load', function (event) {
    initParallax(event.target);
    lenis.resize();
    if (hasScrollTrigger) window.ScrollTrigger.refresh();
  });

  window.CODMotion = {
    lenis: lenis,
    scrollTo: function (target, opts) { lenis.scrollTo(target, Object.assign({ offset: headerOffset() }, opts || {})); },
    stop: function () { lenis.stop(); },
    start: function () { lenis.start(); }
  };
})();
