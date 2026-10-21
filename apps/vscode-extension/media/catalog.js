(() => {
  const vscode = acquireVsCodeApi();
  const search = document.getElementById('search');
  let state = {
    serverless: [],
    dedicated: [],
    publicStatus: 'Chargement…',
    dedicatedStatus: 'Sélectionnez un projet',
    scope: 'Catalogue public',
  };
  let detailTrigger;
  function renderRows(id, rows, kind) {
    const root = document.getElementById(id);
    root.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const shown = rows.filter((row) =>
      `${row.label} ${row.status || ''}`.toLocaleLowerCase().includes(query),
    );
    for (const row of shown) {
      const card = document.createElement('article');
      const title = document.createElement('h3');
      title.textContent = row.label;
      card.append(title);
      const status = document.createElement('p');
      status.textContent = row.status || 'Statut inconnu';
      card.append(status);
      const note = document.createElement('p');
      note.textContent =
        kind === 'public'
          ? 'Serverless · offre disponible, pas un déploiement dédié'
          : 'Dédié · modèle à déployer, pas une ressource déployée';
      card.append(note);
      if (kind === 'public') {
        const prices = (row.serverlessPrices || []).filter(
          (price) => price.consumptionMode === 'realtime',
        );
        const pricing = document.createElement('p');
        pricing.className = 'model-prices';
        pricing.textContent = prices.length
          ? prices
              .map((price) => {
                const type =
                  {
                    input_token: 'Entrée',
                    output_token: 'Sortie',
                    cached_input_token: 'Entrée en cache',
                  }[price.tokenType] || price.tokenType;
                const unit = price.unit === 'token' ? 'tokens' : price.unit;
                return [
                  type,
                  ':',
                  price.amountEUR.replace('.', ','),
                  '€ /',
                  price.size,
                  unit,
                ].join(' ');
              })
              .join(' · ')
          : 'Tarif temps réel non disponible dans les données retournées';
        card.append(pricing);
      }
      const details = document.createElement('button');
      details.type = 'button';
      details.textContent = 'Voir les détails';
      details.setAttribute('aria-label', `Voir les détails de ${row.label}`);
      details.addEventListener('click', () => {
        detailTrigger = details;
        vscode.postMessage({
          type: 'details',
          kind: kind === 'public' ? 'serverless' : 'dedicated-catalog',
          id: row.id,
        });
      });
      card.append(details);
      if (kind === 'dedicated') {
        const supported = new Set(
          (row.dedicatedInfo?.supportedNodes || [])
            .filter((node) => node.allowed && node.maxContextSize > 0)
            .map((node) => node.nodeTypeName),
        );
        const compatiblePrices = (state.prices || []).filter((price) =>
          supported.has(price.nodeTypeName),
        );
        const pricing = document.createElement('p');
        pricing.className = 'model-prices';
        pricing.textContent = compatiblePrices.length
          ? compatiblePrices
              .map((price) =>
                price.estimate
                  ? [
                      price.nodeTypeName,
                      ':',
                      price.estimate.hourlyEquivalentEUR.replace('.', ','),
                      '€/h HT',
                    ].join(' ')
                  : [price.nodeTypeName, ': tarif horaire non confirmé'].join(
                      ' ',
                    ),
              )
              .join(' · ')
          : 'Tarifs compatibles non chargés : voir les infrastructures ci-dessus ou préparer le déploiement.';
        card.append(pricing);

        if (row.dedicatedInfo?.hasEula === true) {
          const eula = document.createElement('button');
          eula.type = 'button';
          eula.textContent = 'Lire l’EULA';
          eula.setAttribute(
            'aria-label',
            ['Lire l’EULA de', row.label].join(' '),
          );
          eula.addEventListener('click', () =>
            vscode.postMessage({ type: 'eula', id: row.id }),
          );
          card.append(eula);
        }
        const prepare = document.createElement('button');
        prepare.type = 'button';
        prepare.textContent = 'Préparer le déploiement';
        prepare.setAttribute(
          'aria-label',
          `Préparer le déploiement de ${row.label}`,
        );
        prepare.addEventListener('click', () =>
          vscode.postMessage({ type: 'prepare', id: row.id }),
        );
        card.append(prepare);
      }

      root.append(card);
    }
    if (rows.length && !shown.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Aucun résultat pour cette recherche.';
      root.append(empty);
    }
  }
  function renderPrices() {
    const root = document.getElementById('price-list');
    root.replaceChildren();
    document.getElementById('price-status').textContent =
      state.priceStatus || 'Tarifs non chargés';
    for (const row of state.prices || []) {
      const card = document.createElement('article');
      const heading = document.createElement('h3');
      heading.textContent = row.nodeTypeName;
      card.append(heading);
      const amount = document.createElement('p');
      amount.className = 'price-amount';
      amount.textContent = row.estimate
        ? [
            row.estimate.hourlyEquivalentEUR.replace('.', ','),
            '€/heure HT',
          ].join(' ')
        : [
            row.amountEUR.replace('.', ','),
            'EUR / node · période non confirmée',
          ].join(' ');
      card.append(amount);
      const minute = document.createElement('p');
      minute.textContent = row.estimate
        ? [row.estimate.minuteEUR.replace('.', ','), '€/minute · 1 nœud'].join(
            ' ',
          )
        : 'Pas de conversion horaire disponible';
      card.append(minute);
      const source = document.createElement('p');
      source.textContent = [
        'Catalogue public · relevé',
        row.fetchedAt,
        row.estimate ? '· période corroborée au 21/10/2026' : '',
      ].join(' ');
      card.append(source);
      root.append(card);
    }
  }
  function render() {
    renderPrices();
    document.getElementById('public-status').textContent =
      `${state.publicStatus} · ${state.serverless.length} modèle(s)`;
    document.getElementById('dedicated-status').textContent =
      `${state.dedicatedStatus} · ${state.dedicated.length} modèle(s)`;
    document.getElementById('scope').textContent = state.scope;
    renderRows('public-list', state.serverless, 'public');
    renderRows('dedicated-list', state.dedicated, 'dedicated');
    document.getElementById('search-results').textContent =
      document.getElementById('public-list').querySelectorAll('article')
        .length +
      document.getElementById('dedicated-list').querySelectorAll('article')
        .length +
      ' résultat(s) affiché(s)';
  }
  window.addEventListener('message', (event) => {
    if (
      event.data?.type === 'catalog-details' ||
      event.data?.type === 'catalog-detail-unavailable'
    ) {
      const data = event.data;
      document.getElementById('model-details').hidden = false;
      const unavailable = data.type === 'catalog-detail-unavailable';
      document.getElementById('detail-title').textContent = unavailable
        ? 'Modèle indisponible'
        : data.label;
      for (const field of ['status', 'source', 'scope', 'limits'])
        document.getElementById(`detail-${field}`).textContent = unavailable
          ? ''
          : data[field];
      if (unavailable)
        document.getElementById('detail-limits').textContent =
          'Cette offre n’est plus dans le catalogue visible. Actualisez le catalogue.';
      document.getElementById('detail-title').focus();
    }
    if (event.data?.type === 'catalog-state') {
      state = event.data;
      render();
      if (Number.isSafeInteger(state.revision))
        vscode.postMessage({
          type: 'rendered',
          revision: state.revision,
          publicCards: document
            .getElementById('public-list')
            .querySelectorAll('article').length,
          priceCards: document
            .getElementById('price-list')
            .querySelectorAll('article').length,
          dedicatedCards: document
            .getElementById('dedicated-list')
            .querySelectorAll('article').length,
        });
    }
  });
  search.addEventListener('input', render);
  function closeDetails() {
    document.getElementById('model-details').hidden = true;
    if (detailTrigger?.isConnected) detailTrigger.focus();
    else search.focus();
  }
  document
    .getElementById('close-details')
    .addEventListener('click', closeDetails);
  document
    .getElementById('model-details')
    .addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetails();
      }
    });
  document
    .getElementById('refresh')
    .addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document
    .getElementById('project')
    .addEventListener('click', () => vscode.postMessage({ type: 'project' }));
  vscode.postMessage({ type: 'ready' });
})();
