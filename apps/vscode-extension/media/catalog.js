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
  function render() {
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
