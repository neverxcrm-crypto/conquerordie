/*
  ============================================================
  carrinho.js — Helper de carrinho (add-to-cart via AJAX)
  ============================================================

  O QUE FAZ:
  Melhoria progressiva para adicionar produtos ao carrinho sem
  recarregar a pagina. Intercepta o envio de qualquer formulario
  de add-to-cart, envia para a Cart AJAX API do Shopify
  (/cart/add.js), atualiza o contador do carrinho no header
  (buscando /cart.js) e mostra uma confirmacao leve via
  window.mostrarAlerta (definido em snippets/alerta.liquid).

  OBSERVACOES:
  Funciona sem JS: o formulario de produto ja envia nativamente
  para /cart/add. Se a requisicao AJAX falhar, o script faz
  fallback e submete o formulario do jeito tradicional.
  O contador usa elementos com [data-cart-count]. O texto do
  alerta vem de window.themeStrings.addedToCart quando disponivel.
*/
(function () {
  'use strict';

  function updateCartCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = count;
    });
  }

  function refreshCartCount() {
    fetch(window.Shopify && window.Shopify.routes ? window.Shopify.routes.root + 'cart.js' : '/cart.js', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (cart) { updateCartCount(cart.item_count); })
      .catch(function () {});
  }

  function handleSubmit(event) {
    var form = event.target;
    if (!form.matches('form[action$="/cart/add"], form[data-type="add-to-cart-form"]')) return;

    event.preventDefault();
    var button = form.querySelector('[type="submit"], [name="add"]');
    if (button) button.setAttribute('aria-busy', 'true');

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: new FormData(form)
    })
      .then(function (r) {
        if (!r.ok) throw new Error('add failed');
        return r.json();
      })
      .then(function () {
        refreshCartCount();
        if (typeof window.mostrarAlerta === 'function') {
          window.mostrarAlerta(
            (window.themeStrings && window.themeStrings.addedToCart) || 'Added to cart',
            'positivo'
          );
        }
      })
      .catch(function () {
        // Fallback: submit the form the normal way.
        form.submit();
      })
      .finally(function () {
        if (button) button.removeAttribute('aria-busy');
      });
  }

  document.addEventListener('submit', handleSubmit);
  document.addEventListener('DOMContentLoaded', refreshCartCount);
})();
