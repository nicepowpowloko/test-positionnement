/* Moteur des tests de positionnement AEFTI
   - Lit window.TEST (défini dans chaque page) et window.AEFTI_CONFIG (config.js)
   - Une question par écran, « Je ne sais pas » ajouté automatiquement
   - Calcule : questions effectuées, bonnes réponses, taux de réussite, détail par domaine
   - Génère un PDF de synthèse (jsPDF) et l'envoie au script Google (email + Google Sheet)
   - Le candidat ne voit pas son score (test de positionnement)
   - ?reset=1 dans l'URL débloque un appareil où le test a déjà été envoyé */
(function () {
  'use strict';
  const T = window.TEST;
  const C = window.AEFTI_CONFIG || {};
  const NSP = 'Je ne sais pas';
  const LOCK_KEY = 'aefti_positionnement_' + T.code + '_envoye';
  const app = document.getElementById('app');

  const params = new URLSearchParams(location.search);
  if (params.get('reset') === '1') {
    localStorage.removeItem(LOCK_KEY);
    history.replaceState(null, '', location.pathname);
  }

  // ── Préparation des questions ──
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const domainName = id => (T.domaines.find(d => d.id === id) || { nom: id }).nom;
  // Dans les données, la bonne réponse est toujours écrite en premier : on mélange à l'affichage.
  const items = T.questions.map((q, i) => ({
    kind: 'q', n: i + 1, domaine: q.d, text: q.q, hint: q.hint || '',
    correct: q.o[0], options: shuffle(q.o.slice()).concat([NSP]), multi: false
  })).concat((T.profil || []).map(p => ({
    kind: 'p', text: p.q, options: p.o, multi: !!p.multi,
    hint: p.multi ? 'Plusieurs réponses possibles.' : ''
  })));
  const nbScored = T.questions.length;

  const state = { i: 0, answers: items.map(it => (it.multi ? [] : '')), candidat: {}, start: null };
  let lastPdf = null;

  // ── Logo (pour le PDF) ──
  let logoData = null;
  fetch('assets/aefti-logo.png').then(r => r.blob()).then(b => {
    const fr = new FileReader();
    fr.onload = () => { logoData = fr.result; };
    fr.readAsDataURL(b);
  }).catch(() => {});

  // ── Utilitaires ──
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3000);
  }
  const isAnswered = a => (Array.isArray(a) ? a.length > 0 : !!a);

  function topbar(stepText, pct) {
    return `<div class="topbar"><div class="topbar-inner">
        <img src="assets/aefti-logo.png" alt="AEFTI">
        <div class="brand">AEFTI<small>Savoirs et Compétences</small></div>
        ${stepText ? `<div class="step">${stepText}</div>` : ''}
      </div>${pct != null ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}</div>`;
  }

  // ── Écran d'accueil ──
  function renderIntro() {
    if (localStorage.getItem(LOCK_KEY) === '1') return renderLocked();
    const c = state.candidat;
    app.innerHTML = topbar('', null) + `<main class="wrap">
      <span class="tag">Test de positionnement</span>
      <h1>${esc(T.titre)}</h1>
      <p class="subtitle">${esc(T.sousTitre)}</p>
      <div class="card"><h2>Comment ça se passe ?</h2><ul class="info-list">
        <li><span class="ico">📝</span><span><b>${nbScored} questions</b> à choix, une par écran.</span></li>
        <li><span class="ico">⏱️</span><span>Environ <b>${T.duree || 20} minutes</b>. Prenez votre temps.</span></li>
        <li><span class="ico">🤔</span><span>Vous ne savez pas ? Choisissez <b>« Je ne sais pas »</b>. Ce n'est pas un examen : ce test sert à connaître votre niveau.</span></li>
        <li><span class="ico">📨</span><span>À la fin, vos réponses sont envoyées à votre formateur.</span></li>
      </ul></div>
      <div class="card"><h2>Vos informations</h2><div class="fields">
        <div class="field" id="fw-nom"><label for="f-nom">Nom *</label><input id="f-nom" autocomplete="family-name" value="${esc(c.nom)}"></div>
        <div class="field" id="fw-prenom"><label for="f-prenom">Prénom *</label><input id="f-prenom" autocomplete="given-name" value="${esc(c.prenom)}"></div>
        <div class="field"><label for="f-tel">Téléphone <span class="opt">(facultatif)</span></label><input id="f-tel" type="tel" autocomplete="tel" value="${esc(c.tel)}"></div>
        <div class="field"><label for="f-email">Email <span class="opt">(facultatif)</span></label><input id="f-email" type="email" autocomplete="email" value="${esc(c.email)}"></div>
      </div></div>
      <button class="btn yellow block" id="go">Commencer le test →</button>
      <p class="foot">AEFTI Savoirs et Compétences · Organisme certifié Qualiopi · Amiens</p>
    </main>`;
    document.getElementById('go').onclick = () => {
      const v = id => document.getElementById(id).value.trim();
      state.candidat = { nom: v('f-nom'), prenom: v('f-prenom'), tel: v('f-tel'), email: v('f-email') };
      let ok = true;
      ['nom', 'prenom'].forEach(k => {
        const w = document.getElementById('fw-' + k);
        w.classList.toggle('error', !state.candidat[k]);
        if (!state.candidat[k]) ok = false;
      });
      if (!ok) return toast('Merci d\'indiquer votre nom et votre prénom.');
      if (!state.start) state.start = new Date();
      state.i = 0; renderQuestion();
    };
  }

  function renderLocked() {
    app.innerHTML = topbar('', null) + `<main class="wrap center">
      <div class="done-ico">✓</div>
      <h1 style="font-size:30px">Test déjà envoyé</h1>
      <p class="subtitle">Ce test a déjà été complété sur cet appareil.</p>
      <p>Si vous pensez qu'il s'agit d'une erreur, prévenez votre formateur.</p>
    </main>`;
  }

  // ── Écran question ──
  function renderQuestion() {
    const it = items[state.i];
    const total = items.length;
    const pct = Math.round((state.i / total) * 100);
    const ans = state.answers[state.i];
    const isProfil = it.kind === 'p';
    const step = isProfil ? 'Pour mieux vous connaître' : `Question ${it.n} / ${nbScored}`;
    const meta = isProfil
      ? '<span class="chip lav">Non noté · pour mieux vous connaître</span>'
      : `<span class="chip">${esc(domainName(it.domaine))}</span>`;
    const opts = it.options.map((o, k) => {
      const sel = it.multi ? ans.includes(o) : ans === o;
      return `<button class="option ${it.multi ? 'multi' : ''} ${o === NSP ? 'nsp' : ''} ${sel ? 'selected' : ''}" data-k="${k}">
        <span class="mark">${sel ? '✓' : ''}</span><span>${esc(o)}</span></button>`;
    }).join('');
    const last = state.i === total - 1;
    app.innerHTML = topbar(step, pct) + `<main class="wrap">
      <div class="q-meta">${meta}</div>
      <div class="q-text">${esc(it.text)}</div>
      <div class="q-hint">${esc(it.hint)}</div>
      <div class="options">${opts}</div>
    </main>
    <div class="navbar"><div class="navbar-inner">
      <button class="btn ghost" id="prev">← Retour</button>
      <button class="btn" id="next">${isAnswered(ans) ? (last ? 'Terminer' : 'Suivant →') : 'Passer'}</button>
    </div></div>`;
    window.scrollTo(0, 0);

    app.querySelectorAll('.option').forEach(btn => btn.onclick = () => {
      const o = it.options[+btn.dataset.k];
      if (it.multi) {
        const arr = state.answers[state.i];
        const p = arr.indexOf(o);
        if (p >= 0) arr.splice(p, 1); else arr.push(o);
        renderQuestion();
      } else {
        state.answers[state.i] = o;
        renderQuestion();
        // Passage automatique à la question suivante pour les QCM simples
        clearTimeout(renderQuestion._auto);
        renderQuestion._auto = setTimeout(goNext, 350);
      }
    });
    document.getElementById('prev').onclick = () => {
      clearTimeout(renderQuestion._auto);
      if (state.i === 0) renderIntro(); else { state.i--; renderQuestion(); }
    };
    document.getElementById('next').onclick = () => { clearTimeout(renderQuestion._auto); goNext(); };
  }
  function goNext() {
    // Si le candidat revient depuis le récapitulatif, on l'y ramène après sa réponse
    if (state.fromRecap) return renderRecap();
    if (state.i < items.length - 1) { state.i++; renderQuestion(); } else renderRecap();
  }

  // ── Récapitulatif avant envoi ──
  function renderRecap() {
    state.fromRecap = false;
    const missing = items.map((it, i) => ({ it, i })).filter(x => x.it.kind === 'q' && !isAnswered(state.answers[x.i]));
    const done = nbScored - missing.length;
    app.innerHTML = topbar('Dernière étape', 100) + `<main class="wrap">
      <span class="tag">Avant d'envoyer</span>
      <div class="card center">
        <div class="big-num">${done} / ${nbScored}</div>
        <p style="margin-top:8px">questions effectuées</p>
      </div>
      ${missing.length ? `<div class="card"><h2>Questions passées</h2>
        <p>Vous pouvez encore y répondre (ou choisir « Je ne sais pas ») :</p>
        <div class="chips-list">${missing.map(x => `<button data-i="${x.i}">${x.it.n}</button>`).join('')}</div></div>` : ''}
      <p class="notice">Une fois envoyées, vos réponses ne pourront plus être modifiées.</p>
    </main>
    <div class="navbar"><div class="navbar-inner">
      <button class="btn ghost" id="prev">← Retour</button>
      <button class="btn yellow" id="send">Envoyer mes réponses</button>
    </div></div>`;
    window.scrollTo(0, 0);
    app.querySelectorAll('.chips-list button').forEach(b => b.onclick = () => { state.i = +b.dataset.i; state.fromRecap = true; renderQuestion(); });
    document.getElementById('prev').onclick = () => { state.i = items.length - 1; renderQuestion(); };
    document.getElementById('send').onclick = send;
  }

  // ── Calcul des résultats ──
  function compute() {
    const details = [];
    items.forEach((it, i) => {
      if (it.kind !== 'q') return;
      const a = state.answers[i];
      let statut;
      if (!a) statut = 'vide';
      else if (a === NSP) statut = 'nsp';
      else statut = a === it.correct ? 'juste' : 'faux';
      details.push({ n: it.n, domaine: domainName(it.domaine), domaineId: it.domaine, question: it.text, reponse: a, bonne: it.correct, statut });
    });
    const count = (arr, s) => arr.filter(d => d.statut === s).length;
    const effectuees = details.filter(d => d.statut !== 'vide').length;
    const bonnes = count(details, 'juste');
    const stats = {
      total: nbScored, effectuees, bonnes,
      fausses: count(details, 'faux'), nsp: count(details, 'nsp'), vides: count(details, 'vide'),
      reussite: Math.round((bonnes / nbScored) * 100)
    };
    stats.niveau = niveau(stats.reussite);
    const domaines = T.domaines.map(d => {
      const ds = details.filter(x => x.domaineId === d.id);
      const b = count(ds, 'juste');
      const pct = ds.length ? Math.round((b / ds.length) * 100) : 0;
      return { nom: d.nom, total: ds.length, effectuees: ds.filter(x => x.statut !== 'vide').length, bonnes: b, pct, appreciation: appreciation(pct) };
    });
    const profil = items.map((it, i) => ({ it, a: state.answers[i] })).filter(x => x.it.kind === 'p')
      .map(x => ({ question: x.it.text, reponse: Array.isArray(x.a) ? x.a.join(', ') : x.a }));
    const fin = new Date();
    const dureeMin = Math.max(1, Math.round((fin - state.start) / 60000));
    return { details, stats, domaines, profil, fin, dureeMin };
  }
  function niveau(p) {
    if (p >= 75) return 'Confirmé';
    if (p >= 50) return 'Intermédiaire';
    if (p >= 25) return 'Débutant';
    return 'Grand débutant';
  }
  function appreciation(p) {
    if (p >= 70) return 'Acquis';
    if (p >= 40) return 'En cours d\'acquisition';
    return 'À renforcer';
  }

  // ── PDF de synthèse ──
  // Les polices standard de jsPDF ne gèrent pas certains caractères : on les remplace.
  const P = s => String(s == null ? '' : s)
    .replace(/[  ]/g, ' ').replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/[→]/g, '->').replace(/[✓✔]/g, '').replace(/≈/g, '~');
  const NAVY = [9, 18, 100], YEL = [254, 216, 29], CREAM = [255, 247, 205], LAV = [107, 111, 156], INK = [8, 0, 28];
  const OK = [29, 122, 61], KO = [179, 38, 30], ORANGE = [176, 112, 0];

  function buildPdf(R) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 12;
    const c = state.candidat;
    const dateTxt = R.fin.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const heureTxt = R.fin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    // En-tête
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 32, 'F');
    doc.setFillColor(...YEL); doc.rect(0, 32, W, 1.6, 'F');
    if (logoData) { try { doc.addImage(logoData, 'PNG', M, 4, 24, 24); } catch (e) { /* logo facultatif */ } }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
    doc.text('Test de positionnement', 41, 13);
    doc.setFontSize(12); doc.setTextColor(...YEL);
    doc.text(P(T.titre), 41, 20.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(220, 222, 240);
    doc.text('AEFTI Savoirs et Compétences · Organisme de formation certifié Qualiopi · Amiens', 41, 27);
    doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
    doc.text(P(dateTxt + ' à ' + heureTxt), W - M, 13, { align: 'right' });

    // Candidat
    let y = 42;
    doc.setTextColor(...INK);
    const label = (txt, x, yy) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...LAV); doc.text(txt.toUpperCase(), x, yy); };
    // Réduit la taille du texte si la valeur est trop longue pour sa colonne
    const value = (txt, x, yy, maxW = 62) => {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK);
      let fs = 11; doc.setFontSize(fs);
      const t = P(txt || '—');
      while (fs > 7 && doc.getTextWidth(t) > maxW) { fs -= 0.5; doc.setFontSize(fs); }
      doc.text(t, x, yy);
    };
    label('Candidat', M, y); value(`${c.prenom} ${c.nom.toUpperCase()}`, M, y + 5.5, 70);
    label('Téléphone', 85, y); value(c.tel, 85, y + 5.5, 46);
    label('Email', 135, y); value(c.email, 135, y + 5.5, W - M - 135);
    y += 13;
    label('Date du test', M, y); value(dateTxt, M, y + 5.5);
    label('Durée', 85, y); value(R.dureeMin + ' min', 85, y + 5.5);
    label('Formation visée', 135, y); value(T.titre, 135, y + 5.5, W - M - 135);

    // Indicateurs
    y += 13;
    const s = R.stats;
    const tw = (W - 2 * M - 2 * 5) / 3;
    const tiles = [
      { big: `${s.effectuees} / ${s.total}`, lab: 'Questions effectuées', sub: `dont ${s.nsp} « je ne sais pas » · ${s.vides} sans réponse` },
      { big: `${s.bonnes} / ${s.total}`, lab: 'Bonnes réponses', sub: `${s.fausses} réponse(s) fausse(s)` },
      { big: `${s.reussite} %`, lab: 'Taux de réussite', sub: `Niveau estimé : ${s.niveau}`, dark: true }
    ];
    tiles.forEach((t, k) => {
      const x = M + k * (tw + 5);
      doc.setFillColor(...(t.dark ? NAVY : CREAM)); doc.roundedRect(x, y, tw, 27, 3, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(21); doc.setTextColor(...(t.dark ? YEL : NAVY));
      doc.text(P(t.big), x + tw / 2, y + 11, { align: 'center' });
      doc.setFontSize(9.5); doc.setTextColor(...(t.dark ? [255, 255, 255] : NAVY));
      doc.text(P(t.lab), x + tw / 2, y + 17.5, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(t.dark ? [220, 222, 240] : LAV));
      doc.text(P(t.sub), x + tw / 2, y + 23, { align: 'center' });
    });
    y += 33;

    // Résultats par domaine
    const apprColor = a => (a === 'Acquis' ? OK : a === 'À renforcer' ? KO : ORANGE);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY);
    doc.text('Résultats par domaine', M, y);
    doc.autoTable({
      startY: y + 2.5, margin: { left: M, right: M },
      head: [['Domaine', 'Questions', 'Effectuées', 'Bonnes réponses', 'Réussite', 'Appréciation']],
      body: R.domaines.map(d => [P(d.nom), d.total, d.effectuees, d.bonnes, d.pct + ' %', P(d.appreciation)]),
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: [225, 225, 235], lineWidth: 0.2 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 58 }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center', fontStyle: 'bold' }, 5: { cellWidth: 42 } },
      alternateRowStyles: { fillColor: [255, 251, 240] },
      didParseCell: h => { if (h.section === 'body' && h.column.index === 5) { h.cell.styles.textColor = apprColor(h.cell.raw); h.cell.styles.fontStyle = 'bold'; } }
    });
    y = doc.lastAutoTable.finalY + 8;

    // Profil (non noté)
    if (R.profil.length) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY);
      doc.text('Profil du candidat (non noté)', M, y);
      doc.autoTable({
        startY: y + 2.5, margin: { left: M, right: M },
        body: R.profil.map(p => [P(p.question), P(p.reponse || 'Sans réponse')]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: [225, 225, 235], lineWidth: 0.2 },
        columnStyles: { 0: { cellWidth: 95, textColor: LAV }, 1: { fontStyle: 'bold' } },
        alternateRowStyles: { fillColor: [255, 251, 240] }
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // Détail des réponses
    const statutTxt = { juste: 'Juste', faux: 'Faux', nsp: 'Ne sait pas', vide: 'Sans réponse' };
    const statutCol = { juste: OK, faux: KO, nsp: ORANGE, vide: LAV };
    if (y > 250) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY);
    doc.text('Détail des réponses', M, y);
    doc.autoTable({
      startY: y + 2.5, margin: { left: M, right: M, top: 14 },
      head: [['N°', 'Question', 'Réponse du candidat', 'Bonne réponse', 'Résultat']],
      body: R.details.map(d => [d.n, P(d.question), P(d.reponse || '—'), P(d.bonne), statutTxt[d.statut]]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, textColor: INK, lineColor: [225, 225, 235], lineWidth: 0.2, valign: 'middle' },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 1: { cellWidth: 72 }, 2: { cellWidth: 42 }, 3: { cellWidth: 42 }, 4: { halign: 'center', fontStyle: 'bold' } },
      alternateRowStyles: { fillColor: [255, 251, 240] },
      didParseCell: h => {
        if (h.section !== 'body') return;
        const d = R.details[h.row.index];
        if (h.column.index === 4) h.cell.styles.textColor = statutCol[d.statut];
        if (h.column.index === 2 && d.statut === 'faux') h.cell.styles.textColor = KO;
      }
    });

    // Pied de page
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...LAV);
      doc.text(P(`AEFTI Savoirs et Compétences · Test de positionnement ${T.titre} · Document confidentiel`), M, 290);
      doc.text(`Page ${p} / ${n}`, W - M, 290, { align: 'right' });
    }
    return doc;
  }

  const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // ── Envoi ──
  async function send() {
    app.innerHTML = topbar('Envoi', 100) + `<main class="wrap center">
      <div class="spinner"></div><h1 style="font-size:28px">Envoi en cours…</h1>
      <p class="subtitle">Merci de ne pas fermer la page.</p></main>`;
    const R = compute();
    let doc;
    try { doc = buildPdf(R); } catch (e) { console.error(e); }
    const c = state.candidat;
    const pdfName = `Positionnement_${T.code}_${slug(c.nom)}_${slug(c.prenom)}_${R.fin.toISOString().slice(0, 10)}.pdf`;
    lastPdf = doc ? { doc, name: pdfName } : null;

    if (!C.ENDPOINT) return renderDone(R, 'demo');

    const payload = {
      formation: T.titre, code: T.code, candidat: c,
      date: R.fin.toISOString(), dureeMin: R.dureeMin,
      stats: R.stats, domaines: R.domaines, profil: R.profil,
      details: R.details.map(d => ({ n: d.n, domaine: d.domaine, question: d.question, reponse: d.reponse, bonne: d.bonne, statut: d.statut })),
      pdfName, pdfBase64: doc ? doc.output('datauristring').split(',')[1] : ''
    };
    try {
      const res = await fetch(C.ENDPOINT, { method: 'POST', body: JSON.stringify(payload) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Erreur serveur');
      localStorage.setItem(LOCK_KEY, '1');
      renderDone(R, 'ok');
    } catch (e) {
      console.error(e);
      renderDone(R, 'error');
    }
  }

  function renderDone(R, mode) {
    const c = state.candidat;
    let body;
    if (mode === 'ok') {
      body = `<div class="done-ico">✓</div><h1 style="font-size:32px">Merci ${esc(c.prenom)} !</h1>
        <p class="subtitle">Vos réponses ont bien été envoyées à votre formateur.</p>
        <p>Vous pouvez fermer cette page. Les résultats seront vus ensemble lors de votre entretien.</p>`;
    } else if (mode === 'demo') {
      body = `<div class="done-ico">✓</div><h1 style="font-size:32px">Test terminé</h1>
        <p class="notice"><b>Mode démonstration :</b> l'envoi par email n'est pas encore configuré
        (adresse du script Google à renseigner dans <code>assets/config.js</code>). Vous pouvez télécharger le PDF ci-dessous.</p>
        <button class="btn block" id="dl">Télécharger le PDF de synthèse</button>`;
    } else {
      body = `<div class="done-ico" style="background:#fdecea">!</div><h1 style="font-size:30px">L'envoi n'a pas fonctionné</h1>
        <p class="notice err">Vérifiez la connexion Internet puis réessayez. Si le problème continue, appelez votre formateur.</p>
        <button class="btn yellow block" id="retry">Réessayer l'envoi</button>
        <p style="margin:14px 0 6px">Ou téléchargez vos résultats pour les remettre au formateur :</p>
        <button class="btn ghost block" id="dl">Télécharger le PDF</button>`;
    }
    app.innerHTML = topbar('Terminé', 100) + `<main class="wrap center">${body}
      <p class="foot">AEFTI Savoirs et Compétences · Organisme certifié Qualiopi</p></main>`;
    const dl = document.getElementById('dl');
    if (dl) dl.onclick = () => lastPdf && lastPdf.doc.save(lastPdf.name);
    const retry = document.getElementById('retry');
    if (retry) retry.onclick = send;
  }

  // Avertit si le candidat quitte la page en cours de test
  window.addEventListener('beforeunload', e => {
    if (state.start && !localStorage.getItem(LOCK_KEY) && document.querySelector('.option')) { e.preventDefault(); e.returnValue = ''; }
  });

  renderIntro();
})();
