(() => {
  const vscode = acquireVsCodeApi();
  const search = document.getElementById('search');
  let state = {
    serverless: [],
    dedicated: [],
    deployments: [],
    selectedServerless: [],
    publicStatus: 'Chargement…',
    dedicatedStatus: 'Sélectionnez un projet',
    scope: 'Catalogue public',
  };
  let detailTrigger;
  let serviceKind = 'serverless';
  function selectService(kind) {
    serviceKind = kind;
    document
      .getElementById('service-serverless')
      .setAttribute('aria-pressed', String(kind === 'serverless'));
    document
      .getElementById('service-dedicated')
      .setAttribute('aria-pressed', String(kind === 'dedicated'));
    document.getElementById('serverless-section').hidden =
      kind !== 'serverless';
    document.getElementById('dedicated-section').hidden = kind !== 'dedicated';
    document.getElementById('model-details').hidden = true;
    render();
  }
  document
    .getElementById('service-serverless')
    .addEventListener('click', () => selectService('serverless'));
  document
    .getElementById('service-dedicated')
    .addEventListener('click', () => selectService('dedicated'));
  function formatPrice(price) {
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
  }
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

      if (kind === 'public') {
        const prices = (row.serverlessPrices || []).filter(
          (price) => price.consumptionMode === 'realtime',
        );
        const pricing = document.createElement('p');
        pricing.className = 'model-prices';
        pricing.textContent = prices.length
          ? prices.map(formatPrice).join(' · ')
          : 'Tarif temps réel non disponible';
        card.append(pricing);
      }
      const deployment =
        kind === 'dedicated'
          ? (state.deployments || []).find(
              (item) => item.deploymentInfo?.modelId === row.id,
            )
          : undefined;
      const ready = row.dedicatedInfo?.status === 'ready';
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'primary-action';
      action.textContent =
        kind === 'public'
          ? (state.selectedServerless || []).includes(row.id)
            ? 'Choisir une clé API'
            : 'Utiliser'
          : deployment
            ? 'Ouvrir le déploiement'
            : 'Déployer';
      action.disabled = kind === 'public' ? false : !deployment && !ready;
      action.setAttribute(
        'aria-label',
        [action.textContent, row.label].join(' · '),
      );
      action.addEventListener('click', () => {
        if (action.disabled) return;
        vscode.postMessage({
          type:
            kind === 'public'
              ? 'use'
              : deployment
                ? 'open-deployment'
                : 'deploy',
          id: deployment ? deployment.id : row.id,
        });
      });
      card.append(action);
      const details = document.createElement('button');
      details.type = 'button';
      details.textContent =
        kind === 'dedicated' && !deployment && !ready
          ? 'Voir pourquoi'
          : 'Voir les détails';
      details.className = 'secondary-action';
      details.setAttribute(
        'aria-label',
        [details.textContent, 'de', row.label].join(' '),
      );
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
      }

      root.append(card);
    }
    if (rows.length && !shown.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Aucun résultat pour cette recherche.';
      root.append(empty);
    }
  }
  function render() {
    document.getElementById('public-status').textContent =
      `${state.publicStatus} · ${state.serverless.length} modèle(s)`;
    document.getElementById('dedicated-status').textContent =
      `${state.dedicatedStatus} · ${state.dedicated.length} modèle(s)`;
    document.getElementById('scope').textContent = state.scope;
    renderRows('public-list', state.serverless, 'public');
    renderRows('dedicated-list', state.dedicated, 'dedicated');
    document.getElementById('search-results').textContent =
      document
        .getElementById(
          serviceKind === 'serverless' ? 'public-list' : 'dedicated-list',
        )
        .querySelectorAll('article').length + ' résultat(s) affiché(s)';
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
      const pricing = document.getElementById('detail-prices');
      pricing.replaceChildren();
      if (!unavailable) {
        for (const price of data.prices || []) {
          const line = document.createElement('p');
          line.textContent = formatPrice(price);
          pricing.append(line);
        }
        if (
          !data.prices?.length &&
          data.pricingNote === 'Tarifs publics · temps réel'
        ) {
          const missing = document.createElement('p');
          missing.textContent = 'Tarif temps réel non disponible';
          pricing.append(missing);
        }
      }
      document.getElementById('detail-pricing-note').textContent = unavailable
        ? ''
        : data.pricingNote || '';
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
