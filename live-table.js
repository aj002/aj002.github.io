(() => {
  'use strict';
  const root = document.getElementById('aj-live-table');
  const q = selector => root.querySelector(selector);
  const all = selector => [...root.querySelectorAll(selector)];
  const apiBase = (document.querySelector('meta[name="poker-api-base"]')?.content || '/api').replace(/\/$/, '');
  const tableOffline = apiBase === 'offline';
  const storageKey = 'aastha-poker-session-v1' + (apiBase === '/api' ? '' : `:${apiBase}`);
  const suit = {s:'♠', h:'♥', d:'♦', c:'♣'};
  const suitName = {s:'spades', h:'hearts', d:'diamonds', c:'clubs'};
  const seatNames = ['You', 'My bot', 'The Rock', 'The Aggressor'];
  const chips = n => Number(n).toLocaleString('en-US');
  let session = null, snapshot = null, busy = false, polling = false;
  let connected = false, arenaOpen = false, decision = null;
  let heldHand = null, lastCompleted = null;

  if (!tableOffline) {
    try { session = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
  }
  if (session?.mode) q('#aj-lineup').value = session.mode;
  q('#aj-offline').hidden = !tableOffline;
  for (const selector of ['.aj-game-grid', '.aj-game-footer', '.aj-mode-label', '.aj-arena-header p']) {
    q(selector).hidden = tableOffline;
  }

  function save() {
    try {
      if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
      else sessionStorage.removeItem(storageKey);
    } catch {
      notice('This browser cannot save the table between reloads. You can still play here.');
    }
  }

  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }
  async function api(path, {body, token, method} = {}) {
    const headers = {Accept:'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${apiBase}${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'), headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000), cache:'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.error?.message || 'The server could not complete that request.', response.status, data.error?.code);
    return data;
  }
  const transient = error => !(error instanceof ApiError) || error.status >= 500 || error.status === 429;

  function connection(message, state='ready') {
    q('#aj-connection').textContent = message;
    q('#aj-connection').dataset.state = state;
  }
  function notice(message='', retry=false) {
    q('#aj-notice').hidden = !message;
    q('#aj-notice-text').textContent = message;
    q('#aj-retry').hidden = !retry;
  }
  function escape(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  }
  function card(value, hidden=false) {
    if (hidden) return '<div class="aj-card back" aria-label="Face-down card">/</div>';
    if (!value) return '<div class="aj-card slot" aria-label="Undealt community card"></div>';
    if (!/^[2-9TJQKA][cdhs]$/.test(value)) return '';
    const rank = value[0] === 'T' ? '10' : value[0], s = value[1];
    return `<div class="aj-card ${'hd'.includes(s) ? 'red' : ''}" aria-label="${rank} of ${suitName[s]}">${rank}<span class="aj-suit">${suit[s]}</span></div>`;
  }
  const cardText = value => `${value[0] === 'T' ? '10' : value[0]}${suit[value[1]]}`;
  const who = seat => seatNames[Number(seat)] || `Seat ${Number(seat) + 1}`;

  function eventText(event, streetOpened=false) {
    const d = event.data;
    const verb = (base, third = `${base}s`) => Number(d.seat) === 0 ? base : third;
    switch (event.type) {
      case 'HandStarted': return `Hand ${d.hand_number} · blinds ${chips(d.small_blind)} / ${chips(d.big_blind)}`;
      case 'BlindPosted': return `${who(d.seat)} ${verb('post')} ${chips(d.amount)}.`;
      case 'BoardDealt': return `${d.street[0].toUpperCase() + d.street.slice(1)}: ${d.cards.map(cardText).join(' ')}.`;
      case 'ActionApplied':
        if (d.auto) return null;
        if (d.action.type === 'raise_to') return `${who(d.seat)} ${d.street === 'preflop' || streetOpened ? verb('raise') + ' to' : verb('bet')} ${chips(d.action.amount)}.`;
        if (d.action.type === 'call') return `${who(d.seat)} ${verb('call')} ${chips(d.added)}.`;
        return `${who(d.seat)} ${d.action.type === 'fold' ? verb('fold') : verb('check')}.`;
      case 'ActionFallback': return `${who(d.seat)}: ${d.reason === 'timeout' ? 'turn timed out' : 'bot error; safe action used'}.`;
      case 'PotAwarded': return Object.entries(d.awards).filter(([,amount]) => amount > 0).map(([seat,amount]) => `${who(seat)} ${Number(seat) === 0 ? 'win' : 'wins'} ${chips(amount)}.`).join(' ');
      case 'ExcessReturned': return `${chips(d.amount)} uncalled chips returned to ${who(d.seat)}.`;
      case 'PlayerEliminated': return `${who(d.seat)} ${Number(d.seat) === 0 ? 'are' : 'is'} out of chips.`;
      default: return null;
    }
  }

  function describeEvents(events) {
    let opened = false;
    return events.map(event => {
      if (event.type === 'BoardDealt') opened = false;
      const text = eventText(event, opened);
      if (event.type === 'ActionApplied' && event.data.action.type === 'raise_to') opened = true;
      return text;
    }).filter(Boolean);
  }

  function renderLastHand(last) {
    q('#aj-last-hand').hidden = !last;
    if (!last) return;
    q('#aj-last-title').textContent = `Hand ${last.hand_number}`;
    const events = last.events;
    const board = events.filter(e => e.type === 'BoardDealt').flatMap(e => e.data.cards);
    q('#aj-last-board').innerHTML = board.map(c => card(c)).join('');
    q('#aj-last-result').textContent = events.filter(e => ['PotAwarded','ExcessReturned'].includes(e.type)).map(eventText).filter(Boolean).join(' ');
    q('#aj-last-cards').textContent = events.filter(e => e.type === 'CardsRevealed').map(e => `${who(e.data.seat)}: ${e.data.cards.map(cardText).join(' ')}`).join(' · ');
  }

  function applySnapshot(next) {
    if (!session || next.table_id !== session.tableId) return;
    if (snapshot && next.version < snapshot.version) return;
    // Keep the completed hand on the felt until the visitor chooses to continue.
    // The server may already be waiting at the next hand's first human decision.
    if (next.last_hand && next.last_hand.hand_id !== lastCompleted && snapshot?.view?.hand_id === next.last_hand.hand_id) {
      heldHand = next.last_hand;
    }
    if (next.last_hand) lastCompleted = next.last_hand.hand_id;
    snapshot = next;
    connected = true;
    connection('Bot connected');
    render();
  }

  function render() {
    const view = snapshot?.view;
    const locked = busy || !connected || Boolean(session?.pending) || Boolean(heldHand);
    q('#aj-lineup').disabled = busy || Boolean(session?.pending);
    q('#aj-new-table').disabled = busy || Boolean(session?.pending);
    q('#aj-next').disabled = busy || Boolean(session?.pending);
    if (!view) {
      all('#aj-actions button').forEach(button => button.disabled = true);
      q('#aj-amount').disabled = true;
      return;
    }
    const mixed = session.mode === 'mixed';
    all('.aj-extra').forEach(el => el.hidden = !mixed);
    q('#aj-lineup-description').hidden = !mixed;
    q('#aj-lineup-description').textContent = mixed ? 'Also here: The Rock and The Aggressor.' : '';

    const events = heldHand?.events || view.action_history;
    const heldBoard = heldHand?.events.filter(e => e.type === 'BoardDealt').flatMap(e => e.data.cards);
    const board = heldBoard || view.board;
    const heldHero = heldHand?.events.filter(e => e.type === 'HoleDealt' && e.data.seat === view.hero_seat).map(e => e.data.card).filter(Boolean);
    const ownCards = heldHero?.length ? heldHero : (view.hole_cards || []);
    q('#aj-hand-number').textContent = `Hand ${heldHand?.hand_number || view.hand_number} / ${view.hand_cap}`;
    q('#aj-pot-value').textContent = chips(heldHand ? heldHand.events.filter(e => e.type === 'PotAwarded').reduce((n,e) => n + e.data.amount, 0) : view.pot_total);
    q('#aj-board').innerHTML = Array.from({length:5}, (_,i) => card(board[i])).join('');
    q('#aj-hero-cards').innerHTML = ownCards.map(c => card(c)).join('');
    q('#aj-street').textContent = heldHand ? 'Hand complete' : snapshot.status === 'complete' ? 'Table complete' : (view.street || 'Dealing');

    const finalStacks = heldHand?.events.find(e => e.type === 'HandCompleted')?.data.final_stacks;
    for (const el of all('[data-seat]')) {
      const seat = Number(el.dataset.seat);
      const player = view.players.find(p => p.seat === seat);
      if (!player) continue;
      const stack = finalStacks?.[String(seat)] ?? player.stack;
      el.querySelector('.aj-seat-panel small').textContent = `${chips(stack)} chips`;
      el.classList.toggle('folded', !heldHand && ['folded','eliminated'].includes(player.status));
      el.classList.toggle('to-act', !heldHand && view.actor_seat === seat);
      let status = '';
      if (heldHand) {
        const awards = heldHand.events.filter(e => e.type === 'PotAwarded').reduce((n,e) => n + (e.data.awards[String(seat)] || 0), 0);
        status = awards ? `WINS ${chips(awards)}` : 'HAND COMPLETE';
      } else if (player.status === 'folded') status = 'FOLDED';
      else if (player.status === 'all_in') status = 'ALL IN';
      else if (player.status === 'eliminated') status = 'OUT';
      else if (view.actor_seat === seat) status = seat === view.hero_seat ? 'YOUR TURN' : 'THINKING…';
      else if (player.street_committed) status = `${chips(player.street_committed)} IN`;
      el.querySelector('.aj-seat-status').textContent = status;
      el.querySelector('.aj-dealer')?.remove();
      if (!heldHand && view.button_seat === seat) el.querySelector('.aj-seat-panel').insertAdjacentHTML('beforeend', '<span class="aj-dealer" aria-label="Dealer">D</span>');
    }
    const bot = view.players.find(p => p.seat === 1);
    const shown = heldHand ? heldHand.events.find(e => e.type === 'CardsRevealed' && e.data.seat === 1)?.data.cards : bot?.shown_cards;
    q('#aj-bot-cards').innerHTML = shown?.length ? shown.map(c => card(c)).join('') : card(null,true) + card(null,true);
    q('#aj-bot-cards').setAttribute('aria-label', shown?.length ? 'Opponent revealed cards' : 'Opponent cards hidden');
    q('#aj-history').innerHTML = describeEvents(events).slice(-5).map(line => `<li>${escape(line)}</li>`).join('');
    renderLastHand(snapshot.last_hand);

    const hero = view.players.find(p => p.seat === view.hero_seat);
    const complete = snapshot.status === 'complete' || hero?.status === 'eliminated';
    const legal = !complete && !heldHand ? view.legal : null;
    const yourTurn = Boolean(legal) && view.actor_seat === view.hero_seat;
    q('#aj-turn-text').textContent = heldHand ? 'Hand complete' : complete ? (hero?.status === 'eliminated' ? 'You’re out of chips.' : 'Table complete.') : busy || session?.pending ? 'Confirming your move…' : !connected ? 'Reconnecting…' : yourTurn ? (legal.check ? `Your move · check or ${view.current_bet_to ? 'raise' : 'bet'}` : `Your move · ${chips(legal.call_amount)} to call`) : `${who(view.actor_seat)} is thinking…`;
    q('#aj-hand-description').textContent = complete || heldHand ? '' : yourTurn && snapshot.turn?.remaining_ms != null ? `${Math.ceil(snapshot.turn.remaining_ms / 1000)}s to act` : '';
    q('#aj-actions').hidden = complete || Boolean(heldHand);
    q('#aj-sizing').hidden = complete || Boolean(heldHand) || !legal?.can_raise;
    q('#aj-fold').disabled = locked || !legal?.fold;
    q('#aj-call').disabled = locked || !(legal?.check || legal?.call_amount != null);
    q('#aj-call').textContent = legal?.check ? 'Check' : legal?.call_amount != null ? `Call ${chips(legal.call_amount)}` : 'Check / call';
    const fullRaise = legal?.can_raise && legal.min_full_raise_to != null && legal.max_raise_to != null && legal.min_full_raise_to <= legal.max_raise_to;
    const input = q('#aj-amount');
    if (decision !== view.decision_id) {
      decision = view.decision_id;
      input.min = String(fullRaise ? legal.min_full_raise_to : legal?.short_all_in_raise_to || 0);
      input.max = String(fullRaise ? legal.max_raise_to : legal?.short_all_in_raise_to || 0);
      input.value = input.min;
    }
    input.disabled = locked || !fullRaise;
    q('#aj-raise').disabled = locked || !legal?.can_raise;
    const allInCall = legal?.call_amount != null && legal.call_amount === hero?.stack;
    q('#aj-all-in').disabled = locked || !(legal?.all_in_raise_to != null || allInCall);
    q('#aj-all-in').textContent = allInCall ? 'Call all in' : 'All in';
    sizing();
    q('#aj-size-help').textContent = heldHand || complete ? '' : legal?.can_raise ? `Adds ${chips(Math.max(0, Number(input.value) - (hero?.street_committed || 0)))} chips from your stack.` : (legal?.raise_blocked_reason || '');
    q('#aj-result').hidden = !heldHand && !complete;
    if (heldHand) q('#aj-result').textContent = heldHand.events.filter(e => e.type === 'PotAwarded').map(eventText).filter(Boolean).join(' ');
    else if (complete) q('#aj-result').textContent = hero?.status === 'eliminated' ? 'Out of chips. There’s always another table.' : `You finished with ${chips(hero?.stack || 0)} chips.`;
    q('#aj-next').hidden = !heldHand && !complete;
    q('#aj-next').textContent = complete ? 'Play again →' : 'Next hand →';
  }

  function sizing() {
    const value = Number(q('#aj-amount').value);
    const verb = snapshot?.view?.current_bet_to === 0 ? 'Bet' : 'Raise to';
    q('#aj-amount-label').textContent = value ? chips(value) : '—';
    q('#aj-raise').textContent = value ? `${verb} ${chips(value)} ↗` : 'Raise ↗';
    const hero = snapshot?.view?.players.find(p => p.seat === snapshot.view.hero_seat);
    if (snapshot?.view?.legal?.can_raise && !heldHand) q('#aj-size-help').textContent = `Adds ${chips(Math.max(0, value - (hero?.street_committed || 0)))} chips from your stack.`;
  }

  async function finishStart(current = session) {
    if (!current.started) {
      try { await api(`/tables/${current.tableId}/start`, {method:'POST', token:current.hostToken}); }
      catch (error) { if (error.code !== 'already_started') throw error; }
      current.started = true;
      delete current.hostToken;
      if (session === current) save();
    }
  }

  async function newTable() {
    if (tableOffline || busy || session?.pending) return;
    const previous = session;
    busy = true; connected = false; snapshot = null; heldHand = null; lastCompleted = null; decision = null;
    session = null; save();
    connection('Taking your seat…', 'loading'); notice(); render();
    try {
      if (previous) {
        try { await api(`/tables/${previous.tableId}`, {method:'DELETE', token:previous.token || previous.hostToken}); }
        catch { /* Idle expiry also releases tables after an interrupted close. */ }
      }
      const mode = q('#aj-lineup').value;
      const catalog = await api('/catalog');
      if (!catalog.policies.some(p => p.id === 'final_bot' && p.source === 'strategy')) throw new Error('Your bot is not available on this server.');
      const seats = [{kind:'human'}, {kind:'bot', policy:'final_bot'}];
      if (mode === 'mixed') seats.push({kind:'bot', policy:'style_rock'}, {kind:'bot', policy:'style_aggressive'});
      const made = await api('/tables', {body:{config:{ruleset_id:'practice_nlhe', starting_stack:1000, hand_cap:20, hands_per_level:20, blind_levels:[[5,10]], human_turn_ms:300000}, seats, styles:{mode:'labelled', learning_aids:false}}});
      const joined = await api(`/tables/${made.table_id}/join`, {body:{seat:0}});
      session = {tableId:made.table_id, token:joined.seat_token, hostToken:made.host_token, mode, started:false, pending:null};
      save();
      await finishStart();
      applySnapshot(await api(`/tables/${session.tableId}`, {token:session.token}));
    } catch (error) {
      connection('Connection unavailable', 'error');
      notice(error.message || 'The table could not be started. Please retry.', true);
    } finally { busy = false; render(); }
  }

  async function resolvePending() {
    if (!session?.pending || busy) return;
    const current = session;
    busy = true; render();
    try {
      const result = await api(`/tables/${current.tableId}/actions`, {body:current.pending, token:current.token});
      current.pending = null; save(); notice(); applySnapshot(result.snapshot);
    } catch (error) {
      if (transient(error)) {
        connected = false; connection('Reconnecting…', 'loading');
        notice('Connection interrupted. Your move is saved; it will be confirmed before another move is allowed.', true);
      } else {
        current.pending = null; save();
        notice(error.code === 'deadline_passed' ? 'That turn timed out. The table has moved on.' : error.message);
      }
    } finally { busy = false; render(); }
  }

  async function send(action) {
    const view = snapshot?.view;
    if (!view?.legal || busy || !connected || session?.pending || heldHand || view.actor_seat !== view.hero_seat) return;
    session.pending = {action_id:crypto.randomUUID(), table_id:session.tableId, hand_id:view.hand_id, decision_id:view.decision_id, expected_state_version:view.state_version, action};
    save();
    await resolvePending();
  }

  async function poll() {
    if (tableOffline || !arenaOpen || !session || polling || busy) return;
    const current = session;
    polling = true;
    try {
      await finishStart(current);
      if (session !== current) return;
      if (session.pending) await resolvePending();
      const next = await api(`/tables/${current.tableId}`, {token:current.token});
      if (session !== current) return;
      const wasDisconnected = !connected;
      applySnapshot(next);
      if (wasDisconnected && !session.pending) notice();
    } catch (error) {
      if (session !== current) return;
      connected = false;
      connection('Connection unavailable', 'error');
      if ([401,403,404].includes(error.status)) {
        notice('This table is no longer available. Choose New table to take another seat.');
        session = null; save();
      } else notice('The connection dropped. Reconnecting to your table…', true);
      render();
    } finally { polling = false; }
  }

  function show(view, jump) {
    all('[data-screen]').forEach(el => el.hidden = el.dataset.screen !== view);
    all('.aj-links [data-view]').forEach(el => el.dataset.view === view ? el.setAttribute('aria-current','page') : el.removeAttribute('aria-current'));
    arenaOpen = view === 'arena';
    const destination = jump ? q(`[data-area="${jump}"]`) : root;
    destination?.scrollIntoView({block:'start', behavior:'auto'});
    if (arenaOpen) {
      if (session) poll();
      else newTable();
    }
  }
  all('[data-view]').forEach(el => el.addEventListener('click', () => show(el.dataset.view, el.dataset.jump)));
  q('#aj-lineup').addEventListener('change', newTable);
  q('#aj-new-table').addEventListener('click', newTable);
  q('#aj-next').addEventListener('click', () => {
    if (snapshot?.status === 'complete' || snapshot?.view?.players.find(p => p.seat === snapshot.view.hero_seat)?.status === 'eliminated') newTable();
    else { heldHand = null; render(); poll(); }
  });
  q('#aj-retry').addEventListener('click', () => session ? poll() : newTable());
  q('#aj-fold').addEventListener('click', () => send({type:'fold'}));
  q('#aj-call').addEventListener('click', () => send({type:snapshot?.view?.legal?.check ? 'check' : 'call'}));
  q('#aj-raise').addEventListener('click', () => send({type:'raise_to', amount:Number(q('#aj-amount').value)}));
  q('#aj-all-in').addEventListener('click', () => {
    const amount = snapshot?.view?.legal?.all_in_raise_to;
    if (amount != null) send({type:'raise_to', amount});
    else send({type:'call'});
  });
  q('#aj-amount').addEventListener('input', sizing);
  window.addEventListener('online', poll);
  window.setInterval(poll, 650);
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('am-visible'); reveal.unobserve(entry.target); }
    }), {threshold:.08});
    root.classList.add('motion-ready');
    all('.am-reveal').forEach(el => reveal.observe(el));
  }
  if (location.hash === '#play') show('arena');
})();
