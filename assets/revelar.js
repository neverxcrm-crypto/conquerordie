/*
  ============================================================
  revelar.js — reveal on scroll
  ============================================================

  O QUE FAZ:
  Revela elementos marcados com [data-reveal] quando eles entram no
  viewport, adicionando a classe .is-revealed (a transicao em si esta
  em assets/base.css). Usa IntersectionObserver e para de observar
  cada elemento depois do primeiro reveal — nada fica preso a um
  listener de scroll.

  POR QUE ASSIM:
  - E um ecommerce, nao um site de apresentacao: o efeito e curto e
    acontece uma vez. Elementos irmaos ganham um atraso minimo
    (60ms) para a fileira aparecer em cascata leve, nunca em bloco.
  - Quem pediu menos movimento (prefers-reduced-motion) ou esta sem
    IntersectionObserver recebe o conteudo visivel de imediato.
  - O CSS so esconde [data-reveal] quando html tem a classe "js",
    entao sem JavaScript nada desaparece.
  - shopify:section:load: o theme editor recria a section inteira ao
    editar, e sem re-observar os elementos novos eles ficariam
    presos em opacity 0.
*/
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var supported = 'IntersectionObserver' in window;

  function revealAll(items) {
    items.forEach(function (el) { el.classList.add('is-revealed'); });
  }

  if (reduced || !supported) {
    revealAll(Array.prototype.slice.call(document.querySelectorAll('[data-reveal]')));
    // No theme editor, conteudo novo tambem precisa aparecer.
    document.addEventListener('shopify:section:load', function (event) {
      revealAll(Array.prototype.slice.call(event.target.querySelectorAll('[data-reveal]')));
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        // Cascata leve entre irmaos: a fileira nao aparece de uma vez.
        var siblings = Array.prototype.slice.call(el.parentElement ? el.parentElement.children : []);
        var position = siblings.indexOf(el);
        var delay = Math.min(position, 5) * 60;
        setTimeout(function () { el.classList.add('is-revealed'); }, delay);
        observer.unobserve(el);
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
  );

  function observe(scope) {
    scope.querySelectorAll('[data-reveal]').forEach(function (el) {
      if (!el.classList.contains('is-revealed')) observer.observe(el);
    });
  }

  observe(document);

  // O theme editor recria a section inteira: os novos elementos
  // precisam voltar para o observer, senao ficariam invisiveis.
  document.addEventListener('shopify:section:load', function (event) {
    observe(event.target);
  });
})();
