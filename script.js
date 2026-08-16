(function () {
  const $ = (id) => document.getElementById(id);

  // 数字入力欄をタップ/クリックしたら中身を全選択する
  // (スマホで手動で数字を消さなくても、そのまま打てば上書きできるようにするため)
  function selectAllOnFocus(el) {
    el.addEventListener('focus', () => el.select());
    el.addEventListener('click', () => el.select());
  }

  const inputs = {
    age: $('age'),
    assets: $('assets'),
    rate: $('rate'),
    endAge: $('endAge'),
  };
  const bulkYearly = $('bulkYearly');
  const applyBulk = $('applyBulk');
  const withdrawInputs = {
    withdrawRate: $('withdrawRate'),
    withdrawEndAge: $('withdrawEndAge'),
  };

  const STORAGE_KEY = 'nisa-sim-inputs-v3';

  // NISA制度の投資枠(2024年〜の新NISA)
  const NISA_ANNUAL_LIMIT = 3600000; // 年間投資枠 360万円(つみたて120万+成長240万)
  const NISA_LIFETIME_LIMIT = 18000000; // 生涯非課税保有限度額 1800万円

  // contributions: { [age]: amount }  年齢(投資が発生する年の年齢)をキーに投資額を保持
  let contributions = {};

  function defaultLoad() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) { /* ignore */ }

    if (saved) {
      Object.keys(inputs).forEach((key) => {
        if (saved[key] !== undefined && saved[key] !== '') inputs[key].value = saved[key];
      });
      if (saved.bulkYearly !== undefined) bulkYearly.value = saved.bulkYearly;
      if (saved.contributions) contributions = saved.contributions;
      Object.keys(withdrawInputs).forEach((key) => {
        if (saved[key] !== undefined && saved[key] !== '') withdrawInputs[key].value = saved[key];
      });
    }
  }

  function save() {
    const data = {};
    Object.keys(inputs).forEach((key) => { data[key] = inputs[key].value; });
    data.bulkYearly = bulkYearly.value;
    data.contributions = contributions;
    Object.keys(withdrawInputs).forEach((key) => { data[key] = withdrawInputs[key].value; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function manYen(n) {
    return (n / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + '万円';
  }

  function getAgeRange() {
    const age = Math.max(0, Math.floor(Number(inputs.age.value) || 0));
    let endAge = Math.floor(Number(inputs.endAge.value) || age);
    if (endAge < age) endAge = age;
    return { age, endAge };
  }

  // 表の対象年齢(投資が発生する年)は age+1 〜 endAge。まだ値が無い年齢には
  // bulkYearly の値をデフォルトとして補完する。
  function ensureContributions() {
    const { age, endAge } = getAgeRange();
    const fallback = Math.max(0, Number(bulkYearly.value) || 0) * 10000;
    for (let a = age + 1; a <= endAge; a++) {
      if (contributions[a] === undefined) contributions[a] = fallback;
    }
    // 範囲外に残ったキーは掃除
    Object.keys(contributions).forEach((k) => {
      const a = Number(k);
      if (a <= age || a > endAge) delete contributions[k];
    });
  }

  function simulate() {
    const { age, endAge } = getAgeRange();
    const startAssets = Math.max(0, Number(inputs.assets.value) || 0) * 10000;
    const rate = (Number(inputs.rate.value) || 0) / 100;

    ensureContributions();

    const rows = [];
    let balance = startAssets;
    let principal = startAssets;
    let nisaCumulative = startAssets; // NISA枠の消化額(生涯1800万円の判定に使う)

    rows.push({
      age, contribution: 0, balance, gain: balance - principal,
      overAnnual: false, overLifetime: nisaCumulative > NISA_LIFETIME_LIMIT,
    });

    for (let a = age + 1; a <= endAge; a++) {
      const contribution = Math.max(0, Number(contributions[a]) || 0);
      const overAnnual = contribution > NISA_ANNUAL_LIMIT;
      const beforeLifetimeOver = nisaCumulative >= NISA_LIFETIME_LIMIT;
      nisaCumulative += contribution;

      balance = balance * (1 + rate) + contribution;
      principal += contribution;
      rows.push({
        age: a, contribution, balance, gain: balance - principal,
        overAnnual, overLifetime: beforeLifetimeOver,
      });
    }

    return { rows, principal, finalBalance: balance, endAge, startAge: age, nisaCumulative };
  }

  // リタイア後、取り崩し率(例:4%)で毎年使っていくシミュレーション。
  // その年の年始残高に対して毎年◯%を計算し直すので、残高が増えれば取り崩し額も増え、
  // 減れば取り崩し額も減る(定率取り崩し方式)。
  function simulateWithdrawal(accResult) {
    const rate = (Number(inputs.rate.value) || 0) / 100;
    const withdrawRate = Math.max(0, Number(withdrawInputs.withdrawRate.value) || 0) / 100;
    let withdrawEndAge = Math.floor(Number(withdrawInputs.withdrawEndAge.value) || accResult.endAge);
    if (withdrawEndAge < accResult.endAge) withdrawEndAge = accResult.endAge;

    const base = accResult.finalBalance;

    const rows = [];
    let balance = base;
    let depletedAge = null;
    let firstAnnualWithdrawal = null;

    for (let a = accResult.endAge + 1; a <= withdrawEndAge; a++) {
      const startBalance = balance;
      const annualWithdrawal = startBalance * withdrawRate;
      if (firstAnnualWithdrawal === null) firstAnnualWithdrawal = annualWithdrawal;
      let endBalance = startBalance * (1 + rate) - annualWithdrawal;
      if (endBalance < 0) endBalance = 0;
      rows.push({ age: a, startBalance, annualWithdrawal, monthlyWithdrawal: annualWithdrawal / 12, endBalance });
      balance = endBalance;
      if (balance <= 0 && depletedAge === null) depletedAge = a;
    }

    return {
      rows, base, annualWithdrawal: firstAnnualWithdrawal || 0,
      withdrawEndAge, startAge: accResult.endAge, depletedAge,
    };
  }

  function renderSummary(result) {
    $('summaryLabel').textContent = `${result.endAge}歳時点の資産額`;
    $('summaryValue').textContent = manYen(result.finalBalance);
    const gain = result.finalBalance - result.principal;
    $('summaryDetail').textContent =
      `元本合計: ${manYen(result.principal)}\n運用益: ${manYen(gain)}`;

    const warnEl = $('nisaWarning');
    const warnings = [];
    if (result.rows.some((r) => r.overAnnual)) {
      warnings.push(`年間投資枠(360万円)を超えている年があります`);
    }
    if (result.nisaCumulative > NISA_LIFETIME_LIMIT) {
      warnings.push(`生涯投資枠(1800万円)を使い切っています(累計 ${manYen(result.nisaCumulative)})。それ以降はNISAの非課税メリットを受けられません`);
    }
    if (warnings.length) {
      warnEl.textContent = '⚠ ' + warnings.join(' / ');
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  }

  function renderWithdrawSummary(w) {
    $('withdrawStartHint').textContent = `${w.startAge}歳(積み立て終了時)から取り崩しを開始します`;
    $('withdrawSummaryLabel').textContent = `${w.startAge}歳、初年度の取り崩し額`;
    $('withdrawSummaryValue').textContent = manYen(w.annualWithdrawal) + ' /年';
    const monthly = w.annualWithdrawal / 12;
    let detail = `月あたり: ${manYen(monthly)}\n取り崩し開始時の資産額: ${manYen(w.base)}\n(残高に応じて、取り崩し額は毎年変わります)`;
    if (w.depletedAge !== null) {
      detail += `\n⚠ ${w.depletedAge}歳ごろに資産が尽きる見込みです`;
    } else if (w.rows.length) {
      detail += `\n${w.withdrawEndAge}歳時点の残高: ${manYen(w.rows[w.rows.length - 1].endBalance)}`;
    }
    $('withdrawSummaryDetail').textContent = detail;
  }

  function renderWithdrawTable(w) {
    const body = $('withdrawTableBody');
    body.innerHTML = '';
    w.rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (r.endBalance <= 0) tr.classList.add('over-limit-row');
      tr.innerHTML =
        `<td>${r.age}歳</td><td>${manYen(r.annualWithdrawal)}</td>` +
        `<td>${manYen(r.monthlyWithdrawal)}</td><td>${manYen(r.endBalance)}</td>`;
      body.appendChild(tr);
    });
  }

  // 行ごとのDOM要素(年齢をキー)を保持しておき、年齢範囲が変わらない限り
  // 入力欄そのものは作り直さない(作り直すとフォーカスが外れて連続入力できなくなるため)
  let rowEls = {};

  function buildTableRows(result) {
    const body = $('tableBody');
    body.innerHTML = '';
    rowEls = {};

    result.rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (r.age === result.startAge) tr.classList.add('current-age-row');
      if (r.overLifetime) tr.classList.add('over-limit-row');

      const ageTd = document.createElement('td');
      ageTd.textContent = `${r.age}歳`;
      tr.appendChild(ageTd);

      const contribTd = document.createElement('td');
      contribTd.className = 'contribution-cell';
      let inputEl = null;
      if (r.age === result.startAge) {
        contribTd.textContent = '-';
      } else {
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'contribution-input';
        inputEl.inputMode = 'numeric';
        inputEl.value = r.contribution / 10000;
        inputEl.addEventListener('input', (e) => {
          contributions[r.age] = Math.max(0, Number(e.target.value) || 0) * 10000;
          update(false);
        });
        selectAllOnFocus(inputEl);
        contribTd.appendChild(inputEl);
        const suffix = document.createElement('span');
        suffix.className = 'contribution-unit';
        suffix.textContent = '万円';
        contribTd.appendChild(suffix);
        if (r.overAnnual) inputEl.classList.add('over-limit-input');
      }
      tr.appendChild(contribTd);

      const balTd = document.createElement('td');
      balTd.textContent = manYen(r.balance);
      tr.appendChild(balTd);

      const gainTd = document.createElement('td');
      gainTd.textContent = manYen(r.gain);
      tr.appendChild(gainTd);

      body.appendChild(tr);
      rowEls[r.age] = { inputEl, balTd, gainTd, tr };
    });
  }

  function renderTable(result, forceRebuild) {
    const ages = result.rows.map((r) => r.age);

    // 表示中の年齢の並びが変わっていなければ、値だけ更新して入力欄は作り直さない
    const currentKeys = Object.keys(rowEls).map(Number).sort((a, b) => a - b);
    const newKeys = ages.slice().sort((a, b) => a - b);
    const sameRange =
      currentKeys.length === newKeys.length &&
      currentKeys.every((v, i) => v === newKeys[i]);

    if (forceRebuild || !sameRange) {
      buildTableRows(result);
      return;
    }

    // 年齢範囲が同じなら、値だけ更新して入力欄(フォーカス中の要素含む)は触らない
    result.rows.forEach((r) => {
      const els = rowEls[r.age];
      if (!els) return;
      if (els.inputEl && document.activeElement !== els.inputEl) {
        els.inputEl.value = r.contribution / 10000;
      }
      if (els.inputEl) els.inputEl.classList.toggle('over-limit-input', r.overAnnual);
      els.tr.classList.toggle('over-limit-row', r.overLifetime);
      els.balTd.textContent = manYen(r.balance);
      els.gainTd.textContent = manYen(r.gain);
    });
  }

  function renderChart(result, withdrawResult) {
    const canvas = $('chart');
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
    const cssHeight = 260;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.height = cssHeight + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const rows = result.rows;
    const wRows = (withdrawResult && withdrawResult.rows) || [];
    const totalPoints = rows.length + wRows.length;
    const maxBalance = Math.max(
      ...rows.map((r) => r.balance),
      ...wRows.map((r) => r.endBalance),
      1
    );

    const padL = 54, padR = 12, padT = 16, padB = 28;
    const plotW = cssWidth - padL - padR;
    const plotH = cssHeight - padT - padB;

    const xFor = (i) => padL + (totalPoints <= 1 ? 0 : (plotW * i) / (totalPoints - 1));
    const yFor = (v) => padT + plotH - (plotH * v) / maxBalance;

    ctx.strokeStyle = '#e1e6e2';
    ctx.fillStyle = '#66756c';
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    const gridSteps = 4;
    for (let g = 0; g <= gridSteps; g++) {
      const v = (maxBalance * g) / gridSteps;
      const y = yFor(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssWidth - padR, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(manYen(v), padL - 6, y + 3);
    }

    ctx.textAlign = 'center';
    const allAges = rows.map((r) => r.age).concat(wRows.map((r) => r.age));
    const labelEvery = Math.max(1, Math.ceil(totalPoints / 6));
    allAges.forEach((age, i) => {
      if (i % labelEvery === 0 || i === allAges.length - 1) {
        ctx.fillText(age + '歳', xFor(i), cssHeight - 8);
      }
    });

    // principal line (cumulative contribution)
    let cum = rows[0].balance;
    ctx.beginPath();
    ctx.strokeStyle = '#b7c2ba';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    rows.forEach((r, i) => {
      if (i === 0) cum = r.balance; else cum += r.contribution;
      const x = xFor(i);
      const y = yFor(cum);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // balance line
    ctx.beginPath();
    ctx.strokeStyle = '#1c6e4a';
    ctx.lineWidth = 3;
    rows.forEach((r, i) => {
      const x = xFor(i);
      const y = yFor(r.balance);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 取り崩しフェーズの続き(色を変えて、積み立てフェーズの終点から繋げる)
    if (wRows.length) {
      ctx.beginPath();
      ctx.strokeStyle = '#b5772e';
      ctx.lineWidth = 3;
      const startX = xFor(rows.length - 1);
      const startY = yFor(rows[rows.length - 1].balance);
      ctx.moveTo(startX, startY);
      wRows.forEach((r, i) => {
        const x = xFor(rows.length + i);
        const y = yFor(r.endBalance);
        ctx.lineTo(x, y);
      });
      ctx.stroke();

      const lastW = wRows[wRows.length - 1];
      ctx.beginPath();
      ctx.fillStyle = '#b5772e';
      ctx.arc(xFor(totalPoints - 1), yFor(lastW.endBalance), 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const last = rows[rows.length - 1];
      ctx.beginPath();
      ctx.fillStyle = '#1c6e4a';
      ctx.arc(xFor(rows.length - 1), yFor(last.balance), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function update(forceRebuild) {
    save();
    const result = simulate();
    const withdrawResult = simulateWithdrawal(result);
    renderSummary(result);
    renderTable(result, forceRebuild);
    renderWithdrawSummary(withdrawResult);
    renderWithdrawTable(withdrawResult);
    renderChart(result, withdrawResult);
  }

  Object.values(inputs).forEach((el) => {
    el.addEventListener('input', () => update(true));
    selectAllOnFocus(el);
  });
  Object.values(withdrawInputs).forEach((el) => {
    el.addEventListener('input', () => update(false));
    selectAllOnFocus(el);
  });
  selectAllOnFocus(bulkYearly);

  applyBulk.addEventListener('click', () => {
    const { age, endAge } = getAgeRange();
    const val = Math.max(0, Number(bulkYearly.value) || 0) * 10000;
    for (let a = age + 1; a <= endAge; a++) contributions[a] = val;
    update(true);
  });

  window.addEventListener('resize', () => {
    const result = simulate();
    renderChart(result, simulateWithdrawal(result));
  });

  defaultLoad();
  update(true);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
