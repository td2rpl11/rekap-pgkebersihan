(function () {
  'use strict';

  /* ====== KONFIGURASI SUPABASE ====== */
  var SUPABASE_URL = 'https://zlfqaohcckfvawgsszec.supabase.co';      // Project URL
  var SUPABASE_KEY = 'sb_publishable_Xlye1NNpvIYZ9syYRNvL0Q_dyLJeOOC'; // publishable / anon key
  /* ======================================================= */

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var PARAMS = [
    'Membersihkan Kloset/Urinor',
    'Menyikat Lantai',
    'Menyikat Dinding',
    'Menyediakan Tissue dan Sabun Tangan',
    'Membersihkan Wastafel dan Cermin',
    'Membuang Sampah',
    'Memeriksa dan Membersihkan saluran Air',
    'Membersihkan Keset Lantai'
  ];
  var MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var LOK = { wanita: 'Toilet (Wanita)', pria: 'Toilet (Pria)' };

  var $ = function (id) { return document.getElementById(id); };

  // Cache di memori; sumber data sebenarnya di Supabase
  var db = { petugas: [], forms: {} };
  var state = { role: 'ob', lokasi: 'wanita', bulan: new Date().getMonth(), tahun: new Date().getFullYear() };
  var okPin = '';

  /* ---------- Bantuan umum ---------- */
  function formKey() { return state.lokasi + '|' + state.tahun + '|' + state.bulan; }
  function newForm() {
    return { noForm: 'FM/TU-05', revisi: '0', tglTerbit: '', pj: '', ketua: '', ket: '', days: {} };
  }
  function getForm() {
    var k = formKey();
    if (!db.forms[k]) db.forms[k] = newForm();
    return db.forms[k];
  }
  function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function initials(name) {
    return name.trim().split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase();
  }
  function deviceId() {
    try {
      var d = localStorage.getItem('dev_id');
      if (!d) {
        d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
        localStorage.setItem('dev_id', d);
      }
      return d;
    } catch (e) { return 'no-storage'; }
  }

  /* ---------- Notifikasi kecil ---------- */
  function toast(text, ok) {
    var el = $('toastDb');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toastDb';
      el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);padding:8px 14px;border-radius:8px;color:#fff;font:14px sans-serif;z-index:9999;max-width:90%';
      document.body.appendChild(el);
      var st = document.createElement('style');
      st.textContent = '@media print{#toastDb{display:none!important}}';
      document.head.appendChild(st);
    }
    el.style.background = ok ? '#2e7d32' : '#c62828';
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.display = 'none'; }, ok ? 1500 : 5000);
  }

  /* ---------- Akses Supabase ---------- */
  async function must(p) {
    var r = await p;
    if (r.error) throw r.error;
    return r.data;
  }

  function dbUpsertDay(lokasi, tahun, bulan, tanggal, petugas, items) {
    return must(sb.from('checklist_entries').upsert({
      lokasi: lokasi, tahun: tahun, bulan: bulan + 1, tanggal: tanggal,
      petugas: petugas, items: items, updated_at: new Date().toISOString()
    }, { onConflict: 'lokasi,tahun,bulan,tanggal' }));
  }

  function dbDeleteDay(lokasi, tahun, bulan, tanggal) {
    return must(sb.from('checklist_entries').delete()
      .eq('lokasi', lokasi).eq('tahun', tahun).eq('bulan', bulan + 1).eq('tanggal', tanggal));
  }

  function dbUpsertSettings(ctx) {
    var f = ctx.f;
    return must(sb.from('form_settings').upsert({
      lokasi: ctx.lokasi, tahun: ctx.tahun, bulan: ctx.bulan + 1,
      no_formulir: f.noForm, revisi: f.revisi,
      tgl_terbit: f.tglTerbit || null,
      penanggung_jawab: f.pj, ketua: f.ketua, ket: f.ket,
      updated_at: new Date().toISOString()
    }, { onConflict: 'lokasi,tahun,bulan' }));
  }

  /* ---------- Simpan tertunda (agar tidak kirim tiap ketukan huruf) ---------- */
  var pending = {};
  function later(key, fn) {
    if (pending[key]) clearTimeout(pending[key].t);
    pending[key] = { fn: fn, t: setTimeout(function () { run(key); }, 700) };
  }
  function run(key) {
    var p = pending[key];
    if (!p) return Promise.resolve();
    clearTimeout(p.t);
    delete pending[key];
    return p.fn().then(function () { toast('Tersimpan', true); })
      .catch(function (e) { toast('Gagal menyimpan: ' + errText(e), false); });
  }
  function flush() {
    return Promise.all(Object.keys(pending).map(run));
  }

  function queueSaveSettings() {
    var ctx = { lokasi: state.lokasi, tahun: state.tahun, bulan: state.bulan, f: getForm() };
    later('f|' + formKey(), function () { return dbUpsertSettings(ctx); });
  }

  function queueSaveDay(day) {
    var ctx = { lokasi: state.lokasi, tahun: state.tahun, bulan: state.bulan, f: getForm() };
    later('d|' + formKey() + '|' + day, function () {
      var e = ctx.f.days[day];
      return e
        ? dbUpsertDay(ctx.lokasi, ctx.tahun, ctx.bulan, day, e.p || '', e.s)
        : dbDeleteDay(ctx.lokasi, ctx.tahun, ctx.bulan, day);
    });
  }

  /* ---------- Muat data dari Supabase ---------- */
  var loadSeq = 0;
  async function refresh() {
    var seq = ++loadSeq;
    var lokasi = state.lokasi, tahun = state.tahun, bulan = state.bulan;
    try {
      await flush();
      var res = await Promise.all([
        must(sb.from('form_settings').select('*')
          .eq('lokasi', lokasi).eq('tahun', tahun).eq('bulan', bulan + 1).maybeSingle()),
        must(sb.from('checklist_entries').select('tanggal, petugas, items')
          .eq('lokasi', lokasi).eq('tahun', tahun).eq('bulan', bulan + 1)),
        must(sb.from('petugas').select('nama').order('created_at', { ascending: true }))
      ]);
      if (seq !== loadSeq) return; // sudah ada permintaan yang lebih baru

      var s = res[0], rows = res[1], names = res[2];
      var f = newForm();
      if (s) {
        if (s.no_formulir != null) f.noForm = s.no_formulir;
        if (s.revisi != null) f.revisi = s.revisi;
        f.tglTerbit = s.tgl_terbit || '';
        f.pj = s.penanggung_jawab || '';
        f.ketua = s.ketua || '';
        f.ket = s.ket || '';
      }
      rows.forEach(function (r) { f.days[r.tanggal] = { s: r.items, p: r.petugas || '' }; });
      db.forms[lokasi + '|' + tahun + '|' + bulan] = f;
      db.petugas = names.map(function (r) { return r.nama; });
      renderAll();
    } catch (e) {
      if (seq === loadSeq) toast('Gagal memuat data: ' + (e.message || e), false);
    }
  }

  /* ---------- Login supervisor (username) ---------- */
  function errText(e) {
    var m = (e && e.message) || String(e);
    return /row-level security/i.test(m)
      ? 'Sesi login habis atau tidak punya izin. Silakan login ulang sebagai supervisor.'
      : m;
  }

  function showLogin() {
    var ov = $('loginOv');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'loginOv';
      ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:10000;padding:16px';
      ov.innerHTML =
        '<div style="background:#fff;color:#222;border-radius:10px;padding:20px;width:100%;max-width:340px;font:14px sans-serif">' +
        '<h3 style="margin:0 0 12px">Login Supervisor</h3>' +
        '<input id="loginEmail" type="text" placeholder="Username" autocomplete="username" autocapitalize="off" style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:8px">' +
        '<input id="loginPass" type="password" placeholder="Password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:8px">' +
        '<div id="loginErr" style="color:#c62828;min-height:18px;margin-bottom:8px"></div>' +
        '<button id="loginGo" type="button" style="padding:8px 14px">Masuk</button> ' +
        '<button id="loginBatal" type="button" style="padding:8px 14px">Batal</button>' +
        '</div>';
      document.body.appendChild(ov);
      var st = document.createElement('style');
      st.textContent = '@media print{#loginOv{display:none!important}}';
      document.head.appendChild(st);
      $('loginGo').onclick = doLogin;
      $('loginBatal').onclick = function () { ov.style.display = 'none'; };
      $('loginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    }
    $('loginErr').textContent = '';
    ov.style.display = 'flex';
    $('loginEmail').focus();
  }

  async function doLogin() {
    var user = $('loginEmail').value.trim().toLowerCase(), pass = $('loginPass').value;
    if (!user || !pass) { $('loginErr').textContent = 'Isi username dan password.'; return; }
    var email = user + '@checklist.local';
    $('loginGo').disabled = true;
    var r = await sb.auth.signInWithPassword({ email: email, password: pass });
    $('loginGo').disabled = false;
    if (r.error) {
      $('loginErr').textContent = r.error.status === 400
        ? 'Username atau password salah.'
        : 'Gagal login: ' + r.error.message;
      return;
    }
    $('loginPass').value = '';
    $('loginOv').style.display = 'none';
    setRole('sup'); refresh();
  }

  function initAuth() {
    var out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'Keluar (logout)';
    out.style.cssText = 'margin-bottom:10px';
    out.onclick = async function () { await sb.auth.signOut(); setRole('ob'); refresh(); };
    $('panelSup').insertBefore(out, $('panelSup').firstChild);
    sb.auth.onAuthStateChange(function (ev, s) {
      if (!s && state.role === 'sup') setRole('ob');
    });
  }

  /* ---------- Inisialisasi kontrol ---------- */
  function init() {
    MONTHS.forEach(function (m, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = m;
      $('bulan').appendChild(o);
    });
    $('bulan').value = state.bulan;
    $('tahun').value = state.tahun;
    $('tanggal').value = iso(state.tahun, state.bulan, new Date().getDate());

    // OB hanya boleh memilih hari ini atau kemarin
    var tt = new Date(), yy = new Date();
    yy.setDate(tt.getDate() - 1);
    $('tanggal').max = iso(tt.getFullYear(), tt.getMonth(), tt.getDate());
    $('tanggal').min = iso(yy.getFullYear(), yy.getMonth(), yy.getDate());

    buildItems();
    bind();
    setRole('ob');
    renderAll();
    refresh();
    initAuth();

    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    $('hintCetak').textContent = mobile
      ? 'Di HP: tekan "Cetak / Simpan PDF", lalu pilih "Simpan sebagai PDF" (atau "Save as PDF") pada tujuan cetak. Ukuran kertas A4 landscape sudah diatur otomatis.'
      : 'Di Windows: tekan "Cetak / Simpan PDF", lalu pilih printer atau "Simpan sebagai PDF" pada tujuan. Ukuran kertas A4 landscape sudah diatur otomatis.';
  }

  function buildItems() {
    var box = $('items');
    box.innerHTML = '';
    PARAMS.forEach(function (p, i) {
      var row = document.createElement('div');
      row.className = 'item';
      row.innerHTML =
        '<div class="nm">' + (i + 1) + '. ' + p + '</div>' +
        '<div class="seg">' +
        '<label data-v="1"><input type="radio" name="s' + i + '" value="1"><span>o Bersih</span></label>' +
        '<label data-v="2"><input type="radio" name="s' + i + '" value="2"><span>x Kotor</span></label>' +
        '</div>';
      box.appendChild(row);
    });
    box.addEventListener('change', paintSeg);
  }

  function paintSeg() {
    var labels = $('items').querySelectorAll('label');
    labels.forEach(function (l) {
      var on = l.querySelector('input').checked;
      l.classList.toggle('on-ok', on && l.dataset.v === '1');
      l.classList.toggle('on-bad', on && l.dataset.v === '2');
    });
  }

  function bind() {
    $('tabOb').onclick = function () { setRole('ob'); refresh(); };
    $('tabSup').onclick = async function () {
      var r = await sb.auth.getSession();
      if (!r.data.session) { showLogin(); return; }
      setRole('sup'); refresh();
    };

    $('lokasi').onchange = function () { state.lokasi = this.value; renderAll(); refresh(); };
    $('bulan').onchange = function () { state.bulan = +this.value; syncDateToMonth(); renderAll(); refresh(); };
    $('tahun').onchange = function () {
      var y = parseInt(this.value, 10);
      if (!y) { this.value = state.tahun; return; }
      state.tahun = y; syncDateToMonth(); renderAll(); refresh();
    };
    $('tanggal').onchange = function () {
      if (!this.value) return;
      var p = this.value.split('-');
      state.tahun = +p[0]; state.bulan = +p[1] - 1;
      $('tahun').value = state.tahun; $('bulan').value = state.bulan;
      renderAll(); refresh();
    };

    $('btnPin').onclick = verifyPin;
    $('pinOb').addEventListener('keydown', function (e) { if (e.key === 'Enter') verifyPin(); });

    $('btnSemuaBersih').onclick = function () {
      PARAMS.forEach(function (_, i) { document.querySelector('input[name="s' + i + '"][value="1"]').checked = true; });
      paintSeg();
    };
    $('btnSimpanOb').onclick = saveOb;

    ['noForm', 'revisi', 'tglTerbit', 'pj', 'ketua'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        getForm()[id] = this.value;
        queueSaveSettings(); renderSheet();
      });
    });

    $('btnTambah').onclick = addPetugas;
    $('namaBaru').addEventListener('keydown', function (e) { if (e.key === 'Enter') addPetugas(); });
    $('btnHapusBulan').onclick = async function () {
      if (!confirm('Kosongkan semua centang bulan ' + MONTHS[state.bulan] + ' ' + state.tahun + ' untuk ' + LOK[state.lokasi] + '?')) return;
      try {
        await flush();
        await must(sb.from('checklist_entries').delete()
          .eq('lokasi', state.lokasi).eq('tahun', state.tahun).eq('bulan', state.bulan + 1));
        getForm().days = {};
        renderAll();
        toast('Centang bulan ini dikosongkan', true);
      } catch (e) {
        toast('Gagal mengosongkan: ' + (e.message || e), false);
      }
    };

    $('btnCetak').onclick = doPrint;
  }

  function syncDateToMonth() {
    var cur = $('tanggal').value ? +$('tanggal').value.split('-')[2] : 1;
    var d = Math.min(cur, daysIn(state.tahun, state.bulan));
    $('tanggal').value = iso(state.tahun, state.bulan, d);
  }

  function setRole(r) {
    state.role = r;
    $('tabOb').classList.toggle('active', r === 'ob');
    $('tabSup').classList.toggle('active', r === 'sup');
    $('panelOb').hidden = r !== 'ob';
    $('panelSup').hidden = r !== 'sup';
    renderSheet();
  }

  /* ---------- Sisi OB ---------- */
  function loadPanel() {
    var d = $('tanggal').value ? +$('tanggal').value.split('-')[2] : 0;
    var e = getForm().days[d];
    PARAMS.forEach(function (_, i) {
      var v = e ? e.s[i] : 0;
      var radios = document.getElementsByName('s' + i);
      radios[0].checked = v === 1;
      radios[1].checked = v === 2;
    });
    paintSeg();
  }

  function setMsg(text, ok) {
    var m = $('msgOb');
    m.textContent = text;
    m.className = 'msg ' + (ok ? 'ok' : 'err');
  }

  var pinLocked = false, pinTimer = null;

  // Hitung mundur saat PIN terkunci
  function lockCountdown(secs) {
    var m = $('msgPin');
    pinLocked = true;
    $('btnPin').disabled = true;
    clearInterval(pinTimer);
    function tick() {
      if (secs <= 0) {
        clearInterval(pinTimer);
        pinLocked = false;
        $('btnPin').disabled = false;
        m.textContent = 'Silakan coba masukkan PIN lagi.';
        m.className = 'msg ok';
        return;
      }
      m.textContent = 'Terlalu banyak PIN salah. Coba lagi ' + secs + ' detik lagi.';
      m.className = 'msg err';
      secs--;
    }
    tick();
    pinTimer = setInterval(tick, 1000);
  }

  async function verifyPin() {
    if (pinLocked) return;
    var pin = $('pinOb').value.trim();
    var m = $('msgPin');
    if (!/^\d{6}$/.test(pin)) { m.textContent = 'PIN harus 6 digit angka.'; m.className = 'msg err'; return; }
    $('btnPin').disabled = true;
    m.textContent = 'Mengecek…'; m.className = 'msg ok';
    try {
      var r = await must(sb.rpc('cek_pin', { p_pin: pin, p_device: deviceId() }));
      if (!r.ok) {
        okPin = ''; $('obForm').hidden = true;
        var lk = /(\d+) detik/.exec(r.error || '');
        if (lk) {
          lockCountdown(+lk[1]);
        } else {
          m.textContent = r.error; m.className = 'msg err';
        }
      } else {
        okPin = pin;
        $('namaOb').textContent = 'Halo, ' + r.nama;
        m.textContent = '';
        $('obForm').hidden = false;
        setMsg('', true);
        loadPanel();
      }
    } catch (e) {
      m.textContent = 'Gagal: ' + (e.message || e); m.className = 'msg err';
    }
    if (!pinLocked) $('btnPin').disabled = false;
  }

  async function saveOb() {
    if (!okPin) { setMsg('Masukkan PIN dulu.', false); return; }
    if (!$('tanggal').value) { setMsg('Tanggal membersihkan belum diisi.', false); return; }
    var s = [];
    for (var i = 0; i < PARAMS.length; i++) {
      var v = 0;
      var radios = document.getElementsByName('s' + i);
      if (radios[0].checked) v = 1; else if (radios[1].checked) v = 2;
      if (!v) { setMsg('Masih ada yang belum dipilih: nomor ' + (i + 1) + ' (' + PARAMS[i] + ').', false); return; }
      s.push(v);
    }
    var d = +$('tanggal').value.split('-')[2];
    var btn = $('btnSimpanOb');
    btn.disabled = true;
    setMsg('Menyimpan…', true);
    try {
      var r = await must(sb.rpc('simpan_checklist', {
        p_pin: okPin, p_device: deviceId(), p_lokasi: state.lokasi,
        p_tahun: state.tahun, p_bulan: state.bulan + 1, p_tanggal: d, p_items: s
      }));
      if (!r.ok) {
        setMsg(r.error, false);
      } else {
        getForm().days[d] = { s: s, p: r.nama };
        renderSheet();
        okPin = ''; $('pinOb').value = ''; $('obForm').hidden = true;
        var m = $('msgPin');
        m.textContent = 'Tersimpan: tanggal ' + d + ' ' + MONTHS[state.bulan] + ' ' + state.tahun + ' oleh ' + r.nama + '.';
        m.className = 'msg ok';
      }
    } catch (e) {
      setMsg('Gagal menyimpan: ' + (e.message || e), false);
    }
    btn.disabled = false;
  }

  /* ---------- Sisi Supervisor ---------- */
  async function addPetugas() {
    var n = $('namaBaru').value.trim();
    if (!n) return;
    if (db.petugas.some(function (x) { return x.toLowerCase() === n.toLowerCase(); })) { $('namaBaru').value = ''; return; }
    try {
      await must(sb.from('petugas').insert({ nama: n }));
      db.petugas.push(n);
      $('namaBaru').value = '';
      renderPetugasLists();
    } catch (e) {
      toast('Gagal menambah nama: ' + (e.message || e), false);
    }
  }

  function renderPetugasLists() {
    var ul = $('chips');
    ul.innerHTML = '';
    db.petugas.forEach(function (n) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(n));

      var pb = document.createElement('button');
      pb.type = 'button'; pb.className = 'pin'; pb.textContent = 'PIN';
      pb.title = 'Buat / reset PIN ' + n;
      pb.onclick = async function () {
        if (!confirm('Buat PIN baru untuk ' + n + '? PIN lama tidak berlaku lagi.')) return;
        try {
          var pin = await must(sb.rpc('buat_pin', { p_nama: n }));
          alert('PIN untuk ' + n + ': ' + pin + '\n\nCatat dan berikan langsung ke yang bersangkutan. PIN tidak bisa dilihat lagi.');
        } catch (e) {
          toast('Gagal membuat PIN: ' + (e.message || e), false);
        }
      };
      li.appendChild(pb);

      var b = document.createElement('button');
      b.type = 'button'; b.textContent = '×'; b.title = 'Hapus ' + n;
      b.onclick = async function () {
        if (!confirm('Hapus ' + n + ' dari daftar petugas? PIN-nya ikut terhapus.')) return;
        try {
          await must(sb.from('petugas').delete().eq('nama', n));
          db.petugas.splice(db.petugas.indexOf(n), 1);
          renderPetugasLists();
        } catch (e) {
          toast('Gagal menghapus nama: ' + (e.message || e), false);
        }
      };
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  /* ---------- Render lembar formulir ---------- */
  function renderAll() {
    var f = getForm();
    $('noForm').value = f.noForm;
    $('revisi').value = f.revisi;
    $('tglTerbit').value = f.tglTerbit;
    $('pj').value = f.pj;
    $('ketua').value = f.ketua;
    renderPetugasLists();
    loadPanel();
    renderSheet();
  }

  function fmtDate(s) {
    if (!s) return '    /    /' + state.tahun;
    var p = s.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function renderSheet() {
    var f = getForm();
    var n = daysIn(state.tahun, state.bulan);
    var edit = state.role === 'sup';

    $('vNoForm').textContent = f.noForm;
    $('vRevisi').textContent = f.revisi;
    $('vTgl').textContent = fmtDate(f.tglTerbit);
    $('vLokasi').textContent = LOK[state.lokasi];
    $('vBulan').textContent = MONTHS[state.bulan];
    $('vTahun').textContent = state.tahun;
    $('vPj').textContent = f.pj;
    $('vKetua').textContent = f.ketua;

    var names = [];
    Object.keys(f.days).forEach(function (d) {
      var p = f.days[d].p;
      if (p && names.indexOf(p) < 0) names.push(p);
    });
    $('vPetugas').textContent = names.join(', ');

    var t = $('tbl');
    t.innerHTML = '';

    var head1 = '<tr><th rowspan="2" class="c-no">NO</th><th rowspan="2" class="c-par">PARAMETER PENGECEKAN</th><th colspan="31">TANGGAL</th><th rowspan="2" class="c-ket">KETERANGAN</th></tr>';
    var head2 = '<tr>';
    for (var d = 1; d <= 31; d++) head2 += '<th class="c-day">' + d + '</th>';
    head2 += '</tr>';
    t.insertAdjacentHTML('beforeend', head1 + head2);

    function dayClass(day) {
      if (day > n) return 'off';
      var w = new Date(state.tahun, state.bulan, day).getDay();
      return (w === 0 || w === 6) ? 'wk' : '';
    }

    PARAMS.forEach(function (p, r) {
      var tr = document.createElement('tr');
      var html = '<td>' + (r + 1) + '</td><td class="c-par">' + p + '</td>';
      tr.innerHTML = html;
      for (var day = 1; day <= 31; day++) {
        var td = document.createElement('td');
        var cls = dayClass(day);
        var e = f.days[day];
        var v = e ? e.s[r] : 0;
        if (v === 1) { td.textContent = 'o'; cls += ' ok'; }
        if (v === 2) { td.textContent = 'x'; cls += ' bad'; }
        if (edit && day <= n) { cls += ' edit'; td.onclick = makeToggle(day, r); }
        td.className = cls.trim();
        tr.appendChild(td);
      }
      if (r === 0) {
        var k = document.createElement('td');
        k.className = 'c-ket';
        k.rowSpan = PARAMS.length + 1;
        var ta = document.createElement('textarea');
        ta.value = f.ket;
        ta.placeholder = 'Catatan';
        ta.readOnly = !edit;
        ta.addEventListener('input', function () { getForm().ket = ta.value; queueSaveSettings(); });
        k.appendChild(ta);
        tr.appendChild(k);
      }
      t.appendChild(tr);
    });

    var pr = document.createElement('tr');
    pr.className = 'paraf';
    pr.innerHTML = '<td colspan="2" class="c-par">PARAF PELAKSANA</td>';
    for (var dd = 1; dd <= 31; dd++) {
      var c = document.createElement('td');
      c.className = dayClass(dd);
      var en = f.days[dd];
      if (en && en.p) { c.textContent = initials(en.p); c.title = en.p; }
      pr.appendChild(c);
    }
    t.appendChild(pr);
  }

  function makeToggle(day, row) {
    return function () {
      var f = getForm();
      if (!f.days[day]) f.days[day] = { s: PARAMS.map(function () { return 0; }), p: '' };
      f.days[day].s[row] = (f.days[day].s[row] + 1) % 3;
      var e = f.days[day];
      if (e.s.every(function (x) { return x === 0; }) && !e.p) delete f.days[day];
      queueSaveDay(day);
      renderSheet();
    };
  }

  /* ---------- Cetak / PDF ---------- */
  function doPrint() {
    var old = document.title;
    document.title = 'Checklist-Toilet-' +
      (state.lokasi === 'wanita' ? 'Wanita' : 'Pria') + '-' +
      MONTHS[state.bulan] + '-' + state.tahun;
    var restore = function () {
      document.title = old;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  init();
})();