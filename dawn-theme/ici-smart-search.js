(function () {
  'use strict';

  const root = document.querySelector('.ici-smart-search');
  if (!root) return;

  const API_URL = root.dataset.apiUrl;
  const SEARCH_ENDPOINT = `${API_URL}/api/search`;

  const trigger = root.querySelector('.ici-search-trigger');
  const modal = root.querySelector('.ici-search-modal');
  const input = root.querySelector('.ici-search-input');
  const grid = root.querySelector('.ici-search-grid');
  const explanation = root.querySelector('.ici-search-explanation');
  const noResults = root.querySelector('.ici-search-no-results');
  const examples = root.querySelectorAll('.ici-example-chip');

  const states = {
    empty: root.querySelector('[data-state="empty"]'),
    loading: root.querySelector('[data-state="loading"]'),
    results: root.querySelector('[data-state="results"]'),
    error: root.querySelector('[data-state="error"]')
  };

  let debounceTimer = null;
  let currentRequest = 0;

  function showState(name) {
    Object.entries(states).forEach(([key, el]) => {
      if (!el) return;
      el.hidden = key !== name;
    });
  }

  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => input.focus(), 50);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    input.value = '';
    showState('empty');
    grid.innerHTML = '';
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatPrice(amount, currency) {
    if (!amount) return '';
    const value = parseFloat(amount).toFixed(2);
    return `$${value} ${currency || 'USD'}`;
  }

  function renderResults(data) {
    if (!data.results || data.results.length === 0) {
      grid.innerHTML = '';
      noResults.hidden = false;
      explanation.textContent = '';
      explanation.style.display = 'none';
      return;
    }

    noResults.hidden = true;
    if (data.explanation) {
      explanation.textContent = data.explanation;
      explanation.style.display = 'block';
    } else {
      explanation.style.display = 'none';
    }

    grid.innerHTML = data.results.map(p => {
      const img = p.image
        ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.image_alt || p.title)}" loading="lazy">`
        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:11px;">Sin imagen</div>`;

      const price = p.available
        ? `<div class="ici-product-price">${formatPrice(p.price, p.currency)}</div>`
        : `<div class="ici-product-unavailable">Agotado</div>`;

      return `
        <a class="ici-product-card" href="${escapeHtml(p.url)}">
          <div class="ici-product-image">${img}</div>
          <div class="ici-product-info">
            <div class="ici-product-vendor">${escapeHtml(p.vendor || '')}</div>
            <div class="ici-product-title">${escapeHtml(p.title)}</div>
            ${price}
          </div>
        </a>
      `;
    }).join('');
  }

  async function performSearch(query) {
    const requestId = ++currentRequest;
    showState('loading');

    try {
      const res = await fetch(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (requestId !== currentRequest) return;

      if (!res.ok) {
        const err = await res.text();
        console.error('Search error:', err);
        showState('error');
        return;
      }

      const data = await res.json();
      if (requestId !== currentRequest) return;

      showState('results');
      renderResults(data);
    } catch (err) {
      if (requestId !== currentRequest) return;
      console.error('Search request failed:', err);
      showState('error');
    }
  }

  trigger.addEventListener('click', openModal);

  root.querySelectorAll('[data-action="close"]').forEach(el => {
    el.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      openModal();
    }
  });

  input.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    clearTimeout(debounceTimer);

    if (value.length < 3) {
      showState('empty');
      return;
    }

    debounceTimer = setTimeout(() => {
      performSearch(value);
    }, 450);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const value = input.value.trim();
      if (value.length >= 2) {
        clearTimeout(debounceTimer);
        performSearch(value);
      }
    }
  });

  examples.forEach(chip => {
    chip.addEventListener('click', () => {
      const example = chip.dataset.example;
      input.value = example;
      performSearch(example);
    });
  });
})();
