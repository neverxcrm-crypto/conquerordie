/*
  ============================================================
  revelar.js — entrada de conteudo ao rolar
  ============================================================

  O QUE FAZ:
  Revela elementos marcados com [data-reveal] quando eles entram no
  viewport, adicionando a classe .is-revealed. A transicao em si
  (subir 10px + aparecer) esta em assets/base.css, junto com as
  variantes — aqui so existe a decisao de QUANDO.

  Usa IntersectionObserver e para de observar cada elemento depois
  do primeiro reveal: nada fica preso a um listener de scroll e o
  custo por frame de rolagem e zero.

  CASCATA SEM TIMER:
  Elementos irmaos entram em degraus. Antes cada um agendava um
  setTimeout para atrasar a propria entrada — uma fileira de 8
  cards criava 8 timers que disputavam a thread justamente durante
  a rolagem. Agora o indice vai para a custom property --reveal-i e
  quem atrasa e o transition-delay do CSS, que roda no compositor.

  O indice e escrito UMA vez, quando o elemento entra no observer,
  e nunca mais: escrever style so quando algo muda evita recalculo
  de estilo a cada quadro.

  Um pai com [data-reveal-group] numera os proprios filhos — util
  quando os itens da cascata nao sao irmaos diretos no DOM.

  QUEM NAO ANIMA:
  - prefers-reduced-motion: tudo nasce visivel.
  - Sem IntersectionObserver: idem.
  - Sem JavaScript: o CSS so esconde [data-reveal] dentro de .js,
    entao o conteudo aparece normalmente. O reveal nunca pode ser
    a razao de alguem nao ver um produto.

  shopify:section:load: o theme editor recria a section inteira ao
  editar; sem re-observar, os elementos novos ficariam em opacity 0.
*/
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var supported = 'IntersectionObserver' in window;

  function revealAll(items) {
    Array.prototype.forEach.call(items, function (el) { el.classList.add('is-revealed'); });
  }

  if (reduced || !supported) {
    revealAll(document.querySelectorAll('[data-reveal]'));
    document.addEventListener('shopify:section:load', function (event) {
      revealAll(event.target.querySelectorAll('[data-reveal]'));
    });
    /* Mesmo sem animar, o gancho precisa existir: quem injeta HTML
       chama CODRevelar sem saber em que modo a pagina esta, e um
       no-op aqui evita um `typeof` espalhado por cada chamador. */
    window.CODRevelar = function (scope) {
      revealAll((scope || document).querySelectorAll('[data-reveal]'));
    };
    return;
  }

  /* Indice da cascata. Teto de 6: passando disso a espera comeca a
     parecer atraso, e a fileira inteira precisa terminar de entrar
     em menos de meio segundo. */
  function indexar(el) {
    if (el.hasAttribute('data-reveal-i')) return;
    var grupo = el.closest('[data-reveal-group]');
    var irmaos = grupo
      ? grupo.querySelectorAll('[data-reveal]')
      : (el.parentElement ? el.parentElement.children : [el]);
    var posicao = Array.prototype.indexOf.call(irmaos, el);
    var i = Math.min(Math.max(posicao, 0), 6);
    if (i > 0) el.style.setProperty('--reveal-i', i);
    el.setAttribute('data-reveal-i', i);
  }

  /* ---------------------------------------------------------
     O que JÁ ESTÁ na tela na abertura não anima.

     Dois motivos, nesta ordem:

     1. LCP. O maior elemento visível costuma ser uma foto de
        produto ou o título do hero. Se ele nasce em opacity 0 e
        só aparece 560ms depois, o navegador conta o LCP a partir
        do momento em que ficou visível — a nota piora sem que
        nada tenha ficado mais lento de verdade.

     2. Sentido. Reveal é para conteúdo que a pessoa ALCANÇA
        rolando. O que já estava na tela quando a página abriu não
        "chega": ele simplesmente está lá. Animá-lo faz a abertura
        inteira piscar.
  --------------------------------------------------------- */
  function jaVisivel(el) {
    var r = el.getBoundingClientRect();
    return r.top < window.innerHeight * 0.95 && r.bottom > 0;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    },
    /* Margem negativa embaixo: o elemento so conta como "entrou"
       depois de subir um pouco na tela, nao no instante em que a
       primeira linha de pixels aparece. */
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );

  function observe(scope, abertura) {
    scope.querySelectorAll('[data-reveal]').forEach(function (el) {
      if (el.classList.contains('is-revealed')) return;
      if (abertura && jaVisivel(el)) {
        // .sem-anim desliga a transicao: aparece pronto, sem fade.
        el.classList.add('sem-anim', 'is-revealed');
        return;
      }
      indexar(el);
      observer.observe(el);
    });
  }

  observe(document, true);

  document.addEventListener('shopify:section:load', function (event) {
    observe(event.target);
  });

  /* ---------------------------------------------------------
     CODRevelar(scope) — para conteudo que chega DEPOIS

     O observer so varre a pagina na abertura e no
     shopify:section:load (editor de temas). Conteudo trazido por
     fetch em tempo de execucao — as recomendacoes da PDP, por
     exemplo — nunca passava por ele: marcar aquele HTML com
     [data-reveal] deixaria os produtos em opacity 0 PARA SEMPRE,
     porque ninguem os observaria.

     Quem injeta HTML chama window.CODRevelar(elemento) e os
     [data-reveal] de dentro entram na fila normalmente.

     Sem `abertura`: conteudo que chega depois nunca e "o que ja
     estava na tela", entao nao existe o caso de pular a animacao
     para proteger o LCP — o LCP ja foi medido ha muito tempo.
  --------------------------------------------------------- */
  window.CODRevelar = function (scope) {
    observe(scope && scope.querySelectorAll ? scope : document, false);
  };
})();
