/*
  ============================================================
  carrinho.js — Cart Drawer + Cart AJAX API
  ============================================================

  O QUE FAZ:
  1. Intercepta QUALQUER formulário de add-to-cart do tema (produto,
     card, order bump) e envia via Cart AJAX API (/cart/add.js).
  2. Intercepta os controles de quantidade/remover do cart-drawer e
     envia via /cart/change.js.
  3. Em ambos os casos, pede ao Shopify (parâmetro `sections`) o HTML
     já renderizado da section 'cart-drawer' e da section 'nav'
     (o header) na MESMA resposta — zero reload, zero segunda
     requisição para montar a UI.
  4. Controla abrir/fechar do drawer: overlay, focus trap, ESC,
     clique no scrim, devolução de foco ao elemento que abriu.
  5. Order bump automático: busca uma recomendação real via
     /recommendations/products (motor nativo do Shopify) e injeta
     no slot do drawer — nunca inventa um produto.

  POR QUE SUBSTITUI ELEMENTOS EM VEZ DE RE-CRIAR TUDO:
  A raiz #CartDrawer NUNCA é substituída — só o miolo dela
  ([data-cart-drawer-inner]). Se recriássemos a raiz inteira a cada
  atualização, a classe .is-open (que controla toda a animação via
  CSS) se perderia e o drawer fecharia sozinho no meio de uma troca
  de quantidade. Os cliques em itens do carrinho funcionam mesmo
  depois de trocar o HTML porque os listeners usam DELEGAÇÃO em
  #CartDrawer (que é estável), nunca em elementos internos.

  ACESSIBILIDADE:
  - foco preso dentro do painel enquanto aberto (Tab/Shift+Tab);
  - Esc fecha e devolve o foco a quem abriu;
  - clique no scrim fecha;
  - aria-live (#CartDrawer [data-cart-status]) anuncia mudanças.

  FALLBACK SEM JS / EM CASO DE ERRO:
  Todo formulário de add-to-cart já funciona nativamente (submit
  normal para /cart/add). Se a chamada AJAX falhar, o script faz
  fallback para o submit tradicional — nada trava.
*/
(function () {
  'use strict';

  var root = document.getElementById('CartDrawer');
  if (!root) return;

  var inner = root.querySelector('[data-cart-drawer-inner]');
  var status = root.querySelector('[data-cart-status]');
  var cartType = root.getAttribute('data-cart-type') || 'drawer';
  var lastOpener = null;
  var lastBumpSourceId = null;

  /* ---------------------------------------------------------
     Contador do header — some quando o carrinho fica vazio, para
     nunca mostrar um badge com "0".
  --------------------------------------------------------- */
  function updateHeaderCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = count;
      el.hidden = count === 0;
    });
  }

  /* ---------------------------------------------------------
     Abrir / fechar
  --------------------------------------------------------- */
  function getFocusable() {
    return Array.prototype.slice.call(
      root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
    );
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    var focusable = getFocusable();
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      closeDrawer();
    } else {
      trapFocus(event);
    }
  }

  function openDrawer(opener) {
    lastOpener = opener || document.activeElement;
    root.classList.add('is-open');
    document.body.classList.add('bloquear');
    document.addEventListener('keydown', onKeydown);
    // Foco vai para o botão de fechar — primeiro elemento operável do painel.
    var closeBtn = root.querySelector('.cart-drawer__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeDrawer() {
    if (!root.classList.contains('is-open')) return;
    root.classList.remove('is-open');
    // O drawer do menu mobile (sections/nav.liquid) também usa
    // .bloquear; se ele ainda estiver aberto, quem destrava o
    // scroll é o fechamento dele, não o do carrinho.
    if (!document.querySelector('.header__mobile-nav.is-open')) {
      document.body.classList.remove('bloquear');
    }
    document.removeEventListener('keydown', onKeydown);
    if (lastOpener && typeof lastOpener.focus === 'function') lastOpener.focus();
  }

  /* ---------------------------------------------------------
     Atualização de conteúdo via Section Rendering API
  --------------------------------------------------------- */
  function extractInner(html) {
    var template = document.createElement('template');
    template.innerHTML = html;
    return template.content.querySelector('[data-cart-drawer-inner]');
  }

  function applySections(sections, opts) {
    opts = opts || {};
    if (sections && sections['cart-drawer']) {
      var scrollRegion = root.querySelector('[data-cart-scroll]');
      var scrollTop = scrollRegion ? scrollRegion.scrollTop : 0;

      var newInner = extractInner(sections['cart-drawer']);
      if (newInner) {
        // Copia os data-* dinâmicos da nova raiz renderizada para a
        // raiz atual (que nunca é substituída) — é assim que o bump
        // automático sabe qual é o produto-base após cada mudança.
        var template = document.createElement('template');
        template.innerHTML = sections['cart-drawer'];
        var newRoot = template.content.querySelector('[data-cart-drawer]');
        if (newRoot) {
          var bumpId = newRoot.getAttribute('data-bump-product-id');
          if (bumpId) {
            root.setAttribute('data-bump-product-id', bumpId);
          } else {
            root.removeAttribute('data-bump-product-id');
          }
        }

        inner.innerHTML = newInner.innerHTML;

        if (scrollRegion) {
          var newScrollRegion = root.querySelector('[data-cart-scroll]');
          if (newScrollRegion) newScrollRegion.scrollTop = scrollTop;
        }
      }
    }

    if (sections && sections.nav) {
      var template2 = document.createElement('template');
      template2.innerHTML = sections.nav;
      var newCount = template2.content.querySelector('[data-cart-count]');
      if (newCount) updateHeaderCount(parseInt(newCount.textContent, 10) || 0);
    }

    if (!opts.silent) maybeLoadBump();
  }

  function announce(message) {
    if (status && message) status.textContent = message;
  }

  /* ---------------------------------------------------------
     Order bump automático — recomendação real do Shopify.
     Só dispara quando o slot existe, está vazio e o produto-base
     mudou desde a última busca (evita refetch a cada +1 de qtd).
  --------------------------------------------------------- */
  function maybeLoadBump() {
    if (cartType !== 'drawer') return;
    if (root.getAttribute('data-bump-mode') !== 'auto') return;

    var bumpBlock = root.querySelector('[data-cart-bump]');
    var slot = root.querySelector('[data-cart-bump-slot]');
    if (!bumpBlock || !slot) return;

    var productId = root.getAttribute('data-bump-product-id');
    if (!productId) {
      bumpBlock.hidden = true;
      lastBumpSourceId = null;
      return;
    }
    if (productId === lastBumpSourceId) return;
    lastBumpSourceId = productId;

    var url = window.Shopify && window.Shopify.routes && window.Shopify.routes.root
      ? window.Shopify.routes.root
      : '/';
    fetch(
      url + 'recommendations/products?product_id=' + encodeURIComponent(productId) +
      '&limit=1&intent=related&section_id=cart-recommendations'
    )
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var template = document.createElement('template');
        template.innerHTML = html;
        var card = template.content.querySelector('.cart-bump-product');
        if (!card) {
          bumpBlock.hidden = true;
          slot.innerHTML = '';
          return;
        }
        // Não recomenda algo que já está no carrinho.
        var recommendedVariant = card.querySelector('[data-cart-bump-add]');
        var recommendedId = recommendedVariant ? recommendedVariant.getAttribute('data-variant-id') : null;
        var currentVariantIds = Array.prototype.slice
          .call(root.querySelectorAll('[data-cart-change]'))
          .map(function (el) { return el.getAttribute('data-variant-id'); });
        if (recommendedId && currentVariantIds.indexOf(recommendedId) !== -1) {
          bumpBlock.hidden = true;
          slot.innerHTML = '';
          return;
        }
        slot.innerHTML = '';
        slot.appendChild(card);
        bumpBlock.hidden = false;
      })
      .catch(function () { bumpBlock.hidden = true; });
  }

  /* ---------------------------------------------------------
     Fetch helper com estado "ocupado" (opacity no drawer, sem
     spinner — feedback visual sutil pedido no design).
  --------------------------------------------------------- */
  function withBusy(promise) {
    root.setAttribute('data-busy', 'true');
    return promise.finally(function () {
      root.removeAttribute('data-busy');
    });
  }

  /* ---------------------------------------------------------
     Adicionar ao carrinho — qualquer form do tema.
  --------------------------------------------------------- */
  function handleSubmit(event) {
    var form = event.target;
    if (!form.matches('form[action$="/cart/add"], form[data-type="add-to-cart-form"]')) return;

    event.preventDefault();
    var button = form.querySelector('[type="submit"], [name="add"]');
    if (button) button.setAttribute('aria-busy', 'true');
    var opener = button || form;

    var formData = new FormData(form);
    formData.append('sections', 'cart-drawer,nav');

    withBusy(
      fetch('/cart/add.js', { method: 'POST', headers: { Accept: 'application/json' }, body: formData })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (err) { throw err; });
          return r.json();
        })
        .then(function (item) {
          applySections(item.sections);
          announce(
            (root.getAttribute('data-added-message') || 'Added to cart') + ': ' + item.product_title
          );
          if (cartType === 'drawer') openDrawer(opener);
        })
        .catch(function (err) {
          // Estoque insuficiente ou erro real: mensagem no lugar do
          // toast antigo, sem travar o formulário.
          var message = (err && err.description) || root.getAttribute('data-error-message') || 'Cart error';
          if (typeof window.mostrarAlerta === 'function') {
            window.mostrarAlerta(message, 'negativo');
          } else {
            form.submit();
          }
        })
        .finally(function () {
          if (button) button.removeAttribute('aria-busy');
        })
    );
  }

  /* ---------------------------------------------------------
     Botão de adicionar do order bump (produto de 1 variante).
  --------------------------------------------------------- */
  function handleBumpAdd(event) {
    var button = event.target.closest('[data-cart-bump-add]');
    if (!button || !root.contains(button)) return;

    button.setAttribute('data-busy', 'true');
    var body = new URLSearchParams();
    body.append('id', button.getAttribute('data-variant-id'));
    body.append('quantity', '1');
    body.append('sections', 'cart-drawer,nav');

    withBusy(
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      })
        .then(function (r) { return r.json(); })
        .then(function (item) {
          lastBumpSourceId = null; // forca reavaliar a recomendacao com o carrinho novo
          applySections(item.sections);
          announce((root.getAttribute('data-added-message') || 'Added to cart') + ': ' + item.product_title);
        })
        .catch(function () {})
        .finally(function () { button.removeAttribute('data-busy'); })
    );
  }

  /* ---------------------------------------------------------
     Quantidade / remover — delegado em #CartDrawer.
  --------------------------------------------------------- */
  function handleChange(event) {
    var button = event.target.closest('[data-cart-change]');
    if (!button || !root.contains(button)) return;

    var line = button.getAttribute('data-cart-change');
    var quantity = Math.max(0, parseInt(button.getAttribute('data-cart-quantity'), 10) || 0);
    var group = button.closest('.cart-item-drawer');
    if (group) group.setAttribute('data-busy', 'true');

    withBusy(
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: line, quantity: quantity, sections: 'cart-drawer,nav' })
      })
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          applySections(cart.sections);
          announce(quantity === 0 ? (root.getAttribute('data-removed-message') || 'Item removed') : null);
        })
        .catch(function () {
          if (typeof window.mostrarAlerta === 'function') {
            window.mostrarAlerta(root.getAttribute('data-error-message') || 'Cart error', 'negativo');
          }
        })
    );
  }

  /* ---------------------------------------------------------
     Bind
  --------------------------------------------------------- */
  document.addEventListener('submit', handleSubmit);
  root.addEventListener('click', handleChange);
  root.addEventListener('click', handleBumpAdd);

  root.addEventListener('click', function (event) {
    if (event.target.closest('[data-cart-close]')) closeDrawer();
  });

  document.querySelectorAll('[data-cart-open]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      if (cartType !== 'drawer') return; // cart_type "page": deixa navegar normalmente
      event.preventDefault();
      openDrawer(link);
    });
  });

  // Se o carrinho já chega com itens (ex.: voltando de outra aba) e o
  // bump automático está ativo, tenta carregar a recomendação uma vez.
  maybeLoadBump();
})();
