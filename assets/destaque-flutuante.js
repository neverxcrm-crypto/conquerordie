/*
  ============================================================
  destaque-flutuante.js — cartão de produto que aparece às vezes
  ============================================================

  O QUE FAZ:
  Lê a configuração que a section activity-popup deixou na página
  e, de tempos em tempos, mostra um cartão com um produto — de
  preferência um que COMBINA com o que a pessoa está vendo ou já
  pôs no carrinho — com compra em um toque e quanto falta para o
  frete grátis.

  DE ONDE VEM O PRODUTO (a cada exibição):
  1. página de produto → recomendações da Shopify para ele;
  2. carrinho com itens → recomendações para o último adicionado;
  3. senão (ou sem recomendação) → a coleção curada do editor.
  Primeiro pede intent=complementary ("complete o look", ligado no
  app Search & Discovery); vazio, tenta intent=related. A resposta
  fica no sessionStorage: o mesmo produto nunca é consultado duas
  vezes na visita. Nunca sugere o que já está no carrinho, o
  produto da página ou os últimos mostrados.

  O RITMO:
  - primeira aparição: sorteada entre N e N+10s;
  - tempo na tela e intervalo: sorteados entre mínimo e máximo;
  - o intervalo conta de quando o cartão SAI (quem parou para ler
    não recebe o próximo colado);
  - teto por sessão, somando todas as páginas da visita;
  - chegando numa página nova, nada aparece antes de 6–10s.

  QUANDO NÃO MOSTRA (tenta de novo mais tarde, sem contar):
  aba em segundo plano, menu ou carrinho abertos, <dialog> aberto,
  alguém digitando, ou o cartão cairia em cima do seletor de
  variantes / botão de compra da PDP.

  COMPRA EM UM TOQUE:
  O cartão monta um <form action="/cart/add"> — exatamente o que
  assets/carrinho.js já intercepta no documento. Tocar num tamanho
  preenche a variante e chama requestSubmit(): gaveta, contador do
  header, mensagem de erro e fallback sem JS são os do tema. Nada
  de carrinho é reimplementado aqui.

  CUSTO:
  Um setTimeout por vez, nenhum observer, nenhum listener de
  scroll. Rede só na hora de mostrar: /cart.js (pequeno) e, se
  preciso, uma recomendação (cacheada). O cartão entra no DOM ao
  aparecer e sai ao sumir.

  ACESSIBILIDADE:
  Nunca rouba o foco. Ponteiro ou foco no cartão congelam o tempo
  (e o fio dourado para junto). Esc fecha; fechar vale para a
  visita inteira. "Reduzir movimento" zera as durações pelos
  tokens do tema.

  EDITOR DE TEMAS:
  Não roda sozinho. Selecionar a section mostra uma prévia fixa.
*/
(function () {
  'use strict';

  if (window.CODDestaque) return;
  window.CODDestaque = true;

  var CHAVE = 'cod:destaque';
  var CHAVE_REC = 'cod:destaque:rec:';
  var CELULAR = '(max-width: 749px)';
  var PROTEGIDOS = '.product__buy-buttons, .product__variants';
  var HISTORICO = 4;
  var TAMANHOS_MAX = 8;

  var raiz = null;
  var cfg = null;
  var curados = null;
  var estado = null;
  var cartao = null;
  var relogio = null;
  var relogioSaida = null;
  var esconderEm = 0;
  var restante = 0;
  var focoAnterior = null;
  var preparando = false;

  /* ---------------------------------------------------------
     Utilidades
  --------------------------------------------------------- */
  function sorteio(min, max) {
    return Math.round(min + Math.random() * Math.max(0, max - min));
  }
  function attr(nome) { return raiz.getAttribute(nome) || ''; }
  function numero(nome, padrao) {
    var v = parseInt(attr(nome), 10);
    return isNaN(v) ? padrao : v;
  }
  function sim(nome) { return attr(nome) === 'true'; }

  function lerSessao(chave) {
    try {
      var bruto = window.sessionStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null;
    }
  }
  function gravarSessao(chave, valor) {
    try { window.sessionStorage.setItem(chave, JSON.stringify(valor)); } catch (e) {}
  }
  function gravarEstado() { gravarSessao(CHAVE, estado); }

  function dinheiro(centavos) {
    try {
      return new Intl.NumberFormat(cfg.idioma, { style: 'currency', currency: cfg.moeda }).format(centavos / 100);
    } catch (e) {
      return (centavos / 100).toFixed(2);
    }
  }

  function noCelular() {
    return !!(window.matchMedia && window.matchMedia(CELULAR).matches);
  }
  function permitidoAqui() {
    return sim(noCelular() ? 'data-mobile' : 'data-desktop');
  }
  function ocupado() {
    if (document.body.classList.contains('bloquear')) return true;
    if (document.querySelector('dialog[open]')) return true;
    var ativo = document.activeElement;
    return !!(ativo && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName) && !(cartao && cartao.contains(ativo)));
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
     Dados
  --------------------------------------------------------- */
  function carregarCurados() {
    if (curados) return curados;
    var fonte = raiz.querySelector('[data-destaque-produtos]');
    try {
      curados = JSON.parse(fonte ? fonte.textContent : '[]');
    } catch (e) {
      curados = [];
    }
    var aqui = window.location.pathname;
    curados = curados.filter(function (p) { return p && p.url && p.titulo && p.url !== aqui; });
    return curados;
  }

  function pedirCarrinho() {
    return fetch(cfg.raizLoja + 'cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* Formato /recommendations/products.json → formato do cartão.
     Preço em centavos, formatado com Intl na moeda da loja. */
  function normalizar(p) {
    if (!p || !p.available || !p.url) return null;
    var variantes = (p.variants || []).slice(0, TAMANHOS_MAX).map(function (v) {
      return { id: v.id, t: v.title, d: !!v.available };
    });
    var nomesOpcoes = (p.options || []).map(function (o) { return typeof o === 'string' ? o : o && o.name; });
    var unica = variantes.length === 1 && /default/i.test(variantes[0].t || '');
    var varia = p.price_varies || (p.price_min != null && p.price_max != null && p.price_min !== p.price_max);
    var comparar = p.compare_at_price || p.compare_at_price_min || 0;
    var imagem = p.featured_image || (p.images && p.images[0]) || null;
    if (imagem && typeof imagem === 'object') imagem = imagem.src || null;
    if (imagem && imagem.indexOf('data:') !== 0) imagem += (imagem.indexOf('?') === -1 ? '?' : '&') + 'width=200';
    return {
      id: p.id,
      url: p.url,
      titulo: p.title,
      imagem: imagem,
      preco: varia ? null : dinheiro(p.price),
      precoDe: !varia && comparar > p.price ? dinheiro(comparar) : null,
      desconto: !varia && comparar > p.price ? Math.floor(((comparar - p.price) * 100) / comparar) : 0,
      unica: unica,
      opcao: !unica && nomesOpcoes.length === 1 && (p.variants || []).length <= TAMANHOS_MAX ? nomesOpcoes[0] : null,
      variantes: variantes,
      aPartirDe: varia ? dinheiro(p.price_min || p.price) : null
    };
  }

  function pedirRecomendacoes(produtoId) {
    var guardado = lerSessao(CHAVE_REC + produtoId);
    if (guardado) return Promise.resolve(guardado);

    function buscar(intent) {
      var url = cfg.raizLoja + 'recommendations/products.json?product_id=' + encodeURIComponent(produtoId) +
        '&limit=8&intent=' + intent;
      return fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { products: [] }; })
        .then(function (dados) { return (dados.products || []).map(normalizar).filter(Boolean); })
        .catch(function () { return []; });
    }

    return buscar('complementary')
      .then(function (lista) { return lista.length ? lista : buscar('related'); })
      .then(function (lista) {
        gravarSessao(CHAVE_REC + produtoId, lista);
        return lista;
      });
  }

  /* Sorteio sem repetir o que já está no carrinho, o produto da
     página e os últimos mostrados. Com poucos produtos o histórico
     cede antes do carrinho: repetir uma sugestão é aceitável,
     sugerir o que a pessoa já tem, não. */
  function sortear(lista, noCarrinho) {
    var atual = cfg.produtoAtual;
    var base = lista.filter(function (p) {
      return String(p.id) !== atual && noCarrinho.indexOf(p.id) === -1;
    });
    if (!base.length) return null;
    var evitar = (estado.historico || []).slice(-Math.min(HISTORICO, base.length - 1));
    var livres = base.filter(function (p) { return evitar.indexOf(p.id) === -1; });
    if (!livres.length) livres = base;
    return livres[Math.floor(Math.random() * livres.length)];
  }

  /* Monta a escolha da vez: produto + título + contexto de frete. */
  function preparar() {
    var precisaCarrinho = cfg.recomendar || cfg.frete > 0;
    var carrinho = precisaCarrinho ? pedirCarrinho() : Promise.resolve(null);

    return carrinho.then(function (c) {
      var itens = (c && c.items) || [];
      var noCarrinho = itens.map(function (i) { return i.product_id; });
      var contexto = { carrinho: c, noCarrinho: noCarrinho };

      var origemId = null;
      var titulo = cfg.tituloPadrao;
      if (cfg.recomendar && cfg.produtoAtual) {
        origemId = cfg.produtoAtual;
        titulo = cfg.tituloProduto || titulo;
      } else if (cfg.recomendar && itens.length) {
        origemId = itens[0].product_id; // /cart.js lista o mais recente primeiro
        titulo = cfg.tituloCarrinho || titulo;
      }

      var recs = origemId ? pedirRecomendacoes(origemId) : Promise.resolve([]);
      return recs.then(function (lista) {
        var p = sortear(lista, noCarrinho);
        if (!p) {
          p = sortear(carregarCurados(), noCarrinho);
          titulo = cfg.tituloPadrao;
        }
        if (!p) return null;
        contexto.produto = p;
        contexto.titulo = titulo;
        return contexto;
      });
    });
  }

  /* ---------------------------------------------------------
     Montagem — tudo por textContent / createElement.
  --------------------------------------------------------- */
  function rotuloOculto(pai, texto) {
    if (!texto) return;
    var s = document.createElement('span');
    s.className = 'visually-hidden';
    s.textContent = texto;
    pai.appendChild(s);
  }

  function inicial(midia, titulo) {
    var img = midia.querySelector('img');
    if (img) img.parentNode.removeChild(img);
    var letra = document.createElement('span');
    letra.className = 'destaque-flutuante__inicial';
    letra.textContent = (titulo || '').trim().charAt(0).toUpperCase();
    midia.appendChild(letra);
  }

  function montarPreco(no, p) {
    var preco = no.querySelector('[data-df-preco]');
    if (!preco) return;
    if (p.aPartirDe) {
      preco.textContent = cfg.txtAPartir ? cfg.txtAPartir.split('[valor]').join(p.aPartirDe) : p.aPartirDe;
      return;
    }
    if (!p.preco) return;
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

  /* A ação da vez: tamanhos, "adicionar", ou link para a página. */
  function montarAcao(no, p) {
    var form = no.querySelector('[data-df-form]');
    var ver = no.querySelector('[data-df-ver]');
    var campo = no.querySelector('[data-df-variante]');
    var grupo = no.querySelector('[data-df-tamanhos]');
    var adicionar = no.querySelector('[data-df-adicionar]');

    var variantes = p.variantes || [];
    var algumaDisponivel = variantes.some(function (v) { return v.d; });
    var podeRapido = cfg.compraRapida && form && algumaDisponivel && (p.unica || p.opcao);

    if (!podeRapido) {
      if (ver) ver.hidden = false;
      return;
    }

    form.hidden = false;
    form.addEventListener('submit', function () {
      /* O carrinho.js assume daqui (gaveta abre, contador sobe). O
         cartão sai de cena: a tarefa dele terminou. */
      window.setTimeout(function () { if (cartao === no) esconder(); seguir(); }, 250);
    });

    function enviar(varianteId, botao) {
      campo.value = varianteId;
      botao.setAttribute('aria-busy', 'true');
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    }

    if (p.unica) {
      adicionar.hidden = false;
      adicionar.setAttribute('aria-label', cfg.txtAdicionar + ': ' + p.titulo);
      adicionar.addEventListener('click', function () { enviar(variantes[0].id, adicionar); });
      return;
    }

    grupo.setAttribute('aria-label', p.opcao);
    variantes.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'destaque-flutuante__tamanho';
      b.textContent = v.t;
      if (v.d) {
        b.setAttribute('aria-label', cfg.txtAdicionar + ': ' + p.titulo + ', ' + p.opcao + ' ' + v.t);
        b.addEventListener('click', function () { enviar(v.id, b); });
      } else {
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('aria-label', p.opcao + ' ' + v.t + ': ' + cfg.txtEsgotado);
      }
      grupo.appendChild(b);
    });
  }

  function montarFrete(no, carrinho) {
    var caixa = no.querySelector('[data-df-frete]');
    if (!caixa || !cfg.frete || !carrinho) return;
    var total = carrinho.total_price || 0;
    if (total >= cfg.frete) return; // já ganhou: nada a vender aqui

    var texto = no.querySelector('[data-df-frete-texto]');
    var modelo = total > 0 ? cfg.txtFreteFalta : cfg.txtFreteAPartir;
    var valor = total > 0 ? dinheiro(cfg.frete - total) : dinheiro(cfg.frete);
    var partes = modelo.split('[valor]');
    texto.textContent = '';
    texto.appendChild(document.createTextNode(partes[0] || ''));
    var forte = document.createElement('strong');
    forte.textContent = valor;
    texto.appendChild(forte);
    texto.appendChild(document.createTextNode(partes.slice(1).join('[valor]')));

    no.style.setProperty('--df-frete', Math.max(0.03, Math.min(1, total / cfg.frete)).toFixed(3));
    caixa.hidden = false;
  }

  function montar(escolha) {
    var modelo = raiz.querySelector('[data-destaque-modelo]');
    if (!modelo || !modelo.content) return null;
    var no = modelo.content.firstElementChild.cloneNode(true);
    var p = escolha.produto;

    var rotulo = no.querySelector('[data-df-rotulo]');
    if (rotulo) {
      if (escolha.titulo) rotulo.textContent = escolha.titulo;
      else rotulo.parentNode.removeChild(rotulo);
    }

    no.querySelectorAll('[data-df-link]').forEach(function (a) { a.href = p.url; });
    var titulo = no.querySelector('[data-df-titulo]');
    if (titulo) {
      titulo.textContent = p.titulo;
      titulo.title = p.titulo;
    }

    montarPreco(no, p);

    var midia = no.querySelector('[data-df-midia]');
    if (midia) {
      if (p.imagem) {
        var img = document.createElement('img');
        img.alt = '';
        img.width = 76;
        img.height = 101;
        img.decoding = 'async';
        img.src = p.imagem;
        img.addEventListener('error', function () { inicial(midia, p.titulo); });
        midia.appendChild(img);
      } else {
        inicial(midia, p.titulo);
      }
      var selo = midia.querySelector('[data-df-selo]');
      if (selo && cfg.desconto && p.desconto >= 5) {
        selo.textContent = '−' + p.desconto + '%';
        selo.hidden = false;
      }
    }

    montarAcao(no, p);
    montarFrete(no, escolha.carrinho);

    var barra = document.querySelector('[data-sticky-buy]');
    if (barra && window.getComputedStyle(barra).display !== 'none') {
      no.style.setProperty('--df-empurra', barra.offsetHeight + 'px');
    }
    return no;
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

  /* A foto é esperada (até 1,2s) antes de o cartão entrar: sem
     isso ele chegaria com um quadrado vazio que "pisca" a foto
     depois — justamente no instante em que o olho está nele. */
  function esperarFoto(no) {
    var img = no.querySelector('.destaque-flutuante__midia img');
    if (!img || img.complete) return Promise.resolve();
    return new Promise(function (resolver) {
      var feito = false;
      function fim() { if (!feito) { feito = true; resolver(); } }
      img.addEventListener('load', fim);
      img.addEventListener('error', fim);
      window.setTimeout(fim, 1200);
    });
  }

  /* ---------------------------------------------------------
     Mostrar / esconder
  --------------------------------------------------------- */
  function tentar() {
    relogio = null;
    if (!raiz || preparando) return;
    if (document.hidden) { esperarAba(); return; }
    if (!permitidoAqui() || ocupado()) { agendar(sorteio(4000, 8000)); return; }

    preparando = true;
    preparar().then(function (escolha) {
      preparando = false;
      if (!raiz) return;
      if (!escolha) return;
      if (document.hidden || ocupado()) { agendar(sorteio(4000, 8000)); return; }
      mostrar(escolha, false);
    }, function () {
      preparando = false;
    });
  }

  function mostrar(escolha, previa) {
    removerAgora();
    var no = montar(escolha);
    if (!no) return;

    no.style.visibility = 'hidden';
    document.body.appendChild(no);

    if (!previa && cobreAlgo(no)) {
      no.parentNode.removeChild(no);
      agendar(sorteio(5000, 9000));
      return;
    }

    cartao = no;
    ligar(no, previa);

    esperarFoto(no).then(function () {
      if (cartao !== no) return;
      no.style.visibility = '';
      window.requestAnimationFrame(function () {
        if (cartao !== no) return;
        no.classList.add('is-visivel');
        if (!previa) no.classList.add('is-contando');
      });
    });

    if (previa) return;

    var tempo = sorteio(cfg.visivelMin, cfg.visivelMax);
    no.style.setProperty('--df-tempo', tempo + 'ms');
    estado.exibidos = (estado.exibidos || 0) + 1;
    estado.historico = (estado.historico || []).concat(escolha.produto.id).slice(-HISTORICO);
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
    no.classList.remove('is-visivel', 'is-contando', 'is-pausado');
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
    window.setTimeout(tirar, 700);

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

  /* Fechar, Esc e pausa. Os listeners morrem junto com o nó. */
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
      no.classList.add('is-pausado');
      if (!relogioSaida) return;
      window.clearTimeout(relogioSaida);
      relogioSaida = null;
      restante = Math.max(0, esconderEm - Date.now());
    }
    function retomar() {
      if (ponteiro || foco || cartao !== no || relogioSaida) return;
      no.classList.remove('is-pausado');
      agendarSaida(Math.max(restante, 1200));
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
    /* No toque não existe hover: encostar o dedo no cartão também
       segura o tempo, até ele sair da tela ou a pessoa rolar. */
    no.addEventListener('touchstart', function () {
      pausar();
      window.setTimeout(retomar, 4000);
    }, { passive: true });
  }

  /* ---------------------------------------------------------
     Início
  --------------------------------------------------------- */
  function iniciar() {
    raiz = document.querySelector('[data-destaque]');
    if (!raiz) return;

    cfg = {
      primeira: numero('data-primeira', 8000),
      visivelMin: numero('data-visivel-min', 8000),
      visivelMax: numero('data-visivel-max', 12000),
      intervaloMin: numero('data-intervalo-min', 25000),
      intervaloMax: numero('data-intervalo-max', 50000),
      limite: numero('data-limite', 4),
      recomendar: sim('data-recomendar'),
      compraRapida: sim('data-compra-rapida'),
      desconto: sim('data-desconto'),
      produtoAtual: attr('data-produto-atual'),
      frete: numero('data-frete', 0),
      moeda: attr('data-moeda') || 'BRL',
      idioma: attr('data-idioma') || document.documentElement.lang || 'pt-BR',
      raizLoja: attr('data-raiz-loja') || '/',
      tituloPadrao: attr('data-titulo-padrao'),
      tituloProduto: attr('data-titulo-produto'),
      tituloCarrinho: attr('data-titulo-carrinho'),
      txtFreteFalta: attr('data-txt-frete-falta'),
      txtFreteAPartir: attr('data-txt-frete-a-partir'),
      txtAdicionar: attr('data-txt-adicionar'),
      txtEsgotado: attr('data-txt-esgotado'),
      txtAPartir: attr('data-txt-a-partir')
    };
    if (cfg.raizLoja.charAt(cfg.raizLoja.length - 1) !== '/') cfg.raizLoja += '/';

    estado = lerSessao(CHAVE) || {};
    curados = null;

    if (window.Shopify && window.Shopify.designMode) return;
    if (estado.dispensado || (estado.exibidos || 0) >= cfg.limite) return;

    var espera = estado.proximoEm
      ? Math.max(estado.proximoEm - Date.now(), sorteio(6000, 10000))
      : sorteio(cfg.primeira, cfg.primeira + 10000);
    agendar(espera);
  }

  function desmontar() {
    window.clearTimeout(relogio);
    relogio = null;
    removerAgora();
    raiz = null;
    curados = null;
  }

  function daSection(evento) {
    return raiz && evento.detail && evento.detail.sectionId === raiz.getAttribute('data-section-id');
  }

  document.addEventListener('shopify:section:select', function (e) {
    if (!daSection(e)) return;
    var p = carregarCurados()[0];
    if (p) mostrar({ produto: p, titulo: cfg.tituloPadrao, carrinho: { total_price: 0 } }, true);
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
