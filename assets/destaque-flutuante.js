/*
  ============================================================
  destaque-flutuante.js — cartão de produto que aparece às vezes
  ============================================================

  O QUE FAZ:
  Lê a configuração e a lista de produtos que a section
  activity-popup deixou na página e, de tempos em tempos, mostra um
  cartão com um desses produtos no canto da tela.

  O RITMO, E POR QUE ELE NÃO PARECE UM SCRIPT:
  - primeira aparição: sorteada entre N e N+10s (N no editor);
  - tempo na tela e intervalo: sorteados entre mínimo e máximo;
  - teto por sessão, somando todas as páginas da visita.

  O estado da visita mora no sessionStorage (quantos já apareceram,
  os últimos produtos mostrados, quando é a próxima vez, se a
  pessoa dispensou). Sem ele, cada troca de página recomeçaria a
  contagem — e quem navega rápido veria um cartão a cada página.
  Ao chegar numa página nova, mesmo que a próxima vez já tenha
  passado, espera-se de 6 a 10s: nada aparece junto com a página.

  QUANDO NÃO MOSTRA (e tenta de novo mais tarde, sem contar):
  aba em segundo plano, menu ou carrinho abertos, <dialog> aberto
  (zoom, guia de tamanhos), alguém digitando num campo, ou o
  cartão cairia em cima do seletor de variantes / botão de compra.

  CUSTO:
  Um setTimeout por vez, nenhum observer, nenhum listener de
  scroll. O JSON só é lido na primeira exibição. O cartão entra no
  DOM ao aparecer e sai dele ao sumir — nada se acumula.

  ACESSIBILIDADE:
  Nunca rouba o foco. Com o ponteiro ou o foco em cima, o tempo
  para de correr (ninguém perde o cartão no meio da leitura). Esc
  fecha. Fechar vale para a visita inteira. Com menos movimento,
  as durações dos tokens do tema já chegam zeradas ao CSS.

  EDITOR DE TEMAS:
  Não roda sozinho (atrapalharia quem edita). Selecionar a section
  mostra uma prévia fixa; sair da section a esconde.
*/
(function () {
  'use strict';

  if (window.CODDestaque) return;
  window.CODDestaque = true;

  var CHAVE = 'cod:destaque';
  var CELULAR = '(max-width: 749px)';
  /* O que o cartão nunca pode cobrir. A barra fixa da PDP não está
     aqui porque o cartão já sobe a altura dela (--df-empurra). */
  var PROTEGIDOS = '.product__buy-buttons, .product__variants';
  var HISTORICO = 4;

  var raiz = null;
  var cfg = null;
  var produtos = null;
  var estado = null;
  var cartao = null;
  var relogio = null;
  var relogioSaida = null;
  var esconderEm = 0;
  var restante = 0;
  var focoAnterior = null;

  function sorteio(min, max) {
    return Math.round(min + Math.random() * Math.max(0, max - min));
  }

  function numero(nome, padrao) {
    var v = parseInt(raiz.getAttribute(nome), 10);
    return isNaN(v) ? padrao : v;
  }

  /* sessionStorage pode não existir (aba anônima em alguns
     navegadores, cookies bloqueados). Sem ele, o estado vale só
     para a página atual — o componente continua funcionando. */
  function lerEstado() {
    try {
      var bruto = window.sessionStorage.getItem(CHAVE);
      return bruto ? JSON.parse(bruto) : {};
    } catch (e) {
      return {};
    }
  }
  function gravarEstado() {
    try { window.sessionStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) {}
  }

  function noCelular() {
    return !!(window.matchMedia && window.matchMedia(CELULAR).matches);
  }
  function permitidoAqui() {
    return raiz.getAttribute(noCelular() ? 'data-mobile' : 'data-desktop') === 'true';
  }

  function ocupado() {
    if (document.body.classList.contains('bloquear')) return true;
    if (document.querySelector('dialog[open]')) return true;
    var ativo = document.activeElement;
    if (ativo && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) return true;
    return false;
  }

  function parar() {
    window.clearTimeout(relogio);
    window.clearTimeout(relogioSaida);
    relogio = null;
    relogioSaida = null;
  }

  function agendar(ms) {
    window.clearTimeout(relogio);
    relogio = window.setTimeout(tentar, Math.max(0, ms));
  }

  function esperarAba() {
    document.addEventListener('visibilitychange', function voltou() {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', voltou);
      agendar(sorteio(3000, 6000));
    });
  }

  /* ---------------------------------------------------------
     Qual produto: sorteio sem repetir os últimos mostrados.
     Com poucos produtos o histórico encolhe junto (nunca exclui
     todos), e com um produto só ele simplesmente se repete.
  --------------------------------------------------------- */
  function carregarProdutos() {
    if (produtos) return produtos;
    var fonte = raiz.querySelector('[data-destaque-produtos]');
    try {
      produtos = JSON.parse(fonte ? fonte.textContent : '[]');
    } catch (e) {
      produtos = [];
    }
    var aqui = window.location.pathname;
    produtos = produtos.filter(function (p) { return p && p.url && p.titulo && p.url !== aqui; });
    return produtos;
  }

  function escolher() {
    var lista = carregarProdutos();
    if (!lista.length) return null;
    var evitar = (estado.historico || []).slice(-Math.min(HISTORICO, lista.length - 1));
    var livres = lista.filter(function (p) { return evitar.indexOf(p.id) === -1; });
    if (!livres.length) livres = lista;
    return livres[Math.floor(Math.random() * livres.length)];
  }

  /* ---------------------------------------------------------
     Montagem. Tudo por textContent / createElement: o nome do
     produto nunca passa por innerHTML.
  --------------------------------------------------------- */
  function montar(p) {
    var modelo = raiz.querySelector('[data-destaque-modelo]');
    if (!modelo || !modelo.content) return null;
    var no = modelo.content.firstElementChild.cloneNode(true);

    no.querySelectorAll('[data-df-link]').forEach(function (a) { a.href = p.url; });

    var titulo = no.querySelector('[data-df-titulo]');
    if (titulo) {
      titulo.textContent = p.titulo;
      titulo.title = p.titulo;
    }

    var preco = no.querySelector('[data-df-preco]');
    /* Em promoção, o leitor de tela precisa saber qual valor é o
       antigo: os mesmos rótulos ocultos do snippet de preço. */
    if (preco && p.preco) {
      if (p.precoDe) {
        rotuloOculto(preco, preco.getAttribute('data-rotulo-de'));
        var de = document.createElement('s');
        de.textContent = p.precoDe;
        preco.appendChild(de);
        rotuloOculto(preco, preco.getAttribute('data-rotulo-por'));
      }
      var por = document.createElement('span');
      por.textContent = p.preco;
      preco.appendChild(por);
    }

    var midia = no.querySelector('[data-df-midia]');
    if (midia) {
      if (p.imagem) {
        var img = document.createElement('img');
        img.alt = '';
        img.width = 64;
        img.height = 85;
        img.decoding = 'async';
        img.src = p.imagem;
        img.addEventListener('error', function () { inicial(midia, p.titulo); });
        midia.appendChild(img);
      } else {
        inicial(midia, p.titulo);
      }
    }

    /* Barra fixa de compra da PDP (celular): o cartão sobe a altura
       dela, esteja ela aparecendo agora ou não — assim, quando ela
       entrar, os dois não se encostam. */
    var barra = document.querySelector('[data-sticky-buy]');
    if (barra && window.getComputedStyle(barra).display !== 'none') {
      no.style.setProperty('--df-empurra', barra.offsetHeight + 'px');
    }

    return no;
  }

  function rotuloOculto(pai, texto) {
    if (!texto) return;
    var s = document.createElement('span');
    s.className = 'visually-hidden';
    s.textContent = texto;
    pai.appendChild(s);
  }

  function inicial(midia, titulo) {
    midia.textContent = '';
    var letra = document.createElement('span');
    letra.className = 'destaque-flutuante__inicial';
    letra.textContent = (titulo || '').trim().charAt(0).toUpperCase();
    midia.appendChild(letra);
  }

  function cobreAlgo(no) {
    var a = no.getBoundingClientRect();
    var alvos = document.querySelectorAll(PROTEGIDOS);
    for (var i = 0; i < alvos.length; i++) {
      var b = alvos[i].getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.bottom > a.top && b.top < a.bottom && b.right > a.left && b.left < a.right) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------
     Mostrar / esconder
  --------------------------------------------------------- */
  function tentar() {
    relogio = null;
    if (!raiz) return;
    if (document.hidden) { esperarAba(); return; }
    if (!permitidoAqui() || ocupado()) { agendar(sorteio(4000, 8000)); return; }

    var p = escolher();
    if (!p) return;
    mostrar(p, false);
  }

  function mostrar(p, previa) {
    removerAgora();
    var no = montar(p);
    if (!no) return;
    document.body.appendChild(no);

    if (!previa && cobreAlgo(no)) {
      no.parentNode.removeChild(no);
      agendar(sorteio(5000, 9000));
      return;
    }

    cartao = no;
    ligar(no, previa);

    /* O getBoundingClientRect acima já forçou o layout no estado
       inicial (transparente e 12px abaixo); a classe no quadro
       seguinte vira a transição de entrada. */
    window.requestAnimationFrame(function () {
      if (cartao === no) no.classList.add('is-visivel');
    });

    if (previa) return;

    var tempo = sorteio(cfg.visivelMin, cfg.visivelMax);
    estado.exibidos = (estado.exibidos || 0) + 1;
    estado.historico = (estado.historico || []).concat(p.id).slice(-HISTORICO);
    estado.proximoEm = Date.now() + tempo + sorteio(cfg.intervaloMin, cfg.intervaloMax);
    gravarEstado();
    agendarSaida(tempo);
  }

  function agendarSaida(ms) {
    window.clearTimeout(relogioSaida);
    esconderEm = Date.now() + ms;
    relogioSaida = window.setTimeout(function () {
      relogioSaida = null;
      esconder();
      seguir();
    }, ms);
  }

  /* O intervalo conta a partir de quando o cartão SAI, não de
     quando entrou: se a pessoa parou em cima dele para ler, o
     próximo não pode vir colado. (O proximoEm gravado na entrada
     continua valendo para quem troca de página no meio.) */
  function seguir() {
    if (!raiz || estado.dispensado) return;
    if ((estado.exibidos || 0) >= cfg.limite) return;
    estado.proximoEm = Date.now() + sorteio(cfg.intervaloMin, cfg.intervaloMax);
    gravarEstado();
    agendar(estado.proximoEm - Date.now());
  }

  function esconder() {
    var no = cartao;
    if (!no) return;
    cartao = null;
    window.clearTimeout(relogioSaida);
    relogioSaida = null;

    var tinhaFoco = no.contains(document.activeElement);

    no.classList.remove('is-visivel');
    no.classList.add('is-saindo');

    var feito = false;
    function tirar() {
      if (feito) return;
      feito = true;
      if (no.parentNode) no.parentNode.removeChild(no);
    }
    no.addEventListener('transitionend', function (e) {
      if (e.target === no && e.propertyName === 'opacity') tirar();
    });
    /* Rede de segurança: sem transição (aba em segundo plano, CSS
       não carregado) o transitionend nunca chega. */
    window.setTimeout(tirar, 600);

    if (tinhaFoco) {
      var destino = focoAnterior;
      focoAnterior = null;
      if (destino && document.contains(destino) && typeof destino.focus === 'function') {
        try { destino.focus({ preventScroll: true }); } catch (e) { destino.focus(); }
      }
    }
  }

  function removerAgora() {
    if (cartao && cartao.parentNode) cartao.parentNode.removeChild(cartao);
    cartao = null;
    window.clearTimeout(relogioSaida);
    relogioSaida = null;
  }

  function dispensar() {
    estado.dispensado = true;
    gravarEstado();
    window.clearTimeout(relogio);
    relogio = null;
    esconder();
  }

  /* ---------------------------------------------------------
     Interação com o cartão: fechar, Esc e pausa enquanto a pessoa
     está com o ponteiro ou o foco nele. Os listeners morrem junto
     com o nó — nada fica pendurado no documento.
  --------------------------------------------------------- */
  function ligar(no, previa) {
    var fechar = no.querySelector('[data-df-fechar]');
    if (fechar) {
      fechar.addEventListener('click', function () {
        if (previa) esconder();
        else dispensar();
      });
    }

    no.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (previa) esconder();
      else dispensar();
    });

    if (previa) return;

    var ponteiro = false;
    var foco = false;

    function pausar() {
      if (!relogioSaida) return;
      window.clearTimeout(relogioSaida);
      relogioSaida = null;
      restante = Math.max(0, esconderEm - Date.now());
    }
    function retomar() {
      if (ponteiro || foco || cartao !== no || relogioSaida) return;
      agendarSaida(Math.max(restante, 2500));
    }

    no.addEventListener('mouseenter', function () { ponteiro = true; pausar(); });
    no.addEventListener('mouseleave', function () { ponteiro = false; retomar(); });
    no.addEventListener('focusin', function (e) {
      if (!foco && e.relatedTarget && !no.contains(e.relatedTarget)) focoAnterior = e.relatedTarget;
      foco = true;
      pausar();
    });
    no.addEventListener('focusout', function (e) {
      if (e.relatedTarget && no.contains(e.relatedTarget)) return;
      foco = false;
      retomar();
    });
  }

  /* ---------------------------------------------------------
     Início
  --------------------------------------------------------- */
  function iniciar() {
    raiz = document.querySelector('[data-destaque]');
    if (!raiz) return;

    cfg = {
      primeira: numero('data-primeira', 8000),
      visivelMin: numero('data-visivel-min', 4000),
      visivelMax: numero('data-visivel-max', 7000),
      intervaloMin: numero('data-intervalo-min', 20000),
      intervaloMax: numero('data-intervalo-max', 45000),
      limite: numero('data-limite', 4)
    };
    estado = lerEstado();
    produtos = null;

    if (window.Shopify && window.Shopify.designMode) return;
    if (estado.dispensado || (estado.exibidos || 0) >= cfg.limite) return;

    var espera;
    if (estado.proximoEm) {
      espera = Math.max(estado.proximoEm - Date.now(), sorteio(6000, 10000));
    } else {
      espera = sorteio(cfg.primeira, cfg.primeira + 10000);
    }
    agendar(espera);
  }

  function desmontar() {
    parar();
    removerAgora();
    raiz = null;
    produtos = null;
  }

  function daSection(evento) {
    return raiz && evento.detail && evento.detail.sectionId === raiz.getAttribute('data-section-id');
  }

  /* Editor: prévia ao selecionar, e reinício quando a section é
     recriada (cada mudança de setting a renderiza de novo). */
  document.addEventListener('shopify:section:select', function (e) {
    if (!daSection(e)) return;
    var p = carregarProdutos()[0];
    if (p) mostrar(p, true);
  });
  document.addEventListener('shopify:section:deselect', function (e) {
    if (daSection(e)) esconder();
  });
  document.addEventListener('shopify:section:unload', function (e) {
    if (daSection(e)) desmontar();
  });
  document.addEventListener('shopify:section:load', function (e) {
    if (!e.target || !e.target.querySelector('[data-destaque]')) return;
    desmontar();
    iniciar();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
